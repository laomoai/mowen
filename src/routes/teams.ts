import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AuthVariables, Env } from '../types'
import { requireWriteMiddleware } from '../middleware/auth'
import {
  addTeamMember,
  createInvite,
  isValidEmail,
  listTeamInvites,
  listUserSpaces,
  removeTeamMember,
  revokeInvite,
  setActiveTeam,
} from '../utils/members'
import { withAvatar } from '../utils/avatar'

type AppContext = Context<{ Bindings: Env; Variables: AuthVariables }>

/** Verify current user is the Space owner (created_by). Returns error response or null. */
async function requireOwner(c: AppContext, teamId: number): Promise<Response | null> {
  const userId = c.get('userId')
  const member = userId
    ? await c.env.DB.prepare(
      `SELECT role FROM _team_members WHERE team_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
    ).bind(teamId, userId).first<{ role: string }>()
    : null
  if (!member || member.role !== 'owner') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Only the Space owner can perform this action' } }, 403)
  }
  return null
}

const teams = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

teams.get('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)
  return c.json({ data: await listUserSpaces(c.env.DB, userId) })
})

teams.post('/', requireWriteMiddleware, async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)
  const body = await c.req.json<{ name?: string }>()
    .catch(() => ({} as { name?: string }))
  const name = body.name?.trim()
  if (!name) return c.json({ error: { code: 'INVALID_BODY', message: '空间名称不能为空' } }, 400)

  const result = await c.env.DB.prepare(`INSERT INTO _teams (name, created_by) VALUES (?, ?)`)
    .bind(name, userId)
    .run()
  const teamId = Number(result.meta.last_row_id)
  await addTeamMember(c.env.DB, { teamId, userId, role: 'owner' })
  const space = await setActiveTeam(c.env.DB, userId, teamId)
  return c.json({ data: { id: space.id, name: space.name, role: space.role } }, 201)
})

/**
 * GET /api/teams/current
 * 获取当前团队详情 + 成员列表
 */
teams.get('/current', async (c) => {
  const teamId = c.get('teamId')
  if (!teamId) {
    return c.json({ error: { code: 'NO_TEAM', message: 'No team associated with this account' } }, 400)
  }

  const [team, members] = await Promise.all([
    c.env.DB.prepare(`SELECT id, name, created_by, created_at FROM _teams WHERE id = ?`)
      .bind(teamId).first<{ id: number; name: string; created_by: number | null; created_at: number }>(),
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.picture, u.role, u.status, u.last_login, tm.role AS space_role, tm.joined_at
       FROM _team_members tm
       JOIN _users u ON u.id = tm.user_id
       WHERE tm.team_id = ? AND tm.status = 'active'
       ORDER BY tm.joined_at ASC, u.id ASC`
    ).bind(teamId).all<{ id: number; email: string; name: string; picture: string; role: string; status: string; space_role: string; joined_at: number }>(),
  ])

  if (!team) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Team not found' } }, 404)
  }

  return c.json({
    data: {
      ...team,
      members: members.results.map((m) => ({ ...m, picture: withAvatar(m.picture, m.email) })),
    }
  })
})

/**
 * PATCH /api/teams/current
 * 重命名团队
 */
teams.patch('/current', requireWriteMiddleware, async (c) => {
  const teamId = c.get('teamId')
  if (!teamId) {
    return c.json({ error: { code: 'NO_TEAM', message: 'No team associated' } }, 400)
  }

  const ownerErr = await requireOwner(c, teamId)
  if (ownerErr) return ownerErr

  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Team name cannot be empty' } }, 400)
  }

  await c.env.DB.prepare(`UPDATE _teams SET name = ? WHERE id = ?`)
    .bind(body.name.trim(), teamId).run()

  return c.json({ data: { success: true } })
})

/**
 * POST /api/teams/current/members
 * 添加成员（输入邮箱）
 */
teams.post('/current/members', requireWriteMiddleware, async (c) => {
  const teamId = c.get('teamId')
  if (!teamId) {
    return c.json({ error: { code: 'NO_TEAM', message: 'No team associated' } }, 400)
  }

  const ownerErr = await requireOwner(c, teamId)
  if (ownerErr) return ownerErr

  const body = await c.req.json<{ email: string }>()
  const email = body.email?.trim().toLowerCase()
  if (!email || !isValidEmail(email)) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Valid email is required' } }, 400)
  }

  const existingUser = await c.env.DB.prepare(
    `SELECT id, team_id, current_team_id FROM _users WHERE email = ? LIMIT 1`
  ).bind(email).first<{ id: number; team_id: number | null; current_team_id: number | null }>()

  if (existingUser) {
    const existingMember = await c.env.DB.prepare(
      `SELECT 1 FROM _team_members WHERE team_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
    ).bind(teamId, existingUser.id).first()
    if (existingMember) {
      return c.json({ error: { code: 'ALREADY_MEMBER', message: 'User is already a member of this space' } }, 409)
    }
    await addTeamMember(c.env.DB, { teamId, userId: existingUser.id, role: 'member', invitedBy: c.get('userId') ?? null })
    return c.json({ data: { id: existingUser.id, email, mail_sent: false, existing_user: true } }, 201)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO _users (email, name, role, status, team_id, current_team_id) VALUES (?, ?, 'user', 'active', ?, ?)`
  ).bind(email, email, teamId, teamId).run()

  const newId = Number(result.meta.last_row_id)
  await addTeamMember(c.env.DB, { teamId, userId: newId, role: 'member', invitedBy: c.get('userId') ?? null })
  try {
    const { sendInviteEmail } = await import('./auth')
    await sendInviteEmail(c.env, newId, email)
  } catch (err) {
    return c.json({
      data: { id: newId, email, mail_sent: false },
      error: { code: 'MAIL_FAILED', message: (err as Error).message || '邀请邮件发送失败' },
    }, 201)
  }

  return c.json({ data: { id: newId, email, mail_sent: true } }, 201)
})

teams.post('/current/members/:userId/invite', requireWriteMiddleware, async (c) => {
  const teamId = c.get('teamId')
  if (!teamId) {
    return c.json({ error: { code: 'NO_TEAM', message: '没有团队' } }, 400)
  }
  const ownerErr = await requireOwner(c, teamId)
  if (ownerErr) return ownerErr

  const userId = parseInt(c.req.param('userId'), 10)
  const member = await c.env.DB.prepare(
    `SELECT u.id, u.email FROM _team_members tm JOIN _users u ON u.id = tm.user_id WHERE u.id = ? AND tm.team_id = ?`,
  ).bind(userId, teamId).first<{ id: number; email: string }>()
  if (!member) {
    return c.json({ error: { code: 'NOT_FOUND', message: '找不到这位成员' } }, 404)
  }
  try {
    const { sendInviteEmail } = await import('./auth')
    await sendInviteEmail(c.env, member.id, member.email)
  } catch (err) {
    return c.json({ error: { code: 'MAIL_FAILED', message: (err as Error).message || '邀请邮件发送失败' } }, 502)
  }
  return c.json({ data: { success: true } })
})

teams.get('/current/invites', async (c) => {
  const teamId = c.get('teamId')
  if (!teamId) return c.json({ error: { code: 'NO_TEAM', message: '没有团队' } }, 400)
  const ownerErr = await requireOwner(c, teamId)
  if (ownerErr) return ownerErr
  return c.json({ data: await listTeamInvites(c.env.DB, teamId) })
})

teams.post('/current/invites', requireWriteMiddleware, async (c) => {
  const teamId = c.get('teamId')
  if (!teamId) return c.json({ error: { code: 'NO_TEAM', message: '没有团队' } }, 400)
  const ownerErr = await requireOwner(c, teamId)
  if (ownerErr) return ownerErr
  const body = await c.req.json<{ role?: string; max_uses?: number | null; expires_in_days?: number | null }>()
    .catch(() => ({} as { role?: string; max_uses?: number | null; expires_in_days?: number | null }))
  const role = body.role === 'viewer' || body.role === 'admin' ? body.role : 'member'
  const maxUses = Number.isInteger(body.max_uses) && Number(body.max_uses) > 0 ? Number(body.max_uses) : null
  const days = Number(body.expires_in_days || 0)
  const expiresAt = days > 0 ? Math.floor(Date.now() / 1000) + Math.floor(days * 86400) : null
  const invite = await createInvite(c.env.DB, {
    teamId,
    role,
    maxUses,
    expiresAt,
    createdBy: c.get('userId') ?? null,
  })
  return c.json({ data: invite }, 201)
})

teams.delete('/current/invites/:id', requireWriteMiddleware, async (c) => {
  const teamId = c.get('teamId')
  if (!teamId) return c.json({ error: { code: 'NO_TEAM', message: '没有团队' } }, 400)
  const ownerErr = await requireOwner(c, teamId)
  if (ownerErr) return ownerErr
  const inviteId = parseInt(c.req.param('id'), 10)
  const ok = await revokeInvite(c.env.DB, teamId, inviteId)
  if (!ok) return c.json({ error: { code: 'NOT_FOUND', message: '邀请码不存在或已撤销' } }, 404)
  return c.json({ data: { success: true } })
})

/**
 * DELETE /api/teams/current/members/:userId
 * 移除成员
 */
teams.delete('/current/members/:userId', requireWriteMiddleware, async (c) => {
  const teamId = c.get('teamId')
  const currentUserId = c.get('userId')
  const targetId = parseInt(c.req.param('userId'), 10)

  if (!teamId) {
    return c.json({ error: { code: 'NO_TEAM', message: 'No team associated' } }, 400)
  }

  const ownerErr = await requireOwner(c, teamId)
  if (ownerErr) return ownerErr

  // 不能移除自己（即 owner 不可被移除）
  if (targetId === currentUserId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Cannot remove yourself from the team' } }, 400)
  }

  // owner 不可被移除（防止通过 API 直接调用绕过前端）
  const team = await c.env.DB.prepare(
    `SELECT created_by FROM _teams WHERE id = ?`
  ).bind(teamId).first<{ created_by: number | null }>()
  if (team && team.created_by === targetId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Cannot remove the Space owner' } }, 400)
  }

  try {
    await removeTeamMember(c.env.DB, { teamId, userId: targetId })
  } catch (err) {
    return teamError(c, err)
  }

  return c.json({ data: { success: true } })
})

function teamError(c: { json: Function }, err: unknown) {
  const e = err as { status?: number; code?: string; message?: string }
  const status = (e.status === 400 || e.status === 403 || e.status === 404 || e.status === 409) ? e.status : 500
  if (status === 500) console.error('[teams]', err)
  return c.json({ error: { code: e.code || 'INTERNAL', message: e.message || '团队操作失败' } }, status)
}

export default teams
