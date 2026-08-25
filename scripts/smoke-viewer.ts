import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from '../src/index'
import { openSqlite } from '../src/db/sqlite'
import { applyMigrations } from '../src/db/migrate'
import { createLocalBucket } from '../src/storage/local-bucket'

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mowen-viewer-'))
  const sqlitePath = path.join(dir, 'test.sqlite')
  const filesDir = path.join(dir, 'files')
  mkdirSync(filesDir, { recursive: true })

  const { db } = openSqlite(sqlitePath)
  applyMigrations(sqlitePath, path.join(process.cwd(), 'migrations'))

  await db.prepare(
    `CREATE TABLE "tbl_viewer" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      public_note TEXT,
      secret TEXT,
      otp TEXT,
      hidden_text TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
  ).run()
  await db.prepare(`INSERT INTO _meta (table_name, title, row_count) VALUES (?, ?, ?)`)
    .bind('tbl_viewer', 'Viewer Smoke', 1).run()
  await db.prepare(
    `INSERT INTO _field_meta (table_name, column_name, title, field_type, order_index, width, is_hidden) VALUES
      ('tbl_viewer', 'id', 'ID', 'number', 0, 80, 0),
      ('tbl_viewer', 'title', 'Title', 'text', 10, 180, 0),
      ('tbl_viewer', 'public_note', 'Public Note', 'longtext', 20, 180, 0),
      ('tbl_viewer', 'secret', 'Secret', 'password', 30, 180, 0),
      ('tbl_viewer', 'otp', 'OTP', 'totp', 40, 180, 0),
      ('tbl_viewer', 'hidden_text', 'Hidden', 'text', 50, 180, 1),
      ('tbl_viewer', 'created_at', 'Created At', 'datetime', 60, 180, 1)`,
  ).run()
  await db.prepare(`INSERT INTO tbl_viewer (title, public_note, secret, otp, hidden_text) VALUES (?, ?, ?, ?, ?)`)
    .bind('hello', 'visible', 'should-not-return', 'totp-secret', 'hidden-value').run()

  const env = {
    DB: db,
    BUCKET: createLocalBucket(filesDir),
    ENVIRONMENT: 'test',
    ADMIN_KEY: 'test-admin-key',
    SESSION_SECRET: 'test-session-secret',
    PUBLIC_ORIGIN: 'http://127.0.0.1',
  }
  const executionCtx = {
    waitUntil(promise: Promise<unknown>) { void promise },
    passThroughOnException() {},
  } as ExecutionContext
  const headers = { 'X-API-Key': 'test-admin-key' }

  await assertOk('/api/viewer/me', env, executionCtx, headers)
  const list = await assertOk('/api/viewer/tables/tbl_viewer/records?page_size=20', env, executionCtx, headers)
  assertNoSecrets(list, 'viewer list')
  const detail = await assertOk(
    '/api/viewer/tables/tbl_viewer/records/1?fields=id,title,secret,otp,hidden_text,public_note',
    env,
    executionCtx,
    headers,
  )
  assertNoSecrets(detail, 'viewer detail')
  const openapi = await assertOk('/api/openapi.json', env, executionCtx, {})
  for (const pathName of [
    '/api/viewer/me',
    '/api/viewer/tables/{tableName}/records',
    '/api/viewer/tables/{tableName}/records/{id}',
  ]) {
    if (!openapi.paths?.[pathName]) throw new Error(`OpenAPI is missing ${pathName}`)
  }

  console.log('viewer smoke ok')
}

async function assertOk(
  pathname: string,
  env: Record<string, unknown>,
  executionCtx: ExecutionContext,
  headers: Record<string, string>,
) {
  const res = await app.fetch(new Request(`http://local.test${pathname}`, { headers }), env, executionCtx)
  const body = await res.json() as Record<string, unknown>
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${pathname} failed with ${res.status}: ${JSON.stringify(body)}`)
  }
  return body
}

function assertNoSecrets(body: unknown, label: string) {
  const text = JSON.stringify(body)
  for (const secret of ['should-not-return', 'totp-secret', 'hidden-value']) {
    if (text.includes(secret)) throw new Error(`${label} leaked ${secret}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
