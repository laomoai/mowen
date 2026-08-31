import { Hono } from 'hono'
import type { Env, AuthVariables, SessionUser } from '../types'
import {
  createSessionCookie, clearSessionCookie, verifySession,
} from '../utils/session'
import { hashPassword, verifyPassword, generateToken } from '../utils/password'
import { sendMail, resetPasswordHtml, inviteHtml } from '../mail/resend'
import { withAvatar } from '../utils/avatar'
import {
  addTeamMember,
  getActiveTeamForUser,
  listUserSpaces,
  redeemInvite,
  setActiveTeam,
} from '../utils/members'

const auth = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function createBootstrapAdmin(
  c: { env: Env },
  email: string,
  name: string,
  passwordHash: string,
): Promise<void> {
  const teamResult = await c.env.DB.prepare(
    `INSERT INTO _teams (name) VALUES (?)`,
  ).bind(`${name}'s Team`).run()
  const teamId = teamResult.meta.last_row_id
  await c.env.DB.prepare(
    `INSERT INTO _users (email, name, picture, role, last_login, team_id, current_team_id, password_hash)
     VALUES (?, ?, '', 'admin', unixepoch(), ?, ?, ?)`,
  ).bind(email, name, teamId, teamId, passwordHash).run()
  const newUser = await c.env.DB.prepare(
    `SELECT id FROM _users WHERE email = ?`,
  ).bind(email).first<{ id: number }>()
  if (newUser) {
    await c.env.DB.prepare(`UPDATE _teams SET created_by = ? WHERE id = ?`).bind(newUser.id, teamId).run()
    await addTeamMember(c.env.DB, { teamId, userId: newUser.id, role: 'owner' })
  }
}

async function issueSession(c: { req: { url: string } }, env: Env, user: SessionUser) {
  const isSecure = new URL(c.req.url).protocol === 'https:'
  return createSessionCookie(user, env.SESSION_SECRET, isSecure)
}

auth.get('/setup-status', async (c) => {
  const userCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM _users`).first<{ cnt: number }>()
  return c.json({
    data: {
      bootstrap: !userCount || userCount.cnt === 0,
      publicRegister: (c.env.ALLOW_PUBLIC_REGISTER ?? 'false') === 'true',
    },
  })
})

// POST /register — 仅当用户表为空，或 ALLOW_PUBLIC_REGISTER=true
auth.post('/register', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; name?: string; invite_code?: string }>()
    .catch(() => ({} as { email?: string; password?: string; name?: string; invite_code?: string }))
  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''
  const name = (body.name?.trim() || email.split('@')[0] || 'User')
  const inviteCode = body.invite_code?.trim() ?? ''

  if (!isValidEmail(email) || password.length < 8) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Valid email and password (min 8 chars) are required' } }, 400)
  }

  const userCount = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM _users`).first<{ cnt: number }>()
  const empty = !userCount || userCount.cnt === 0
  const publicOk = (c.env.ALLOW_PUBLIC_REGISTER ?? 'false') === 'true'
  if (!empty && !publicOk && !inviteCode) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Registration is closed' } }, 403)
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM _users WHERE email = ?`).bind(email).first()
  if (existing) {
    return c.json({ error: { code: 'USER_EXISTS', message: 'Email already registered' } }, 409)
  }

  const passwordHash = await hashPassword(password)
  if (empty) {
    await createBootstrapAdmin(c, email, name, passwordHash)
  } else if (inviteCode) {
    const result = await c.env.DB.prepare(
      `INSERT INTO _users (email, name, picture, role, status, last_login, password_hash)
       VALUES (?, ?, '', 'user', 'active', unixepoch(), ?)`,
    ).bind(email, name, passwordHash).run()
    const userId = Number(result.meta.last_row_id)
    try {
      const space = await redeemInvite(c.env.DB, inviteCode, userId)
      await c.env.DB.prepare(`UPDATE _users SET team_id = COALESCE(team_id, ?), current_team_id = ? WHERE id = ?`)
        .bind(space.id, space.id, userId)
        .run()
    } catch (err) {
      await c.env.DB.prepare(`DELETE FROM _users WHERE id = ?`).bind(userId).run()
      return authError(c, err)
    }
  } else {
    const teamResult = await c.env.DB.prepare(`INSERT INTO _teams (name) VALUES (?)`).bind(`${name}'s Team`).run()
    const teamId = teamResult.meta.last_row_id
    await c.env.DB.prepare(
      `INSERT INTO _users (email, name, picture, role, last_login, team_id, current_team_id, password_hash)
       VALUES (?, ?, '', 'user', unixepoch(), ?, ?, ?)`,
    ).bind(email, name, teamId, teamId, passwordHash).run()
    const newUser = await c.env.DB.prepare(`SELECT id FROM _users WHERE email = ?`).bind(email).first<{ id: number }>()
    if (newUser) {
      await c.env.DB.prepare(`UPDATE _teams SET created_by = ? WHERE id = ?`).bind(newUser.id, teamId).run()
      await addTeamMember(c.env.DB, { teamId, userId: newUser.id, role: 'owner' })
    }
  }

  const sessionCookie = await issueSession(c, c.env, { email, name, picture: withAvatar('', email) })
  return new Response(JSON.stringify({ data: { email, name } }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie,
    },
  })
})

auth.post('/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>()
    .catch(() => ({} as { email?: string; password?: string }))
  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''
  if (!email || !password) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Email and password are required' } }, 400)
  }

  const row = await c.env.DB.prepare(
    `SELECT id, name, picture, status, team_id, current_team_id, password_hash FROM _users WHERE email = ? LIMIT 1`,
  ).bind(email).first<{
    id: number
    name: string
    picture: string
    status: string
    team_id: number | null
    current_team_id: number | null
    password_hash: string | null
  }>()

  if (!row || row.status === 'disabled' || !row.password_hash) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }, 401)
  }
  const ok = await verifyPassword(password, row.password_hash)
  if (!ok) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }, 401)
  }
  const activeSpace = await getActiveTeamForUser(c.env.DB, row.id, row.current_team_id ?? row.team_id)
  if (!activeSpace) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Account has no space' } }, 403)
  }

  await c.env.DB.prepare(`UPDATE _users SET last_login = unixepoch() WHERE id = ?`).bind(row.id).run()
  const sessionCookie = await issueSession(c, c.env, {
    email,
    name: row.name,
    picture: withAvatar(row.picture, email),
  })
  return new Response(JSON.stringify({ data: { email, name: row.name } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie,
    },
  })
})

auth.post('/change-password', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const session = await verifySession(cookieHeader, c.env.SESSION_SECRET)
  if (!session) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)
  }

  const body = await c.req.json<{ current_password?: string; new_password?: string }>()
    .catch(() => ({} as { current_password?: string; new_password?: string }))
  const currentPassword = body.current_password ?? ''
  const newPassword = body.new_password ?? ''
  if (!currentPassword || newPassword.length < 8) {
    return c.json({ error: { code: 'INVALID_BODY', message: '请填写当前密码，新密码至少 8 位' } }, 400)
  }
  if (currentPassword === newPassword) {
    return c.json({ error: { code: 'INVALID_BODY', message: '新密码不能和当前密码相同' } }, 400)
  }

  const row = await c.env.DB.prepare(
    `SELECT id, password_hash FROM _users WHERE email = ? AND status = 'active' LIMIT 1`,
  ).bind(session.email).first<{ id: number; password_hash: string | null }>()
  if (!row?.password_hash) {
    return c.json({ error: { code: 'INVALID_BODY', message: '账号无法修改密码' } }, 400)
  }
  const ok = await verifyPassword(currentPassword, row.password_hash)
  if (!ok) {
    return c.json({ error: { code: 'INVALID_BODY', message: '当前密码不正确' } }, 400)
  }

  const passwordHash = await hashPassword(newPassword)
  await c.env.DB.prepare(`UPDATE _users SET password_hash = ? WHERE id = ?`).bind(passwordHash, row.id).run()
  return c.json({ data: { success: true } })
})

auth.post('/forgot-password', async (c) => {
  const body = await c.req.json<{ email?: string }>()
    .catch(() => ({} as { email?: string }))
  const email = body.email?.trim().toLowerCase() ?? ''
  if (!isValidEmail(email)) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Valid email is required' } }, 400)
  }

  const user = await c.env.DB.prepare(
    `SELECT id FROM _users WHERE email = ? AND status = 'active'`,
  ).bind(email).first<{ id: number }>()

  // Always 200 to avoid email enumeration
  if (user) {
    const token = generateToken()
    const expires = Math.floor(Date.now() / 1000) + 3600
    await c.env.DB.prepare(
      `INSERT INTO _password_resets (token, user_id, expires_at) VALUES (?, ?, ?)`,
    ).bind(token, user.id, expires).run()
    const origin = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin
    try {
      await sendMail(c.env, email, '重置墨问密码', resetPasswordHtml(origin, token))
    } catch (err) {
      console.error('[mail] forgot-password failed', err)
      return c.json({ error: { code: 'MAIL_FAILED', message: 'Could not send email' } }, 502)
    }
  }

  return c.json({ data: { sent: true } })
})

auth.post('/reset-password', async (c) => {
  const body = await c.req.json<{ token?: string; password?: string }>()
    .catch(() => ({} as { token?: string; password?: string }))
  const token = body.token?.trim() ?? ''
  const password = body.password ?? ''
  if (!token || password.length < 8) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Token and password (min 8 chars) are required' } }, 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const row = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, used_at FROM _password_resets WHERE token = ?`,
  ).bind(token).first<{ id: number; user_id: number; expires_at: number; used_at: number | null }>()

  if (!row || row.used_at || row.expires_at < now) {
    return c.json({ error: { code: 'INVALID_TOKEN', message: '链接无效或已过期，请让对方重发邀请' } }, 400)
  }

  const passwordHash = await hashPassword(password)
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE _users SET password_hash = ? WHERE id = ?`).bind(passwordHash, row.user_id),
    c.env.DB.prepare(`UPDATE _password_resets SET used_at = unixepoch() WHERE id = ?`).bind(row.id),
  ])

  const user = await c.env.DB.prepare(
    `SELECT email, name, picture FROM _users WHERE id = ?`,
  ).bind(row.user_id).first<{ email: string; name: string; picture: string }>()
  if (!user) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  }

  const sessionCookie = await issueSession(c, c.env, {
    email: user.email,
    name: user.name,
    picture: withAvatar(user.picture, user.email),
  })
  return new Response(JSON.stringify({ data: { email: user.email } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie,
    },
  })
})

auth.post('/logout', (c) => {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
  })
})

auth.get('/me', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  if (!cookieHeader) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }

  const user = await verifySession(cookieHeader, c.env.SESSION_SECRET)
  if (!user) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }

  const userRow = await c.env.DB.prepare(
    `SELECT u.id, u.role, u.status, u.team_id, u.current_team_id
     FROM _users u
     WHERE u.email = ? LIMIT 1`,
  ).bind(user.email).first<{ id: number; role: string; status: string; team_id: number | null; current_team_id: number | null }>()

  if (!userRow || userRow.status !== 'active') {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'User account not found or disabled' } }, 401)
  }
  const currentTeam = await getActiveTeamForUser(c.env.DB, userRow.id, userRow.current_team_id ?? userRow.team_id)
  const spaces = await listUserSpaces(c.env.DB, userRow.id)

  return c.json({
    data: {
      id: userRow.id, email: user.email, name: user.name, picture: withAvatar(user.picture, user.email), role: userRow.role,
      team: currentTeam ? { id: currentTeam.id, name: currentTeam.name } : null,
      current_team: currentTeam ? { id: currentTeam.id, name: currentTeam.name, role: currentTeam.role } : null,
      spaces: spaces.map((space) => ({ id: space.id, name: space.name, role: space.role })),
    },
  })
})

auth.post('/switch-space', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const session = await verifySession(cookieHeader, c.env.SESSION_SECRET)
  if (!session) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)
  }
  const body = await c.req.json<{ team_id?: number }>()
    .catch(() => ({} as { team_id?: number }))
  const teamId = Number(body.team_id)
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'team_id is required' } }, 400)
  }
  const row = await c.env.DB.prepare(
    `SELECT id FROM _users WHERE email = ? AND status = 'active' LIMIT 1`,
  ).bind(session.email).first<{ id: number }>()
  if (!row) return c.json({ error: { code: 'UNAUTHORIZED', message: 'User account not found or disabled' } }, 401)
  try {
    const space = await setActiveTeam(c.env.DB, row.id, teamId)
    return c.json({ data: { current_team: { id: space.id, name: space.name, role: space.role } } })
  } catch (err) {
    return authError(c, err)
  }
})

auth.post('/join', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const session = await verifySession(cookieHeader, c.env.SESSION_SECRET)
  if (!session) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录后使用邀请码加入空间' } }, 401)
  }
  const body = await c.req.json<{ invite_code?: string }>()
    .catch(() => ({} as { invite_code?: string }))
  const inviteCode = body.invite_code?.trim() ?? ''
  if (!inviteCode) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'invite_code is required' } }, 400)
  }
  const row = await c.env.DB.prepare(
    `SELECT id FROM _users WHERE email = ? AND status = 'active' LIMIT 1`,
  ).bind(session.email).first<{ id: number }>()
  if (!row) return c.json({ error: { code: 'UNAUTHORIZED', message: 'User account not found or disabled' } }, 401)
  try {
    const space = await redeemInvite(c.env.DB, inviteCode, row.id)
    return c.json({ data: { current_team: { id: space.id, name: space.name, role: space.role } } })
  } catch (err) {
    return authError(c, err)
  }
})

export async function sendInviteEmail(env: Env, userId: number, email: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error('邮件未配置，无法发送邀请')
  }
  const token = generateToken()
  const expires = Math.floor(Date.now() / 1000) + 7 * 86400
  await env.DB.prepare(
    `INSERT INTO _password_resets (token, user_id, expires_at) VALUES (?, ?, ?)`,
  ).bind(token, userId, expires).run()
  await sendMail(env, email, '邀请你加入墨问', inviteHtml(env.PUBLIC_ORIGIN, token))
}

function authError(c: { json: Function }, err: unknown) {
  const e = err as { status?: number; code?: string; message?: string }
  const status = (e.status === 400 || e.status === 403 || e.status === 404 || e.status === 409) ? e.status : 500
  if (status === 500) console.error('[auth]', err)
  return c.json({ error: { code: e.code || 'INTERNAL', message: e.message || 'Auth error' } }, status)
}

export default auth
