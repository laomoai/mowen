import { Hono } from 'hono'
import type { AuthVariables, Env } from '../types'
import { requireWriteMiddleware } from '../middleware/auth'
import { getUserTables } from '../utils/schema-cache'

const dashboards = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

async function assertDashboardTableAccess(c: {
  env: Env
  get: (key: keyof AuthVariables) => unknown
  json: Function
}, tableName: string): Promise<Response | null> {
  const tables = await getUserTables(c.env.DB)
  if (!tables.includes(tableName)) {
    return c.json({ error: { code: 'TABLE_NOT_FOUND', message: 'Table not found' } }, 404)
  }

  const teamId = c.get('teamId') as number | undefined
  if (teamId !== undefined) {
    const meta = await c.env.DB.prepare(
      `SELECT team_id FROM _meta WHERE table_name = ?`,
    ).bind(tableName).first<{ team_id: number | null }>()
    if (!meta || meta.team_id !== teamId) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Dashboard is not in the active Space' } }, 403)
    }
  }

  return null
}

// GET /api/tables/:tableName/dashboard
dashboards.get('/:tableName/dashboard', async (c) => {
  const { tableName } = c.req.param()
  const accessError = await assertDashboardTableAccess(c, tableName)
  if (accessError) return accessError

  const row = await c.env.DB
    .prepare('SELECT config FROM _dashboards WHERE table_name = ? AND (? IS NULL OR team_id = ?)')
    .bind(tableName, c.get('teamId') ?? null, c.get('teamId') ?? null)
    .first<{ config: string }>()

  let config: unknown[] = []
  if (row) {
    try { config = JSON.parse(row.config) } catch { /* corrupted data, return empty */ }
  }
  return c.json({ data: { config } })
})

// PUT /api/tables/:tableName/dashboard
dashboards.put('/:tableName/dashboard', requireWriteMiddleware, async (c) => {
  const { tableName } = c.req.param()
  const accessError = await assertDashboardTableAccess(c, tableName)
  if (accessError) return accessError

  const body = await c.req.json<{ config: unknown[] }>()
  const config = JSON.stringify(body.config ?? [])

  // 限制 config 大小（50KB）
  if (config.length > 50_000) {
    return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Dashboard config exceeds 50KB limit' } }, 400)
  }

  await c.env.DB
    .prepare(`
      INSERT INTO _dashboards (table_name, config, updated_at, owner_id, team_id)
      VALUES (?, ?, unixepoch(), ?, ?)
      ON CONFLICT(table_name) DO UPDATE SET config = excluded.config, updated_at = unixepoch()
    `)
    .bind(tableName, config, c.get('userId') ?? null, c.get('teamId') ?? null)
    .run()

  return c.json({ data: { success: true } })
})

export default dashboards
