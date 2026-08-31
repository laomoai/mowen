import type { MiddlewareHandler } from 'hono'
import type { AuthVariables, Env } from '../types'
import { sha256 } from '../utils/crypto'
import { verifySession } from '../utils/session'
import { getFolderScopedAccess } from '../utils/workspace'
import { getActiveTeamForUser } from '../utils/members'

/**
 * API Key / Session 认证中间件
 *
 * 优先级：
 * 1. Session cookie → 查 _users 表获取 userId
 * 2. ADMIN_KEY → 超级管理员（无 userId，绕过 owner 校验）
 * 3. _api_keys 表 → 继承 key 的 user_id
 */
export const authMiddleware: MiddlewareHandler<{
  Bindings: Env
  Variables: AuthVariables
}> = async (c, next) => {
  // 1. 尝试 session cookie 认证（web UI）
  const cookieHeader = c.req.header('Cookie')
  if (cookieHeader) {
    const user = await verifySession(cookieHeader, c.env.SESSION_SECRET)
    if (user) {
      // 查 _users 表确认用户存在且未禁用
      const userRow = await c.env.DB.prepare(
        `SELECT id, role, team_id, current_team_id FROM _users WHERE email = ? AND status = 'active' LIMIT 1`
      ).bind(user.email).first<{ id: number; role: 'admin' | 'user'; team_id: number | null; current_team_id: number | null }>()

      if (!userRow) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'User account not found or disabled' } }, 401)
      }

      c.set('keyType', 'readwrite')
      c.set('keyScope', 'all')
      c.set('allowedTables', null)
      c.set('allowedGroupIds', null)
      c.set('allowedNoteRootIds', null)
      c.set('user', user)
      c.set('userId', userRow.id)
      c.set('userRole', userRow.role)
      const activeSpace = await getActiveTeamForUser(c.env.DB, userRow.id, userRow.current_team_id ?? userRow.team_id)
      if (activeSpace) c.set('teamId', activeSpace.id)
      return next()
    }
  }

  // 2. API Key 认证
  const apiKey = c.req.header('X-API-Key') ?? c.req.query('api_key')

  if (!apiKey) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing API Key. Include it in the X-API-Key request header' } }, 401)
  }

  // 2a. ADMIN_KEY：超级管理员，不设 userId，绕过所有 owner 校验
  if (c.env.ADMIN_KEY && apiKey === c.env.ADMIN_KEY) {
    c.set('keyType', 'readwrite')
    c.set('keyScope', 'all')
    c.set('allowedTables', null)
    c.set('allowedGroupIds', null)
    c.set('allowedNoteRootIds', null)
    return next()
  }

  // 2b. 数据库 API Key
  const hash = await sha256(apiKey)
  const row = await c.env.DB.prepare(
    `SELECT id, type, scope, notes_scope, user_id, team_id FROM _api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1`
  )
    .bind(hash)
    .first<{ id: number; type: 'readonly' | 'readwrite'; scope: 'all' | 'groups'; notes_scope: 'all' | 'none' | 'roots'; user_id: number | null; team_id: number | null }>()

  if (!row) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or disabled API Key' } }, 401)
  }

  c.set('keyType', row.type)
  c.set('keyScope', row.scope)

  // 异步更新 last_used_at（不阻塞请求）
  c.executionCtx.waitUntil(
    c.env.DB.prepare(`UPDATE _api_keys SET last_used_at = unixepoch() WHERE id = ?`).bind(row.id).run()
  )

  // 设置 userId（API Key 继承创建者的 user_id）
  if (row.user_id) {
    c.set('userId', row.user_id)
  }
  // 设置 teamId（API Key 继承创建时的 team_id）
  if (row.team_id) {
    c.set('teamId', row.team_id)
  }

  // scope=groups → 该组/文件夹下的表和笔记（含子文件夹）
  if (row.scope === 'groups') {
    const groupIds = await c.env.DB.prepare(
      `SELECT group_id FROM _api_key_groups WHERE key_id = ?`,
    ).bind(row.id).all<{ group_id: number }>()
    const ids = groupIds.results.map((r) => r.group_id)
    const access = await getFolderScopedAccess(c.env.DB, row.team_id ?? c.get('teamId'), ids)
    c.set('allowedTables', access.tableNames)
    c.set('allowedGroupIds', access.folderGroupIds)
    c.set('allowedNoteRootIds', access.noteIds)
  } else {
    c.set('allowedTables', null)
    c.set('allowedGroupIds', null)
    if (row.notes_scope === 'roots') {
      const noteRoots = await c.env.DB.prepare(
        `SELECT note_id FROM _api_key_note_roots WHERE key_id = ?`
      ).bind(String(row.id)).all<{ note_id: string }>()
      c.set('allowedNoteRootIds', noteRoots.results.map((r) => r.note_id))
    } else {
      c.set('allowedNoteRootIds', row.notes_scope === 'none' ? [] : null)
    }
  }

  return next()
}

/**
 * 写操作保护中间件：readonly key 不允许写操作
 */
export const requireWriteMiddleware: MiddlewareHandler<{
  Bindings: Env
  Variables: AuthVariables
}> = async (c, next) => {
  if (c.get('keyType') !== 'readwrite') {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'This operation requires a read-write API Key' } },
      403
    )
  }
  return next()
}

/**
 * 表访问控制中间件：
 * 1. scope=groups 的 Key 只能访问关联分组内的表
 * 2. 有 userId 时验证表的 owner_id 匹配
 */
export const tableAccessMiddleware: MiddlewareHandler<{
  Bindings: Env
  Variables: AuthVariables
}> = async (c, next) => {
  const tableName = c.req.param('tableName')
  if (!tableName) return next()

  // _notes uses dedicated note-scope checks inside the search helper.
  if (tableName === '_notes' && c.req.path.endsWith('/records/search')) {
    return next()
  }

  // scope=groups 限制
  const allowedTables = c.get('allowedTables')
  if (allowedTables !== null && allowedTables !== undefined) {
    if (!allowedTables.includes(tableName)) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: `Access to table "${tableName}" is not allowed` } },
        403
      )
    }
  }

  // team 校验：有 teamId 时检查表归属
  const teamId = c.get('teamId')
  if (teamId !== undefined) {
    const meta = await c.env.DB.prepare(
      `SELECT team_id FROM _meta WHERE table_name = ?`
    ).bind(tableName).first<{ team_id: number | null }>()

    // 表存在于 _meta 且有 team_id 且不匹配 → 拒绝
    if (meta && meta.team_id !== null && meta.team_id !== teamId) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: `Access to table "${tableName}" is not allowed` } },
        403
      )
    }
  }

  const method = c.req.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const row = await c.env.DB.prepare(
      `SELECT archived_at FROM _meta WHERE table_name = ?`,
    ).bind(tableName).first<{ archived_at: number | null }>()
    if (row?.archived_at && !c.req.path.endsWith('/unarchive')) {
      return c.json(
        { error: { code: 'ARCHIVED', message: '归档中的表格不能修改，请先把所在文件夹恢复到工作区' } },
        403,
      )
    }
  }

  return next()
}

/** team_id 过滤条件辅助（替代原 ownerFilter） */
export function teamFilter(teamId: number | undefined): { clause: string; params: unknown[] } {
  if (teamId !== undefined) {
    return { clause: 'team_id = ?', params: [teamId] }
  }
  return { clause: '1=1', params: [] }
}

/**
 * Admin 角色保护中间件
 */
export const requireAdminMiddleware: MiddlewareHandler<{
  Bindings: Env
  Variables: AuthVariables
}> = async (c, next) => {
  if (c.get('userRole') !== 'admin') {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      403
    )
  }
  return next()
}
