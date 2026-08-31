import { sha256 } from './crypto'
import type { AppPreparedStatement } from '../db/sqlite'
import { generateToken } from './password'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export type SpaceRole = 'owner' | 'admin' | 'member' | 'viewer'

export type UserSpace = {
  id: number
  name: string
  role: SpaceRole
  created_by: number | null
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email)
}

export async function listUserSpaces(db: AppDatabase, userId: number): Promise<UserSpace[]> {
  const rows = await db.prepare(
    `SELECT t.id, t.name, tm.role, t.created_by
     FROM _team_members tm
     JOIN _teams t ON t.id = tm.team_id
     WHERE tm.user_id = ? AND tm.status = 'active'
     ORDER BY tm.joined_at ASC, t.id ASC`,
  ).bind(userId).all<UserSpace>()
  return rows.results.map((row) => ({
    id: Number(row.id),
    name: row.name,
    role: normalizeRole(row.role),
    created_by: row.created_by == null ? null : Number(row.created_by),
  }))
}

export async function getActiveTeamForUser(
  db: AppDatabase,
  userId: number,
  currentTeamId: number | null | undefined,
): Promise<UserSpace | null> {
  const spaces = await listUserSpaces(db, userId)
  if (!spaces.length) return null
  const active = currentTeamId ? spaces.find((space) => space.id === currentTeamId) : null
  const picked = active || spaces[0]
  if (!active) {
    await db.prepare(`UPDATE _users SET current_team_id = ?, team_id = ? WHERE id = ?`).bind(picked.id, picked.id, userId).run()
  }
  return picked
}

export async function setActiveTeam(db: AppDatabase, userId: number, teamId: number): Promise<UserSpace> {
  const row = await db.prepare(
    `SELECT t.id, t.name, tm.role, t.created_by
     FROM _team_members tm
     JOIN _teams t ON t.id = tm.team_id
     WHERE tm.user_id = ? AND tm.team_id = ? AND tm.status = 'active'
     LIMIT 1`,
  ).bind(userId, teamId).first<UserSpace>()
  if (!row) throw Object.assign(new Error('你不是该空间成员'), { status: 403, code: 'FORBIDDEN' })
  await db.prepare(`UPDATE _users SET current_team_id = ?, team_id = ? WHERE id = ?`).bind(teamId, teamId, userId).run()
  return {
    id: Number(row.id),
    name: row.name,
    role: normalizeRole(row.role),
    created_by: row.created_by == null ? null : Number(row.created_by),
  }
}

export async function assertTeamMember(
  db: AppDatabase,
  userId: number,
  teamId: number,
): Promise<{ role: SpaceRole } | null> {
  const row = await db.prepare(
    `SELECT role FROM _team_members WHERE user_id = ? AND team_id = ? AND status = 'active' LIMIT 1`,
  ).bind(userId, teamId).first<{ role: string }>()
  return row ? { role: normalizeRole(row.role) } : null
}

export async function addTeamMember(
  db: AppDatabase,
  opts: { teamId: number; userId: number; role?: SpaceRole; invitedBy?: number | null },
): Promise<void> {
  await db.prepare(
    `INSERT INTO _team_members (team_id, user_id, role, status, invited_by)
     VALUES (?, ?, ?, 'active', ?)
     ON CONFLICT(team_id, user_id) DO UPDATE SET
       role = excluded.role,
       status = 'active',
       invited_by = COALESCE(_team_members.invited_by, excluded.invited_by)`,
  ).bind(opts.teamId, opts.userId, opts.role || 'member', opts.invitedBy ?? null).run()

  const user = await db.prepare(
    `SELECT current_team_id, team_id FROM _users WHERE id = ?`,
  ).bind(opts.userId).first<{ current_team_id: number | null; team_id: number | null }>()
  if (user && !user.current_team_id) {
    await db.prepare(`UPDATE _users SET current_team_id = ?, team_id = COALESCE(team_id, ?) WHERE id = ?`)
      .bind(opts.teamId, opts.teamId, opts.userId)
      .run()
  }
}

export async function removeTeamMember(
  db: AppDatabase,
  opts: { teamId: number; userId: number },
): Promise<void> {
  const team = await db.prepare(
    `SELECT created_by FROM _teams WHERE id = ?`,
  ).bind(opts.teamId).first<{ created_by: number | null }>()
  if (team?.created_by === opts.userId) {
    throw Object.assign(new Error('不能移除空间所有者'), { status: 400, code: 'FORBIDDEN' })
  }

  const result = await db.prepare(
    `DELETE FROM _team_members WHERE team_id = ? AND user_id = ?`,
  ).bind(opts.teamId, opts.userId).run()
  if (result.meta.changes === 0) {
    throw Object.assign(new Error('成员不在该空间'), { status: 404, code: 'NOT_FOUND' })
  }

  const user = await db.prepare(
    `SELECT current_team_id FROM _users WHERE id = ?`,
  ).bind(opts.userId).first<{ current_team_id: number | null }>()
  if (user?.current_team_id === opts.teamId) {
    const spaces = await listUserSpaces(db, opts.userId)
    await db.prepare(`UPDATE _users SET current_team_id = ?, team_id = ? WHERE id = ?`)
      .bind(spaces[0]?.id ?? null, spaces[0]?.id ?? null, opts.userId)
      .run()
  }
}

export async function createInvite(
  db: AppDatabase,
  opts: { teamId: number; role?: SpaceRole; maxUses?: number | null; expiresAt?: number | null; createdBy?: number | null },
): Promise<{ id: number; code: string; expires_at: number | null; max_uses: number | null; role: SpaceRole }> {
  const code = `mw-invite-${generateToken(12)}`
  const codeHash = await sha256(normalizeInviteCode(code))
  const role = opts.role || 'member'
  const result = await db.prepare(
    `INSERT INTO _team_invites (team_id, code_hash, role, max_uses, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(opts.teamId, codeHash, role, opts.maxUses ?? null, opts.expiresAt ?? null, opts.createdBy ?? null).run()
  return {
    id: Number(result.meta.last_row_id),
    code,
    expires_at: opts.expiresAt ?? null,
    max_uses: opts.maxUses ?? null,
    role,
  }
}

export async function listTeamInvites(db: AppDatabase, teamId: number) {
  const rows = await db.prepare(
    `SELECT id, role, max_uses, used_count, expires_at, created_at, revoked_at
     FROM _team_invites
     WHERE team_id = ?
     ORDER BY created_at DESC, id DESC`,
  ).bind(teamId).all<{
    id: number
    role: string
    max_uses: number | null
    used_count: number
    expires_at: number | null
    created_at: number
    revoked_at: number | null
  }>()
  return rows.results.map((row) => ({ ...row, role: normalizeRole(row.role) }))
}

export async function revokeInvite(db: AppDatabase, teamId: number, inviteId: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE _team_invites SET revoked_at = unixepoch() WHERE id = ? AND team_id = ? AND revoked_at IS NULL`,
  ).bind(inviteId, teamId).run()
  return result.meta.changes > 0
}

export async function redeemInvite(
  db: AppDatabase,
  code: string,
  userId: number,
): Promise<UserSpace> {
  const codeHash = await sha256(normalizeInviteCode(code))
  const invite = await db.prepare(
    `SELECT i.id, i.team_id, i.role, i.max_uses, i.used_count, i.expires_at, i.revoked_at, t.name, t.created_by
     FROM _team_invites i
     JOIN _teams t ON t.id = i.team_id
     WHERE i.code_hash = ?
     LIMIT 1`,
  ).bind(codeHash).first<{
    id: number
    team_id: number
    role: string
    max_uses: number | null
    used_count: number
    expires_at: number | null
    revoked_at: number | null
    name: string
    created_by: number | null
  }>()

  const now = Math.floor(Date.now() / 1000)
  if (!invite || invite.revoked_at || (invite.expires_at && invite.expires_at < now)) {
    throw Object.assign(new Error('邀请码无效或已过期'), { status: 400, code: 'INVALID_INVITE' })
  }
  if (invite.max_uses !== null && invite.used_count >= invite.max_uses) {
    throw Object.assign(new Error('邀请码使用次数已达上限'), { status: 400, code: 'INVITE_EXHAUSTED' })
  }

  const existing = await assertTeamMember(db, userId, invite.team_id)
  if (!existing) {
    await addTeamMember(db, {
      teamId: invite.team_id,
      userId,
      role: normalizeRole(invite.role),
      invitedBy: invite.created_by,
    })
    await db.prepare(`UPDATE _team_invites SET used_count = used_count + 1 WHERE id = ?`).bind(invite.id).run()
  }
  const space = await setActiveTeam(db, userId, invite.team_id)
  return space
}

function normalizeInviteCode(code: string): string {
  return String(code || '').trim().toLowerCase()
}

function normalizeRole(role: string | null | undefined): SpaceRole {
  return role === 'owner' || role === 'admin' || role === 'viewer' ? role : 'member'
}

/**
 * Hard-delete a team member: nullify their ownership references, then remove user record.
 * Resources (notes, groups, etc.) remain in the Space (team_id unchanged), only personal ownership is cleared.
 */
export async function hardDeleteMember(db: AppDatabase, userId: number) {
  await db.batch([
    db.prepare(`DELETE FROM _team_members WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM _password_resets WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM _api_key_groups WHERE key_id IN (SELECT id FROM _api_keys WHERE user_id = ?)`).bind(userId),
    db.prepare(`DELETE FROM _api_key_note_roots WHERE key_id IN (SELECT id FROM _api_keys WHERE user_id = ?)`).bind(userId),
    db.prepare(`UPDATE _workspace_nodes SET owner_id = NULL WHERE owner_id = ?`).bind(userId),
    db.prepare(`UPDATE _notes SET owner_id = NULL WHERE owner_id = ?`).bind(userId),
    db.prepare(`UPDATE _notes SET created_by = NULL WHERE created_by = ?`).bind(userId),
    db.prepare(`UPDATE _groups SET owner_id = NULL WHERE owner_id = ?`).bind(userId),
    db.prepare(`UPDATE _meta SET owner_id = NULL WHERE owner_id = ?`).bind(userId),
    db.prepare(`UPDATE _dashboards SET owner_id = NULL WHERE owner_id = ?`).bind(userId),
    db.prepare(`UPDATE _trash SET owner_id = NULL WHERE owner_id = ?`).bind(userId),
    db.prepare(`DELETE FROM _user_preferences WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM _api_keys WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM _users WHERE id = ?`).bind(userId),
  ])
}

/**
 * Delete an entire Space and all its data.
 * Order matters: must respect FK constraints.
 *   _api_key_groups / _api_key_note_roots → _api_keys
 *   _group_tables → _groups
 *   _teams.created_by → _users  (must nullify before deleting the team)
 */
export async function hardDeleteSpace(db: AppDatabase, teamId: number) {
  const [users, tables] = await Promise.all([
    db.prepare(`SELECT user_id AS id FROM _team_members WHERE team_id = ?`).bind(teamId).all<{ id: number }>(),
    db.prepare(`SELECT table_name FROM _meta WHERE team_id = ?`).bind(teamId).all<{ table_name: string }>(),
  ])

  // Step 1: Break circular FK — nullify _teams.created_by so _users can be deleted later
  await db.prepare(`UPDATE _teams SET created_by = NULL WHERE id = ?`).bind(teamId).run()

  // Step 2: Delete FK-dependent association tables
  await db.batch([
    db.prepare(`DELETE FROM _api_key_groups WHERE key_id IN (SELECT id FROM _api_keys WHERE team_id = ?)`).bind(teamId),
    db.prepare(`DELETE FROM _api_key_note_roots WHERE key_id IN (SELECT id FROM _api_keys WHERE team_id = ?)`).bind(teamId),
    db.prepare(`DELETE FROM _group_tables WHERE group_id IN (SELECT id FROM _groups WHERE team_id = ?)`).bind(teamId),
    db.prepare(`DELETE FROM _team_invites WHERE team_id = ?`).bind(teamId),
  ])

  // Step 3: Move users whose current space is being deleted to another membership.
  const userStmts: AppPreparedStatement[] = [
    db.prepare(`DELETE FROM _team_members WHERE team_id = ?`).bind(teamId),
  ]
  for (const u of users.results) {
    userStmts.push(
      db.prepare(
        `UPDATE _users
         SET current_team_id = (
             SELECT team_id FROM _team_members
             WHERE user_id = ? AND team_id <> ? AND status = 'active'
             ORDER BY joined_at ASC, team_id ASC
             LIMIT 1
           ),
           team_id = (
             SELECT team_id FROM _team_members
             WHERE user_id = ? AND team_id <> ? AND status = 'active'
             ORDER BY joined_at ASC, team_id ASC
             LIMIT 1
           )
         WHERE id = ? AND current_team_id = ?`,
      ).bind(u.id, teamId, u.id, teamId, u.id, teamId),
    )
  }
  if (userStmts.length > 0) await db.batch(userStmts)

  await db.prepare(`DELETE FROM _api_keys WHERE team_id = ?`).bind(teamId).run()

  // Step 4: Delete space-scoped system records (no more FK deps on these)
  await db.batch([
    db.prepare(`DELETE FROM _notes WHERE team_id = ?`).bind(teamId),
    db.prepare(`DELETE FROM _groups WHERE team_id = ?`).bind(teamId),
    db.prepare(`DELETE FROM _dashboards WHERE team_id = ?`).bind(teamId),
    db.prepare(`DELETE FROM _trash WHERE team_id = ?`).bind(teamId),
    db.prepare(`DELETE FROM _meta WHERE team_id = ?`).bind(teamId),
  ])

  // Step 5: Delete the team. Accounts can belong to other Spaces, so they are preserved.
  await db.prepare(`DELETE FROM _teams WHERE id = ?`).bind(teamId).run()

  // Step 6: Drop user-created data tables
  for (const t of tables.results) {
    try {
      await db.prepare(`DROP TABLE IF EXISTS "${t.table_name}"`).run()
    } catch {
      // Table may already be gone
    }
  }
}
