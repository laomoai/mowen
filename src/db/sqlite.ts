import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export type QueryMeta = {
  changes: number
  last_row_id: number
  duration: number
}

export type QueryResult<T = unknown> = {
  success: boolean
  results: T[]
  meta: QueryMeta
}

export type AppPreparedStatement = {
  bind: (...values: unknown[]) => AppPreparedStatement
  first: <T = unknown>(colName?: string) => Promise<T | null>
  all: <T = unknown>() => Promise<QueryResult<T>>
  run: <T = unknown>() => Promise<QueryResult<T>>
  raw: <T = unknown>() => Promise<T[]>
}

export type AppDatabase = {
  prepare: (query: string) => AppPreparedStatement
  batch: <T = unknown>(statements: AppPreparedStatement[]) => Promise<QueryResult<T>[]>
  exec: (query: string) => Promise<QueryResult>
}

type BoundStatement = {
  sql: string
  params: unknown[]
}

function execStatement(db: Database.Database, stmt: BoundStatement): QueryResult {
  const started = Date.now()
  const prepared = db.prepare(stmt.sql)
  const isSelect =
    /^\s*(select|pragma|with)\b/i.test(stmt.sql) ||
    prepared.reader === true

  if (isSelect) {
    const rows = prepared.all(...stmt.params) as unknown[]
    return {
      success: true,
      results: rows,
      meta: {
        changes: 0,
        last_row_id: Number((db.prepare('SELECT last_insert_rowid() AS id').get() as { id?: number | bigint } | undefined)?.id ?? 0),
        duration: Date.now() - started,
      },
    }
  }

  const info = prepared.run(...stmt.params)
  return {
    success: true,
    results: [],
    meta: {
      changes: info.changes,
      last_row_id: Number(info.lastInsertRowid),
      duration: Date.now() - started,
    },
  }
}

class PreparedStatement implements AppPreparedStatement {
  constructor(
    private readonly db: Database.Database,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): AppPreparedStatement {
    return new PreparedStatement(this.db, this.sql, values)
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const result = execStatement(this.db, { sql: this.sql, params: this.params })
    const row = (result.results[0] ?? null) as Record<string, unknown> | null
    if (!row) return null
    if (colName) return (row[colName] as T) ?? null
    return row as T
  }

  async all<T = unknown>(): Promise<QueryResult<T>> {
    return execStatement(this.db, { sql: this.sql, params: this.params }) as QueryResult<T>
  }

  async run<T = unknown>(): Promise<QueryResult<T>> {
    return execStatement(this.db, { sql: this.sql, params: this.params }) as QueryResult<T>
  }

  async raw<T = unknown>(): Promise<T[]> {
    const result = execStatement(this.db, { sql: this.sql, params: this.params })
    return result.results as T[]
  }

  /** Internal: used by batch() */
  _bound(): BoundStatement {
    return { sql: this.sql, params: this.params }
  }
}

export function openSqlite(sqlitePath: string): { raw: Database.Database; db: AppDatabase } {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const raw = new Database(sqlitePath)
  raw.pragma('journal_mode = WAL')
  raw.pragma('busy_timeout = 5000')
  raw.pragma('foreign_keys = ON')
  raw.pragma('synchronous = NORMAL')

  const db: AppDatabase = {
    prepare(query: string) {
      return new PreparedStatement(raw, query)
    },
    async batch<T = unknown>(statements: AppPreparedStatement[]): Promise<QueryResult<T>[]> {
      const tx = raw.transaction(() => {
        return statements.map((s) => {
          const bound = (s as PreparedStatement)._bound()
          return execStatement(raw, bound) as QueryResult<T>
        })
      })
      return tx()
    },
    async exec(query: string) {
      raw.exec(query)
      return {
        success: true,
        results: [],
        meta: { changes: 0, last_row_id: 0, duration: 0 },
      }
    },
  }

  return { raw, db }
}
