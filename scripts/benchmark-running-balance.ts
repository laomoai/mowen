import { performance } from 'node:perf_hooks'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from '../src/index'
import { openSqlite } from '../src/db/sqlite'
import { applyMigrations } from '../src/db/migrate'
import { createLocalBucket } from '../src/storage/local-bucket'

function percentile95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mowen-running-balance-bench-'))
  const sqlitePath = path.join(dir, 'bench.sqlite')
  mkdirSync(path.join(dir, 'files'), { recursive: true })
  applyMigrations(sqlitePath, path.join(process.cwd(), 'migrations'))
  const { raw, db } = openSqlite(sqlitePath)
  raw.exec(`CREATE TABLE ledger_bench (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_date TEXT,
    income REAL,
    expense REAL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE ledger_plain (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_date TEXT,
    income REAL,
    expense REAL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_plain_order ON ledger_plain (transaction_date, id);
  INSERT INTO _meta (table_name, title, row_count) VALUES ('ledger_bench', 'Benchmark', 0);
  INSERT INTO _meta (table_name, title, row_count) VALUES ('ledger_plain', 'Baseline', 0);`)

  const env = {
    DB: db,
    BUCKET: createLocalBucket(path.join(dir, 'files')),
    ENVIRONMENT: 'test', ADMIN_KEY: 'test-admin', SESSION_SECRET: 'secret',
    PUBLIC_ORIGIN: 'http://local.test', ALLOW_PUBLIC_REGISTER: 'false',
  }
  const ctx = { waitUntil(p: Promise<unknown>) { void p }, passThroughOnException() {} } as ExecutionContext
  const request = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('X-API-Key', 'test-admin')
    if (init.body) headers.set('Content-Type', 'application/json')
    const response = await app.fetch(new Request(`http://local.test${url}`, { ...init, headers }), env, ctx)
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${response.status} ${await response.text()}`)
    return response
  }
  await request('/api/tables/ledger_bench/fields')
  await request('/api/tables/ledger_bench/fields', {
    method: 'POST',
    body: JSON.stringify({
      title: '余额', column_name: 'balance', field_type: 'running_balance',
      formula_config: {
        version: 1, kind: 'running_balance', opening_balance: '10000.00',
        income_field: 'income', expense_field: 'expense', order_field: 'transaction_date',
        tie_breaker: 'id', null_as_zero: true, precision: 2,
      },
    }),
  })

  const insert = raw.prepare(`INSERT INTO ledger_bench (transaction_date, income, expense) VALUES (?, ?, ?)`)
  const insertPlain = raw.prepare(`INSERT INTO ledger_plain (transaction_date, income, expense) VALUES (?, ?, ?)`)
  const addRows = raw.transaction((start: number, count: number) => {
    for (let i = start; i < start + count; i += 1) {
      const day = String((i % 28) + 1).padStart(2, '0')
      const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, '0')
      const year = 2020 + Math.floor(i / 336)
      insert.run(`${year}-${month}-${day}`, i % 7 === 0 ? 100 : 0, i % 7 === 0 ? 0 : 12.34)
      insertPlain.run(`${year}-${month}-${day}`, i % 7 === 0 ? 100 : 0, i % 7 === 0 ? 0 : 12.34)
    }
  })

  async function measure(label: string, thresholdMs: number) {
    const scenarios = {
      first_page: '/api/tables/ledger_bench/records?page=1&page_size=100',
      second_page: '/api/tables/ledger_bench/records?page=2&page_size=100',
      physical_filter: '/api/tables/ledger_bench/records?page=1&page_size=100&filter%5Bexpense__gt%5D=10',
      balance_filter: '/api/tables/ledger_bench/records?page=1&page_size=100&filter%5Bbalance__gte%5D=0',
      balance_sort: '/api/tables/ledger_bench/records?page=1&page_size=100&sort=balance:desc',
    }
    const results: Record<string, number> = {}
    for (const [name, url] of Object.entries(scenarios)) {
      await (await request(url)).arrayBuffer()
      const samples: number[] = []
      for (let i = 0; i < 5; i += 1) {
        const started = performance.now()
        await (await request(url)).arrayBuffer()
        samples.push(performance.now() - started)
      }
      results[name] = Number(percentile95(samples).toFixed(2))
    }
    const baselineStarted = performance.now()
    await (await request('/api/tables/ledger_plain/records?page=1&page_size=100')).arrayBuffer()
    results.plain_first_page = Number((performance.now() - baselineStarted).toFixed(2))
    if (label === '10000') {
      const exportStarted = performance.now()
      await (await request('/api/tables/ledger_bench/export?format=json')).arrayBuffer()
      results.export_10000 = Number((performance.now() - exportStarted).toFixed(2))
    }
    const maxP95 = Math.max(...Object.entries(results).filter(([name]) => name !== 'plain_first_page').map(([, value]) => value))
    const memoryMb = Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1))
    console.log(JSON.stringify({ rows: label, scenario_p95_ms: results, max_p95_ms: maxP95, threshold_ms: thresholdMs, rss_mb: memoryMb }))
    if (maxP95 > thresholdMs) throw new Error(`${label} p95 ${maxP95.toFixed(2)}ms exceeds ${thresholdMs}ms`)
  }

  addRows(0, 10_000)
  raw.prepare(`UPDATE _meta SET row_count = 10000 WHERE table_name IN ('ledger_bench', 'ledger_plain')`).run()
  await measure('10000', 500)
  addRows(10_000, 40_000)
  raw.prepare(`UPDATE _meta SET row_count = 50000 WHERE table_name IN ('ledger_bench', 'ledger_plain')`).run()
  await measure('50000', 1500)
}

main().catch(error => { console.error(error); process.exit(1) })
