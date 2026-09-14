import type { AppTransaction } from '../db/sqlite'
import type { RevisionActor } from './revisions'

export type TableRevisionAction = 'insert' | 'update' | 'delete' | 'batch_insert' | 'restore'

export type TableRevisionRow = {
  id: number
  table_version: number
  action: TableRevisionAction
  before_rows_json: string
  after_rows_json: string
  changed_record_ids_json: string
  actor_user_id: number | null
  actor_api_key_id: number | null
  auth_mode: string
  restore_from_id: number | null
  created_at: number
}

function rowId(row: Record<string, unknown>): string {
  return String(row.id)
}

export function ensureTableHead(tx: AppTransaction, teamId: number, tableName: string): number {
  tx.run(
    `INSERT OR IGNORE INTO _table_revision_heads (team_id, table_name, current_version)
     VALUES (?, ?, 1)`,
    teamId, tableName,
  )
  return tx.first<{ current_version: number }>(
    `SELECT current_version FROM _table_revision_heads WHERE team_id = ? AND table_name = ?`,
    teamId, tableName,
  )!.current_version
}

export function saveTableChange(
  tx: AppTransaction,
  teamId: number,
  tableName: string,
  beforeRows: Record<string, unknown>[],
  afterRows: Record<string, unknown>[],
  actor: RevisionActor,
  action: TableRevisionAction,
  restoreFromId?: number,
): number {
  const currentVersion = ensureTableHead(tx, teamId, tableName)
  const nextVersion = currentVersion + 1
  const changedIds = [...new Set([...beforeRows, ...afterRows].map(rowId))]
  tx.run(
    `INSERT INTO _table_revisions
       (team_id, table_name, table_version, action, before_rows_json, after_rows_json,
        changed_record_ids_json, actor_user_id, actor_api_key_id, auth_mode, restore_from_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    teamId, tableName, nextVersion, action, JSON.stringify(beforeRows), JSON.stringify(afterRows),
    JSON.stringify(changedIds), actor.userId ?? null, actor.apiKeyId ?? null, actor.authMode,
    restoreFromId ?? null,
  )
  tx.run(
    `UPDATE _table_revision_heads SET current_version = ?, updated_at = unixepoch()
     WHERE team_id = ? AND table_name = ?`,
    nextVersion, teamId, tableName,
  )
  return nextVersion
}

export function reconstructTableVersion(
  revisions: TableRevisionRow[],
  currentRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const rows = new Map(currentRows.map(row => [rowId(row), { ...row }]))
  for (const revision of revisions) {
    const afterRows = JSON.parse(revision.after_rows_json) as Record<string, unknown>[]
    const beforeRows = JSON.parse(revision.before_rows_json) as Record<string, unknown>[]
    for (const row of afterRows) rows.delete(rowId(row))
    for (const row of beforeRows) rows.set(rowId(row), row)
  }
  return [...rows.values()].sort((a, b) => Number(a.id) - Number(b.id))
}

export type TableRowDiff = {
  record_id: string
  type: 'added' | 'removed' | 'modified'
  fields: Array<{ field: string; before: unknown; after: unknown }>
}

export function diffTableRows(
  historicalRows: Record<string, unknown>[],
  currentRows: Record<string, unknown>[],
): TableRowDiff[] {
  const historical = new Map(historicalRows.map(row => [rowId(row), row]))
  const current = new Map(currentRows.map(row => [rowId(row), row]))
  const ids = [...new Set([...historical.keys(), ...current.keys()])].sort((a, b) => Number(a) - Number(b))
  const result: TableRowDiff[] = []
  for (const id of ids) {
    const before = historical.get(id)
    const after = current.get(id)
    if (!before && after) {
      result.push({ record_id: id, type: 'added', fields: Object.keys(after).map(field => ({ field, before: null, after: after[field] })) })
      continue
    }
    if (before && !after) {
      result.push({ record_id: id, type: 'removed', fields: Object.keys(before).map(field => ({ field, before: before[field], after: null })) })
      continue
    }
    if (!before || !after) continue
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
      .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }))
    if (fields.length) result.push({ record_id: id, type: 'modified', fields })
  }
  return result
}
