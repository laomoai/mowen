import { Hono } from 'hono'
import type { AuthVariables, Env } from '../types'
import { sha256 } from '../utils/crypto'
import { verifySession } from '../utils/session'
import { getFolderScopedAccess } from '../utils/workspace'
import {
  canReadStoredFile,
  getFileMeta,
  normalizeStorageKey,
  signFileUrl,
  verifyFileSig,
} from '../utils/files'

const files = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

async function resolveViewer(c: { env: Env; req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }) {
  const cookieHeader = c.req.header('Cookie')
  if (cookieHeader) {
    const user = await verifySession(cookieHeader, c.env.SESSION_SECRET)
    if (user) {
      const userRow = await c.env.DB.prepare(
        `SELECT id, team_id FROM _users WHERE email = ? AND status = 'active' LIMIT 1`,
      ).bind(user.email).first<{ id: number; team_id: number | null }>()
      if (userRow) {
        return {
          userId: userRow.id,
          teamId: userRow.team_id ?? undefined,
          allowedTables: null as string[] | null,
          allowedNoteRootIds: null as string[] | null,
          isAdminKey: false,
        }
      }
    }
  }

  const apiKey = c.req.header('X-API-Key') ?? c.req.query('api_key')
  if (!apiKey) return null
  if (c.env.ADMIN_KEY && apiKey === c.env.ADMIN_KEY) {
    return { isAdminKey: true, allowedTables: null as string[] | null, allowedNoteRootIds: null as string[] | null }
  }
  const hash = await sha256(apiKey)
  const row = await c.env.DB.prepare(
    `SELECT id, scope, notes_scope, user_id, team_id FROM _api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1`,
  ).bind(hash).first<{
    id: number
    scope: 'all' | 'groups'
    notes_scope: 'all' | 'none' | 'roots'
    user_id: number | null
    team_id: number | null
  }>()
  if (!row) return null

  let allowedTables: string[] | null = null
  let allowedNoteRootIds: string[] | null = null
  if (row.scope === 'groups') {
    const groupIds = await c.env.DB.prepare(
      `SELECT group_id FROM _api_key_groups WHERE key_id = ?`,
    ).bind(row.id).all<{ group_id: number }>()
    const access = await getFolderScopedAccess(c.env.DB, row.team_id ?? undefined, groupIds.results.map((r) => r.group_id))
    allowedTables = access.tableNames
    allowedNoteRootIds = access.noteIds
  } else if (row.notes_scope === 'none') {
    allowedNoteRootIds = []
  } else if (row.notes_scope === 'roots') {
    const noteRoots = await c.env.DB.prepare(
      `SELECT note_id FROM _api_key_note_roots WHERE key_id = ?`,
    ).bind(String(row.id)).all<{ note_id: string }>()
    allowedNoteRootIds = noteRoots.results.map((r) => r.note_id)
  }

  return {
    userId: row.user_id ?? undefined,
    teamId: row.team_id ?? undefined,
    allowedTables,
    allowedNoteRootIds,
    isAdminKey: false,
  }
}

files.get('/sign', async (c) => {
  const key = normalizeStorageKey(c.req.query('key') || '')
  if (!key) return c.json({ error: { message: 'Missing key' } }, 400)
  const viewer = await resolveViewer(c)
  if (!viewer) return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)
  if (await c.env.BUCKET.size(key) === null) {
    return c.json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } }, 404)
  }
  const meta = await getFileMeta(c.env.DB, key)
  if (!(await canReadStoredFile(c.env.DB, meta, viewer))) {
    return c.json({ error: { code: 'FORBIDDEN', message: '无权查看此文件' } }, 403)
  }
  const { exp, sig } = signFileUrl(c.env.SESSION_SECRET, key)
  return c.json({ data: { key, exp, sig, url: `/api/files/${key}?exp=${exp}&sig=${sig}` } })
})

files.get('/*', async (c) => {
  const raw = c.req.path.replace(/^\/api\/files\//, '')
  const key = normalizeStorageKey(raw)
  if (!key) return c.json({ error: { message: 'Missing key' } }, 400)

  const exp = c.req.query('exp') || ''
  const sig = c.req.query('sig') || ''
  const signedOk = exp && sig && verifyFileSig(c.env.SESSION_SECRET, key, exp, sig)

  if (!signedOk) {
    const viewer = await resolveViewer(c)
    if (!viewer) return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)
    const meta = await getFileMeta(c.env.DB, key)
    if (!(await canReadStoredFile(c.env.DB, meta, viewer))) {
      return c.json({ error: { code: 'FORBIDDEN', message: '无权查看此文件' } }, 403)
    }
  }

  const obj = await c.env.BUCKET.get(key)
  if (!obj) return c.json({ error: { message: 'Not found' } }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('Cache-Control', signedOk ? 'private, max-age=300' : 'private, no-store')
  return new Response(obj.body as BodyInit, { headers })
})

export default files
