import { Hono } from 'hono'
import type { AuthVariables, Env } from '../types'
import { requireWriteMiddleware } from '../middleware/auth'
import { createFolder, listWorkspaceNodes, expandTablesAcrossFolders, ensureTableNode, ensureNoteNode, updateNodeTitleByRef, moveNode } from '../utils/workspace'
import { getUserTables, isValidIdentifier } from '../utils/schema-cache'
import {
  appendMessage,
  getOrCreateThread,
  lastUserBefore,
  listMessages,
  recentForModel,
  updateThreadMeta,
  type StoredMsg,
} from '../utils/assistant-memory'

const assistant = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

export type DraftField = {
  title: string
  field_type: 'text' | 'longtext' | 'number' | 'date' | 'datetime' | 'select' | 'checkbox' | 'password' | 'totp'
  options?: string[]
}

export type TableDraft = {
  action?: 'create_table' | 'add_fields' | 'create_note'
  table_name?: string
  title?: string
  content?: string
  folder_title?: string
  folder_id?: string | null
  create_folder?: boolean
  fields?: DraftField[]
  note?: string
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_workspace',
      description: '列出当前工作区里的文件夹、表格和笔记（标题与 id）',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_table_schema',
      description: '读取一张已有表的字段。改当前打开的表之前先调用。',
      parameters: {
        type: 'object',
        properties: { table_name: { type: 'string' } },
        required: ['table_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_fields',
      description: '给已有表增加字段的草案，不要直接改表。用户说「这个表」「当前表」「新增字段」时必须用这个，不要 propose_table。',
      parameters: {
        type: 'object',
        properties: {
          table_name: { type: 'string' },
          note: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                field_type: { type: 'string', enum: ['text', 'longtext', 'number', 'date', 'datetime', 'select', 'checkbox', 'password', 'totp'] },
                options: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'field_type'],
            },
          },
        },
        required: ['table_name', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_note',
      description: '读取一篇已有笔记的标题和正文。改当前笔记或另存为新笔记前可调用。',
      parameters: {
        type: 'object',
        properties: { note_id: { type: 'string' } },
        required: ['note_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_note',
      description: '提出一篇待确认的新笔记草案。用户说「存为笔记」「保存为新笔记」「写成笔记」时必须用这个，不要 propose_table，也不要说自己不能建笔记。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string', description: 'Markdown 正文' },
          folder_title: { type: 'string' },
          folder_id: { type: 'string' },
          create_folder: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_table',
      description: '仅当用户明确要新建一张表时才用。给已有表加字段请用 propose_fields。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '表格显示名' },
          folder_title: { type: 'string', description: '放到哪个文件夹，按名称匹配' },
          folder_id: { type: 'string', description: '若已知文件夹 id 可直接给' },
          create_folder: { type: 'boolean', description: '找不到文件夹时是否新建' },
          note: { type: 'string', description: '给用户看的简短说明' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                field_type: { type: 'string', enum: ['text', 'longtext', 'number', 'date', 'datetime', 'select', 'checkbox'] },
                options: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'field_type'],
            },
          },
        },
        required: ['title', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_note',
      description: '修改已有笔记的标题和/或正文。用户说改这篇、更新笔记、改标题时用。note_id 默认当前打开的笔记。',
      parameters: {
        type: 'object',
        properties: {
          note_id: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_records',
      description: '查询表格记录。可用关键词搜索。默认当前打开的表。',
      parameters: {
        type: 'object',
        properties: {
          table_name: { type: 'string' },
          q: { type: 'string', description: '关键词，匹配各文本字段' },
          limit: { type: 'integer' },
        },
        required: ['table_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_record',
      description: '按 id 读取一条记录。',
      parameters: {
        type: 'object',
        properties: {
          table_name: { type: 'string' },
          id: { type: 'integer' },
        },
        required: ['table_name', 'id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_record',
      description: '向表格新增一条记录。values 的键用字段中文标题或 column_name。',
      parameters: {
        type: 'object',
        properties: {
          table_name: { type: 'string' },
          values: { type: 'object', additionalProperties: true },
        },
        required: ['table_name', 'values'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_record',
      description: '更新一条记录的部分字段。',
      parameters: {
        type: 'object',
        properties: {
          table_name: { type: 'string' },
          id: { type: 'integer' },
          values: { type: 'object', additionalProperties: true },
        },
        required: ['table_name', 'id', 'values'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_record',
      description: '删除一条记录，进回收站。',
      parameters: {
        type: 'object',
        properties: {
          table_name: { type: 'string' },
          id: { type: 'integer' },
        },
        required: ['table_name', 'id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_node',
      description: '把表格、笔记或文件夹移到另一个文件夹。可先 list_workspace。当前打开的表/笔记可不传 id。folder 为空或 root 表示工作区根目录。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '工作区节点 id，或表格 name，或笔记 id' },
          table_name: { type: 'string' },
          note_id: { type: 'string' },
          folder: { type: 'string', description: '目标文件夹节点 id 或文件夹标题；root 表示根目录' },
          folder_id: { type: 'string' },
        },
      },
    },
  },
]

const SYSTEM = `你是墨问里的工作区助手。用户用中文说话。
你可以读写表格记录，也可以读、改、新建笔记。不要说做不到这些。
系统会告诉你用户当前打开的表格或笔记。
- 查记录：query_records / get_record。
- 增改删记录：insert_record / update_record / delete_record。values 优先用字段中文标题。先 get_table_schema。
- 改当前笔记标题或正文：update_note。
- 新建笔记：propose_note，等用户确认。
- 新建表 / 给表加字段：propose_table / propose_fields，等用户确认。
- 把表格或笔记换到别的文件夹：move_node，可直接执行。先 list_workspace 对上文件夹标题。
改结构（建表、加字段、建整篇新笔记）要确认；改记录、改已有笔记、移动可以直接执行并告诉用户结果。
回复用简短中文 Markdown。`

function fieldTypeToSqlite(t: string): 'TEXT' | 'INTEGER' {
  if (t === 'number' || t === 'checkbox' || t === 'date' || t === 'datetime') return 'INTEGER'
  return 'TEXT'
}

function randomId(prefix: string, n = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < n; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return `${prefix}${id}`
}

async function listWorkspaceBrief(c: { env: Env; get: (k: string) => unknown }) {
  const teamId = c.get('teamId') as number | undefined
  const nodes = await expandTablesAcrossFolders(c.env.DB, teamId, await listWorkspaceNodes(c.env.DB, teamId))
  return nodes
    .filter((n) => n.kind === 'folder' || n.kind === 'table' || n.kind === 'note')
    .map((n) => ({ id: n.id, kind: n.kind, title: n.title, parent_id: n.parent_id, ref: n.ref }))
}

async function getNoteBrief(db: Env['DB'], noteId: string) {
  const row = await db.prepare(
    `SELECT id, title, content FROM _notes WHERE id = ? AND deleted_at IS NULL`,
  ).bind(noteId).first<{ id: string; title: string; content: string }>()
  if (!row) return { error: '找不到这篇笔记' }
  const content = row.content || ''
  return {
    id: row.id,
    title: row.title,
    content: content.length > 16000 ? `${content.slice(0, 16000)}\n…(已截断)` : content,
  }
}

async function getTableSchema(db: Env['DB'], tableName: string) {
  const rows = await db.prepare(
    `SELECT column_name, title, field_type FROM _field_meta WHERE table_name = ? ORDER BY order_index ASC`,
  ).bind(tableName).all<{ column_name: string; title: string; field_type: string }>()
  return { table_name: tableName, fields: rows.results ?? [] }
}

type FieldRow = { column_name: string; title: string; field_type: string }

async function loadFields(db: Env['DB'], tableName: string): Promise<FieldRow[]> {
  const rows = await db.prepare(
    `SELECT column_name, title, field_type FROM _field_meta WHERE table_name = ? ORDER BY order_index ASC`,
  ).bind(tableName).all<FieldRow>()
  return rows.results ?? []
}

function resolveTableName(raw: string | undefined, fallback?: string | null) {
  return String(raw || fallback || '').trim()
}

function mapValuesToColumns(fields: FieldRow[], values: Record<string, unknown>) {
  const byTitle = new Map(fields.map((f) => [f.title.trim().toLowerCase(), f.column_name]))
  const byCol = new Set(fields.map((f) => f.column_name))
  const mapped: Record<string, unknown> = {}
  const unknown: string[] = []
  for (const [key, val] of Object.entries(values || {})) {
    if (byCol.has(key)) mapped[key] = val
    else {
      const col = byTitle.get(key.trim().toLowerCase())
      if (col) mapped[col] = val
      else unknown.push(key)
    }
  }
  return { mapped, unknown }
}

function assertWritable(c: { get: (k: string) => unknown }) {
  if (c.get('keyType') === 'readonly') throw new Error('当前是只读权限，不能改数据')
}

async function assertUserTable(db: Env['DB'], tableName: string) {
  const tables = await getUserTables(db)
  if (!tableName || !tables.includes(tableName)) throw new Error('找不到这张表格')
  return tableName
}

function rowForDisplay(fields: FieldRow[], row: Record<string, unknown>) {
  const out: Record<string, unknown> = { id: row.id }
  for (const f of fields) {
    if (f.column_name === 'id' || f.column_name === 'created_at') continue
    if (f.column_name in row) out[f.title || f.column_name] = row[f.column_name]
  }
  return out
}

async function queryRecords(db: Env['DB'], tableName: string, q?: string, limit = 20) {
  await assertUserTable(db, tableName)
  const fields = await loadFields(db, tableName)
  const n = Math.min(Math.max(limit || 20, 1), 50)
  let sql = `SELECT * FROM "${tableName}"`
  const params: unknown[] = []
  if (q?.trim()) {
    const textCols = fields.filter((f) => !['id', 'created_at'].includes(f.column_name))
    if (textCols.length) {
      sql += ` WHERE ${textCols.map((f) => `"${f.column_name}" LIKE ?`).join(' OR ')}`
      for (const _ of textCols) params.push(`%${q.trim()}%`)
    }
  }
  sql += ` ORDER BY id DESC LIMIT ?`
  params.push(n)
  const rows = await db.prepare(sql).bind(...params).all<Record<string, unknown>>()
  return { table_name: tableName, count: rows.results.length, records: rows.results.map((r) => rowForDisplay(fields, r)) }
}

async function getRecord(db: Env['DB'], tableName: string, id: number) {
  await assertUserTable(db, tableName)
  const fields = await loadFields(db, tableName)
  const row = await db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row) return { error: '找不到这条记录' }
  return { table_name: tableName, record: rowForDisplay(fields, row) }
}

async function insertRecord(db: Env['DB'], tableName: string, values: Record<string, unknown>) {
  await assertUserTable(db, tableName)
  const fields = await loadFields(db, tableName)
  const { mapped, unknown } = mapValuesToColumns(fields, values)
  const cols = Object.keys(mapped).filter((k) => k !== 'id' && isValidIdentifier(k))
  if (cols.length === 0) return { error: '没有可写入的字段', unknown }
  const sql = `INSERT INTO "${tableName}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  const result = await db.prepare(sql).bind(...cols.map((c) => mapped[c])).run()
  await db.prepare(
    `INSERT INTO _meta (table_name, row_count) VALUES (?, 1)
     ON CONFLICT(table_name) DO UPDATE SET row_count = row_count + 1, updated_at = unixepoch()`,
  ).bind(tableName).run()
  const id = Number(result.meta.last_row_id || 0)
  return { ok: true, id, unknown, record: rowForDisplay(fields, { id, ...mapped }) }
}

async function updateRecord(db: Env['DB'], tableName: string, id: number, values: Record<string, unknown>) {
  await assertUserTable(db, tableName)
  const fields = await loadFields(db, tableName)
  const { mapped, unknown } = mapValuesToColumns(fields, values)
  const cols = Object.keys(mapped).filter((k) => k !== 'id' && isValidIdentifier(k))
  if (cols.length === 0) return { error: '没有可更新的字段', unknown }
  const sql = `UPDATE "${tableName}" SET ${cols.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`
  const result = await db.prepare(sql).bind(...cols.map((c) => mapped[c]), id).run()
  if (!result.meta.changes) return { error: '找不到这条记录' }
  return { ok: true, id, unknown }
}

async function deleteRecord(db: Env['DB'], tableName: string, id: number, userId: number | null, teamId: number | null) {
  await assertUserTable(db, tableName)
  const existing = await db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).bind(id).first()
  if (!existing) return { error: '找不到这条记录' }
  await db.batch([
    db.prepare(`INSERT INTO _trash (table_name, record_id, record_data, owner_id, team_id) VALUES (?, ?, ?, ?, ?)`)
      .bind(tableName, id, JSON.stringify(existing), userId, teamId),
    db.prepare(`DELETE FROM "${tableName}" WHERE id = ?`).bind(id),
    db.prepare(`UPDATE _meta SET row_count = MAX(row_count - 1, 0), updated_at = unixepoch() WHERE table_name = ?`).bind(tableName),
  ])
  return { ok: true, id }
}

async function resolveWorkspaceNodes(c: { env: Env; get: (k: string) => unknown }) {
  const teamId = c.get('teamId') as number | undefined
  return expandTablesAcrossFolders(c.env.DB, teamId, await listWorkspaceNodes(c.env.DB, teamId))
}

function pickNode(
  nodes: Awaited<ReturnType<typeof listWorkspaceNodes>>,
  raw: string,
  kind?: 'folder' | 'table' | 'note',
) {
  const key = raw.trim()
  if (!key) return null
  const pool = kind ? nodes.filter((n) => n.kind === kind) : nodes
  const byId = pool.find((n) => n.id === key || n.id.startsWith(`${key}::`))
  if (byId) return byId
  const byRef = pool.find((n) => n.ref === key)
  if (byRef) return byRef
  const titled = pool.filter((n) => n.title === key)
  if (titled.length === 1) return titled[0]
  if (titled.length > 1) throw new Error(`有多份叫「${key}」的${kind === 'folder' ? '文件夹' : '项目'}，请用 id`)
  return null
}

async function moveWorkspaceItem(
  c: { env: Env; get: (k: string) => unknown },
  args: { id?: string; table_name?: string; note_id?: string; folder?: string; folder_id?: string },
  ctx?: { table?: string | null; note?: string | null },
) {
  const nodes = await resolveWorkspaceNodes(c)
  const rawId = String(args.id || args.table_name || args.note_id || ctx?.table || ctx?.note || '').trim()
  if (!rawId) throw new Error('请指定要移动的表格、笔记或节点 id')
  const node = pickNode(nodes, rawId)
  if (!node) throw new Error('找不到要移动的项目')
  const folderRaw = String(args.folder_id || args.folder || '').trim()
  let parentId: string | null = null
  if (folderRaw && folderRaw !== 'root' && folderRaw !== 'null') {
    const folder = pickNode(nodes, folderRaw, 'folder')
    if (!folder) throw new Error(`找不到文件夹「${folderRaw}」`)
    parentId = folder.id
  }
  await moveNode(c.env.DB, {
    id: node.id,
    parentId,
    teamId: c.get('teamId') as number | undefined,
  })
  return { ok: true, id: node.id, kind: node.kind, title: node.title, parent_id: parentId }
}

async function updateNote(db: Env['DB'], noteId: string, title?: string, content?: string) {
  const row = await db.prepare(
    `SELECT id, archived_at FROM _notes WHERE id = ? AND deleted_at IS NULL`,
  ).bind(noteId).first<{ id: string; archived_at: number | null }>()
  if (!row) return { error: '找不到这篇笔记' }
  if (row.archived_at) return { error: '归档中的笔记不能改' }
  if (title === undefined && content === undefined) return { error: '请提供 title 或 content' }
  const sets = ['updated_at = unixepoch()']
  const params: unknown[] = []
  if (title !== undefined) {
    sets.push('title = ?')
    params.push(title.trim() || '未命名')
  }
  if (content !== undefined) {
    sets.push('content = ?')
    params.push(content)
  }
  params.push(noteId)
  await db.prepare(`UPDATE _notes SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run()
  if (title !== undefined) await updateNodeTitleByRef(db, 'note', noteId, title.trim() || '未命名')
  return { ok: true, id: noteId, title: title?.trim() }
}

function normalizeFields(fields: DraftField[]): DraftField[] {
  return fields.map((f) => ({
    title: String(f.title || '').trim(),
    field_type: f.field_type,
    options: f.options,
  })).filter((f) => f.title)
}

async function llmChat(apiKey: string, messages: unknown[]) {
  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
    }),
  })
  const text = await resp.text()
  if (!resp.ok) {
    throw new Error(`模型调用失败：${resp.status} ${text.slice(0, 240)}`)
  }
  return JSON.parse(text) as {
    choices?: Array<{
      message?: {
        role: string
        content?: string | null
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
      }
    }>
  }
}

async function llmText(apiKey: string, messages: unknown[], temperature = 0.1): Promise<string> {
  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages,
      temperature,
    }),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`模型调用失败：${resp.status} ${text.slice(0, 240)}`)
  const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string | null } }> }
  return (data.choices?.[0]?.message?.content || '').trim()
}

async function detectTopic(apiKey: string, prevUser: string, lastAssistant: string, nextUser: string): Promise<'continue' | 'new'> {
  if (!prevUser) return 'new'
  try {
    const raw = await llmText(apiKey, [
      {
        role: 'system',
        content: '判断用户最新一句话是接着上一轮做事，还是换了一个新问题。只输出 JSON：{"kind":"continue"} 或 {"kind":"new"}。指代「这个」「刚才」「再」「也」通常是 continue；主题、对象完全换了是 new。',
      },
      {
        role: 'user',
        content: `上一句用户：${prevUser.slice(0, 400)}\n上一句助手：${lastAssistant.slice(0, 400)}\n最新用户：${nextUser.slice(0, 800)}`,
      },
    ])
    const m = raw.match(/\{[\s\S]*\}/)
    const kind = m ? (JSON.parse(m[0]) as { kind?: string }).kind : ''
    return kind === 'new' ? 'new' : 'continue'
  } catch {
    return 'continue'
  }
}

async function compressSummary(apiKey: string, oldSummary: string, msgs: StoredMsg[]): Promise<string> {
  const blob = msgs.map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content.slice(0, 600)}`).join('\n')
  try {
    const text = await llmText(apiKey, [
      {
        role: 'system',
        content: '把对话压成不超过 350 字的中文备忘。保留：用户目标、提到的表格/笔记、已完成和未完成的操作。不要客套。',
      },
      {
        role: 'user',
        content: `已有备忘：\n${oldSummary || '（无）'}\n\n新增对话：\n${blob.slice(0, 6000)}`,
      },
    ])
    return text.slice(0, 1200)
  } catch {
    return (oldSummary + '\n' + blob).slice(-800)
  }
}

assistant.get('/thread', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)
  const thread = await getOrCreateThread(c.env.DB, userId, c.get('teamId'))
  const stored = await listMessages(c.env.DB, thread.id)
  const messages = stored.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    draft: m.draft_json ? JSON.parse(m.draft_json) : undefined,
    steps: m.steps_json ? JSON.parse(m.steps_json) : undefined,
    topic: m.topic,
    done: !!m.draft_json,
    created_at: m.created_at,
  }))
  const topics = stored
    .filter((m) => m.role === 'user' && m.topic === 'new')
    .map((m) => ({ id: m.id, title: m.content.trim().slice(0, 36), created_at: m.created_at }))
  return c.json({ data: { thread_id: thread.id, title: thread.title, summary: thread.summary, messages, topics } })
})

assistant.post('/chat', async (c) => {
  const apiKey = c.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return c.json({ error: { code: 'NOT_CONFIGURED', message: '未配置 DEEPSEEK_API_KEY，无法使用助手' } }, 503)
  }
  const body = await c.req.json<{
    content?: string
    messages?: Array<{ role: string; content: string }>
    context?: { table?: string | null; table_title?: string | null; note?: string | null; note_title?: string | null }
  }>().catch(() => ({ content: '', messages: [] as Array<{ role: string; content: string }>, context: undefined }))
  const userText = String(body.content || body.messages?.filter((m) => m.role === 'user').slice(-1)[0]?.content || '').trim()
  if (!userText) {
    return c.json({ error: { code: 'INVALID_BODY', message: '请输入内容' } }, 400)
  }

  const ctx = body.context
  let contextLine = '当前没有打开表格或笔记。'
  if (ctx?.table) {
    contextLine = `用户当前打开的表格：table_name=${ctx.table}${ctx.table_title ? `，标题「${ctx.table_title}」` : ''}。改字段必须用 propose_fields，table_name 用这个。`
  } else if (ctx?.note) {
    contextLine = `用户当前打开的笔记：id=${ctx.note}${ctx.note_title ? `，标题「${ctx.note_title}」` : ''}。`
  }

  const userId = c.get('userId')
  let topic: 'continue' | 'new' = 'new'
  let memory = ''
  let threadId: string | null = null
  let historyForModel: Array<{ role: string; content: string }> = []
  if (userId) {
    const thread = await getOrCreateThread(c.env.DB, userId, c.get('teamId'))
    threadId = thread.id
    const history = await listMessages(c.env.DB, thread.id)
    const prevUser = lastUserBefore(history, userText)
    const lastAsst = [...history].reverse().find((m) => m.role === 'assistant')?.content || ''
    topic = await detectTopic(apiKey, prevUser, lastAsst, userText)
    memory = thread.summary || ''
    if (topic === 'new' && history.length > 0) {
      memory = await compressSummary(apiKey, memory, recentForModel(history, 16))
      await updateThreadMeta(c.env.DB, thread.id, {
        summary: memory,
        title: userText.slice(0, 28),
      })
    } else if (history.length >= 20 && history.length % 8 === 0) {
      memory = await compressSummary(apiKey, memory, recentForModel(history, 16))
      await updateThreadMeta(c.env.DB, thread.id, { summary: memory })
    }
    const window = topic === 'new' ? [] : recentForModel(history, 10)
    historyForModel = window.map((m) => ({ role: m.role, content: m.content }))
  } else {
    historyForModel = (body.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-10)
  }

  const memoryLine = memory
    ? `长期备忘（压缩过的历史，可能跨多个问题）：\n${memory}`
    : '没有更早的备忘。'
  const topicLine = topic === 'new'
    ? '用户这句是新问题。不要被备忘里的旧任务绑住，只在相关时参考。'
    : '用户这句是上一轮的继续，优先接着做。'

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: contextLine },
    { role: 'system', content: `${topicLine}\n${memoryLine}` },
    ...historyForModel,
    { role: 'user', content: userText },
  ]

  let draft: TableDraft | null = null
  let reply = ''
  let mutated = false
  const steps: Array<{ name: string; label: string }> = []
  const stepLabel: Record<string, string> = {
    list_workspace: '查看工作区',
    get_table_schema: '读取表格字段',
    get_note: '读取笔记',
    update_note: '修改笔记',
    query_records: '查询记录',
    get_record: '读取记录',
    insert_record: '新增记录',
    update_record: '更新记录',
    delete_record: '删除记录',
    move_node: '移动到文件夹',
    propose_fields: '准备添加字段',
    propose_table: '准备新建表格',
    propose_note: '准备新建笔记',
  }

  for (let i = 0; i < 5; i++) {
    const data = await llmChat(apiKey, messages)
    const msg = data.choices?.[0]?.message
    if (!msg) {
      return c.json({ error: { code: 'MODEL_EMPTY', message: '模型没有返回内容' } }, 502)
    }
    const calls = msg.tool_calls ?? []
    if (calls.length === 0) {
      reply = (msg.content || '').trim()
      break
    }
    messages.push(msg)
    for (const call of calls) {
      let result: unknown = { ok: false }
      try {
        const args = JSON.parse(call.function.arguments || '{}') as TableDraft & {
          table_name?: string
          note_id?: string
          id?: number
          q?: string
          limit?: number
          values?: Record<string, unknown>
          content?: string
          folder?: string
        }
        steps.push({ name: call.function.name, label: stepLabel[call.function.name] || call.function.name })
        if (call.function.name === 'list_workspace') {
          result = await listWorkspaceBrief(c)
        } else if (call.function.name === 'get_note') {
          const nid = String(args.note_id || ctx?.note || '').trim()
          if (!nid) result = { error: '缺少 note_id' }
          else result = await getNoteBrief(c.env.DB, nid)
        } else if (call.function.name === 'propose_note') {
          const title = String(args.title || '').trim()
          const content = String(args.content || '').trim()
          if (!title || !content) {
            result = { error: 'title 和 content 必填' }
          } else {
            draft = {
              action: 'create_note',
              title,
              content,
              folder_title: args.folder_title?.trim(),
              folder_id: args.folder_id || null,
              create_folder: !!args.create_folder,
              note: args.note,
            }
            result = { ok: true, waiting_for_user_confirm: true, draft }
          }
        } else if (call.function.name === 'get_table_schema') {
          const name = String(args.table_name || ctx?.table || '').trim()
          if (!name) result = { error: '缺少 table_name' }
          else result = await getTableSchema(c.env.DB, name)
        } else if (call.function.name === 'propose_fields') {
          const tableName = String(args.table_name || ctx?.table || '').trim()
          const fields = normalizeFields(args.fields || [])
          if (!tableName || fields.length === 0) {
            result = { error: 'table_name 和 fields 必填' }
          } else {
            draft = {
              action: 'add_fields',
              table_name: tableName,
              title: ctx?.table_title || tableName,
              fields,
              note: args.note,
            }
            result = { ok: true, waiting_for_user_confirm: true, draft }
          }
        } else if (call.function.name === 'update_note') {
          assertWritable(c)
          const nid = String(args.note_id || ctx?.note || '').trim()
          if (!nid) result = { error: '缺少 note_id，请先打开一篇笔记或指定 id' }
          else {
            result = await updateNote(c.env.DB, nid, args.title, args.content)
            if ((result as { ok?: boolean }).ok) mutated = true
          }
        } else if (call.function.name === 'query_records') {
          const name = resolveTableName(args.table_name, ctx?.table)
          result = await queryRecords(c.env.DB, name, args.q, args.limit)
        } else if (call.function.name === 'get_record') {
          const name = resolveTableName(args.table_name, ctx?.table)
          result = await getRecord(c.env.DB, name, Number(args.id))
        } else if (call.function.name === 'insert_record') {
          assertWritable(c)
          const name = resolveTableName(args.table_name, ctx?.table)
          result = await insertRecord(c.env.DB, name, args.values || {})
          if ((result as { ok?: boolean }).ok) mutated = true
        } else if (call.function.name === 'update_record') {
          assertWritable(c)
          const name = resolveTableName(args.table_name, ctx?.table)
          result = await updateRecord(c.env.DB, name, Number(args.id), args.values || {})
          if ((result as { ok?: boolean }).ok) mutated = true
        } else if (call.function.name === 'delete_record') {
          assertWritable(c)
          const name = resolveTableName(args.table_name, ctx?.table)
          result = await deleteRecord(c.env.DB, name, Number(args.id), c.get('userId') ?? null, c.get('teamId') ?? null)
          if ((result as { ok?: boolean }).ok) mutated = true
        } else if (call.function.name === 'move_node') {
          assertWritable(c)
          result = await moveWorkspaceItem(c, {
            id: args.id != null ? String(args.id) : undefined,
            table_name: args.table_name,
            note_id: args.note_id,
            folder: args.folder as string | undefined,
            folder_id: args.folder_id != null ? String(args.folder_id) : undefined,
          }, ctx)
          mutated = true
        } else if (call.function.name === 'propose_table') {
          if (!args.title || !Array.isArray(args.fields) || args.fields.length === 0) {
            result = { error: 'title 和 fields 必填' }
          } else {
            draft = {
              action: 'create_table',
              title: String(args.title).trim(),
              folder_title: args.folder_title?.trim(),
              folder_id: args.folder_id || null,
              create_folder: !!args.create_folder,
              fields: normalizeFields(args.fields || []),
              note: args.note,
            }
            result = { ok: true, waiting_for_user_confirm: true, draft }
          }
        } else {
          result = { error: '未知工具' }
        }
      } catch (err) {
        result = { error: (err as Error).message }
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      })
    }
  }

  if (!reply) {
    reply = draft?.action === 'add_fields'
      ? `准备给当前表增加 ${draft.fields?.length || 0} 个字段，确认后才会写入。`
      : draft?.action === 'create_note'
        ? `准备新建笔记「${draft.title}」。确认后写入工作区。`
        : draft
          ? `准备建「${draft.title}」。请确认下面的字段后，我再真正创建。`
          : '我这边没有得到明确回复，请再说一次。'
  }

  if (threadId) {
    await appendMessage(c.env.DB, threadId, { role: 'user', content: userText, topic })
    await appendMessage(c.env.DB, threadId, { role: 'assistant', content: reply, draft, steps })
  }

  return c.json({ data: { reply, draft, steps, mutated, topic } })
})

assistant.post('/confirm', requireWriteMiddleware, async (c) => {
  const body = await c.req.json<{ draft?: TableDraft }>().catch(() => ({ draft: undefined as TableDraft | undefined }))
  const draft = body.draft
  if (!draft) {
    return c.json({ error: { code: 'INVALID_BODY', message: '没有可确认的草案' } }, 400)
  }

  if (draft.action === 'create_note') {
    const title = String(draft.title || '').trim()
    const content = String(draft.content || '').trim()
    if (!title || !content) {
      return c.json({ error: { code: 'INVALID_BODY', message: '笔记标题和正文不能为空' } }, 400)
    }
    const teamId = c.get('teamId')
    const ownerId = c.get('userId') ?? null
    const nodes = await expandTablesAcrossFolders(c.env.DB, teamId, await listWorkspaceNodes(c.env.DB, teamId))
    let folderId = draft.folder_id || null
    if (!folderId && draft.folder_title) {
      const hit = nodes.find((n) => n.kind === 'folder' && n.title === draft.folder_title)
      folderId = hit?.id ?? null
    }
    if (!folderId && draft.folder_title && draft.create_folder) {
      const folder = await createFolder(c.env.DB, {
        title: draft.folder_title,
        teamId,
        ownerId,
      })
      folderId = folder.id
    }
    const id = 'n_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    await c.env.DB.prepare(
      `INSERT INTO _notes (id, title, content, parent_id, created_by, owner_id, team_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(id, title, content, ownerId, ownerId, teamId ?? null).run()
    await ensureNoteNode(c.env.DB, { noteId: id, title, folderId, teamId, ownerId })
    return c.json({ data: { name: id, title, folder_id: folderId, action: 'create_note' } }, 201)
  }

  if (!draft.fields?.length) {
    return c.json({ error: { code: 'INVALID_BODY', message: '没有可确认的草案' } }, 400)
  }

  if (draft.action === 'add_fields') {
    const tableName = String(draft.table_name || '').trim()
    const tables = await getUserTables(c.env.DB)
    if (!tableName || !tables.includes(tableName)) {
      return c.json({ error: { code: 'NOT_FOUND', message: '找不到要改的表格' } }, 404)
    }
    const existing = await c.env.DB.prepare(
      `SELECT title FROM _field_meta WHERE table_name = ?`,
    ).bind(tableName).all<{ title: string }>()
    const have = new Set((existing.results ?? []).map((r) => (r.title || '').trim().toLowerCase()))
    const maxOrder = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(order_index), 0) as max_order FROM _field_meta WHERE table_name = ?`,
    ).bind(tableName).first<{ max_order: number }>()
    let order = maxOrder?.max_order ?? 0
    const added: string[] = []
    for (const f of draft.fields) {
      const title = f.title.trim()
      if (!title || have.has(title.toLowerCase())) continue
      const columnName = randomId('col_', 4)
      const sqliteType = fieldTypeToSqlite(f.field_type)
      const select_options = f.field_type === 'select' && f.options?.length
        ? JSON.stringify(f.options.map((label, i) => ({
          value: label, label, color: ['#4f6ef7', '#18a058', '#f0a020', '#d03050', '#8a2be2'][i % 5],
        })))
        : null
      order += 10
      await c.env.DB.batch([
        c.env.DB.prepare(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${sqliteType}`),
        c.env.DB.prepare(
          `INSERT INTO _field_meta (table_name, column_name, title, field_type, select_options, order_index, width)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(tableName, columnName, title, f.field_type, select_options, order, 180),
      ])
      have.add(title.toLowerCase())
      added.push(title)
    }
    return c.json({ data: { name: tableName, title: draft.title || tableName, folder_id: null, action: 'add_fields', added } })
  }

  if (!draft.title) {
    return c.json({ error: { code: 'INVALID_BODY', message: '没有可确认的草案' } }, 400)
  }

  const teamId = c.get('teamId')
  const ownerId = c.get('userId') ?? null
  const nodes = await expandTablesAcrossFolders(c.env.DB, teamId, await listWorkspaceNodes(c.env.DB, teamId))
  let folderId = draft.folder_id || null
  if (!folderId && draft.folder_title) {
    const hit = nodes.find((n) => n.kind === 'folder' && n.title === draft.folder_title)
    folderId = hit?.id ?? null
  }
  if (!folderId && draft.folder_title && draft.create_folder) {
    const folder = await createFolder(c.env.DB, {
      title: draft.folder_title,
      teamId,
      ownerId,
    })
    folderId = folder.id
  }

  const tableName = randomId('tbl_')
  const existing = await getUserTables(c.env.DB)
  if (existing.includes(tableName) || !isValidIdentifier(tableName)) {
    return c.json({ error: { code: 'CONFLICT', message: '表名生成失败，请再试一次' } }, 409)
  }

  const columns = draft.fields.map((f) => {
    const name = randomId('col_', 4)
    const type = fieldTypeToSqlite(f.field_type)
    const select_options = f.field_type === 'select' && f.options?.length
      ? f.options.map((label, i) => ({
        value: label,
        label,
        color: ['#4f6ef7', '#18a058', '#f0a020', '#d03050', '#8a2be2'][i % 5],
      }))
      : undefined
    return {
      name,
      title: f.title,
      type,
      field_type: f.field_type,
      select_options,
    }
  })

  const colDefs = columns.map((col) => `"${col.name}" ${col.type}`)
  const createSQL = `CREATE TABLE "${tableName}" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  ${colDefs.join(',\n  ')},
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
)`

  const allMeta = [
    { name: 'id', title: 'ID', field_type: 'number', select_options: null as string | null },
    ...columns.map((col) => ({
      name: col.name,
      title: col.title,
      field_type: col.field_type,
      select_options: col.select_options ? JSON.stringify(col.select_options) : null,
    })),
    { name: 'created_at', title: '创建时间', field_type: 'datetime', select_options: null },
  ]

  await c.env.DB.batch([
    c.env.DB.prepare(createSQL),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO _meta (table_name, row_count, title, owner_id, team_id) VALUES (?, 0, ?, ?, ?)`,
    ).bind(tableName, draft.title, ownerId, teamId ?? null),
    ...allMeta.map((col, idx) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO _field_meta (table_name, column_name, title, field_type, select_options, order_index, width, is_hidden)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        tableName,
        col.name,
        col.title,
        col.field_type,
        col.select_options,
        idx * 10,
        col.name === 'id' ? 80 : 180,
        col.name === 'created_at' ? 1 : 0,
      ),
    ),
  ])

  await ensureTableNode(c.env.DB, {
    tableName,
    title: draft.title,
    folderId,
    teamId,
    ownerId,
  })

  return c.json({ data: { name: tableName, title: draft.title, folder_id: folderId } }, 201)
})

export default assistant
