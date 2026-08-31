import type {
  AppDatabase as RuntimeDatabase,
  AppPreparedStatement as RuntimePreparedStatement,
  QueryResult as RuntimeQueryResult,
} from './db/sqlite'

declare global {
  type AppDatabase = RuntimeDatabase
  type AppPreparedStatement = RuntimePreparedStatement
  type QueryResult<T = unknown> = RuntimeQueryResult<T>
}

export {}
