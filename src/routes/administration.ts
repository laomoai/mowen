import { Hono } from 'hono'
import type { AuthVariables, Env } from '../types'
import { requireAdminMiddleware } from '../middleware/auth'
import { addTeamMember, hardDeleteSpace, isValidEmail, removeTeamMember } from '../utils/members'
import { withAvatar } from '../utils/avatar'

const administration = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

administration.use('*', requireAdminMiddleware)

/**
 * GET /api/admin/spaces
 * List all Spaces with summary stats
 */
administration.get('/spaces', async (c) => {
  const teams = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.created_by, t.created_at, u.email as owner_email
     FROM _teams t
     LEFT JOIN _users u ON u.id = t.created_by
     ORDER BY t.id ASC`
  ).all<{ id: number; name: string; created_by: number | null; created_at: number; owner_email: string | null }>()

  const teamIds = teams.results.map(t => t.id)
  if (teamIds.length === 0) return c.json({ data: [] })

  const placeholders = teamIds.map(() => '?').join(',')

  const [memberCounts, tableCounts, noteCounts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT team_id, COUNT(*) as count FROM _team_members WHERE team_id IN (${placeholders}) AND status = 'active' GROUP BY team_id`
    ).bind(...teamIds).all<{ team_id: number; count: number }>(),
    c.env.DB.prepare(
      `SELECT team_id, COUNT(*) as count FROM _meta WHERE team_id IN (${placeholders}) GROUP BY team_id`
    ).bind(...teamIds).all<{ team_id: number; count: number }>(),
    c.env.DB.prepare(
      `SELECT team_id, COUNT(*) as count FROM _notes WHERE team_id IN (${placeholders}) AND deleted_at IS NULL AND archived_at IS NULL GROUP BY team_id`
    ).bind(...teamIds).all<{ team_id: number; count: number }>(),
  ])

  const memberMap = new Map(memberCounts.results.map(r => [r.team_id, r.count]))
  const tableMap = new Map(tableCounts.results.map(r => [r.team_id, r.count]))
  const noteMap = new Map(noteCounts.results.map(r => [r.team_id, r.count]))

  const data = teams.results.map(t => ({
    id: t.id,
    name: t.name,
    created_by: t.created_by,
    created_at: t.created_at,
    owner_email: t.owner_email,
    member_count: memberMap.get(t.id) ?? 0,
    table_count: tableMap.get(t.id) ?? 0,
    note_count: noteMap.get(t.id) ?? 0,
  }))

  return c.json({ data })
})

/**
 * POST /api/admin/spaces
 * Create a new Space with an owner
 */
administration.post('/spaces', async (c) => {
  const body = await c.req.json<{ name: string; owner_email: string }>()
  const name = body.name?.trim()
  const ownerEmail = body.owner_email?.trim().toLowerCase()

  if (!name) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Space name is required' } }, 400)
  }
  if (!ownerEmail || !isValidEmail(ownerEmail)) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Valid owner email is required' } }, 400)
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM _users WHERE email = ? LIMIT 1`
  ).bind(ownerEmail).first<{ id: number }>()

  // Step 1: create team (created_by is NULL initially due to circular reference)
  const teamResult = await c.env.DB.prepare(
    `INSERT INTO _teams (name) VALUES (?)`
  ).bind(name).run()
  const teamId = teamResult.meta.last_row_id

  try {
    // Step 2: create or reuse owner user. One account may own multiple spaces.
    let userId = existing?.id
    if (!userId) {
      const userResult = await c.env.DB.prepare(
        `INSERT INTO _users (email, name, role, status, team_id, current_team_id) VALUES (?, ?, 'user', 'active', ?, ?)`
      ).bind(ownerEmail, ownerEmail, teamId, teamId).run()
      userId = Number(userResult.meta.last_row_id)
    }

    // Step 3: backfill created_by
    await c.env.DB.prepare(
      `UPDATE _teams SET created_by = ? WHERE id = ?`
    ).bind(userId, teamId).run()
    await addTeamMember(c.env.DB, { teamId: Number(teamId), userId: Number(userId), role: 'owner' })

    if (!existing) try {
      const { sendInviteEmail } = await import('./auth')
      await sendInviteEmail(c.env, Number(userId), ownerEmail)
    } catch (mailErr) {
      console.error('[mail] owner invite failed', mailErr)
    }

    return c.json({
      data: { id: teamId, name, owner_email: ownerEmail, owner_id: userId, existing_user: Boolean(existing) }
    }, 201)
  } catch (err) {
    // Rollback: delete orphaned team
    await c.env.DB.prepare(`DELETE FROM _teams WHERE id = ?`).bind(teamId).run()
    throw err
  }
})

/**
 * GET /api/admin/spaces/:id
 * Space detail with member list
 */
administration.get('/spaces/:id', async (c) => {
  const spaceId = parseInt(c.req.param('id'), 10)

  const [team, members] = await Promise.all([
    c.env.DB.prepare(
      `SELECT t.id, t.name, t.created_by, t.created_at, u.email as owner_email
       FROM _teams t LEFT JOIN _users u ON u.id = t.created_by
       WHERE t.id = ?`
    ).bind(spaceId).first<{ id: number; name: string; created_by: number | null; created_at: number; owner_email: string | null }>(),
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.picture, u.role, u.status, u.last_login, tm.role AS space_role, tm.joined_at
       FROM _team_members tm
       JOIN _users u ON u.id = tm.user_id
       WHERE tm.team_id = ? AND tm.status = 'active'
       ORDER BY tm.joined_at ASC, u.id ASC`
    ).bind(spaceId).all<{ id: number; email: string; name: string; picture: string; role: string; status: string; space_role: string; joined_at: number }>(),
  ])

  if (!team) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
  }

  return c.json({
    data: {
      ...team,
      members: members.results.map((m) => ({ ...m, picture: withAvatar(m.picture, m.email) })),
    },
  })
})

/**
 * PATCH /api/admin/spaces/:id
 * Rename a Space
 */
administration.patch('/spaces/:id', async (c) => {
  const spaceId = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()

  if (!name) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Space name cannot be empty' } }, 400)
  }

  const result = await c.env.DB.prepare(
    `UPDATE _teams SET name = ? WHERE id = ?`
  ).bind(name, spaceId).run()

  if (result.meta.changes === 0) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
  }

  return c.json({ data: { success: true } })
})

/**
 * POST /api/admin/spaces/:id/members
 * Add a member to a Space. Existing users can join multiple Spaces.
 */
administration.post('/spaces/:id/members', async (c) => {
  const spaceId = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ email: string }>()
  const email = body.email?.trim().toLowerCase()

  if (!email || !isValidEmail(email)) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Valid email is required' } }, 400)
  }

  // Verify space exists
  const team = await c.env.DB.prepare(
    `SELECT id FROM _teams WHERE id = ?`
  ).bind(spaceId).first()
  if (!team) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM _users WHERE email = ? LIMIT 1`
  ).bind(email).first<{ id: number }>()
  if (existing) {
    const member = await c.env.DB.prepare(
      `SELECT 1 FROM _team_members WHERE team_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
    ).bind(spaceId, existing.id).first()
    if (member) {
      return c.json({ error: { code: 'ALREADY_MEMBER', message: `User "${email}" is already in this space` } }, 409)
    }
    await addTeamMember(c.env.DB, { teamId: spaceId, userId: existing.id, role: 'member', invitedBy: c.get('userId') ?? null })
    return c.json({ data: { id: existing.id, email, existing_user: true } }, 201)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO _users (email, name, role, status, team_id, current_team_id) VALUES (?, ?, 'user', 'active', ?, ?)`
  ).bind(email, email, spaceId, spaceId).run()

  const newId = result.meta.last_row_id
  await addTeamMember(c.env.DB, { teamId: spaceId, userId: Number(newId), role: 'member', invitedBy: c.get('userId') ?? null })
  try {
    const { sendInviteEmail } = await import('./auth')
    await sendInviteEmail(c.env, Number(newId), email)
  } catch (err) {
    console.error('[mail] invite failed', err)
  }

  return c.json({ data: { id: newId, email } }, 201)
})

/**
 * DELETE /api/admin/spaces/:id/members/:userId
 * Remove a member from a Space. Owner cannot be removed.
 */
administration.delete('/spaces/:id/members/:userId', async (c) => {
  const spaceId = parseInt(c.req.param('id'), 10)
  const targetId = parseInt(c.req.param('userId'), 10)

  // Verify space exists and check owner
  const team = await c.env.DB.prepare(
    `SELECT id, created_by FROM _teams WHERE id = ?`
  ).bind(spaceId).first<{ id: number; created_by: number | null }>()
  if (!team) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
  }

  if (team.created_by === targetId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Cannot remove the Space owner' } }, 400)
  }

  try {
    await removeTeamMember(c.env.DB, { teamId: spaceId, userId: targetId })
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string }
    const status = (e.status === 400 || e.status === 403 || e.status === 404 || e.status === 409) ? e.status : 500
    return c.json({ error: { code: e.code || 'DELETE_FAILED', message: e.message || '移除成员失败' } }, status)
  }

  return c.json({ data: { success: true } })
})

/**
 * DELETE /api/admin/spaces/:id
 * Delete a Space and all its data. Requires confirmation (body.confirm_name must match space name).
 */
administration.post('/spaces/:id/delete', async (c) => {
  const spaceId = parseInt(c.req.param('id'), 10)
  const body = await c.req.json<{ confirm_name: string }>()

  if (!body.confirm_name) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'confirm_name is required' } }, 400)
  }

  const team = await c.env.DB.prepare(
    `SELECT id, name FROM _teams WHERE id = ?`
  ).bind(spaceId).first<{ id: number; name: string }>()
  if (!team) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Space not found' } }, 404)
  }

  if (body.confirm_name !== team.name) {
    return c.json({ error: { code: 'CONFIRMATION_FAILED', message: 'Space name does not match. Please type the exact space name to confirm deletion.' } }, 400)
  }

  try {
    await hardDeleteSpace(c.env.DB, spaceId)
  } catch (err) {
    return c.json({ error: { code: 'DELETE_FAILED', message: (err as Error).message } }, 500)
  }

  return c.json({ data: { success: true } })
})

export default administration
