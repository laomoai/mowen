import { Hono } from 'hono'
import type { AuthVariables, Env } from '../types'
import { requireWriteMiddleware } from '../middleware/auth'
import { canAccessNote, getAccessibleNoteIds } from '../utils/note-access'
import {
  backfillMissingGroupFolders,
  backfillTableFolderParents,
  canonicalNodeId,
  createFolder,
  deleteEmptyFolder,
  filterVisibleNodes,
  expandTablesAcrossFolders,
  getNode,
  listWorkspaceNodes,
  moveNode,
  renameFolder,
  updateFolderIcon,
  archiveFolder,
  unarchiveFolder,
  listArchivedFolders,
  getArchivedFolderTree,
} from '../utils/workspace'

const workspace = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

workspace.get('/tree', async (c) => {
  await backfillMissingGroupFolders(c.env.DB, c.get('teamId'))
  await backfillTableFolderParents(c.env.DB, c.get('teamId'))
  const rawNodes = await listWorkspaceNodes(c.env.DB, c.get('teamId'))
  const nodes = await expandTablesAcrossFolders(c.env.DB, c.get('teamId'), rawNodes)
  const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, c.get('teamId'), c.get('allowedNoteRootIds'))
  const visible = filterVisibleNodes(
    nodes,
    c.get('allowedTables') ?? null,
    allowedNoteIds,
    c.get('allowedGroupIds') ?? null,
  )
  return c.json({ data: visible })
})

workspace.post('/folders', requireWriteMiddleware, async (c) => {
  if (c.get('allowedGroupIds') !== null && c.get('allowedGroupIds') !== undefined) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Scoped API keys cannot create folders' } }, 403)
  }
  const body = await c.req.json<{ title?: string; parent_id?: string | null }>()
    .catch(() => ({} as { title?: string; parent_id?: string | null }))
  try {
    const node = await createFolder(c.env.DB, {
      title: body.title ?? '',
      parentId: body.parent_id,
      teamId: c.get('teamId'),
      ownerId: c.get('userId') ?? null,
    })
    return c.json({ data: node }, 201)
  } catch (err) {
    return workspaceError(c, err)
  }
})

workspace.patch('/folders/:id', requireWriteMiddleware, async (c) => {
  const body = await c.req.json<{ title?: string; icon?: string | null }>()
    .catch(() => ({} as { title?: string; icon?: string | null }))
  try {
    if (body.title !== undefined) {
      await renameFolder(c.env.DB, c.req.param('id'), body.title, c.get('teamId'))
    }
    if ('icon' in body) {
      await updateFolderIcon(c.env.DB, c.req.param('id'), body.icon ?? null, c.get('teamId'))
    }
    if (body.title === undefined && !('icon' in body)) {
      return c.json({ error: { code: 'INVALID_BODY', message: 'Nothing to update' } }, 400)
    }
    return c.json({ data: { success: true } })
  } catch (err) {
    return workspaceError(c, err)
  }
})

workspace.delete('/folders/:id', requireWriteMiddleware, async (c) => {
  try {
    await deleteEmptyFolder(c.env.DB, c.req.param('id'), c.get('teamId'))
    return c.json({ data: { success: true } })
  } catch (err) {
    return workspaceError(c, err)
  }
})

workspace.get('/archived', async (c) => {
  const folders = await listArchivedFolders(c.env.DB, c.get('teamId'))
  return c.json({ data: folders })
})

workspace.get('/archived/:id', async (c) => {
  try {
    const data = await getArchivedFolderTree(c.env.DB, c.req.param('id'), c.get('teamId'))
    return c.json({ data })
  } catch (err) {
    return workspaceError(c, err)
  }
})

workspace.post('/folders/:id/archive', requireWriteMiddleware, async (c) => {
  try {
    const counts = await archiveFolder(c.env.DB, c.req.param('id'), c.get('teamId'))
    return c.json({ data: { success: true, ...counts } })
  } catch (err) {
    return workspaceError(c, err)
  }
})

workspace.post('/folders/:id/unarchive', requireWriteMiddleware, async (c) => {
  try {
    await unarchiveFolder(c.env.DB, c.req.param('id'), c.get('teamId'))
    return c.json({ data: { success: true } })
  } catch (err) {
    return workspaceError(c, err)
  }
})

workspace.post('/move', requireWriteMiddleware, async (c) => {
  const body = await c.req.json<{ id?: string; parent_id?: string | null; sort_order?: number }>()
    .catch(() => ({} as { id?: string; parent_id?: string | null; sort_order?: number }))
  if (!body.id) {
    return c.json({ error: { code: 'INVALID_BODY', message: 'id is required' } }, 400)
  }
  const allowedGroupIds = c.get('allowedGroupIds')
  if (allowedGroupIds !== null && allowedGroupIds !== undefined) {
    const node = await getNode(c.env.DB, canonicalNodeId(body.id))
    if (!node || (c.get('teamId') !== undefined && node.team_id !== c.get('teamId'))) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Node not found' } }, 404)
    }
    if (node.kind === 'folder') {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Scoped API keys cannot move folders' } }, 403)
    }
    if (node.kind === 'table' && (!node.ref || !(c.get('allowedTables') ?? []).includes(node.ref))) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Access to this table is not allowed' } }, 403)
    }
    if (node.kind === 'note') {
      const allowedNoteIds = await getAccessibleNoteIds(c.env.DB, c.get('teamId'), c.get('allowedNoteRootIds'))
      if (!canAccessNote(allowedNoteIds, node.ref)) {
        return c.json({ error: { code: 'FORBIDDEN', message: 'Access to this note is not allowed' } }, 403)
      }
    }
    if (!body.parent_id) {
      return c.json({ error: { code: 'FOLDER_REQUIRED', message: 'Scoped API keys can only move nodes into allowed folders' } }, 400)
    }
    const target = await getNode(c.env.DB, canonicalNodeId(body.parent_id))
    if (!target || target.kind !== 'folder') {
      return c.json({ error: { code: 'INVALID_PARENT', message: 'Parent must be a folder' } }, 400)
    }
    if (c.get('teamId') !== undefined && target.team_id !== c.get('teamId')) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Folder not found' } }, 404)
    }
    if (target.group_id === null || !allowedGroupIds.includes(target.group_id)) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Cannot move nodes outside allowed folders' } }, 403)
    }
  }
  try {
    await moveNode(c.env.DB, {
      id: body.id,
      parentId: body.parent_id ?? null,
      sortOrder: body.sort_order,
      teamId: c.get('teamId'),
    })
    return c.json({ data: { success: true } })
  } catch (err) {
    return workspaceError(c, err)
  }
})

function workspaceError(c: { json: Function }, err: unknown) {
  const e = err as { status?: number; code?: string; message?: string }
  const status = (e.status === 400 || e.status === 404 || e.status === 409) ? e.status : 500
  if (status === 500) console.error('[workspace]', err)
  return c.json({ error: { code: e.code || 'INTERNAL', message: e.message || 'Workspace error' } }, status)
}

export default workspace
