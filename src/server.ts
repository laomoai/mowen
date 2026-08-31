import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from './index'
import { openSqlite } from './db/sqlite'
import { createLocalBucket } from './storage/local-bucket'
import { applyMigrations } from './db/migrate'
import type { Env } from './types'

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadDotEnv()

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data')
const sqlitePath = process.env.SQLITE_PATH || path.join(dataDir, 'mowen.sqlite')
const filesDir = path.join(dataDir, 'files')
const publicDir = path.join(rootDir, 'public')
const listenHost = process.env.LISTEN_HOST || '127.0.0.1'
const listenPort = Number(process.env.LISTEN_PORT || 18085)

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) {
  console.error('SESSION_SECRET is required')
  process.exit(1)
}

const { db } = openSqlite(sqlitePath)
applyMigrations(sqlitePath, path.join(rootDir, 'migrations'))

const env: Env = {
  DB: db,
  BUCKET: createLocalBucket(filesDir),
  ENVIRONMENT: process.env.ENVIRONMENT || 'production',
  ADMIN_KEY: process.env.ADMIN_KEY,
  SESSION_SECRET: sessionSecret,
  ALLOW_PUBLIC_REGISTER: process.env.ALLOW_PUBLIC_REGISTER || 'false',
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || `http://${listenHost}:${listenPort}`,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
}

const executionCtx = {
  props: {},
  waitUntil(promise: Promise<unknown>) {
    void promise.catch((err) => console.error('[waitUntil]', err))
  },
  passThroughOnException() {},
}

if (existsSync(publicDir)) {
  app.use('/*', serveStatic({ root: './public' }))
  app.get('*', async (c) => {
    const pathname = new URL(c.req.url).pathname
    if (pathname.split('/').some((part) => part.startsWith('.'))) {
      return c.notFound()
    }
    const html = readFileSync(path.join(publicDir, 'index.html'))
    return c.html(html.toString())
  })
}

const nodeApp = {
  fetch(request: Request) {
    return app.fetch(request, env, executionCtx)
  },
}

serve({ fetch: nodeApp.fetch, hostname: listenHost, port: listenPort }, (info) => {
  console.log(`MoWen listening on http://${info.address}:${info.port}`)
})
