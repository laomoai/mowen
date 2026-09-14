import { Hono } from 'hono'
import type { AuthVariables, Env } from '../types'
import { getUserTables, getTableColumns, isValidIdentifier } from '../utils/schema-cache'
import { buildSelectSQL, parseFilters } from '../utils/query-builder'
import { requireWriteMiddleware } from '../middleware/auth'
import { getAccessibleNoteIds } from '../utils/note-access'
import { getFieldMeta } from './fields'
import type { AppDatabase, AppPreparedStatement } from '../db/sqlite'
import { diffSnapshots, savePreimage, type RevisionRow } from '../utils/revisions'
import { diffTableRows, reconstructTableVersion, saveTableChange, type TableRevisionRow } from '../utils/table-revisions'
import { getRunningBalanceField } from '../utils/computed-fields'

const records = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

type SelectOpt = { id?: string; value: string; label: string; color: string }
type FieldMetaRow = {
  column_name: string
  field_type: string
  select_options: unknown[] | null
  formula_config: unknown | null
}

const SELECT_COLORS = ['#4f6ef7', '#18a058', '#f0a020', '#d03050', '#8a2be2', '#00ced1']

/**
 * 针对多行数据，检查 select 字段中是否有不存在的选项值，
 * 若有则自动追加并返回需要更新 _field_meta 的 PreparedStatement 列表。
 */
function buildSelectOptionStmts(
  db: AppDatabase,
  tableName: string,
  fieldMeta: FieldMetaRow[],
  rows: Record<string, unknown>[],
): AppPreparedStatement[] {
  const stmts: AppPreparedStatement[] = []

  for (const field of fieldMeta) {
    if (field.field_type !== 'select') continue

    const existing = (field.select_options ?? []) as SelectOpt[]
    const existingValues = new Set(existing.map(o => o.value))

    // 收集所有行中该字段的新值（去重）
    const newValues: string[] = []
    for (const row of rows) {
      const val = row[field.column_name]
      if (val == null || val === '') continue
      const str = String(val)
      if (!existingValues.has(str) && !newValues.includes(str)) {
        newValues.push(str)
      }
    }

    if (newValues.length === 0) continue

    const updated = [...existing]
    for (let i = 0; i < newValues.length; i++) {
      updated.push({
        id: Math.random().toString(36).slice(2, 10),
        value: newValues[i],
        label: newValues[i],
        color: SELECT_COLORS[(existing.length + i) % SELECT_COLORS.length],
      })
    }

    stmts.push(
      db.prepare(`UPDATE _field_meta SET select_options = ? WHERE table_name = ? AND column_name = ?`)
        .bind(JSON.stringify(updated), tableName, field.column_name)
    )
  }

  return stmts
}

/**
 * GET /api/tables/:tableName/records
 *
 * 查询参数：
 *   page_size=20          每页条数（默认20，最大100）
 *   cursor=<id>           上一页最后一条 id（keyset 分页）
 *   filter[field]=value   筛选（eq）
 *   filter[field__gt]=v   筛选（gt/gte/lt/lte/like/nlike/ne）
 *   sort=field:asc|desc   排序
 *   fields=f1,f2          只返回指定字段
 *
 * SQLite 查询优化：
 * - keyset 分页：只读 page_size 行，不扫描历史数据
 * - fields 指定字段：减少数据传输和 JSON 序列化开销
 * - 不做 COUNT(*)：避免全表扫描；total 从 _meta 表取（1行）
 */
records.get('/:tableName/records', async (c) => {
  const { tableName } = c.req.param()
  const query = c.req.query()

  // 三个独立查询并行：表存在验证 + 列结构（构建 SQL 用）+ 字段展示元数据
  const [allTables, cols, fieldMeta] = await Promise.all([
    getUserTables(c.env.DB),
    getTableColumns(c.env.DB, tableName),
    getFieldMeta(c.env.DB, tableName),
  ])

  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }

  const allColumns = cols.map((c) => c.name)
  const runningBalance = getRunningBalanceField(fieldMeta)
  const allowedColumns = runningBalance
    ? [...allColumns, runningBalance.columnName]
    : allColumns

  // 解析 fields 参数（白名单校验）
  const requestedFields = query.fields
    ? query.fields.split(',').filter((f) => allowedColumns.includes(f.trim())).map((f) => f.trim())
    : []

  // 解析筛选条件（白名单校验在 parseFilters 内完成）
  const filters = parseFilters(query, allowedColumns)

  // 解析排序
  let sort: { field: string; dir: 'ASC' | 'DESC' } | undefined
  if (query.sort) {
    const [field, dir] = query.sort.split(':')
    if (field && allowedColumns.includes(field)) {
      sort = { field, dir: dir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC' }
    }
  }

  // 解析分页参数
  const pageSize = Math.min(parseInt(query.page_size ?? '20', 10) || 20, 100)
  const usesComputedDefaultSort = !!runningBalance && !sort
  const hasPageParam = query.page !== undefined || usesComputedDefaultSort
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1)
  const cursor = query.cursor ? parseInt(query.cursor, 10) : undefined
  // page 参数优先于 cursor；二者同时存在时忽略 cursor
  const offset = hasPageParam && page > 1 ? (page - 1) * pageSize : undefined
  if (usesComputedDefaultSort && cursor !== undefined) {
    return c.json({ error: { code: 'PAGE_REQUIRED_FOR_COMPUTED_SORT', message: '累计余额表默认按业务日期排序，请使用 page 分页' } }, 400)
  }
  if (!hasPageParam && cursor !== undefined && sort?.field === runningBalance?.columnName) {
    return c.json({ error: { code: 'PAGE_REQUIRED_FOR_COMPUTED_SORT', message: '累计余额排序请使用 page 分页' } }, 400)
  }

  const { sql, params } = buildSelectSQL({
    tableName,
    selectFields: requestedFields,
    filters,
    sort,
    cursor: hasPageParam ? undefined : cursor,
    pageSize,
    offset,
    searchableFields: allColumns.filter((name) => name !== 'id'),
    runningBalance,
  })

  const result = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = result.results as Record<string, unknown>[]

  // next_cursor：取最后一条记录的 id
  const lastRow = rows[rows.length - 1]
  const nextCursor =
    !hasPageParam && sort?.field !== runningBalance?.columnName && rows.length === pageSize && lastRow && 'id' in lastRow
      ? String(lastRow.id)
      : null

  const fields: Record<string, { title: string; field_type: string }> = {}
  for (const f of fieldMeta) {
    fields[f.column_name] = { title: f.title, field_type: f.field_type }
  }

  // 格式化日期时间字段（Unix 时间戳 → ISO 8601）
  const formattedRows = formatDatetimeFields(rows, fieldMeta)

  // 解析 link 字段值（ID → {id, title}）
  const linkFields = getLinkFields(fieldMeta)
  const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, c.get('teamId'), c.get('allowedNoteRootIds'))
  await resolveLinkValues(c.env.DB, formattedRows, linkFields, allowedNoteIds)

  return c.json({
    data: formattedRows,
    fields,
    meta: {
      page_size: pageSize,
      count: rows.length,
      next_cursor: nextCursor,
    },
  })
})

/**
 * GET /api/tables/:tableName/records/search
 * 简化版搜索：返回 id + primary field，用于 link 字段的记录选择器
 * 查询参数：q=搜索词，limit=数量（默认20）
 */
records.get('/:tableName/records/search', async (c) => {
  const { tableName } = c.req.param()
  const query = c.req.query()
  const limit = Math.min(parseInt(query.limit ?? '20', 10) || 20, 50)
  const q = query.q?.trim()

  // 特殊处理 _notes：直接搜索 _notes 表
  if (tableName === '_notes') {
    const teamId = c.get('teamId')
    const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, teamId, c.get('allowedNoteRootIds'))
    const teamClause = teamId !== undefined ? 'team_id = ?' : '1=1'
    const baseParams: unknown[] = teamId !== undefined ? [teamId] : []
    let sql: string
    let params: unknown[]
    if (q) {
      sql = `SELECT id, title FROM _notes WHERE ${teamClause} AND deleted_at IS NULL AND title LIKE ? ORDER BY updated_at DESC LIMIT ?`
      params = [...baseParams, `%${q}%`, limit]
    } else {
      sql = `SELECT id, title FROM _notes WHERE ${teamClause} AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`
      params = [...baseParams, limit]
    }
    const result = await c.env.DB.prepare(sql).bind(...params).all<{ id: string; title: string | null }>()
    const rows = allowedNoteIds === null
      ? result.results
      : result.results.filter((row) => allowedNoteIds.has(row.id))
    return c.json({
      data: rows.map(r => ({ id: r.id, title: r.title || 'Untitled' }))
    })
  }

  const allTables = await getUserTables(c.env.DB)
  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }

  // 支持指定显示字段（link_display_field），否则用 primaryField；校验列是否存在
  const displayFieldParam = query.display_field?.trim()
  let displayField: string | null = null
  if (displayFieldParam && isValidIdentifier(displayFieldParam)) {
    const exists = await c.env.DB.prepare(
      `SELECT 1 FROM _field_meta WHERE table_name = ? AND column_name = ?`
    ).bind(tableName, displayFieldParam).first()
    if (exists) displayField = displayFieldParam
  }
  if (!displayField) {
    displayField = await getTablePrimaryField(c.env.DB, tableName)
  }
  if (!displayField) {
    return c.json({ data: [] })
  }

  let sql: string
  let params: unknown[]
  if (q) {
    sql = `SELECT id, "${displayField}" as title FROM "${tableName}" WHERE "${displayField}" LIKE ? ORDER BY id DESC LIMIT ?`
    params = [`%${q}%`, limit]
  } else {
    sql = `SELECT id, "${displayField}" as title FROM "${tableName}" ORDER BY id DESC LIMIT ?`
    params = [limit]
  }

  const result = await c.env.DB.prepare(sql).bind(...params).all<{ id: number; title: string | null }>()
  let rows = result.results.map(r => ({ id: String(r.id), title: r.title ?? `#${r.id}` }))

  // 如果 displayField 本身是 link 类型，title 存的是 ID，需要嵌套解析
  const dfMeta = await c.env.DB.prepare(
    `SELECT field_type, select_options FROM _field_meta WHERE table_name = ? AND column_name = ?`
  ).bind(tableName, displayField).first<{ field_type: string; select_options: string | null }>()

  if (dfMeta?.field_type === 'link' && dfMeta.select_options) {
    const cfg = JSON.parse(dfMeta.select_options) as { link_table?: string; link_display_field?: string }
    if (cfg.link_table) {
      const ids = rows.map(r => r.title).filter(t => t && !t.startsWith('#'))
      if (ids.length > 0) {
        const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, c.get('teamId'), c.get('allowedNoteRootIds'))
        const resolved = await resolveNestedLinkIds(c.env.DB, cfg.link_table, ids, cfg.link_display_field, allowedNoteIds)
        rows = rows.map(r => ({ ...r, title: resolved.get(r.title) ?? r.title }))
      }
    }
  }

  return c.json({ data: rows })
})

records.get('/:tableName/revisions', async (c) => {
  const { tableName } = c.req.param()
  const allTables = await getUserTables(c.env.DB)
  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }
  const meta = await c.env.DB.prepare(`SELECT team_id FROM _meta WHERE table_name = ?`).bind(tableName).first<{ team_id: number | null }>()
  const teamId = c.get('teamId') ?? meta?.team_id ?? 0
  const rows = await c.env.DB.prepare(
    `SELECT id, table_version, action, changed_record_ids_json, actor_user_id, actor_api_key_id,
            auth_mode, restore_from_id, created_at
     FROM _table_revisions WHERE team_id = ? AND table_name = ?
     ORDER BY table_version DESC LIMIT 100`,
  ).bind(teamId, tableName).all<Omit<TableRevisionRow, 'before_rows_json' | 'after_rows_json'>>()
  const head = await c.env.DB.prepare(
    `SELECT current_version FROM _table_revision_heads WHERE team_id = ? AND table_name = ?`,
  ).bind(teamId, tableName).first<{ current_version: number }>()
  return c.json({
    data: rows.results.map(row => ({
      ...row,
      target_version: row.table_version - 1,
      changed_record_ids: JSON.parse(row.changed_record_ids_json),
    })),
    current_version: head?.current_version ?? 1,
  })
})

records.get('/:tableName/revisions/:revisionId', async (c) => {
  const { tableName, revisionId } = c.req.param()
  const allTables = await getUserTables(c.env.DB)
  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }
  const meta = await c.env.DB.prepare(`SELECT team_id FROM _meta WHERE table_name = ?`).bind(tableName).first<{ team_id: number | null }>()
  const teamId = c.get('teamId') ?? meta?.team_id ?? 0
  const revision = await c.env.DB.prepare(
    `SELECT * FROM _table_revisions WHERE id = ? AND team_id = ? AND table_name = ?`,
  ).bind(revisionId, teamId, tableName).first<TableRevisionRow>()
  if (!revision) return c.json({ error: { code: 'REVISION_NOT_FOUND', message: 'Revision not found' } }, 404)
  const [currentResult, laterResult] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM "${tableName}" ORDER BY id`).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT * FROM _table_revisions
       WHERE team_id = ? AND table_name = ? AND table_version >= ?
       ORDER BY table_version DESC`,
    ).bind(teamId, tableName, revision.table_version).all<TableRevisionRow>(),
  ])
  const historical = reconstructTableVersion(laterResult.results, currentResult.results)
  return c.json({ data: {
    ...revision,
    target_version: revision.table_version - 1,
    changed_record_ids: JSON.parse(revision.changed_record_ids_json),
    changes: diffTableRows(historical, currentResult.results),
  } })
})

records.post('/:tableName/restore-version', requireWriteMiddleware, async (c) => {
  const { tableName } = c.req.param()
  const body = await c.req.json<{ revision_id: number; base_version?: number }>()
  const [allTables, cols] = await Promise.all([
    getUserTables(c.env.DB),
    getTableColumns(c.env.DB, tableName),
  ])
  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }
  const validColumns = new Set(cols.map(col => col.name))
  const actor = { userId: c.get('userId'), apiKeyId: c.get('apiKeyId'), authMode: c.get('authMode') }
  try {
    const version = c.env.DB.transaction((tx) => {
      const meta = tx.first<{ team_id: number | null }>(`SELECT team_id FROM _meta WHERE table_name = ?`, tableName)
      const teamId = c.get('teamId') ?? meta?.team_id ?? 0
      const revision = tx.first<TableRevisionRow>(
        `SELECT * FROM _table_revisions WHERE id = ? AND team_id = ? AND table_name = ?`,
        body.revision_id, teamId, tableName,
      )
      if (!revision) throw new Error('REVISION_NOT_FOUND')
      const head = tx.first<{ current_version: number }>(
        `SELECT current_version FROM _table_revision_heads WHERE team_id = ? AND table_name = ?`,
        teamId, tableName,
      )
      const currentVersion = head?.current_version ?? 1
      if (body.base_version !== undefined && currentVersion !== body.base_version) throw new Error('REVISION_CONFLICT')
      const currentRows = tx.all<Record<string, unknown>>(`SELECT * FROM "${tableName}" ORDER BY id`)
      const later = tx.all<TableRevisionRow>(
        `SELECT * FROM _table_revisions
         WHERE team_id = ? AND table_name = ? AND table_version >= ?
         ORDER BY table_version DESC`,
        teamId, tableName, revision.table_version,
      )
      const targetRows = reconstructTableVersion(later, currentRows)
      const nextVersion = saveTableChange(tx, teamId, tableName, currentRows, targetRows, actor, 'restore', revision.id)
      tx.run(`DELETE FROM "${tableName}"`)
      for (const row of targetRows) {
        const fields = Object.keys(row).filter(field => validColumns.has(field))
        if (!fields.length) continue
        tx.run(
          `INSERT INTO "${tableName}" (${fields.map(field => `"${field}"`).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
          ...fields.map(field => row[field]),
        )
      }
      tx.run(`UPDATE _meta SET row_count = ?, updated_at = unixepoch() WHERE table_name = ?`, targetRows.length, tableName)
      return nextVersion
    })
    return c.json({ data: { success: true, version } })
  } catch (error) {
    const message = (error as Error).message
    if (message === 'REVISION_NOT_FOUND') return c.json({ error: { code: 'REVISION_NOT_FOUND', message: 'Revision not found' } }, 404)
    if (message === 'REVISION_CONFLICT') return c.json({ error: { code: 'VERSION_CONFLICT', message: 'The table has changed; reload before restoring' } }, 409)
    throw error
  }
})

/**
 * GET /api/tables/:tableName/records/:id
 * 查询单条记录
 * 通过主键查询单行。
 */
records.get('/:tableName/records/:id', async (c) => {
  const { tableName, id } = c.req.param()

  // 表验证 + 列结构 + 字段元数据并行
  const [allTables, cols, fieldMeta] = await Promise.all([
    getUserTables(c.env.DB),
    getTableColumns(c.env.DB, tableName),
    getFieldMeta(c.env.DB, tableName),
  ])

  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }

  const runningBalance = getRunningBalanceField(fieldMeta)
  const { sql, params } = buildSelectSQL({
    tableName,
    selectFields: [],
    filters: [{ field: 'id', op: 'eq', value: id }],
    pageSize: 1,
    searchableFields: cols.map(col => col.name).filter(name => name !== 'id'),
    runningBalance,
  })
  const rowResult = await c.env.DB.prepare(sql).bind(...params).first()

  if (!rowResult) {
    return c.json({ error: { code: 'RECORD_NOT_FOUND', message: 'Record not found' } }, 404)
  }

  const fields: Record<string, { title: string; field_type: string }> = {}
  for (const f of fieldMeta) {
    fields[f.column_name] = { title: f.title, field_type: f.field_type }
  }

  const [formattedRow] = formatDatetimeFields([rowResult as Record<string, unknown>], fieldMeta)

  // 解析 link 字段值
  const linkFields = getLinkFields(fieldMeta)
  const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, c.get('teamId'), c.get('allowedNoteRootIds'))
  await resolveLinkValues(c.env.DB, [formattedRow], linkFields, allowedNoteIds)

  return c.json({ data: formattedRow, fields })
})

/**
 * POST /api/tables/:tableName/records
 * 新增记录
 * 写入记录后同步更新 _meta 计数。
 */
records.post('/:tableName/records', requireWriteMiddleware, async (c) => {
  const { tableName } = c.req.param()

  const [allTables, cols, fieldMeta] = await Promise.all([
    getUserTables(c.env.DB),
    getTableColumns(c.env.DB, tableName),
    getFieldMeta(c.env.DB, tableName),
  ])

  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }

  // 排除主键（自增）以及有 SQL 表达式默认值的列（如 created_at DEFAULT (unixepoch())）
  // 这类列由数据库自动填写，用户传 null 会触发 NOT NULL 违反
  const writableCols = cols.filter(
    (c) => c.pk === 0 && !(c.dflt_value?.includes('('))
  )
  const allowedNames = writableCols.map((c) => c.name)

  const body = await c.req.json<Record<string, unknown>>()

  // 只保留合法字段
  const fields = Object.keys(body).filter((k) => allowedNames.includes(k))
  if (fields.length === 0) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'No valid fields provided in request body' } }, 400)
  }

  const values = fields.map((f) => body[f])
  const placeholders = fields.map(() => '?').join(', ')
  const columnList = fields.map((f) => `"${f}"`).join(', ')

  // 前置校验：NOT NULL 且无默认值的字段不能为 null
  const requiredCols = writableCols.filter((c) => c.notnull === 1 && c.dflt_value === null)
  const missing = requiredCols.filter((c) => {
    const val = body[c.name]
    return val === null || val === undefined
  })
  if (missing.length > 0) {
    return c.json({
      error: {
        code: 'REQUIRED_FIELDS_MISSING',
        message: `The following fields are required: ${missing.map((c) => c.name).join(', ')}`,
      },
    }, 400)
  }

  const insertSQL = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})`
  const optionStmts = buildSelectOptionStmts(c.env.DB, tableName, fieldMeta, [body])

  try {
    const actor = { userId: c.get('userId'), apiKeyId: c.get('apiKeyId'), authMode: c.get('authMode') }
    const newRow = c.env.DB.transaction((tx) => {
      const meta = tx.first<{ team_id: number | null }>(`SELECT team_id FROM _meta WHERE table_name = ?`, tableName)
      const teamId = c.get('teamId') ?? meta?.team_id ?? 0
      const inserted = tx.run(insertSQL, ...values)
      const row = tx.first<Record<string, unknown>>(`SELECT * FROM "${tableName}" WHERE id = ?`, inserted.last_row_id)!
      tx.run(
        `INSERT INTO _meta (table_name, row_count) VALUES (?, 1)
         ON CONFLICT(table_name) DO UPDATE SET row_count = row_count + 1, updated_at = unixepoch()`,
        tableName,
      )
      saveTableChange(tx, teamId, tableName, [], [row], actor, 'insert')
      return row
    })
    if (optionStmts.length) await c.env.DB.batch(optionStmts)

    return c.json({ data: newRow }, 201)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.includes('NOT NULL constraint')) {
      const col = msg.match(/NOT NULL constraint failed: \w+\.(\w+)/)?.[1]
      return c.json({
        error: { code: 'REQUIRED_FIELDS_MISSING', message: `Field "${col ?? 'unknown'}" is required` },
      }, 400)
    }
    throw err // 其他错误继续抛出
  }
})

/**
 * PATCH /api/tables/:tableName/records/:id
 * 更新记录（只更新请求体中提供的字段）
 * 更新单条记录。
 */
records.patch('/:tableName/records/:id', requireWriteMiddleware, async (c) => {
  const { tableName, id } = c.req.param()

  const [allTables, cols, fieldMeta] = await Promise.all([
    getUserTables(c.env.DB),
    getTableColumns(c.env.DB, tableName),
    getFieldMeta(c.env.DB, tableName),
  ])

  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }

  const writableCols = cols.filter((c) => c.pk === 0)
  const allowedNames = writableCols.map((c) => c.name)

  const body = await c.req.json<Record<string, unknown> & { base_version?: number }>()
  const fields = Object.keys(body).filter((k) => allowedNames.includes(k))

  if (fields.length === 0) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'No valid fields provided in request body' } }, 400)
  }

  const setClause = fields.map((f) => `"${f}" = ?`).join(', ')
  const values = [...fields.map((f) => body[f]), id]
  const optionStmts = buildSelectOptionStmts(c.env.DB, tableName, fieldMeta, [body])

  const actor = { userId: c.get('userId'), apiKeyId: c.get('apiKeyId'), authMode: c.get('authMode') }
  try {
    const version = c.env.DB.transaction((tx) => {
      const existing = tx.first<Record<string, unknown>>(`SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`, id)
      if (!existing) throw new Error('REVISION_RECORD_NOT_FOUND')
      const meta = tx.first<{ team_id: number | null }>(`SELECT team_id FROM _meta WHERE table_name = ?`, tableName)
      const teamId = c.get('teamId') ?? meta?.team_id ?? 0
      if (body.base_version !== undefined) {
        const head = tx.first<{ current_version: number }>(
          `SELECT current_version FROM _entity_heads WHERE team_id = ? AND entity_type = 'record' AND table_name = ? AND entity_id = ?`,
          teamId, tableName, id,
        )
        if ((head?.current_version ?? 1) !== body.base_version) throw new Error('REVISION_CONFLICT')
      }
      const updated = tx.run(`UPDATE "${tableName}" SET ${setClause} WHERE id = ?`, ...values)
      if (updated.changes === 0) throw new Error('REVISION_RECORD_NOT_FOUND')
      const after = tx.first<Record<string, unknown>>(`SELECT * FROM "${tableName}" WHERE id = ?`, id)!
      savePreimage(tx, { teamId, entityType: 'record', tableName, entityId: id }, existing, fields, actor)
      return saveTableChange(tx, teamId, tableName, [existing], [after], actor, 'update')
    })
    if (optionStmts.length > 0) await c.env.DB.batch(optionStmts)
    return c.json({ data: { success: true, id: Number(id), version } })
  } catch (error) {
    if ((error as Error).message === 'REVISION_RECORD_NOT_FOUND') {
      return c.json({ error: { code: 'RECORD_NOT_FOUND', message: 'Record not found' } }, 404)
    }
    if ((error as Error).message === 'REVISION_CONFLICT') {
      return c.json({ error: { code: 'VERSION_CONFLICT', message: 'The record has changed; reload before saving' } }, 409)
    }
    throw error
  }
})

records.get('/:tableName/records/:id/revisions', async (c) => {
  const { tableName, id } = c.req.param()
  const meta = await c.env.DB.prepare(`SELECT team_id FROM _meta WHERE table_name = ?`).bind(tableName).first<{ team_id: number | null }>()
  const teamId = c.get('teamId') ?? meta?.team_id ?? 0
  const current = await c.env.DB.prepare(`SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>()
  if (!current) return c.json({ error: { code: 'RECORD_NOT_FOUND', message: 'Record not found' } }, 404)
  const rows = await c.env.DB.prepare(
    `SELECT id, entity_version, action, changed_fields_json, actor_user_id, actor_api_key_id,
            auth_mode, restore_from_id, created_at
     FROM _revisions WHERE team_id = ? AND entity_type = 'record' AND table_name = ? AND entity_id = ?
     ORDER BY entity_version DESC LIMIT 100`,
  ).bind(teamId, tableName, id).all<Omit<RevisionRow, 'snapshot_json'>>()
  const head = await c.env.DB.prepare(
    `SELECT current_version FROM _entity_heads WHERE team_id = ? AND entity_type = 'record' AND table_name = ? AND entity_id = ?`,
  ).bind(teamId, tableName, id).first<{ current_version: number }>()
  return c.json({ data: rows.results.map(r => ({ ...r, changed_fields: JSON.parse(r.changed_fields_json) })), current_version: head?.current_version ?? 1 })
})

records.get('/:tableName/records/:id/revisions/:revisionId', async (c) => {
  const { tableName, id, revisionId } = c.req.param()
  const meta = await c.env.DB.prepare(`SELECT team_id FROM _meta WHERE table_name = ?`).bind(tableName).first<{ team_id: number | null }>()
  const teamId = c.get('teamId') ?? meta?.team_id ?? 0
  const [revision, current] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM _revisions WHERE id = ? AND team_id = ? AND entity_type = 'record' AND table_name = ? AND entity_id = ?`).bind(revisionId, teamId, tableName, id).first<RevisionRow>(),
    c.env.DB.prepare(`SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>(),
  ])
  if (!revision || !current) return c.json({ error: { code: 'REVISION_NOT_FOUND', message: 'Revision not found' } }, 404)
  const snapshot = JSON.parse(revision.snapshot_json) as Record<string, unknown>
  return c.json({ data: { ...revision, snapshot, changes: diffSnapshots(snapshot, current) } })
})

records.post('/:tableName/records/:id/restore', requireWriteMiddleware, async (c) => {
  const { tableName, id } = c.req.param()
  const body = await c.req.json<{ revision_id: number; base_version?: number }>()
  const cols = await getTableColumns(c.env.DB, tableName)
  const writable = cols.filter(col => col.pk === 0).map(col => col.name)
  const actor = { userId: c.get('userId'), apiKeyId: c.get('apiKeyId'), authMode: c.get('authMode') }
  try {
    const version = c.env.DB.transaction((tx) => {
      const meta = tx.first<{ team_id: number | null }>(`SELECT team_id FROM _meta WHERE table_name = ?`, tableName)
      const teamId = c.get('teamId') ?? meta?.team_id ?? 0
      const current = tx.first<Record<string, unknown>>(`SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`, id)
      const revision = tx.first<RevisionRow>(`SELECT * FROM _revisions WHERE id = ? AND team_id = ? AND entity_type = 'record' AND table_name = ? AND entity_id = ?`, body.revision_id, teamId, tableName, id)
      if (!current || !revision) throw new Error('REVISION_NOT_FOUND')
      const head = tx.first<{ current_version: number }>(`SELECT current_version FROM _entity_heads WHERE team_id = ? AND entity_type = 'record' AND table_name = ? AND entity_id = ?`, teamId, tableName, id)
      if (body.base_version !== undefined && (head?.current_version ?? 1) !== body.base_version) throw new Error('REVISION_CONFLICT')
      const snapshot = JSON.parse(revision.snapshot_json) as Record<string, unknown>
      const fields = writable.filter(field => Object.hasOwn(snapshot, field))
      if (fields.length === 0) throw new Error('REVISION_SCHEMA_MISMATCH')
      const next = savePreimage(tx, { teamId, entityType: 'record', tableName, entityId: id }, current, fields, actor, 'restore', revision.id)
      tx.run(`UPDATE "${tableName}" SET ${fields.map(f => `"${f}" = ?`).join(', ')} WHERE id = ?`, ...fields.map(f => snapshot[f]), id)
      const after = tx.first<Record<string, unknown>>(`SELECT * FROM "${tableName}" WHERE id = ?`, id)!
      saveTableChange(tx, teamId, tableName, [current], [after], actor, 'update')
      return next
    })
    return c.json({ data: { success: true, id: Number(id), version } })
  } catch (error) {
    const message = (error as Error).message
    if (message === 'REVISION_NOT_FOUND') return c.json({ error: { code: 'REVISION_NOT_FOUND', message: 'Revision not found' } }, 404)
    if (message === 'REVISION_CONFLICT') return c.json({ error: { code: 'VERSION_CONFLICT', message: 'The record has changed; reload before restoring' } }, 409)
    if (message === 'REVISION_SCHEMA_MISMATCH') return c.json({ error: { code: 'SCHEMA_MISMATCH', message: 'No restorable fields remain in the current table schema' } }, 409)
    throw error
  }
})

/**
 * DELETE /api/tables/:tableName/records/:id
 * 删除记录
 * 删除记录后同步更新计数。
 */
records.delete('/:tableName/records/:id', requireWriteMiddleware, async (c) => {
  const { tableName, id } = c.req.param()

  const allTables = await getUserTables(c.env.DB)
  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }

  const actor = { userId: c.get('userId'), apiKeyId: c.get('apiKeyId'), authMode: c.get('authMode') }
  try {
    c.env.DB.transaction((tx) => {
      const existing = tx.first<Record<string, unknown>>(`SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`, id)
      if (!existing) throw new Error('RECORD_NOT_FOUND')
      const meta = tx.first<{ team_id: number | null }>(`SELECT team_id FROM _meta WHERE table_name = ?`, tableName)
      const teamId = c.get('teamId') ?? meta?.team_id ?? 0
      tx.run(
        `INSERT INTO _trash (table_name, record_id, record_data, owner_id, team_id) VALUES (?, ?, ?, ?, ?)`,
        tableName, id, JSON.stringify(existing), c.get('userId') ?? null, c.get('teamId') ?? null,
      )
      tx.run(`DELETE FROM "${tableName}" WHERE id = ?`, id)
      tx.run(`UPDATE _meta SET row_count = MAX(row_count - 1, 0), updated_at = unixepoch() WHERE table_name = ?`, tableName)
      saveTableChange(tx, teamId, tableName, [existing], [], actor, 'delete')
    })
  } catch (error) {
    if ((error as Error).message === 'RECORD_NOT_FOUND') {
      return c.json({ error: { code: 'RECORD_NOT_FOUND', message: 'Record not found' } }, 404)
    }
    throw error
  }

  return c.json({ data: { success: true } })
})

/**
 * POST /api/tables/:tableName/records/batch
 * 批量新增（最多 500 条）
 * 使用事务批量写入，减少多语句写入的中间状态。
 */
records.post('/:tableName/records/batch', requireWriteMiddleware, async (c) => {
  const { tableName } = c.req.param()

  const [allTables, cols, fieldMeta] = await Promise.all([
    getUserTables(c.env.DB),
    getTableColumns(c.env.DB, tableName),
    getFieldMeta(c.env.DB, tableName),
  ])

  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }
  const writableCols = cols.filter((c) => c.pk === 0)
  const allowedNames = writableCols.map((c) => c.name)

  const body = await c.req.json<{ records: Record<string, unknown>[] }>()
  if (!Array.isArray(body.records) || body.records.length === 0) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'records array cannot be empty' } }, 400)
  }

  const rows = body.records.slice(0, 500) // 单次最多 500 条

  const requiredCols = writableCols.filter((c) => c.notnull === 1 && c.dflt_value === null)
  const inserts: Array<{ sql: string; values: unknown[] }> = []

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx]
    const fields = Object.keys(row).filter((k) => allowedNames.includes(k))
    if (fields.length === 0) {
      return c.json({ error: { code: 'INVALID_BODY', message: `Record ${idx + 1} has no valid fields` } }, 400)
    }

    const missing = requiredCols.filter((c) => {
      const val = row[c.name]
      return val === null || val === undefined
    })
    if (missing.length > 0) {
      return c.json({
        error: {
          code: 'REQUIRED_FIELDS_MISSING',
          message: `Record ${idx + 1} is missing required fields: ${missing.map((c) => c.name).join(', ')}`,
        },
      }, 400)
    }

    const placeholders = fields.map(() => '?').join(', ')
    const columnList = fields.map((f) => `"${f}"`).join(', ')
    const insertSQL = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})`
    inserts.push({ sql: insertSQL, values: fields.map((f) => row[f]) })
  }
  const actor = { userId: c.get('userId'), apiKeyId: c.get('apiKeyId'), authMode: c.get('authMode') }
  c.env.DB.transaction((tx) => {
    const meta = tx.first<{ team_id: number | null }>(`SELECT team_id FROM _meta WHERE table_name = ?`, tableName)
    const teamId = c.get('teamId') ?? meta?.team_id ?? 0
    const insertedRows: Record<string, unknown>[] = []
    for (const insert of inserts) {
      const result = tx.run(insert.sql, ...insert.values)
      insertedRows.push(tx.first<Record<string, unknown>>(`SELECT * FROM "${tableName}" WHERE id = ?`, result.last_row_id)!)
    }
    tx.run(
      `INSERT INTO _meta (table_name, row_count) VALUES (?, ?)
       ON CONFLICT(table_name) DO UPDATE SET row_count = row_count + ?, updated_at = unixepoch()`,
      tableName, rows.length, rows.length,
    )
    saveTableChange(tx, teamId, tableName, [], insertedRows, actor, 'batch_insert')
  })
  const optionStmts = buildSelectOptionStmts(c.env.DB, tableName, fieldMeta, rows)
  if (optionStmts.length) await c.env.DB.batch(optionStmts)

  return c.json({ data: { inserted: rows.length } }, 201)
})

/**
 * GET /api/tables/:tableName/export
 *
 * 导出整张表数据（遵循当前筛选/排序）
 *   format=csv   → UTF-8 BOM CSV（默认，Excel 兼容）
 *   format=json  → JSON 数组
 *   filter/sort  → 同 records 接口
 *   最多导出 10000 行；超过时返回 413，避免静默截断
 */
records.get('/:tableName/export', async (c) => {
  const { tableName } = c.req.param()
  const query = c.req.query()

  const [allTables, cols, fieldMeta] = await Promise.all([
    getUserTables(c.env.DB),
    getTableColumns(c.env.DB, tableName),
    getFieldMeta(c.env.DB, tableName),
  ])

  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }

  const allColumns = cols.map((col) => col.name)
  const runningBalance = getRunningBalanceField(fieldMeta)
  const allowedColumns = runningBalance
    ? [...allColumns, runningBalance.columnName]
    : allColumns
  const filters = parseFilters(query, allowedColumns)

  let sort: { field: string; dir: 'ASC' | 'DESC' } | undefined
  if (query.sort) {
    const [field, dir] = query.sort.split(':')
    if (field && allowedColumns.includes(field)) {
      sort = { field, dir: dir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC' }
    }
  }

  const EXPORT_ROW_LIMIT = 10000

  const { sql, params } = buildSelectSQL({
    tableName,
    selectFields: [],
    filters,
    sort,
    pageSize: EXPORT_ROW_LIMIT + 1,
    skipPageSizeLimit: true,
    searchableFields: allColumns.filter((name) => name !== 'id'),
    runningBalance,
  })

  const result = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = result.results as Record<string, unknown>[]
  if (rows.length > EXPORT_ROW_LIMIT) {
    return c.json({
      error: {
        code: 'EXPORT_LIMIT_EXCEEDED',
        message: `Export exceeds the ${EXPORT_ROW_LIMIT} row limit. Please narrow your filters before exporting.`,
      },
    }, 413)
  }
  const formattedRows = formatDatetimeFields(rows, fieldMeta)

  // 解析 link 字段值
  const linkFields = getLinkFields(fieldMeta)
  const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, c.get('teamId'), c.get('allowedNoteRootIds'))
  await resolveLinkValues(c.env.DB, formattedRows, linkFields, allowedNoteIds)

  // getFieldMeta 已按 order_index ASC 返回（含 id / created_at 等系统列）
  // 兜底：如果 _field_meta 为空（表未初始化），用 allColumns 作为 fallback
  const orderedFields = fieldMeta.length > 0
    ? fieldMeta
    : allColumns.map(c => ({ column_name: c, title: c }))

  const format = query.format === 'json' ? 'json' : 'csv'
  const safeFilename = tableName.replace(/[^a-z0-9_-]/gi, '_')

  if (format === 'json') {
    // JSON：使用 column_name 作为 key
    const json = JSON.stringify(formattedRows, null, 2)
    return new Response(json, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename}.json"`,
      },
    })
  }

  // CSV：用 field title 作为表头，保持字段顺序
  function csvEscape(v: unknown): string {
    if (v == null) return ''
    const s = String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const columnNames = orderedFields.map(f => f.column_name)
  const headerRow = orderedFields.map(f => csvEscape(f.title)).join(',')
  const dataRows = formattedRows.map(row =>
    columnNames.map(col => csvEscape(row[col])).join(',')
  )
  const csv = '\uFEFF' + [headerRow, ...dataRows].join('\r\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename}.csv"`,
    },
  })
})

/**
 * 解析 link 字段的配置（从 select_options JSON 中提取 link_table）
 */
function getLinkFields(fieldMeta: FieldMetaRow[]): Array<{ column_name: string; link_table: string; link_display_field?: string }> {
  const result: Array<{ column_name: string; link_table: string; link_display_field?: string }> = []
  for (const f of fieldMeta) {
    if (f.field_type !== 'link') continue
    if (!f.select_options) continue
    const config = f.select_options as unknown as { link_table?: string; link_display_field?: string }
    if (config.link_table) {
      result.push({ column_name: f.column_name, link_table: config.link_table, link_display_field: config.link_display_field })
    }
  }
  return result
}

/**
 * 解析嵌套 link ID → 标题（当 display_field 本身是 link 类型时使用）
 */
async function resolveNestedLinkIds(
  db: AppDatabase,
  targetTable: string,
  ids: string[],
  displayField?: string,
  allowedNoteIds?: Set<string> | null,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return result

  if (targetTable === '_notes') {
    const ph = uniqueIds.map(() => '?').join(',')
    const rows = await db.prepare(
      `SELECT id, title FROM _notes WHERE id IN (${ph}) AND deleted_at IS NULL`
    ).bind(...uniqueIds).all<{ id: string; title: string | null }>()
    for (const r of rows.results) {
      if (allowedNoteIds !== undefined && allowedNoteIds !== null && !allowedNoteIds.has(r.id)) continue
      result.set(r.id, r.title || 'Untitled')
    }
    return result
  }

  if (!isValidIdentifier(targetTable)) return result

  let col = displayField && isValidIdentifier(displayField) ? displayField : null
  if (col) {
    const exists = await db.prepare(
      `SELECT 1 FROM _field_meta WHERE table_name = ? AND column_name = ?`
    ).bind(targetTable, col).first()
    if (!exists) col = null
  }
  if (!col) col = await getTablePrimaryField(db, targetTable)
  if (!col) return result

  const ph = uniqueIds.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT id, "${col}" as _t FROM "${targetTable}" WHERE id IN (${ph})`
  ).bind(...uniqueIds).all<{ id: number | string; _t: string | null }>()
  for (const r of rows.results) result.set(String(r.id), r._t ?? `#${r.id}`)
  return result
}

/**
 * 获取目标表的 "primary field"（第一个 text/longtext 类型的非系统字段）
 * 用于 link 字段的显示标题
 */
async function getTablePrimaryField(db: AppDatabase, tableName: string): Promise<string | null> {
  if (!isValidIdentifier(tableName)) return null
  const meta = await db.prepare(
    `SELECT column_name, field_type FROM _field_meta WHERE table_name = ? AND column_name NOT IN ('id', 'created_at') ORDER BY order_index ASC`
  ).bind(tableName).all<{ column_name: string; field_type: string }>()

  // 优先找 text/longtext，否则取第一个非系统字段
  const textField = meta.results.find(f => f.field_type === 'text' || f.field_type === 'longtext')
  const col = textField?.column_name ?? meta.results[0]?.column_name ?? null
  if (col && !isValidIdentifier(col)) return null
  return col
}

/**
 * 解析 link 字段的值（ID → {id, title}）
 * 按目标表分组批量查询，减少 DB 调用
 */
async function resolveLinkValues(
  db: AppDatabase,
  rows: Record<string, unknown>[],
  linkFields: Array<{ column_name: string; link_table: string; link_display_field?: string }>,
  allowedNoteIds?: Set<string> | null,
): Promise<void> {
  if (linkFields.length === 0 || rows.length === 0) return

  // 按 link_table + display_field 分组收集需要查的 IDs
  // 同一目标表可能有不同的 display_field，用 key 区分
  interface TableGroup { table: string; displayField?: string; ids: Set<string> }
  const groups = new Map<string, TableGroup>()

  for (const lf of linkFields) {
    if (!isValidIdentifier(lf.link_table)) continue
    const key = `${lf.link_table}::${lf.link_display_field ?? ''}`
    if (!groups.has(key)) groups.set(key, { table: lf.link_table, displayField: lf.link_display_field, ids: new Set() })
    const g = groups.get(key)!
    for (const row of rows) {
      const val = row[lf.column_name]
      if (val != null && val !== '') g.ids.add(String(val))
    }
  }

  // 批量查询每个目标表
  const resolved = new Map<string, Map<string, { id: string; title: string }>>()

  for (const [key, g] of groups) {
    if (g.ids.size === 0) continue

    const idArr = Array.from(g.ids)
    const placeholders = idArr.map(() => '?').join(',')

    // 特殊处理 _notes
    if (g.table === '_notes') {
      const result = await db.prepare(
        `SELECT id, title FROM _notes WHERE id IN (${placeholders}) AND deleted_at IS NULL`
      ).bind(...idArr).all<{ id: string; title: string | null }>()
      const map = new Map<string, { id: string; title: string }>()
      for (const r of result.results) {
        if (allowedNoteIds !== undefined && allowedNoteIds !== null && !allowedNoteIds.has(r.id)) continue
        map.set(r.id, { id: r.id, title: r.title || 'Untitled' })
      }
      resolved.set(key, map)
      continue
    }

    // 使用配置的 display_field，否则取 primaryField；校验列是否存在
    let displayCol: string | null = null
    if (g.displayField && isValidIdentifier(g.displayField)) {
      const exists = await db.prepare(
        `SELECT 1 FROM _field_meta WHERE table_name = ? AND column_name = ?`
      ).bind(g.table, g.displayField).first()
      if (exists) displayCol = g.displayField
    }
    if (!displayCol) {
      displayCol = await getTablePrimaryField(db, g.table)
    }
    if (!displayCol) continue

    const result = await db.prepare(
      `SELECT id, "${displayCol}" as _title FROM "${g.table}" WHERE id IN (${placeholders})`
    ).bind(...idArr).all<{ id: number; _title: string | null }>()

    const map = new Map<string, { id: string; title: string }>()
    for (const r of result.results) {
      map.set(String(r.id), { id: String(r.id), title: r._title ?? `#${r.id}` })
    }

    // 如果 displayCol 本身是 link 类型，title 存的是 ID，需要嵌套解析
    const dcMeta = await db.prepare(
      `SELECT field_type, select_options FROM _field_meta WHERE table_name = ? AND column_name = ?`
    ).bind(g.table, displayCol).first<{ field_type: string; select_options: string | null }>()
    if (dcMeta?.field_type === 'link' && dcMeta.select_options) {
      const cfg = JSON.parse(dcMeta.select_options) as { link_table?: string; link_display_field?: string }
      if (cfg.link_table) {
        const nestedIds = [...map.values()].map(v => v.title).filter(t => !t.startsWith('#'))
        if (nestedIds.length > 0) {
          const nested = await resolveNestedLinkIds(db, cfg.link_table, nestedIds, cfg.link_display_field, allowedNoteIds)
          for (const [id, entry] of map) {
            const resolved_title = nested.get(entry.title)
            if (resolved_title) entry.title = resolved_title
          }
        }
      }
    }

    resolved.set(key, map)
  }

  // 替换行数据中的 link 字段值
  for (const lf of linkFields) {
    const key = `${lf.link_table}::${lf.link_display_field ?? ''}`
    const map = resolved.get(key)
    if (!map) continue
    for (const row of rows) {
      const val = row[lf.column_name]
      if (val == null || val === '') continue
      const linked = map.get(String(val))
      if (linked) {
        row[lf.column_name] = JSON.stringify(linked)
      }
    }
  }
}

/**
 * 将 datetime/date 字段的 Unix 时间戳格式化为 ISO 8601 字符串
 * datetime: "2026-03-15T04:37:31Z" (UTC)
 * date: "2026-03-15"
 */
function formatDatetimeFields(
  rows: Record<string, unknown>[],
  fieldMeta: Array<{ column_name: string; field_type: string }>
): Record<string, unknown>[] {
  const dtCols = fieldMeta.filter(f => f.field_type === 'datetime').map(f => f.column_name)
  const dateCols = fieldMeta.filter(f => f.field_type === 'date').map(f => f.column_name)

  if (dtCols.length === 0 && dateCols.length === 0) return rows

  return rows.map(row => {
    const out = { ...row }
    for (const col of dtCols) {
      const v = out[col]
      if (v == null) continue
      const n = Number(v)
      if (!isNaN(n) && n > 0) {
        out[col] = new Date(n < 1e10 ? n * 1000 : n).toISOString()
      }
    }
    for (const col of dateCols) {
      const v = out[col]
      if (v == null) continue
      // 已经是 YYYY-MM-DD 字符串则保留
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) continue
      const n = Number(v)
      if (!isNaN(n) && n > 0) {
        out[col] = new Date(n < 1e10 ? n * 1000 : n).toISOString().slice(0, 10)
      }
    }
    return out
  })
}

export default records
