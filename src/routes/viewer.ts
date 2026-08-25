import { Context, Hono } from 'hono'
import type { AuthVariables, Env } from '../types'
import { getTableColumns, getUserTables } from '../utils/schema-cache'
import { buildSelectSQL, parseFilters } from '../utils/query-builder'
import {
  backfillMissingGroupFolders,
  backfillTableFolderParents,
  expandTablesAcrossFolders,
  filterVisibleNodes,
  listWorkspaceNodes,
  type WorkspaceNode,
} from '../utils/workspace'
import { canAccessNote, getAccessibleNoteIds } from '../utils/note-access'
import { ensureFieldMeta } from './fields'
import { signFileUrl } from '../utils/files'
import { teamFilter } from '../middleware/auth'

const viewer = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

type ViewerField = {
  column_name: string
  title: string
  field_type: string
  is_hidden: boolean
  order_index: number
}

const BLOCKED_FIELD_TYPES = new Set(['password', 'totp'])

viewer.get('/me', async (c) => {
  const visible = await getVisibleWorkspaceNodes(c)

  return c.json({
    data: {
      ok: true,
      key_type: c.get('keyType'),
      scope: c.get('keyScope'),
      workspace: {
        folder_count: visible.filter((n) => n.kind === 'folder').length,
        note_count: visible.filter((n) => n.kind === 'note').length,
        table_count: visible.filter((n) => n.kind === 'table').length,
      },
    },
  })
})

viewer.get('/workspace', async (c) => {
  const visible = await getVisibleWorkspaceNodes(c)
  return c.json({ data: visible.map(toViewerWorkspaceNode) })
})

viewer.get('/notes/:id', async (c) => {
  const id = c.req.param('id')
  const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, c.get('teamId'), c.get('allowedNoteRootIds'))
  if (!canAccessNote(allowedNoteIds, id)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access to this note is not allowed' } }, 403)
  }

  const { clause, params } = teamFilter(c.get('teamId'))
  const row = await c.env.DB.prepare(
    `SELECT id, title, content, icon, parent_id, sort_order, created_at, updated_at, cover, description
     FROM _notes
     WHERE id = ? AND ${clause} AND deleted_at IS NULL AND archived_at IS NULL`,
  ).bind(id, ...params)
    .first<{
      id: string
      title: string
      content: string
      icon: string | null
      parent_id: string | null
      sort_order: number
      created_at: number
      updated_at: number
      cover: string | null
      description: string | null
    }>()

  if (!row) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)
  }

  return c.json({ data: row })
})

viewer.get('/tables/:tableName/records', async (c) => {
  const tableName = c.req.param('tableName')
  const accessError = await assertTableAccess(c, tableName)
  if (accessError) return accessError

  const [cols, allFields] = await Promise.all([
    getTableColumns(c.env.DB, tableName),
    ensureFieldMeta(c.env.DB, tableName) as Promise<ViewerField[]>,
  ])
  const allColumns = cols.map((col) => col.name)
  const safeFields = buildSafeFields(allFields, allColumns)
  const safeColumns = safeFields.map((field) => field.column_name)
  const selectedFields = pickRequestedSafeFields(c.req.query('fields'), safeFields)

  const query = c.req.query()
  const filters = parseFilters(query, safeColumns)
  const sort = parseSort(query.sort, safeColumns)
  const pageSize = Math.min(parseInt(query.page_size ?? '20', 10) || 20, 100)
  const cursor = query.cursor ? parseInt(query.cursor, 10) : undefined

  const { sql, params } = buildSelectSQL({
    tableName,
    selectFields: selectedFields.map((field) => field.column_name),
    filters,
    sort,
    cursor,
    pageSize,
    searchableFields: safeFields
      .map((field) => field.column_name)
      .filter((name) => name !== 'id'),
  })

  const result = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = await signImageFields(
    c.env.SESSION_SECRET,
    new URL(c.req.url).origin,
    formatDatetimeFields(result.results as Record<string, unknown>[], selectedFields),
    selectedFields,
  )
  const lastRow = rows[rows.length - 1]

  return c.json({
    data: rows,
    fields: selectedFields.map(toViewerFieldMeta),
    meta: {
      page_size: pageSize,
      count: rows.length,
      next_cursor:
        rows.length === pageSize && lastRow && 'id' in lastRow
          ? String(lastRow.id)
          : null,
    },
  })
})

viewer.get('/tables/:tableName/records/:id', async (c) => {
  const tableName = c.req.param('tableName')
  const id = c.req.param('id')
  const accessError = await assertTableAccess(c, tableName)
  if (accessError) return accessError

  const [cols, allFields] = await Promise.all([
    getTableColumns(c.env.DB, tableName),
    ensureFieldMeta(c.env.DB, tableName) as Promise<ViewerField[]>,
  ])
  const allColumns = cols.map((col) => col.name)
  const safeFields = buildSafeFields(allFields, allColumns)
  const selectedFields = pickRequestedSafeFields(c.req.query('fields'), safeFields)

  const { sql, params } = buildSelectSQL({
    tableName,
    selectFields: selectedFields.map((field) => field.column_name),
    filters: [{ field: 'id', op: 'eq', value: id }],
    pageSize: 1,
    searchableFields: [],
  })

  const result = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = await signImageFields(
    c.env.SESSION_SECRET,
    new URL(c.req.url).origin,
    formatDatetimeFields(result.results as Record<string, unknown>[], selectedFields),
    selectedFields,
  )
  if (!rows[0]) {
    return c.json({ error: { code: 'RECORD_NOT_FOUND', message: 'Record not found' } }, 404)
  }

  return c.json({ data: rows[0], fields: selectedFields.map(toViewerFieldMeta) })
})

async function assertTableAccess(
  c: Context<{ Bindings: Env; Variables: AuthVariables }>,
  tableName: string,
): Promise<Response | null> {
  const allTables = await getUserTables(c.env.DB)
  if (!allTables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: `Table "${tableName}" not found` } }, 404)
  }

  const allowedTables = c.get('allowedTables')
  if (allowedTables !== null && allowedTables !== undefined && !allowedTables.includes(tableName)) {
    return c.json({ error: { code: 'FORBIDDEN', message: `Access to table "${tableName}" is not allowed` } }, 403)
  }

  const teamId = c.get('teamId')
  if (teamId !== undefined) {
    const meta = await c.env.DB.prepare(
      `SELECT team_id FROM _meta WHERE table_name = ?`,
    ).bind(tableName).first<{ team_id: number | null }>()
    if (meta && meta.team_id !== null && meta.team_id !== teamId) {
      return c.json({ error: { code: 'FORBIDDEN', message: `Access to table "${tableName}" is not allowed` } }, 403)
    }
  }

  return null
}

async function getVisibleWorkspaceNodes(
  c: Context<{ Bindings: Env; Variables: AuthVariables }>,
): Promise<WorkspaceNode[]> {
  await backfillMissingGroupFolders(c.env.DB, c.get('teamId'))
  await backfillTableFolderParents(c.env.DB, c.get('teamId'))
  const rawNodes = await listWorkspaceNodes(c.env.DB, c.get('teamId'))
  const nodes = await expandTablesAcrossFolders(c.env.DB, c.get('teamId'), rawNodes)
  const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, c.get('teamId'), c.get('allowedNoteRootIds'))
  return filterVisibleNodes(
    nodes,
    c.get('allowedTables') ?? null,
    allowedNoteIds,
    c.get('allowedGroupIds') ?? null,
  )
}

function toViewerWorkspaceNode(node: WorkspaceNode) {
  return {
    id: node.id,
    kind: node.kind,
    parent_id: node.parent_id,
    sort_order: node.sort_order,
    title: node.title,
    ref: node.ref,
    group_id: node.group_id,
    icon: node.icon,
  }
}

function buildSafeFields(fields: ViewerField[], allColumns: string[]): ViewerField[] {
  const allColumnSet = new Set(allColumns)
  const safe = fields.filter((field) => {
    if (!allColumnSet.has(field.column_name)) return false
    if (field.is_hidden && field.column_name !== 'id') return false
    if (BLOCKED_FIELD_TYPES.has(field.field_type)) return false
    return true
  })

  if (!safe.some((field) => field.column_name === 'id') && allColumnSet.has('id')) {
    safe.unshift({
      column_name: 'id',
      title: 'ID',
      field_type: 'number',
      is_hidden: false,
      order_index: -1,
    })
  }

  return safe
}

function pickRequestedSafeFields(raw: string | undefined, safeFields: ViewerField[]): ViewerField[] {
  if (!raw) return safeFields
  const safeByName = new Map(safeFields.map((field) => [field.column_name, field]))
  const picked: ViewerField[] = []
  for (const name of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const field = safeByName.get(name)
    if (field && !picked.some((item) => item.column_name === field.column_name)) picked.push(field)
  }
  const idField = safeByName.get('id')
  if (idField && !picked.some((field) => field.column_name === 'id')) picked.unshift(idField)
  return picked.length > 0 ? picked : safeFields.filter((field) => field.column_name === 'id')
}

function parseSort(raw: string | undefined, allowedColumns: string[]): { field: string; dir: 'ASC' | 'DESC' } | undefined {
  if (!raw) return undefined
  const [field, dir] = raw.split(':')
  if (!field || !allowedColumns.includes(field)) return undefined
  return { field, dir: dir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC' }
}

function toViewerFieldMeta(field: ViewerField) {
  return {
    column_name: field.column_name,
    title: field.title,
    field_type: field.field_type,
  }
}

function formatDatetimeFields(rows: Record<string, unknown>[], fields: ViewerField[]): Record<string, unknown>[] {
  const dtCols = fields.filter((field) => field.field_type === 'datetime').map((field) => field.column_name)
  const dateCols = fields.filter((field) => field.field_type === 'date').map((field) => field.column_name)
  if (dtCols.length === 0 && dateCols.length === 0) return rows

  return rows.map((row) => {
    const out = { ...row }
    for (const col of dtCols) {
      const v = out[col]
      if (v == null) continue
      const n = Number(v)
      if (!Number.isNaN(n) && n > 0) out[col] = new Date(n < 1e10 ? n * 1000 : n).toISOString()
    }
    for (const col of dateCols) {
      const v = out[col]
      if (v == null) continue
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) continue
      const n = Number(v)
      if (!Number.isNaN(n) && n > 0) out[col] = new Date(n < 1e10 ? n * 1000 : n).toISOString().slice(0, 10)
    }
    return out
  })
}

async function signImageFields(
  secret: string,
  origin: string,
  rows: Record<string, unknown>[],
  fields: ViewerField[],
): Promise<Record<string, unknown>[]> {
  const imageFields = fields.filter((field) => field.field_type === 'image').map((field) => field.column_name)
  if (imageFields.length === 0 || rows.length === 0) return rows

  return rows.map((row) => {
    const out = { ...row }
    for (const col of imageFields) {
      const parsed = parseImageValue(out[col])
      if (!parsed) continue
      const signed = { ...parsed } as Record<string, unknown>
      for (const keyName of ['thumb', 'display']) {
        const key = parsed[keyName]
        if (typeof key !== 'string' || !key) continue
        const { exp, sig } = signFileUrl(secret, key)
        signed[`${keyName}_url`] = `${origin}/api/files/${key}?exp=${exp}&sig=${sig}`
      }
      out[col] = signed
    }
    return out
  })
}

function parseImageValue(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return value.startsWith('images/') ? { display: value } : null
  }
}

export default viewer
