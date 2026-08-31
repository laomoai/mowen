import { Hono } from 'hono'
import type { Env, AuthVariables } from '../types'
import { listOrphanFiles, registerFile, unregisterFile, type FileRefKind } from '../utils/files'

const upload = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

upload.post('/image', async (c) => {
  if (c.get('keyType') === 'readonly') {
    return c.json({ error: { message: 'Read-only key cannot upload files' } }, 403)
  }

  const form = await c.req.formData()
  const thumb = form.get('thumb') as File | null
  const display = form.get('display') as File | null
  const name = (form.get('name') as string | null) ?? 'image'
  const refKindRaw = String(form.get('ref_kind') || 'none')
  const refKind: FileRefKind = refKindRaw === 'table' || refKindRaw === 'note' ? refKindRaw : 'none'
  const refId = String(form.get('ref_id') || '').trim() || null

  if (!thumb || !display) {
    return c.json({ error: { message: 'Missing thumb or display' } }, 400)
  }

  const uuid = crypto.randomUUID()
  const thumbKey = `images/${uuid}/thumb.webp`
  const displayKey = `images/${uuid}/display.webp`

  await Promise.all([
    c.env.BUCKET.put(thumbKey, await thumb.arrayBuffer(), {
      httpMetadata: { contentType: 'image/webp' },
    }),
    c.env.BUCKET.put(displayKey, await display.arrayBuffer(), {
      httpMetadata: { contentType: 'image/webp' },
    }),
  ])

  const ownerId = c.get('userId') ?? null
  const teamId = c.get('teamId') ?? null
  await registerFile(c.env.DB, { storageKey: thumbKey, ownerId, teamId, refKind, refId })
  await registerFile(c.env.DB, { storageKey: displayKey, ownerId, teamId, refKind, refId })

  return c.json({
    data: { thumb: thumbKey, display: displayKey, name, size: display.size },
  })
})

// DELETE /api/upload/image — 删除本地对象存储中的图片（thumb + display）
upload.delete('/image', async (c) => {
  if (c.get('keyType') === 'readonly') {
    return c.json({ error: { message: 'Read-only key cannot delete files' } }, 403)
  }

  const { thumb, display } = await c.req.json<{ thumb: string; display: string }>()
  if (!thumb || !display) {
    return c.json({ error: { message: 'Missing keys' } }, 400)
  }

  await Promise.all([
    c.env.BUCKET.delete(thumb),
    c.env.BUCKET.delete(display),
  ])
  await unregisterFile(c.env.DB, thumb)
  await unregisterFile(c.env.DB, display)

  return c.json({ data: { success: true } })
})

upload.get('/files/stats', async (c) => {
  const teamId = c.get('teamId')
  const listSql = teamId !== undefined
    ? c.env.DB.prepare(`SELECT storage_key FROM _files WHERE team_id = ?`).bind(teamId)
    : c.env.DB.prepare(`SELECT storage_key FROM _files`)
  const listed = await listSql.all<{ storage_key: string }>()
  const orphans = await listOrphanFiles(c.env.DB, { teamId, olderThanSec: 24 * 3600 })
  const orphanKeys = new Set(orphans.map((o) => o.storage_key))
  let bytes = 0
  let orphanBytes = 0
  for (const row of listed.results ?? []) {
    const n = await c.env.BUCKET.size(row.storage_key)
    if (!n) continue
    bytes += n
    if (orphanKeys.has(row.storage_key)) orphanBytes += n
  }
  return c.json({
    data: {
      total: listed.results?.length ?? 0,
      orphan: orphans.length,
      bytes,
      orphan_bytes: orphanBytes,
      used_bytes: Math.max(0, bytes - orphanBytes),
      orphan_after_hours: 24,
    },
  })
})

upload.post('/files/sweep', async (c) => {
  if (c.get('keyType') === 'readonly') {
    return c.json({ error: { message: '只读密钥不能清理文件' } }, 403)
  }
  const orphans = await listOrphanFiles(c.env.DB, { teamId: c.get('teamId'), olderThanSec: 24 * 3600 })
  let deleted = 0
  for (const row of orphans) {
    await c.env.BUCKET.delete(row.storage_key)
    await unregisterFile(c.env.DB, row.storage_key)
    deleted += 1
  }
  return c.json({ data: { deleted } })
})

export default upload
