import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from '../src/index'
import { openSqlite } from '../src/db/sqlite'
import { applyMigrations } from '../src/db/migrate'
import { createLocalBucket } from '../src/storage/local-bucket'

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mowen-running-balance-'))
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
  const request = (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('X-API-Key', 'test-admin')
    if (init.body) headers.set('Content-Type', 'application/json')
    return app.fetch(new Request(`http://local.test${url}`, { ...init, headers }), env, ctx)
  }
  const call = async (url: string, init: RequestInit = {}) => {
    const response = await request(url, init)
    const json = await response.json() as any
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(json)}`)
    return json
  }

  await db.exec(`CREATE TABLE ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_date TEXT,
    income REAL,
    expense REAL,
    memo TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`)
  await db.prepare(`INSERT INTO _meta (table_name, title, row_count) VALUES ('ledger', '收支流水', 0)`).run()
  await call('/api/tables/ledger/fields')

  const config = {
    version: 1, kind: 'running_balance', opening_balance: '1000.00',
    income_field: 'income', expense_field: 'expense', order_field: 'transaction_date',
    tie_breaker: 'id', null_as_zero: true, precision: 2,
  }
  const created = await call('/api/tables/ledger/fields', {
    method: 'POST', body: JSON.stringify({ title: '余额', column_name: 'balance', field_type: 'running_balance', formula_config: config }),
  })
  assert.equal(created.data.column_name, 'balance')

  const pragma = await db.prepare(`PRAGMA table_info("ledger")`).all<{ name: string }>()
  assert.equal(pragma.results.some(column => column.name === 'balance'), false, '累计余额不应创建实体列')
  const fields = await call('/api/tables/ledger/fields')
  const balanceField = fields.data.find((field: any) => field.column_name === 'balance')
  assert.equal(balanceField.virtual, true)
  assert.equal(balanceField.read_only, true)

  const schema = await call('/api/tables/ledger')
  assert.equal(schema.data.columns.some((field: any) => field.name === 'balance'), false, '实体 columns 不应混入虚拟字段')
  const schemaBalance = schema.data.fields.find((field: any) => field.name === 'balance')
  assert.equal(schemaBalance?.type, 'VIRTUAL')
  assert.equal(schemaBalance?.virtual, true)
  assert.equal(schemaBalance?.read_only, true)
  assert.deepEqual(schemaBalance?.formula_config, config)

  const openapi = await call('/api/openapi.json')
  assert.equal(openapi.info.version, '2.5.1')
  const recordParameters = openapi.paths['/api/tables/{tableName}/records'].get.parameters
  assert.equal(recordParameters.some((parameter: any) => parameter.name === 'page'), true, 'OpenAPI 应说明计算字段页码分页')

  const duplicate = await request('/api/tables/ledger/fields', {
    method: 'POST', body: JSON.stringify({ title: '另一余额', column_name: 'balance_2', field_type: 'running_balance', formula_config: config }),
  })
  assert.equal(duplicate.status, 409, '每表应只允许一个累计余额')

  const insert = (body: Record<string, unknown>) => call('/api/tables/ledger/records', { method: 'POST', body: JSON.stringify(body) })
  await insert({ transaction_date: '2026-01-01', income: 100, expense: 0, memo: '工资' })
  await insert({ transaction_date: '2026-01-02', income: 0, expense: 250, memo: '房租' })
  await insert({ transaction_date: '2026-01-03', income: 20, expense: null, memo: '红包' })
  await insert({ transaction_date: null, income: 0, expense: 999, memo: '待补日期' })

  const list = await call('/api/tables/ledger/records?page_size=20')
  assert.deepEqual(list.data.map((row: any) => [row.id, row.balance]), [[3, 870], [2, 850], [1, 1100], [4, null]], '默认应按业务日期倒序而不是插入 id 倒序')
  assert.equal(list.meta.next_cursor, null, '业务日期默认排序应使用 page 分页')
  const invalidDefaultCursor = await request('/api/tables/ledger/records?page_size=2&cursor=3')
  assert.equal(invalidDefaultCursor.status, 400, '累计余额表的业务日期默认排序不得返回不稳定 id 游标')

  const filtered = await call('/api/tables/ledger/records?page_size=20&filter%5Bbalance__gte%5D=900')
  assert.deepEqual(filtered.data.map((row: any) => row.id), [1], '必须先全表累计再过滤')

  const page1 = await call('/api/tables/ledger/records?page=1&page_size=2')
  const page2 = await call('/api/tables/ledger/records?page=2&page_size=2')
  assert.deepEqual([...page1.data, ...page2.data].map((row: any) => row.balance), [870, 850, 1100, null])
  const balancePage1 = await call('/api/tables/ledger/records?page=1&page_size=2&sort=balance:asc')
  const balancePage2 = await call('/api/tables/ledger/records?page=2&page_size=2&sort=balance:asc')
  assert.deepEqual([...balancePage1.data, ...balancePage2.data].map((row: any) => row.balance), [null, 850, 870, 1100])
  assert.equal(balancePage1.meta.next_cursor, null, '累计余额排序应使用 page 而不是 id cursor')

  const detail = await call('/api/tables/ledger/records/2')
  assert.equal(detail.data.balance, 850, '单条详情应基于全表计算')

  const exportResponse = await request('/api/tables/ledger/export?format=json&sort=transaction_date:asc')
  assert.equal(exportResponse.status, 200)
  const exported = await exportResponse.json() as any[]
  assert.equal(exported.find(row => row.id === 3)?.balance, 870)

  await call('/api/tables/ledger/records/3', {
    method: 'PATCH', body: JSON.stringify({ transaction_date: '2025-12-31' }),
  })
  const recalculated = await call('/api/tables/ledger/records?page_size=20')
  assert.deepEqual(recalculated.data.map((row: any) => [row.id, row.balance]), [[2, 870], [1, 1120], [3, 1020], [4, null]])

  await call('/api/tables/ledger/records/1', { method: 'DELETE' })
  const afterDelete = await call('/api/tables/ledger/records?page_size=20')
  assert.deepEqual(afterDelete.data.map((row: any) => [row.id, row.balance]), [[2, 770], [3, 1020], [4, null]])

  const invalidDependency = await request('/api/tables/ledger/fields/expense', {
    method: 'PATCH', body: JSON.stringify({ field_type: 'text' }),
  })
  assert.equal(invalidDependency.status, 409, '不能把依赖的金额字段改为不兼容类型')

  await call('/api/tables/ledger/fields/balance', {
    method: 'PATCH', body: JSON.stringify({ formula_config: { ...config, opening_balance: '2000.00' } }),
  })
  const changedOpening = await call('/api/tables/ledger/records/2')
  assert.equal(changedOpening.data.balance, 1770)

  const viewerDetail = await call('/api/viewer/tables/ledger/records/2')
  assert.equal(viewerDetail.data.balance, 1770, '只读 Viewer 也应返回同一累计余额')

  const directFormulaWrite = await request('/api/tables/ledger/records/2', {
    method: 'PATCH', body: JSON.stringify({ balance: 999999 }),
  })
  assert.equal(directFormulaWrite.status, 400, '虚拟余额不能直接写入')

  const history = await call('/api/tables/ledger/revisions')
  const beforeDelete = history.data.find((revision: any) => revision.target_version === 6)
  assert.ok(beforeDelete, '应能找到删除前的整表版本')
  await call('/api/tables/ledger/restore-version', {
    method: 'POST', body: JSON.stringify({ revision_id: beforeDelete.id, base_version: history.current_version }),
  })
  const afterRestore = await call('/api/tables/ledger/records?page_size=20')
  assert.deepEqual(afterRestore.data.map((row: any) => [row.id, row.balance]), [[2, 1870], [1, 2120], [3, 2020], [4, null]], '整表恢复后应使用当前配置自动重算')

  const indexRows = await db.prepare(`PRAGMA index_list("ledger")`).all<{ name: string }>()
  assert.equal(indexRows.results.some(index => index.name.startsWith('idx_rb_')), true, '应创建排序字段索引')
  console.log('running balance smoke ok')
}

main().catch(error => { console.error(error); process.exit(1) })
