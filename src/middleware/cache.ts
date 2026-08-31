import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types'

/**
 * VPS runtime placeholder for GET caching.
 * The current Node + SQLite deployment intentionally avoids platform-specific
 * edge cache APIs; keep this middleware as a no-op so routes can opt into a
 * real server-side cache later without changing route wiring.
 */
export function cacheMiddleware(_ttl = 60): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    await next()
  }
}

/**
 * Reserved hook for future VPS-side cache invalidation.
 */
export async function invalidateTableCache(
  _request: Request,
  _tableName: string
): Promise<void> {
}
