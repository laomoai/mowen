import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from '../src/index'
import { openSqlite } from '../src/db/sqlite'
import { applyMigrations } from '../src/db/migrate'
import { createLocalBucket } from '../src/storage/local-bucket'

type TestEnv = {
  DB: ReturnType<typeof openSqlite>['db']
  BUCKET: ReturnType<typeof createLocalBucket>
  ENVIRONMENT: string
  ADMIN_KEY: string
  SESSION_SECRET: string
  PUBLIC_ORIGIN: string
  ALLOW_PUBLIC_REGISTER: string
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mowen-multi-space-'))
  const sqlitePath = path.join(dir, 'test.sqlite')
  const filesDir = path.join(dir, 'files')
  mkdirSync(filesDir, { recursive: true })

  const { db } = openSqlite(sqlitePath)
  applyMigrations(sqlitePath, path.join(process.cwd(), 'migrations'))

  const env: TestEnv = {
    DB: db,
    BUCKET: createLocalBucket(filesDir),
    ENVIRONMENT: 'test',
    ADMIN_KEY: 'test-admin-key',
    SESSION_SECRET: 'test-session-secret',
    PUBLIC_ORIGIN: 'http://local.test',
    ALLOW_PUBLIC_REGISTER: 'false',
  }
  const executionCtx = {
    waitUntil(promise: Promise<unknown>) { void promise },
    passThroughOnException() {},
  } as ExecutionContext

  const adminCookie = await register(env, executionCtx, 'owner@example.com', 'owner-pass-1', 'Owner')
  const ownerMe = await getMe(env, executionCtx, adminCookie)
  const firstTeamId = ownerMe.current_team.id
  await addNoteNode(db, firstTeamId, 'note_first', 'First Space Note')

  const secondSpace = await requestJson(env, executionCtx, '/api/teams', {
    method: 'POST',
    headers: cookieHeaders(adminCookie),
    body: JSON.stringify({ name: 'Second Space' }),
  })
  const secondTeamId = secondSpace.data.id
  await addNoteNode(db, secondTeamId, 'note_second', 'Second Space Note')

  await assertWorkspace(env, executionCtx, adminCookie, ['Second Space Note'], ['First Space Note'])
  await requestJson(env, executionCtx, '/api/auth/switch-space', {
    method: 'POST',
    headers: cookieHeaders(adminCookie),
    body: JSON.stringify({ team_id: firstTeamId }),
  })
  await assertWorkspace(env, executionCtx, adminCookie, ['First Space Note'], ['Second Space Note'])
  const firstThread = await requestJson(env, executionCtx, '/api/assistant/thread', {
    headers: cookieHeaders(adminCookie),
  })
  await addTable(db, firstTeamId, 'tbl_first_dashboard', 'First Dashboard Table')
  await requestJson(env, executionCtx, '/api/tables/tbl_first_dashboard/dashboard', {
    method: 'PUT',
    headers: cookieHeaders(adminCookie),
    body: JSON.stringify({ config: [{ type: 'stat', title: 'First Space Only' }] }),
  })

  await requestJson(env, executionCtx, '/api/auth/switch-space', {
    method: 'POST',
    headers: cookieHeaders(adminCookie),
    body: JSON.stringify({ team_id: secondTeamId }),
  })
  const secondThread = await requestJson(env, executionCtx, '/api/assistant/thread', {
    headers: cookieHeaders(adminCookie),
  })
  if (firstThread.data.thread_id === secondThread.data.thread_id) {
    throw new Error('assistant thread leaked across spaces')
  }
  await expectStatus(env, executionCtx, '/api/tables/tbl_first_dashboard/dashboard', {
    headers: cookieHeaders(adminCookie),
  }, 403)
  const invite = await requestJson(env, executionCtx, '/api/teams/current/invites', {
    method: 'POST',
    headers: cookieHeaders(adminCookie),
    body: JSON.stringify({ max_uses: 2, expires_in_days: 7 }),
  })

  const memberCookie = await register(env, executionCtx, 'member@example.com', 'member-pass-1', 'Member', invite.data.code)
  const memberMe = await getMe(env, executionCtx, memberCookie)
  if (memberMe.current_team.id !== secondTeamId) throw new Error('invite registration did not select invited space')
  if (memberMe.spaces.length !== 1) throw new Error('invited member should only have one space')

  const createdKey = await requestJson(env, executionCtx, '/api/admin/keys', {
    method: 'POST',
    headers: cookieHeaders(memberCookie),
    body: JSON.stringify({ name: 'Mini Program', type: 'readonly', scope: 'all' }),
  })
  const apiKey = createdKey.data.key
  await assertViewerWorkspace(env, executionCtx, apiKey, ['Second Space Note'], ['First Space Note'])

  const authorizedFolder = await requestJson(env, executionCtx, '/api/workspace/folders', {
    method: 'POST',
    headers: cookieHeaders(memberCookie),
    body: JSON.stringify({ title: 'Agent Notes' }),
  })
  const unauthorizedFolder = await requestJson(env, executionCtx, '/api/workspace/folders', {
    method: 'POST',
    headers: cookieHeaders(memberCookie),
    body: JSON.stringify({ title: 'Private Notes' }),
  })
  const scopedWriteKey = await requestJson(env, executionCtx, '/api/admin/keys', {
    method: 'POST',
    headers: cookieHeaders(memberCookie),
    body: JSON.stringify({
      name: 'Agent Folder Write Key',
      type: 'readwrite',
      scope: 'groups',
      group_ids: [authorizedFolder.data.group_id],
    }),
  })
  await expectStatus(env, executionCtx, '/api/notes', {
    method: 'POST',
    headers: { 'X-API-Key': scopedWriteKey.data.key },
    body: JSON.stringify({ title: 'Missing Folder Note', content: '' }),
  }, 400)
  await expectStatus(env, executionCtx, '/api/notes', {
    method: 'POST',
    headers: { 'X-API-Key': scopedWriteKey.data.key },
    body: JSON.stringify({ title: 'Wrong Folder Note', content: '', folder_id: unauthorizedFolder.data.id }),
  }, 403)
  const scopedNote = await requestJson(env, executionCtx, '/api/notes', {
    method: 'POST',
    headers: { 'X-API-Key': scopedWriteKey.data.key },
    body: JSON.stringify({ title: 'Scoped Folder Note', content: '# Scoped', folder_id: authorizedFolder.data.id }),
  })
  const scopedNotes = await requestJson(env, executionCtx, '/api/notes', {
    headers: { 'X-API-Key': scopedWriteKey.data.key },
  })
  assertTitles(scopedNotes, ['Scoped Folder Note'], ['Second Space Note'])
  await requestJson(env, executionCtx, `/api/notes/${scopedNote.data.id}`, {
    method: 'PATCH',
    headers: { 'X-API-Key': scopedWriteKey.data.key },
    body: JSON.stringify({ content: '# Scoped updated' }),
  })
  await expectStatus(env, executionCtx, '/api/workspace/move', {
    method: 'POST',
    headers: { 'X-API-Key': scopedWriteKey.data.key },
    body: JSON.stringify({ id: `wn_n_${scopedNote.data.id}`, parent_id: unauthorizedFolder.data.id }),
  }, 403)

  const writeKey = await requestJson(env, executionCtx, '/api/admin/keys', {
    method: 'POST',
    headers: cookieHeaders(memberCookie),
    body: JSON.stringify({ name: 'Agent Write Key', type: 'readwrite', scope: 'groups', group_ids: [] }),
  })
  await expectStatus(env, executionCtx, '/api/admin/keys', {
    headers: { 'X-API-Key': writeKey.data.key },
  }, 403)
  await expectStatus(env, executionCtx, '/api/teams', {
    headers: { 'X-API-Key': writeKey.data.key },
  }, 403)

  const viewerInvite = await requestJson(env, executionCtx, '/api/teams/current/invites', {
    method: 'POST',
    headers: cookieHeaders(adminCookie),
    body: JSON.stringify({ role: 'viewer', max_uses: 1 }),
  })
  const viewerCookie = await register(env, executionCtx, 'viewer@example.com', 'viewer-pass-1', 'Viewer', viewerInvite.data.code)
  await expectStatus(env, executionCtx, '/api/notes', {
    method: 'POST',
    headers: cookieHeaders(viewerCookie),
    body: JSON.stringify({ title: 'Viewer Write Attempt', content: '' }),
  }, 403)

  console.log('multi-space smoke ok')
}

async function register(
  env: TestEnv,
  executionCtx: ExecutionContext,
  email: string,
  password: string,
  name: string,
  inviteCode?: string,
): Promise<string> {
  const res = await app.fetch(new Request('http://local.test/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name, invite_code: inviteCode }),
  }), env, executionCtx)
  const body = await res.json() as Record<string, unknown>
  if (res.status < 200 || res.status >= 300) throw new Error(`register failed ${res.status}: ${JSON.stringify(body)}`)
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('register did not set session cookie')
  return cookie.split(';')[0]
}

async function getMe(env: TestEnv, executionCtx: ExecutionContext, cookie: string) {
  const body = await requestJson(env, executionCtx, '/api/auth/me', {
    headers: cookieHeaders(cookie),
  })
  return body.data as {
    current_team: { id: number; name: string; role: string }
    spaces: Array<{ id: number; name: string; role: string }>
  }
}

async function addNoteNode(db: TestEnv['DB'], teamId: number, id: string, title: string) {
  await db.prepare(
    `INSERT INTO _notes (id, title, content, sort_order, team_id) VALUES (?, ?, ?, 0, ?)`,
  ).bind(id, title, `# ${title}`, teamId).run()
  await db.prepare(
    `INSERT INTO _workspace_nodes (id, kind, parent_id, sort_order, title, ref, team_id)
     VALUES (?, 'note', NULL, 0, ?, ?, ?)`,
  ).bind(`wn_${id}`, title, id, teamId).run()
}

async function addTable(db: TestEnv['DB'], teamId: number, tableName: string, title: string) {
  await db.prepare(
    `CREATE TABLE "${tableName}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  ).run()
  await db.prepare(
    `INSERT INTO _meta (table_name, row_count, title, team_id) VALUES (?, 0, ?, ?)`,
  ).bind(tableName, title, teamId).run()
  await db.prepare(
    `INSERT INTO _workspace_nodes (id, kind, parent_id, sort_order, title, ref, team_id)
     VALUES (?, 'table', NULL, 0, ?, ?, ?)`,
  ).bind(`wn_${tableName}`, title, tableName, teamId).run()
}

async function assertWorkspace(
  env: TestEnv,
  executionCtx: ExecutionContext,
  cookie: string,
  expected: string[],
  forbidden: string[],
) {
  const body = await requestJson(env, executionCtx, '/api/workspace/tree', {
    headers: cookieHeaders(cookie),
  })
  assertTitles(body, expected, forbidden)
}

async function assertViewerWorkspace(
  env: TestEnv,
  executionCtx: ExecutionContext,
  apiKey: string,
  expected: string[],
  forbidden: string[],
) {
  const body = await requestJson(env, executionCtx, '/api/viewer/workspace', {
    headers: { 'X-API-Key': apiKey },
  })
  assertTitles(body, expected, forbidden)
}

function assertTitles(body: unknown, expected: string[], forbidden: string[]) {
  const text = JSON.stringify(body)
  for (const title of expected) {
    if (!text.includes(title)) throw new Error(`workspace missing ${title}`)
  }
  for (const title of forbidden) {
    if (text.includes(title)) throw new Error(`workspace leaked ${title}`)
  }
}

async function requestJson(
  env: TestEnv,
  executionCtx: ExecutionContext,
  pathname: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await app.fetch(new Request(`http://local.test${pathname}`, { ...init, headers }), env, executionCtx)
  const body = await res.json() as Record<string, any>
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${pathname} failed with ${res.status}: ${JSON.stringify(body)}`)
  }
  return body
}

async function expectStatus(
  env: TestEnv,
  executionCtx: ExecutionContext,
  pathname: string,
  init: RequestInit,
  expectedStatus: number,
) {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await app.fetch(new Request(`http://local.test${pathname}`, { ...init, headers }), env, executionCtx)
  if (res.status !== expectedStatus) {
    const text = await res.text()
    throw new Error(`${pathname} expected ${expectedStatus}, got ${res.status}: ${text}`)
  }
}

function cookieHeaders(cookie: string) {
  return { Cookie: cookie, 'Content-Type': 'application/json' }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
