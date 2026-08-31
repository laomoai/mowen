import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyMigrations } from '../src/db/migrate.ts'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data')
const sqlitePath = process.env.SQLITE_PATH || path.join(dataDir, 'mowen.sqlite')
applyMigrations(sqlitePath, path.join(rootDir, 'migrations'))
