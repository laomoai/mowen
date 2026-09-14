import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from '../src/index'
import { openSqlite } from '../src/db/sqlite'
import { applyMigrations } from '../src/db/migrate'
import { createLocalBucket } from '../src/storage/local-bucket'

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mowen-revisions-'))
  const sqlitePath = path.join(dir, 'test.sqlite')
  mkdirSync(path.join(dir, 'files'), { recursive: true })
  applyMigrations(sqlitePath, path.join(process.cwd(), 'migrations'))
  const { db } = openSqlite(sqlitePath)
  const env = {
    DB: db,
    BUCKET: createLocalBucket(path.join(dir, 'files')),
    ENVIRONMENT: 'test', ADMIN_KEY: 'test-admin', SESSION_SECRET: 'secret',
    PUBLIC_ORIGIN: 'http://local.test', ALLOW_PUBLIC_REGISTER: 'false',
  }
  const ctx = { waitUntil(p: Promise<unknown>) { void p }, passThroughOnException() {} } as ExecutionContext
  const call = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('X-API-Key', 'test-admin')
    if (init.body) headers.set('Content-Type', 'application/json')
    const response = await app.fetch(new Request(`http://local.test${url}`, { ...init, headers }), env, ctx)
    const json = await response.json() as any
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(json)}`)
    return json
  }

  const note = await call('/api/notes', { method: 'POST', body: JSON.stringify({ title: 'Original', content: 'one' }) })
  const noteId = note.data.id as string
  await call(`/api/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ content: 'two' }) })
  await call(`/api/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Second', content: 'three' }) })
  const noteHistory = await call(`/api/notes/${noteId}/revisions`)
  if (noteHistory.data.length !== 2 || noteHistory.current_version !== 3) throw new Error('note revision chain is incomplete')
  const noteDiff = await call(`/api/notes/${noteId}/revisions/${noteHistory.data[1].id}`)
  if (!noteDiff.data.changes.some((change: any) => change.field === 'content' && change.before === 'one' && change.after === 'three')) throw new Error('note diff is incorrect')
  await call(`/api/notes/${noteId}/restore-version`, { method: 'POST', body: JSON.stringify({ revision_id: noteHistory.data[1].id, base_version: 3 }) })
  const restoredNote = await call(`/api/notes/${noteId}`)
  if (restoredNote.data.content !== 'one') throw new Error('note restore failed')

  await db.exec(`CREATE TABLE smoke_records (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, amount INTEGER)`)
  await db.prepare(`INSERT INTO _meta (table_name, title, row_count) VALUES ('smoke_records', 'Smoke', 1)`).run()
  await db.prepare(`INSERT INTO smoke_records (title, amount) VALUES ('Original', 1)`).run()
  await call('/api/tables/smoke_records/records/1', { method: 'PATCH', body: JSON.stringify({ title: 'Changed', amount: 2 }) })
  await call('/api/tables/smoke_records/records', { method: 'POST', body: JSON.stringify({ title: 'New row', amount: 9 }) })
  await call('/api/tables/smoke_records/records/1', { method: 'DELETE' })
  const tableHistory = await call('/api/tables/smoke_records/revisions')
  if (tableHistory.data.length !== 3 || tableHistory.current_version !== 4) throw new Error('table revision chain is incomplete')
  const oldest = tableHistory.data[2]
  if (oldest.target_version !== 1) throw new Error('table target version is incorrect')
  const tableDiff = await call(`/api/tables/smoke_records/revisions/${oldest.id}`)
  if (!tableDiff.data.changes.some((change: any) => change.record_id === '1' && change.type === 'removed')) throw new Error('deleted row is missing from table diff')
  if (!tableDiff.data.changes.some((change: any) => change.record_id === '2' && change.type === 'added')) throw new Error('inserted row is missing from table diff')
  await call('/api/tables/smoke_records/restore-version', { method: 'POST', body: JSON.stringify({ revision_id: oldest.id, base_version: 4 }) })
  const restoredTable = await call('/api/tables/smoke_records/records?page_size=20')
  if (restoredTable.data.length !== 1 || restoredTable.data[0].title !== 'Original' || restoredTable.data[0].amount !== 1) throw new Error('whole-table restore failed')
  const afterRestore = await call('/api/tables/smoke_records/revisions')
  if (afterRestore.current_version !== 5 || afterRestore.data[0].action !== 'restore') throw new Error('restore was not saved as a reversible table version')
  console.log('revision smoke ok')
}

main().catch(error => { console.error(error); process.exit(1) })
