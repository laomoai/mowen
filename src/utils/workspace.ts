import type { AppDatabase } from '../db/sqlite'

export type WorkspaceKind = 'folder' | 'table' | 'note'

export type WorkspaceNode = {
  id: string
  kind: WorkspaceKind
  parent_id: string | null
  sort_order: number
  title: string
  ref: string | null
  group_id: number | null
  team_id: number | null
  icon: string | null
  archived_at?: number | null
}

export function newWorkspaceId(kind: WorkspaceKind): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  return `wn_${kind[0]}_${rand}`
}

async function nextSort(db: AppDatabase, teamId: number | undefined, parentId: string | null): Promise<number> {
  const row = parentId
    ? await db.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM _workspace_nodes WHERE parent_id = ? AND (? IS NULL OR team_id = ?)`,
      ).bind(parentId, teamId ?? null, teamId ?? null).first<{ m: number }>()
    : teamId !== undefined
      ? await db.prepare(
          `SELECT COALESCE(MAX(sort_order), -1) AS m FROM _workspace_nodes WHERE parent_id IS NULL AND team_id = ?`,
        ).bind(teamId).first<{ m: number }>()
      : await db.prepare(
          `SELECT COALESCE(MAX(sort_order), -1) AS m FROM _workspace_nodes WHERE parent_id IS NULL`,
        ).first<{ m: number }>()
  return (row?.m ?? -1) + 1
}

export async function getNode(db: AppDatabase, id: string): Promise<WorkspaceNode | null> {
  return db.prepare(
    `SELECT id, kind, parent_id, sort_order, title, ref, group_id, team_id, icon, archived_at
     FROM _workspace_nodes WHERE id = ?`,
  ).bind(id).first<WorkspaceNode>()
}

export async function assertFolder(
  db: AppDatabase,
  folderId: string | null | undefined,
  teamId: number | undefined,
): Promise<WorkspaceNode | null> {
  if (!folderId) return null
  const node = await getNode(db, folderId)
  if (!node || node.kind !== 'folder') {
    throw Object.assign(new Error('Parent must be a folder'), { status: 400, code: 'INVALID_PARENT' })
  }
  if (teamId !== undefined && node.team_id !== teamId) {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  return node
}

export async function ensureFolderForGroup(
  db: AppDatabase,
  opts: { groupId: number; title: string; teamId?: number; ownerId?: number | null },
): Promise<WorkspaceNode> {
  const existing = await db.prepare(
    `SELECT id, kind, parent_id, sort_order, title, ref, group_id, team_id FROM _workspace_nodes WHERE kind = 'folder' AND group_id = ?`,
  ).bind(opts.groupId).first<WorkspaceNode>()
  if (existing) return { ...existing, icon: null }

  const id = newWorkspaceId('folder')
  const sort = await nextSort(db, opts.teamId, null)
  await db.prepare(
    `INSERT INTO _workspace_nodes (id, kind, parent_id, sort_order, title, ref, group_id, team_id, owner_id)
     VALUES (?, 'folder', NULL, ?, ?, NULL, ?, ?, ?)`,
  ).bind(id, sort, opts.title, opts.groupId, opts.teamId ?? null, opts.ownerId ?? null).run()
  return {
    id, kind: 'folder', parent_id: null, sort_order: sort,
    title: opts.title, ref: null, group_id: opts.groupId, team_id: opts.teamId ?? null, icon: null,
  }
}

export async function syncFolderTitleByGroup(db: AppDatabase, groupId: number, title: string): Promise<void> {
  await db.prepare(
    `UPDATE _workspace_nodes SET title = ?, updated_at = unixepoch() WHERE kind = 'folder' AND group_id = ?`,
  ).bind(title, groupId).run()
}

export async function removeFolderByGroup(db: AppDatabase, groupId: number): Promise<void> {
  const folder = await db.prepare(
    `SELECT id FROM _workspace_nodes WHERE kind = 'folder' AND group_id = ?`,
  ).bind(groupId).first<{ id: string }>()
  if (!folder) return
  await db.batch([
    db.prepare(`UPDATE _workspace_nodes SET parent_id = NULL, updated_at = unixepoch() WHERE parent_id = ?`).bind(folder.id),
    db.prepare(`DELETE FROM _workspace_nodes WHERE id = ?`).bind(folder.id),
  ])
}

export async function attachTablesToGroupFolder(
  db: AppDatabase,
  groupId: number,
  tableNames: string[],
): Promise<void> {
  const folder = await db.prepare(
    `SELECT id FROM _workspace_nodes WHERE kind = 'folder' AND group_id = ?`,
  ).bind(groupId).first<{ id: string }>()
  if (!folder) return

  for (const name of tableNames) {
    const title = await db.prepare(`SELECT title FROM _meta WHERE table_name = ?`).bind(name).first<{ title: string | null }>()
    await ensureTableNode(db, {
      tableName: name,
      title: title?.title || name,
      folderId: folder.id,
    })
  }
}

export async function backfillTableFolderParents(db: AppDatabase, teamId?: number): Promise<void> {
  const sql = teamId !== undefined
    ? `SELECT t.id AS node_id, (
         SELECT n.id FROM _group_tables gt
         JOIN _workspace_nodes n ON n.kind = 'folder' AND n.group_id = gt.group_id
         JOIN _groups g ON g.id = gt.group_id
         WHERE gt.table_name = t.ref
         ORDER BY g.sort_order ASC, g.id ASC
         LIMIT 1
       ) AS folder_id
       FROM _workspace_nodes t
       WHERE t.kind = 'table' AND t.parent_id IS NULL AND t.team_id = ?`
    : `SELECT t.id AS node_id, (
         SELECT n.id FROM _group_tables gt
         JOIN _workspace_nodes n ON n.kind = 'folder' AND n.group_id = gt.group_id
         JOIN _groups g ON g.id = gt.group_id
         WHERE gt.table_name = t.ref
         ORDER BY g.sort_order ASC, g.id ASC
         LIMIT 1
       ) AS folder_id
       FROM _workspace_nodes t
       WHERE t.kind = 'table' AND t.parent_id IS NULL`

  const rows = teamId !== undefined
    ? await db.prepare(sql).bind(teamId).all<{ node_id: string; folder_id: string | null }>()
    : await db.prepare(sql).all<{ node_id: string; folder_id: string | null }>()

  for (const row of rows.results) {
    if (!row.folder_id) continue
    await db.prepare(
      `UPDATE _workspace_nodes SET parent_id = ?, updated_at = unixepoch() WHERE id = ?`,
    ).bind(row.folder_id, row.node_id).run()
  }
}

export async function backfillMissingGroupFolders(db: AppDatabase, teamId?: number): Promise<void> {
  const sql = teamId !== undefined
    ? `SELECT g.id, g.name, g.team_id, g.owner_id FROM _groups g
       WHERE g.team_id = ? AND NOT EXISTS (
         SELECT 1 FROM _workspace_nodes n WHERE n.kind = 'folder' AND n.group_id = g.id
       )`
    : `SELECT g.id, g.name, g.team_id, g.owner_id FROM _groups g
       WHERE NOT EXISTS (
         SELECT 1 FROM _workspace_nodes n WHERE n.kind = 'folder' AND n.group_id = g.id
       )`
  const rows = teamId !== undefined
    ? await db.prepare(sql).bind(teamId).all<{ id: number; name: string; team_id: number | null; owner_id: number | null }>()
    : await db.prepare(sql).all<{ id: number; name: string; team_id: number | null; owner_id: number | null }>()
  for (const g of rows.results) {
    await ensureFolderForGroup(db, {
      groupId: g.id,
      title: g.name,
      teamId: g.team_id ?? undefined,
      ownerId: g.owner_id,
    })
  }
}

export async function createFolder(
  db: AppDatabase,
  opts: { title: string; parentId?: string | null; teamId?: number; ownerId?: number | null },
): Promise<WorkspaceNode> {
  const parent = await assertFolder(db, opts.parentId, opts.teamId)
  const title = opts.title.trim()
  if (!title) {
    throw Object.assign(new Error('Folder name cannot be empty'), { status: 400, code: 'INVALID_BODY' })
  }

  const groupResult = await db.prepare(
    `INSERT INTO _groups (name, sort_order, owner_id, team_id) VALUES (?, ?, ?, ?)`,
  ).bind(title, 0, opts.ownerId ?? null, opts.teamId ?? null).run()
  const groupId = Number(groupResult.meta.last_row_id)
  const id = newWorkspaceId('folder')
  const sort = await nextSort(db, opts.teamId, parent?.id ?? null)
  await db.prepare(
    `INSERT INTO _workspace_nodes (id, kind, parent_id, sort_order, title, ref, group_id, team_id, owner_id)
     VALUES (?, 'folder', ?, ?, ?, NULL, ?, ?, ?)`,
  ).bind(id, parent?.id ?? null, sort, title, groupId, opts.teamId ?? null, opts.ownerId ?? null).run()

  return {
    id, kind: 'folder', parent_id: parent?.id ?? null, sort_order: sort,
    title, ref: null, group_id: groupId, team_id: opts.teamId ?? null, icon: null,
  }
}

export async function renameFolder(db: AppDatabase, id: string, title: string, teamId?: number): Promise<void> {
  const node = await getNode(db, id)
  if (!node || node.kind !== 'folder') {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  if (teamId !== undefined && node.team_id !== teamId) {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  const name = title.trim()
  if (!name) {
    throw Object.assign(new Error('Folder name cannot be empty'), { status: 400, code: 'INVALID_BODY' })
  }
  await db.batch([
    db.prepare(`UPDATE _workspace_nodes SET title = ?, updated_at = unixepoch() WHERE id = ?`).bind(name, id),
    ...(node.group_id
      ? [db.prepare(`UPDATE _groups SET name = ? WHERE id = ?`).bind(name, node.group_id)]
      : []),
  ])
}

function normalizeIcon(icon: string | null): string | null {
  if (icon === null || icon === '') return null
  if (icon.startsWith('ion:')) {
    if (icon.length <= 4) {
      throw Object.assign(new Error('Invalid icon'), { status: 400, code: 'INVALID_BODY' })
    }
    return icon
  }
  if (icon.length > 20) {
    throw Object.assign(new Error('Icon is too long'), { status: 400, code: 'INVALID_BODY' })
  }
  return icon
}

export async function updateFolderIcon(
  db: AppDatabase,
  id: string,
  icon: string | null,
  teamId?: number,
): Promise<void> {
  const node = await getNode(db, id)
  if (!node || node.kind !== 'folder') {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  if (teamId !== undefined && node.team_id !== teamId) {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  const value = normalizeIcon(icon)
  await db.prepare(
    `UPDATE _workspace_nodes SET icon = ?, updated_at = unixepoch() WHERE id = ?`,
  ).bind(value, id).run()
}

export async function deleteEmptyFolder(db: AppDatabase, id: string, teamId?: number): Promise<void> {
  const node = await getNode(db, id)
  if (!node || node.kind !== 'folder') {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  if (teamId !== undefined && node.team_id !== teamId) {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  const child = await db.prepare(
    `SELECT id FROM _workspace_nodes WHERE parent_id = ? LIMIT 1`,
  ).bind(id).first()
  if (child) {
    throw Object.assign(new Error('Folder is not empty'), { status: 409, code: 'NOT_EMPTY' })
  }
  await db.batch([
    db.prepare(`DELETE FROM _workspace_nodes WHERE id = ?`).bind(id),
    ...(node.group_id
      ? [db.prepare(`DELETE FROM _groups WHERE id = ?`).bind(node.group_id)]
      : []),
  ])
}

async function isDescendant(db: AppDatabase, ancestorId: string, maybeChildId: string): Promise<boolean> {
  let current: string | null = maybeChildId
  const seen = new Set<string>()
  while (current) {
    if (current === ancestorId) return true
    if (seen.has(current)) break
    seen.add(current)
    const row: { parent_id: string | null } | null = await db
      .prepare(`SELECT parent_id FROM _workspace_nodes WHERE id = ?`)
      .bind(current)
      .first<{ parent_id: string | null }>()
    current = row?.parent_id ?? null
  }
  return false
}

export async function moveNode(
  db: AppDatabase,
  opts: { id: string; parentId: string | null; sortOrder?: number; teamId?: number },
): Promise<void> {
  const sourceFolderId = opts.id.includes('::') ? opts.id.slice(opts.id.indexOf('::') + 2) : null
  const node = await getNode(db, canonicalNodeId(opts.id))
  if (!node) {
    throw Object.assign(new Error('Node not found'), { status: 404, code: 'NOT_FOUND' })
  }
  if (opts.teamId !== undefined && node.team_id !== opts.teamId) {
    throw Object.assign(new Error('Node not found'), { status: 404, code: 'NOT_FOUND' })
  }

  const parent = await assertFolder(db, opts.parentId, opts.teamId)
  const newParentId = parent?.id ?? null
  if (newParentId === node.id) {
    throw Object.assign(new Error('Cannot move a folder into itself'), { status: 400, code: 'INVALID_PARENT' })
  }
  if (node.kind === 'folder' && newParentId && await isDescendant(db, node.id, newParentId)) {
    throw Object.assign(new Error('Cannot move a folder into its descendant'), { status: 400, code: 'INVALID_PARENT' })
  }

  const sort = opts.sortOrder ?? await nextSort(db, opts.teamId, newParentId)
  const stmts = [
    db.prepare(
      `UPDATE _workspace_nodes SET parent_id = ?, sort_order = ?, updated_at = unixepoch() WHERE id = ?`,
    ).bind(newParentId, sort, node.id),
  ]

  if (node.kind === 'table' && node.ref) {
    const oldFolderId = sourceFolderId || node.parent_id
    const oldFolder = oldFolderId ? await getNode(db, oldFolderId) : null
    if (oldFolder?.group_id) {
      stmts.push(
        db.prepare(`DELETE FROM _group_tables WHERE group_id = ? AND table_name = ?`).bind(oldFolder.group_id, node.ref),
      )
    }
    if (parent?.group_id) {
      stmts.push(
        db.prepare(`INSERT OR IGNORE INTO _group_tables (group_id, table_name) VALUES (?, ?)`).bind(parent.group_id, node.ref),
      )
    }
  }

  await db.batch(stmts)
}

export async function ensureTableNode(
  db: AppDatabase,
  opts: { tableName: string; title: string; folderId?: string | null; teamId?: number; ownerId?: number | null },
): Promise<void> {
  const existing = await db.prepare(
    `SELECT id FROM _workspace_nodes WHERE kind = 'table' AND ref = ?`,
  ).bind(opts.tableName).first()
  if (existing) return

  const parent = await assertFolder(db, opts.folderId, opts.teamId)
  const sort = await nextSort(db, opts.teamId, parent?.id ?? null)
  const stmts = [
    db.prepare(
      `INSERT INTO _workspace_nodes (id, kind, parent_id, sort_order, title, ref, team_id, owner_id)
       VALUES (?, 'table', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `wn_t_${opts.tableName}`,
      parent?.id ?? null,
      sort,
      opts.title,
      opts.tableName,
      opts.teamId ?? null,
      opts.ownerId ?? null,
    ),
  ]
  if (parent?.group_id) {
    stmts.push(
      db.prepare(`INSERT OR IGNORE INTO _group_tables (group_id, table_name) VALUES (?, ?)`).bind(parent.group_id, opts.tableName),
    )
  }
  await db.batch(stmts)
}

export async function ensureNoteNode(
  db: AppDatabase,
  opts: { noteId: string; title: string; folderId?: string | null; teamId?: number; ownerId?: number | null },
): Promise<void> {
  const existing = await db.prepare(
    `SELECT id FROM _workspace_nodes WHERE kind = 'note' AND ref = ?`,
  ).bind(opts.noteId).first()
  if (existing) return

  const parent = await assertFolder(db, opts.folderId, opts.teamId)
  const sort = await nextSort(db, opts.teamId, parent?.id ?? null)
  await db.prepare(
    `INSERT INTO _workspace_nodes (id, kind, parent_id, sort_order, title, ref, team_id, owner_id)
     VALUES (?, 'note', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `wn_n_${opts.noteId}`,
    parent?.id ?? null,
    sort,
    opts.title,
    opts.noteId,
    opts.teamId ?? null,
    opts.ownerId ?? null,
  ).run()
}

export async function removeNodeByRef(db: AppDatabase, kind: 'table' | 'note', ref: string): Promise<void> {
  await db.prepare(`DELETE FROM _workspace_nodes WHERE kind = ? AND ref = ?`).bind(kind, ref).run()
}

export async function updateNodeTitleByRef(
  db: AppDatabase,
  kind: 'table' | 'note',
  ref: string,
  title: string,
): Promise<void> {
  await db.prepare(
    `UPDATE _workspace_nodes SET title = ?, updated_at = unixepoch() WHERE kind = ? AND ref = ?`,
  ).bind(title, kind, ref).run()
}

export async function expandTablesAcrossFolders(
  db: AppDatabase,
  teamId: number | undefined,
  nodes: WorkspaceNode[],
): Promise<WorkspaceNode[]> {
  const folders = nodes.filter((n) => n.kind === 'folder' && n.group_id != null)
  const tables = nodes.filter((n) => n.kind === 'table')
  const others = nodes.filter((n) => n.kind !== 'table')
  if (folders.length === 0) return nodes

  const gids = folders.map((f) => f.group_id!)
  const placeholders = gids.map(() => '?').join(',')
  const membership = await db.prepare(
    `SELECT group_id, table_name FROM _group_tables WHERE group_id IN (${placeholders})`,
  ).bind(...gids).all<{ group_id: number; table_name: string }>()

  const namesByGroup = new Map<number, string[]>()
  for (const row of membership.results) {
    const arr = namesByGroup.get(row.group_id) ?? []
    arr.push(row.table_name)
    namesByGroup.set(row.group_id, arr)
  }

  const tableByRef = new Map(tables.map((t) => [t.ref, t]))
  const expanded: WorkspaceNode[] = [...others]
  const placed = new Set<string>()

  for (const folder of folders) {
    for (const name of namesByGroup.get(folder.group_id!) ?? []) {
      const base = tableByRef.get(name)
      if (!base) continue
      if (base.parent_id === folder.id) {
        expanded.push({ ...base })
      } else {
        expanded.push({
          ...base,
          id: `${base.id}::${folder.id}`,
          parent_id: folder.id,
        })
      }
      placed.add(name)
    }
  }

  for (const table of tables) {
    if (table.ref && !placed.has(table.ref)) {
      expanded.push({ ...table })
    }
  }
  return expanded
}

export function canonicalNodeId(id: string): string {
  const i = id.indexOf('::')
  return i === -1 ? id : id.slice(0, i)
}

export async function listWorkspaceNodes(
  db: AppDatabase,
  teamId: number | undefined,
): Promise<WorkspaceNode[]> {
  const sql = teamId !== undefined
    ? `SELECT n.id, n.kind, n.parent_id, n.sort_order, n.title, n.ref, n.group_id, n.team_id,
              CASE
                WHEN n.kind = 'table' THEN (SELECT icon FROM _meta WHERE table_name = n.ref)
                WHEN n.kind = 'note' THEN (SELECT icon FROM _notes WHERE id = n.ref)
                ELSE n.icon
              END AS icon,
              n.archived_at
       FROM _workspace_nodes n
       WHERE n.team_id = ?
         AND NOT (n.kind = 'note' AND EXISTS (
           SELECT 1 FROM _notes nt WHERE nt.id = n.ref AND (nt.deleted_at IS NOT NULL OR nt.archived_at IS NOT NULL)
         ))
         AND NOT (n.kind = 'table' AND EXISTS (
           SELECT 1 FROM _meta m WHERE m.table_name = n.ref AND m.archived_at IS NOT NULL
         ))
       ORDER BY n.sort_order ASC, n.created_at ASC`
    : `SELECT n.id, n.kind, n.parent_id, n.sort_order, n.title, n.ref, n.group_id, n.team_id,
              CASE
                WHEN n.kind = 'table' THEN (SELECT icon FROM _meta WHERE table_name = n.ref)
                WHEN n.kind = 'note' THEN (SELECT icon FROM _notes WHERE id = n.ref)
                ELSE n.icon
              END AS icon,
              n.archived_at
       FROM _workspace_nodes n
       WHERE NOT (n.kind = 'note' AND EXISTS (
           SELECT 1 FROM _notes nt WHERE nt.id = n.ref AND (nt.deleted_at IS NOT NULL OR nt.archived_at IS NOT NULL)
         ))
         AND NOT (n.kind = 'table' AND EXISTS (
           SELECT 1 FROM _meta m WHERE m.table_name = n.ref AND m.archived_at IS NOT NULL
         ))
       ORDER BY n.sort_order ASC, n.created_at ASC`

  const result = teamId !== undefined
    ? await db.prepare(sql).bind(teamId).all<WorkspaceNode>()
    : await db.prepare(sql).all<WorkspaceNode>()
  return excludeArchivedCabinets(result.results)
}

function excludeArchivedCabinets(nodes: WorkspaceNode[]): WorkspaceNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const hidden = new Set<string>()
  for (const n of nodes) {
    if (n.kind === 'folder' && n.archived_at) hidden.add(n.id)
  }
  const underHidden = (id: string): boolean => {
    let cur: string | null = id
    const seen = new Set<string>()
    while (cur) {
      if (hidden.has(cur)) return true
      if (seen.has(cur)) break
      seen.add(cur)
      cur = byId.get(cur)?.parent_id ?? null
    }
    return false
  }
  return nodes.filter((n) => !underHidden(n.id))
}

async function loadTeamNodes(db: AppDatabase, teamId: number | undefined): Promise<WorkspaceNode[]> {
  const sql = teamId !== undefined
    ? `SELECT id, kind, parent_id, sort_order, title, ref, group_id, team_id, icon, archived_at
       FROM _workspace_nodes WHERE team_id = ?`
    : `SELECT id, kind, parent_id, sort_order, title, ref, group_id, team_id, icon, archived_at
       FROM _workspace_nodes`
  const result = teamId !== undefined
    ? await db.prepare(sql).bind(teamId).all<WorkspaceNode>()
    : await db.prepare(sql).all<WorkspaceNode>()
  return result.results
}

function subtreeIds(nodes: WorkspaceNode[], rootId: string): string[] {
  const byParent = new Map<string | null, WorkspaceNode[]>()
  for (const n of nodes) {
    const arr = byParent.get(n.parent_id) ?? []
    arr.push(n)
    byParent.set(n.parent_id, arr)
  }
  const out = [rootId]
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift()!
    for (const child of byParent.get(id) ?? []) {
      out.push(child.id)
      queue.push(child.id)
    }
  }
  return out
}

async function cabinetContents(
  db: AppDatabase,
  folderId: string,
  teamId: number | undefined,
): Promise<{ nodes: WorkspaceNode[]; subtree: WorkspaceNode[]; idSet: Set<string> }> {
  const raw = await loadTeamNodes(db, teamId)
  const nodes = await expandTablesAcrossFolders(db, teamId, raw)
  const ids = subtreeIds(nodes, folderId)
  const idSet = new Set(ids)
  return { nodes, subtree: nodes.filter((n) => idSet.has(n.id)), idSet }
}

export async function archiveFolder(
  db: AppDatabase,
  folderId: string,
  teamId: number | undefined,
): Promise<{ table_count: number; note_count: number }> {
  const folder = await getNode(db, folderId)
  if (!folder || folder.kind !== 'folder') {
    throw Object.assign(new Error('只能归档文件夹'), { status: 400, code: 'NOT_A_FOLDER' })
  }
  if (teamId !== undefined && folder.team_id !== teamId) {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  if (folder.archived_at) {
    return { table_count: 0, note_count: 0 }
  }

  const { nodes, subtree, idSet } = await cabinetContents(db, folderId, teamId)
  const notes = subtree.filter((n) => n.kind === 'note' && n.ref)
  const tableRefs = [...new Set(subtree.filter((n) => n.kind === 'table' && n.ref).map((n) => n.ref!))]

  await db.prepare(`UPDATE _workspace_nodes SET archived_at = unixepoch() WHERE id = ?`).bind(folderId).run()

  for (const note of notes) {
    await db.prepare(
      `UPDATE _notes SET archived_at = unixepoch() WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL`,
    ).bind(note.ref).run()
  }

  let exclusiveTables = 0
  for (const ref of tableRefs) {
    const liveElsewhere = nodes.some((n) => n.kind === 'table' && n.ref === ref && !idSet.has(n.id))
    if (!liveElsewhere) {
      await db.prepare(
        `UPDATE _meta SET archived_at = unixepoch() WHERE table_name = ? AND archived_at IS NULL`,
      ).bind(ref).run()
      exclusiveTables += 1
    }
  }

  return { table_count: tableRefs.length, note_count: notes.length }
}

export async function unarchiveFolder(
  db: AppDatabase,
  folderId: string,
  teamId: number | undefined,
): Promise<void> {
  const folder = await getNode(db, folderId)
  if (!folder || folder.kind !== 'folder') {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  if (teamId !== undefined && folder.team_id !== teamId) {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }

  const { subtree } = await cabinetContents(db, folderId, teamId)

  await db.prepare(`UPDATE _workspace_nodes SET archived_at = NULL WHERE id = ?`).bind(folderId).run()

  for (const note of subtree.filter((n) => n.kind === 'note' && n.ref)) {
    await db.prepare(`UPDATE _notes SET archived_at = NULL WHERE id = ? AND deleted_at IS NULL`).bind(note.ref).run()
  }
  for (const ref of [...new Set(subtree.filter((n) => n.kind === 'table' && n.ref).map((n) => n.ref!))]) {
    await db.prepare(`UPDATE _meta SET archived_at = NULL WHERE table_name = ?`).bind(ref).run()
  }
}

export async function listArchivedFolders(
  db: AppDatabase,
  teamId: number | undefined,
): Promise<Array<{ id: string; title: string; archived_at: number; table_count: number; note_count: number }>> {
  const raw = await loadTeamNodes(db, teamId)
  const nodes = await expandTablesAcrossFolders(db, teamId, raw)
  const cabinets = nodes.filter((n) => n.kind === 'folder' && n.archived_at)
  return cabinets.map((folder) => {
    const ids = new Set(subtreeIds(nodes, folder.id))
    const kids = nodes.filter((n) => ids.has(n.id))
    return {
      id: folder.id,
      title: folder.title,
      archived_at: folder.archived_at as number,
      table_count: kids.filter((n) => n.kind === 'table').length,
      note_count: kids.filter((n) => n.kind === 'note').length,
    }
  })
}

export async function getArchivedFolderTree(
  db: AppDatabase,
  folderId: string,
  teamId: number | undefined,
): Promise<{ folder: WorkspaceNode; nodes: WorkspaceNode[] }> {
  const folder = await getNode(db, folderId)
  if (!folder || folder.kind !== 'folder') {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  if (teamId !== undefined && folder.team_id !== teamId) {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'NOT_FOUND' })
  }
  const { subtree, nodes, idSet } = await cabinetContents(db, folderId, teamId)
  // Heal cabinets archived before group_tables expansion
  for (const note of subtree.filter((n) => n.kind === 'note' && n.ref)) {
    await db.prepare(
      `UPDATE _notes SET archived_at = unixepoch() WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL`,
    ).bind(note.ref).run()
  }
  for (const ref of [...new Set(subtree.filter((n) => n.kind === 'table' && n.ref).map((n) => n.ref!))]) {
    const liveElsewhere = nodes.some((n) => n.kind === 'table' && n.ref === ref && !idSet.has(n.id))
    if (!liveElsewhere) {
      await db.prepare(
        `UPDATE _meta SET archived_at = unixepoch() WHERE table_name = ? AND archived_at IS NULL`,
      ).bind(ref).run()
    }
  }
  return { folder, nodes: subtree }
}

/** Tables and notes inside selected folders, including nested folders. */
export async function getFolderScopedAccess(
  db: AppDatabase,
  teamId: number | undefined,
  groupIds: number[],
): Promise<{ tableNames: string[]; noteIds: string[]; folderGroupIds: number[] }> {
  if (groupIds.length === 0) {
    return { tableNames: [], noteIds: [], folderGroupIds: [] }
  }
  const nodes = await listWorkspaceNodes(db, teamId)
  const byParent = new Map<string | null, typeof nodes>()
  for (const n of nodes) {
    const arr = byParent.get(n.parent_id) ?? []
    arr.push(n)
    byParent.set(n.parent_id, arr)
  }
  const selected = new Set(
    nodes.filter((n) => n.kind === 'folder' && n.group_id !== null && groupIds.includes(n.group_id)).map((n) => n.id),
  )
  const queue = [...selected]
  const seen = new Set<string>(queue)
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const child of byParent.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      if (child.kind === 'folder') queue.push(child.id)
    }
  }
  const tableNames = new Set<string>()
  const noteIds = new Set<string>()
  const folderGroupIds = new Set<number>(groupIds)
  for (const n of nodes) {
    if (!seen.has(n.id)) continue
    if (n.kind === 'folder' && n.group_id != null) folderGroupIds.add(n.group_id)
    if (n.kind === 'table' && n.ref) tableNames.add(n.ref)
    if (n.kind === 'note' && n.ref) noteIds.add(n.ref)
  }
  if (folderGroupIds.size > 0) {
    const placeholders = [...folderGroupIds].map(() => '?').join(',')
    const extra = await db.prepare(
      `SELECT DISTINCT table_name FROM _group_tables WHERE group_id IN (${placeholders})`,
    ).bind(...folderGroupIds).all<{ table_name: string }>()
    for (const row of extra.results) tableNames.add(row.table_name)
  }
  return {
    tableNames: [...tableNames],
    noteIds: [...noteIds],
    folderGroupIds: [...folderGroupIds],
  }
}

export function filterVisibleNodes(
  nodes: WorkspaceNode[],
  allowedTables: string[] | null,
  allowedNoteIds: Set<string> | null,
  allowedGroupIds: number[] | null = null,
): WorkspaceNode[] {
  return nodes.filter((n) => {
    if (n.kind === 'folder') {
      if (allowedGroupIds === null) return true
      return n.group_id != null && allowedGroupIds.includes(n.group_id)
    }
    if (n.kind === 'table') {
      if (!n.ref) return false
      return allowedTables === null || allowedTables.includes(n.ref)
    }
    if (!n.ref) return false
    return allowedNoteIds === null || allowedNoteIds.has(n.ref)
  })
}
