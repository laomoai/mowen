import type { AppTransaction } from '../db/sqlite'

export type EntityType = 'record' | 'note'

export type RevisionActor = {
  userId?: number
  apiKeyId?: number
  authMode: 'session' | 'apiKey' | 'adminKey'
}

export type RevisionRow = {
  id: number
  entity_version: number
  action: 'update' | 'restore'
  snapshot_json: string
  changed_fields_json: string
  actor_user_id: number | null
  actor_api_key_id: number | null
  auth_mode: string
  restore_from_id: number | null
  created_at: number
}

type EntityKey = {
  teamId: number
  entityType: EntityType
  tableName?: string
  entityId: string
}

export function ensureHead(tx: AppTransaction, key: EntityKey): number {
  const tableName = key.tableName ?? ''
  tx.run(
    `INSERT OR IGNORE INTO _entity_heads
       (team_id, entity_type, table_name, entity_id, current_version)
     VALUES (?, ?, ?, ?, 1)`,
    key.teamId, key.entityType, tableName, key.entityId,
  )
  return tx.first<{ current_version: number }>(
    `SELECT current_version FROM _entity_heads
     WHERE team_id = ? AND entity_type = ? AND table_name = ? AND entity_id = ?`,
    key.teamId, key.entityType, tableName, key.entityId,
  )!.current_version
}

export function savePreimage(
  tx: AppTransaction,
  key: EntityKey,
  snapshot: Record<string, unknown>,
  changedFields: string[],
  actor: RevisionActor,
  action: 'update' | 'restore' = 'update',
  restoreFromId?: number,
): number {
  const tableName = key.tableName ?? ''
  const version = ensureHead(tx, key)
  tx.run(
    `INSERT INTO _revisions
       (team_id, entity_type, table_name, entity_id, entity_version, action,
        snapshot_json, changed_fields_json, actor_user_id, actor_api_key_id,
        auth_mode, restore_from_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    key.teamId, key.entityType, tableName, key.entityId, version, action,
    JSON.stringify(snapshot), JSON.stringify([...new Set(changedFields)].sort()),
    actor.userId ?? null, actor.apiKeyId ?? null, actor.authMode, restoreFromId ?? null,
  )
  tx.run(
    `UPDATE _entity_heads SET current_version = current_version + 1, updated_at = unixepoch()
     WHERE team_id = ? AND entity_type = ? AND table_name = ? AND entity_id = ?`,
    key.teamId, key.entityType, tableName, key.entityId,
  )
  return version + 1
}

export function diffSnapshots(before: Record<string, unknown>, after: Record<string, unknown>) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return keys.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }))
}
