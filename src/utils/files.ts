import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AppDatabase } from '../db/sqlite'
import { getAccessibleNoteIds, canAccessNote } from './note-access'

export type FileRefKind = 'table' | 'note' | 'none'

export type FileMeta = {
  storage_key: string
  owner_id: number | null
  team_id: number | null
  ref_kind: FileRefKind
  ref_id: string | null
  created_at?: number
}

export function normalizeStorageKey(raw: string): string | null {
  const key = decodeURIComponent(raw).replace(/^\/+/, '').replace(/\0/g, '')
  if (!key || key.includes('..') || key.length > 240) return null
  return key
}

export async function registerFile(
  db: AppDatabase,
  opts: {
    storageKey: string
    ownerId?: number | null
    teamId?: number | null
    refKind?: FileRefKind
    refId?: string | null
  },
): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO _files (storage_key, owner_id, team_id, ref_kind, ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())`,
  ).bind(
    opts.storageKey,
    opts.ownerId ?? null,
    opts.teamId ?? null,
    opts.refKind ?? 'none',
    opts.refId ?? null,
  ).run()
}

export async function unregisterFile(db: AppDatabase, key: string): Promise<void> {
  await db.prepare(`DELETE FROM _files WHERE storage_key = ?`).bind(key).run()
}

export async function collectReferencedKeys(db: AppDatabase, teamId?: number): Promise<Set<string>> {
  const used = new Set<string>()
  const noteSql = teamId !== undefined
    ? `SELECT content FROM _notes WHERE deleted_at IS NULL AND team_id = ?`
    : `SELECT content FROM _notes WHERE deleted_at IS NULL`
  const notes = teamId !== undefined
    ? await db.prepare(noteSql).bind(teamId).all<{ content: string | null }>()
    : await db.prepare(noteSql).all<{ content: string | null }>()
  const fileRe = /\/api\/files\/(images\/[a-z0-9-]+\/[a-z]+\.webp)/gi
  for (const row of notes.results ?? []) {
    const text = row.content || ''
    let m: RegExpExecArray | null
    fileRe.lastIndex = 0
    while ((m = fileRe.exec(text))) used.add(m[1])
  }

  const imgFields = await db.prepare(
    `SELECT table_name, column_name FROM _field_meta WHERE field_type = 'image'`,
  ).all<{ table_name: string; column_name: string }>()
  for (const f of imgFields.results ?? []) {
    if (!/^[a-zA-Z0-9_]+$/.test(f.table_name) || !/^[a-zA-Z0-9_]+$/.test(f.column_name)) continue
    try {
      const rows = await db.prepare(`SELECT "${f.column_name}" AS v FROM "${f.table_name}"`).all<{ v: string | null }>()
      for (const row of rows.results ?? []) {
        if (!row.v) continue
        try {
          const parsed = JSON.parse(row.v) as { thumb?: string; display?: string }
          if (parsed.thumb) used.add(parsed.thumb)
          if (parsed.display) used.add(parsed.display)
        } catch {
          if (row.v.startsWith('images/')) used.add(row.v)
        }
      }
    } catch {
      /* table may have been dropped */
    }
  }
  return used
}

export async function listOrphanFiles(
  db: AppDatabase,
  opts: { teamId?: number; olderThanSec?: number },
): Promise<FileMeta[]> {
  const used = await collectReferencedKeys(db, opts.teamId)
  const sql = opts.teamId !== undefined
    ? `SELECT storage_key, owner_id, team_id, ref_kind, ref_id, created_at FROM _files WHERE team_id = ?`
    : `SELECT storage_key, owner_id, team_id, ref_kind, ref_id, created_at FROM _files`
  const rows = opts.teamId !== undefined
    ? await db.prepare(sql).bind(opts.teamId).all<FileMeta & { created_at: number }>()
    : await db.prepare(sql).all<FileMeta & { created_at: number }>()
  const now = Math.floor(Date.now() / 1000)
  const minAge = opts.olderThanSec ?? 0
  return (rows.results ?? []).filter((row) => {
    if (used.has(row.storage_key)) return false
    if (minAge && now - (row.created_at || 0) < minAge) return false
    return true
  })
}

export async function getFileMeta(db: AppDatabase, key: string): Promise<FileMeta | null> {
  return db.prepare(
    `SELECT storage_key, owner_id, team_id, ref_kind, ref_id FROM _files WHERE storage_key = ?`,
  ).bind(key).first<FileMeta>()
}

export function signFileUrl(secret: string, key: string, ttlSec = 3600): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const sig = createHmac('sha256', secret).update(`${key}\n${exp}`).digest('hex')
  return { exp, sig }
}

export function verifyFileSig(secret: string, key: string, expRaw: string, sig: string): boolean {
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false
  const expected = createHmac('sha256', secret).update(`${key}\n${exp}`).digest()
  const got = Buffer.from(sig, 'hex')
  if (got.length !== expected.length) return false
  return timingSafeEqual(got, expected)
}

export async function canReadStoredFile(
  db: AppDatabase,
  meta: FileMeta | null,
  access: {
    userId?: number
    teamId?: number
    allowedTables: string[] | null
    allowedNoteRootIds: string[] | null
    isAdminKey?: boolean
  },
): Promise<boolean> {
  if (access.isAdminKey) return true
  if (!meta) return true
  if (meta.team_id != null && access.teamId != null && meta.team_id !== access.teamId) return false

  if (meta.ref_kind === 'table' && meta.ref_id) {
    if (access.allowedTables === null) return true
    return access.allowedTables.includes(meta.ref_id)
  }
  if (meta.ref_kind === 'note' && meta.ref_id) {
    const allowed = await getAccessibleNoteIds(db, access.teamId, access.allowedNoteRootIds)
    return canAccessNote(allowed, meta.ref_id)
  }
  if (meta.owner_id != null && access.userId != null) return meta.owner_id === access.userId
  return true
}
