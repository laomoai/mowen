import axios from 'axios'

export const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true,
})

http.interceptors.response.use(
  (res) => res,
  (err) => {
    // 401: 未登录，跳转登录页
    if (err.response?.status === 401) {
      const path = window.location.pathname
      const reqUrl = String(err.config?.url || '')
      const isAuthProbe = reqUrl.includes('/auth/me')
      if (!isAuthProbe && path !== '/login' && path !== '/reset-password') {
        window.location.href = '/login'
      }
    }
    const msg = err.response?.data?.error?.message ?? err.message
    return Promise.reject(new Error(msg))
  }
)

// ── 类型定义 ──────────────────────────────────────────────────

export type FieldType = 'text' | 'longtext' | 'number' | 'currency' | 'percent' | 'email' | 'url' | 'date' | 'datetime' | 'checkbox' | 'select' | 'image' | 'note' | 'link' | 'totp' | 'password'

export interface LinkValue {
  id: string
  title: string
}

export interface ImageValue {
  thumb: string    // storage key，如 images/uuid/thumb.webp
  display: string  // storage key，如 images/uuid/display.webp
  name: string     // 原始文件名
  size: number     // display 文件大小（字节）
}

export interface SelectOption {
  id?: string
  value: string
  label: string
  color: string
}

export interface FieldMeta {
  column_name: string
  title: string
  field_type: FieldType
  select_options: SelectOption[] | null
  order_index: number
  width: number
  is_hidden: boolean
  nullable: boolean
  isPrimaryKey: boolean
  defaultValue: string | null
  sqliteType: string
}

export interface GroupInfo {
  id: number
  name: string
}

export interface TableMeta {
  name: string
  title: string | null
  row_count: number | null
  groups: GroupInfo[]
  icon: string | null
  is_locked: boolean
}

export interface Group {
  id: number
  name: string
  sort_order: number
  created_at: number
  tables: string[]
}

export interface ColumnDef {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  defaultValue: string | null
}

export interface RecordRow {
  id: number
  [key: string]: unknown
}

export interface PageResult {
  data: RecordRow[]
  meta: {
    page_size: number
    count: number
    next_cursor: string | null
  }
}

export interface RecordQuery {
  page_size?: number
  page?: number
  cursor?: string
  sort?: string          // 格式：field:asc
  fields?: string
  [key: string]: string | number | undefined  // filter[field]=value
}

// ── API 方法 ──────────────────────────────────────────────────

export const api = {
  /** 获取所有表 */
  getTables: () =>
    http.get<{ data: TableMeta[] }>('/tables').then((r) => r.data.data),

  getArchivedTables: () =>
    http.get<{ data: TableMeta[] }>('/tables', { params: { archived: 1 } }).then((r) => r.data.data),

  archiveTable: (tableName: string) =>
    http.post<{ data: { success: boolean } }>(`/tables/${tableName}/archive`).then((r) => r.data.data),

  unarchiveTable: (tableName: string) =>
    http.post<{ data: { success: boolean } }>(`/tables/${tableName}/unarchive`).then((r) => r.data.data),

  /** 获取表结构 */
  getTableSchema: (tableName: string) =>
    http.get<{ data: { name: string; columns: ColumnDef[]; is_locked?: boolean; archived_at?: number | null; title?: string; icon?: string | null } }>(`/tables/${tableName}`).then((r) => r.data.data),

  /** 查询记录（分页） */
  getRecords: (tableName: string, query: RecordQuery = {}) =>
    http.get<PageResult>(`/tables/${tableName}/records`, { params: query }).then((r) => r.data),

  /** 导出表数据 */
  exportRecords: (tableName: string, params: Omit<RecordQuery, 'page' | 'page_size' | 'cursor'> & { format: 'csv' | 'json' }) =>
    http.get(`/tables/${tableName}/export`, { params, responseType: 'blob' }).then((r) => r.data as Blob),

  /** 查询单条记录 */
  getRecord: (tableName: string, id: number) =>
    http.get<{ data: RecordRow }>(`/tables/${tableName}/records/${id}`).then((r) => r.data.data),

  /** 新增记录 */
  createRecord: (tableName: string, data: Record<string, unknown>) =>
    http.post<{ data: RecordRow }>(`/tables/${tableName}/records`, data).then((r) => r.data.data),

  /** 更新记录 */
  updateRecord: (tableName: string, id: number, data: Record<string, unknown>) =>
    http.patch<{ data: { success: boolean; id: number } }>(`/tables/${tableName}/records/${id}`, data).then((r) => r.data.data),

  /** 删除记录 */
  deleteRecord: (tableName: string, id: number) =>
    http.delete(`/tables/${tableName}/records/${id}`),

  /** 搜索记录（用于 link 字段选择器）*/
  searchRecords: (tableName: string, q?: string, limit?: number, displayField?: string) =>
    http.get<{ data: LinkValue[] }>(`/tables/${tableName}/records/search`, { params: { q, limit, display_field: displayField } }).then((r) => r.data.data),

  /** 字段元数据 */
  getFieldMeta: (tableName: string) =>
    http.get<{ data: FieldMeta[] }>(`/tables/${tableName}/fields`).then((r) => r.data.data),

  updateFieldMeta: (tableName: string, colName: string, patch: Partial<Pick<FieldMeta, 'title' | 'field_type' | 'select_options' | 'width' | 'is_hidden' | 'order_index'>>) =>
    http.patch<{ data: { success: boolean } }>(`/tables/${tableName}/fields/${colName}`, patch).then((r) => r.data.data),

  addField: (tableName: string, data: { title: string; column_name?: string; field_type: FieldType; nullable?: boolean; default_value?: string; select_options?: SelectOption[]; link_table?: string; link_display_field?: string }) =>
    http.post<{ data: { column_name: string; title: string; field_type: string } }>(`/tables/${tableName}/fields`, data).then((r) => r.data.data),

  deleteField: (tableName: string, colName: string) =>
    http.delete(`/tables/${tableName}/fields/${colName}`),

  /** 更新表显示名 */
  updateTableTitle: (tableName: string, title: string) =>
    http.patch<{ data: { success: boolean } }>(`/tables/${tableName}`, { title }).then((r) => r.data.data),

  /** 更新表图标 */
  updateTableIcon: (tableName: string, icon: string | null) =>
    http.patch<{ data: { success: boolean } }>(`/tables/${tableName}`, { icon }).then((r) => r.data.data),

  /** 切换表锁定状态 */
  setTableLocked: (tableName: string, isLocked: boolean) =>
    http.patch<{ data: { success: boolean } }>(`/tables/${tableName}`, { is_locked: isLocked }).then((r) => r.data.data),

  /** 删除表 */
  deleteTable: (tableName: string) =>
    http.delete(`/tables/${tableName}`),

  /** API Key 管理 */
  getKeys: () =>
    http.get<{ data: ApiKeyInfo[] }>('/admin/keys').then((r) => r.data.data),
  createKey: (data: { name: string; type: 'readonly' | 'readwrite'; scope?: 'all' | 'groups'; group_ids?: number[]; notes_scope?: 'all' | 'none' | 'roots'; note_root_ids?: string[] }) =>
    http.post<{ data: { key: string; key_prefix: string; name: string; type: string; scope: string; notes_scope: string; group_ids: number[]; note_root_ids: string[] } }>('/admin/keys', data).then((r) => r.data),
  updateKey: (id: number, data: { scope?: 'all' | 'groups'; group_ids?: number[]; notes_scope?: 'all' | 'none' | 'roots'; note_root_ids?: string[] }) =>
    http.patch<{ data: { success: boolean } }>(`/admin/keys/${id}`, data).then((r) => r.data.data),
  revokeKey: (id: number) =>
    http.delete(`/admin/keys/${id}`),
  deleteKey: (id: number) =>
    http.delete(`/admin/keys/${id}/permanent`),

  /** 图片上传 */
  uploadImage: async (
    thumb: Blob,
    display: Blob,
    name: string,
    ref?: { kind?: 'table' | 'note' | 'none'; id?: string | null },
  ): Promise<ImageValue> => {
    const form = new FormData()
    form.append('thumb', thumb, 'thumb.webp')
    form.append('display', display, 'display.webp')
    form.append('name', name)
    if (ref?.kind) form.append('ref_kind', ref.kind)
    if (ref?.id) form.append('ref_id', ref.id)
    const res = await http.post<{ data: ImageValue }>('/upload/image', form)
    return res.data.data
  },

  deleteImage: (thumb: string, display: string): Promise<void> =>
    http.delete('/upload/image', { data: { thumb, display } }).then(() => {}),
  fileStats: () =>
    http.get<{ data: {
      total: number
      orphan: number
      bytes: number
      orphan_bytes: number
      used_bytes: number
      orphan_after_hours: number
    } }>('/upload/files/stats').then((r) => r.data.data),
  sweepFiles: () =>
    http.post<{ data: { deleted: number } }>('/upload/files/sweep').then((r) => r.data.data),

  /** 回收站 */
  getTrash: (params?: { page?: number; page_size?: number }) =>
    http.get<{ data: TrashItem[]; meta: { total: number; page: number; page_size: number } }>('/trash', { params }).then((r) => r.data),
  restoreTrash: (id: number) =>
    http.post<{ data: { success: boolean } }>(`/trash/${id}/restore`).then((r) => r.data.data),
  deleteTrash: (id: number) =>
    http.delete(`/trash/${id}`),
  emptyTrash: () =>
    http.delete('/trash'),

  /** Dashboard 配置 */
  getDashboard: (tableName: string) =>
    http.get<{ data: { config: unknown[] } }>(`/tables/${tableName}/dashboard`).then(r => r.data.data.config),
  saveDashboard: (tableName: string, config: unknown[]) =>
    http.put<{ data: { success: boolean } }>(`/tables/${tableName}/dashboard`, { config }).then(r => r.data.data),

  /** 用户偏好设置 */
  getPreferences: () =>
    http.get<{ data: Record<string, unknown> }>('/user/preferences').then(r => r.data.data),
  savePreferences: (data: Record<string, unknown>) =>
    http.put<{ data: { success: boolean } }>('/user/preferences', data).then(r => r.data.data),

  /** 分组管理 */
  getGroups: () =>
    http.get<{ data: Group[] }>('/groups').then((r) => r.data.data),
  createGroup: (name: string, sort_order?: number) =>
    http.post<{ data: { id: number; name: string } }>('/groups', { name, sort_order }).then((r) => r.data.data),
  updateGroup: (id: number, data: { name?: string; sort_order?: number }) =>
    http.patch<{ data: { success: boolean } }>(`/groups/${id}`, data).then((r) => r.data.data),
  deleteGroup: (id: number) =>
    http.delete(`/groups/${id}`),
  setGroupTables: (id: number, tables: string[]) =>
    http.put<{ data: { success: boolean } }>(`/groups/${id}/tables`, { tables }).then((r) => r.data.data),
}

export interface TrashItem {
  id: number
  table_name: string
  record_id: number
  record_data: Record<string, unknown>
  deleted_at: string
  expires_at: string
}

export interface ApiKeyInfo {
  id: number
  key_prefix: string
  key_plain?: string | null
  name: string
  type: 'readonly' | 'readwrite'
  scope: 'all' | 'groups'
  notes_scope: 'all' | 'none' | 'roots'
  created_at: number
  is_active: number
  last_used_at: number | null
  groups: GroupInfo[]
  note_roots: Array<{ id: string; title: string }>
}

export interface TeamInfo {
  id: number
  name: string
  role?: 'owner' | 'admin' | 'member' | 'viewer'
}

export interface CurrentUser {
  id: number
  email: string
  name: string
  picture: string
  role: 'admin' | 'user'
  team: TeamInfo | null
  current_team?: TeamInfo | null
  spaces?: TeamInfo[]
}

export interface UserInfo {
  id: number
  email: string
  name: string
  picture: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  created_at: number
  last_login: number | null
  team_id: number | null
  current_team_id?: number | null
  team_name: string | null
  spaces?: TeamInfo[]
}

export interface TeamMember {
  id: number
  email: string
  name: string
  picture: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  last_login: number | null
  space_role?: 'owner' | 'admin' | 'member' | 'viewer'
  joined_at?: number
}

export interface TeamDetail {
  id: number
  name: string
  created_by: number | null
  created_at: number
  members: TeamMember[]
}

export interface TeamInvite {
  id: number
  role: 'owner' | 'admin' | 'member' | 'viewer'
  max_uses: number | null
  used_count: number
  expires_at: number | null
  created_at: number
  revoked_at: number | null
}

export interface CreatedInvite {
  id: number
  code: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  max_uses: number | null
  expires_at: number | null
}

// ── Notes 类型定义 ──────────────────────────────────────────────────

export interface Note {
  id: string
  title: string
  content: string
  icon: string | null
  parent_id: string | null
  sort_order: number
  is_locked: number
  created_by: number | null
  owner_id: number | null
  created_at: number
  updated_at: number
  cover: string | null
  description: string | null
  archived_at: number | null
}

export type NoteListItem = Omit<Note, 'content' | 'owner_id'>

export interface NoteCreate {
  title?: string
  content?: string
  parent_id?: string
  folder_id?: string | null
}

export type WorkspaceKind = 'folder' | 'table' | 'note'

export interface WorkspaceNode {
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

export type ArchivedFolder = {
  id: string
  title: string
  archived_at: number
  table_count: number
  note_count: number
}

export type TableDraft = {
  action?: 'create_table' | 'add_fields' | 'create_note'
  table_name?: string
  title?: string
  content?: string
  folder_title?: string
  folder_id?: string | null
  create_folder?: boolean
  fields?: Array<{ title: string; field_type: string; options?: string[] }>
  note?: string
}

export type AssistantStep = { name: string; label: string }

export type AssistantTopic = { id: string; title: string; created_at: number }

export const assistantApi = {
  thread: () =>
    http.get<{ data: {
      thread_id: string
      title: string
      summary: string
      messages: Array<{ role: 'user' | 'assistant'; content: string; draft?: TableDraft; steps?: AssistantStep[]; topic?: string; done?: boolean; created_at?: number; id?: string }>
      topics: AssistantTopic[]
    } }>('/assistant/thread').then((r) => r.data.data),
  chat: (
    content: string,
    context?: { table?: string | null; table_title?: string | null; note?: string | null; note_title?: string | null },
  ) =>
    http.post<{ data: { reply: string; draft: TableDraft | null; steps?: AssistantStep[]; mutated?: boolean; topic?: string } }>('/assistant/chat', { content, context }, { timeout: 90000 })
      .then((r) => r.data.data),
  confirm: (draft: TableDraft) =>
    http.post<{ data: { name: string; title: string; folder_id: string | null; action?: string; added?: string[] } }>('/assistant/confirm', { draft })
      .then((r) => r.data.data),
}

export const workspaceApi = {
  getTree: () =>
    http.get<{ data: WorkspaceNode[] }>('/workspace/tree').then(r => r.data.data),
  createFolder: (data: { title: string; parent_id?: string | null }) =>
    http.post<{ data: WorkspaceNode }>('/workspace/folders', data).then(r => r.data.data),
  renameFolder: (id: string, title: string) =>
    http.patch(`/workspace/folders/${id}`, { title }),
  updateFolderIcon: (id: string, icon: string | null) =>
    http.patch(`/workspace/folders/${id}`, { icon }),
  deleteFolder: (id: string) =>
    http.delete(`/workspace/folders/${id}`),
  move: (data: { id: string; parent_id: string | null; sort_order?: number }) =>
    http.post('/workspace/move', data),
  archiveFolder: (id: string) =>
    http.post<{ data: { success: boolean; table_count: number; note_count: number } }>(`/workspace/folders/${id}/archive`).then(r => r.data.data),
  unarchiveFolder: (id: string) =>
    http.post<{ data: { success: boolean } }>(`/workspace/folders/${id}/unarchive`).then(r => r.data.data),
  listArchivedFolders: () =>
    http.get<{ data: ArchivedFolder[] }>('/workspace/archived').then(r => r.data.data),
  getArchivedFolder: (id: string) =>
    http.get<{ data: { folder: WorkspaceNode; nodes: WorkspaceNode[] } }>(`/workspace/archived/${id}`).then(r => r.data.data),
}

export interface NoteUpdate {
  title?: string
  content?: string
  icon?: string | null
  parent_id?: string | null
  sort_order?: number
  is_locked?: boolean
  cover?: string | null
  description?: string | null
}

export interface ArchivedRoot {
  id: string
  title: string
  icon: string | null
  cover: string | null
  description: string | null
  archived_count: number
  created_at: number
  updated_at: number
}

export interface ArchivedChild {
  id: string
  title: string
  icon: string | null
  parent_id: string | null
  archived_at: number | null
  sort_order: number
  created_at: number
  updated_at: number
}

export const notesApi = {
  /** 获取笔记列表 */
  getNotes: (params?: { parent_id?: string }) =>
    http.get<{ data: NoteListItem[] }>('/notes', { params }).then(r => r.data.data),

  /** 获取笔记树（独立笔记） */
  getTree: () =>
    http.get<{ data: NoteListItem[] }>('/notes/tree').then(r => r.data.data),

  /** 获取单个笔记（含 content） */
  getNote: (id: string) =>
    http.get<{ data: Note }>(`/notes/${id}`).then(r => r.data.data),

  /** 创建笔记 */
  createNote: (data: NoteCreate) =>
    http.post<{ data: { id: string; title: string } }>('/notes', data).then(r => r.data.data),

  /** 更新笔记 */
  updateNote: (id: string, data: NoteUpdate) =>
    http.patch<{ data: { success: boolean } }>(`/notes/${id}`, data).then(r => r.data.data),

  /** 删除笔记（软删除） */
  deleteNote: (id: string) =>
    http.delete(`/notes/${id}`),

  /** 恢复已删除的笔记 */
  restoreNote: (id: string) =>
    http.post<{ data: { success: boolean } }>(`/notes/${id}/restore`).then(r => r.data.data),

  /** 永久删除（仅限已软删的笔记） */
  permanentDeleteNote: (id: string) =>
    http.delete(`/notes/${id}/permanent`),

  /** 获取已删除的笔记 */
  getTrash: (params?: { page?: number; page_size?: number }) =>
    http.get<{ data: { id: string; title: string; icon: string | null; deleted_at: number }[]; meta: { total: number; page: number; page_size: number } }>('/notes/trash', { params }).then(r => r.data),

  /** 归档笔记（连带子笔记） */
  archiveNote: (id: string) =>
    http.post<{ data: { success: boolean; archived_count: number } }>(`/notes/${id}/archive`).then(r => r.data.data),

  /** 取消归档 */
  unarchiveNote: (id: string) =>
    http.post<{ data: { success: boolean } }>(`/notes/${id}/unarchive`).then(r => r.data.data),

  /** 批量归档 */
  batchArchive: (ids: string[]) =>
    http.post<{ data: { success: boolean; archived_count: number } }>('/notes/batch-archive', { ids }).then(r => r.data.data),

  /** 获取已归档的根笔记列表 */
  getArchivedRoots: (params?: { q?: string }) =>
    http.get<{ data: ArchivedRoot[] }>('/notes/archived', { params }).then(r => r.data.data),

  /** 获取某根笔记下的已归档子笔记 */
  getArchivedChildren: (rootId: string) =>
    http.get<{ data: ArchivedChild[] }>(`/notes/${rootId}/archived-children`).then(r => r.data.data),
}

export function avatarUrl(picture: string | null | undefined, email: string): string {
  const value = picture?.trim() ?? ''
  if (value && !value.includes('/api/avatars/')) return value
  return `/api/avatars/${encodeURIComponent((email || 'user').trim().toLowerCase())}?v=color`
}

export const getCurrentUser = (): Promise<CurrentUser> =>
  http.get<{ data: CurrentUser }>('/auth/me').then((r) => r.data.data)

export const switchSpace = (team_id: number): Promise<{ current_team: TeamInfo }> =>
  http.post<{ data: { current_team: TeamInfo } }>('/auth/switch-space', { team_id }).then((r) => r.data.data)

export const joinSpace = (invite_code: string): Promise<{ current_team: TeamInfo }> =>
  http.post<{ data: { current_team: TeamInfo } }>('/auth/join', { invite_code }).then((r) => r.data.data)

export const changePassword = (current_password: string, new_password: string) =>
  http.post<{ data: { success: boolean } }>('/auth/change-password', { current_password, new_password }).then((r) => r.data.data)

export const userApi = {
  getUsers: () =>
    http.get<{ data: UserInfo[] }>('/admin/users').then(r => r.data.data),
  addUser: (data: { email: string; name?: string; role?: 'admin' | 'user' }) =>
    http.post<{ data: UserInfo }>('/admin/users', data).then(r => r.data.data),
  updateUser: (id: number, data: { role?: string; status?: string }) =>
    http.patch<{ data: { success: boolean } }>(`/admin/users/${id}`, data).then(r => r.data.data),
  disableUser: (id: number) =>
    http.delete(`/admin/users/${id}`),
}

export const teamApi = {
  getSpaces: () =>
    http.get<{ data: TeamInfo[] }>('/teams').then(r => r.data.data),
  createSpace: (name: string) =>
    http.post<{ data: TeamInfo }>('/teams', { name }).then(r => r.data.data),
  getTeamInfo: () =>
    http.get<{ data: TeamDetail }>('/teams/current').then(r => r.data.data),
  renameTeam: (name: string) =>
    http.patch<{ data: { success: boolean } }>('/teams/current', { name }).then(r => r.data.data),
  addMember: (email: string) =>
    http.post<{ data: { id: number; email: string; mail_sent?: boolean; existing_user?: boolean }; error?: { message: string } }>('/teams/current/members', { email }).then(r => r.data),
  resendInvite: (userId: number) =>
    http.post<{ data: { success: boolean } }>(`/teams/current/members/${userId}/invite`).then(r => r.data.data),
  removeMember: (userId: number) =>
    http.delete(`/teams/current/members/${userId}`),
  listInvites: () =>
    http.get<{ data: TeamInvite[] }>('/teams/current/invites').then(r => r.data.data),
  createInvite: (data: { role?: 'admin' | 'member' | 'viewer'; max_uses?: number | null; expires_in_days?: number | null }) =>
    http.post<{ data: CreatedInvite }>('/teams/current/invites', data).then(r => r.data.data),
  revokeInvite: (id: number) =>
    http.delete(`/teams/current/invites/${id}`),
}

// ── Administration (Space 管理) ──────────────────────────────

export interface SpaceSummary {
  id: number
  name: string
  created_by: number | null
  created_at: number
  owner_email: string | null
  member_count: number
  table_count: number
  note_count: number
}

export interface SpaceDetail {
  id: number
  name: string
  created_by: number | null
  created_at: number
  owner_email: string | null
  members: TeamMember[]
}

export const administrationApi = {
  getSpaces: () =>
    http.get<{ data: SpaceSummary[] }>('/admin/spaces').then(r => r.data.data),
  createSpace: (data: { name: string; owner_email: string }) =>
    http.post<{ data: { id: number; name: string; owner_email: string; owner_id: number } }>('/admin/spaces', data).then(r => r.data.data),
  getSpace: (id: number) =>
    http.get<{ data: SpaceDetail }>(`/admin/spaces/${id}`).then(r => r.data.data),
  renameSpace: (id: number, name: string) =>
    http.patch<{ data: { success: boolean } }>(`/admin/spaces/${id}`, { name }).then(r => r.data.data),
  addMember: (spaceId: number, email: string) =>
    http.post<{ data: { id: number; email: string; existing_user?: boolean } }>(`/admin/spaces/${spaceId}/members`, { email }).then(r => r.data.data),
  removeMember: (spaceId: number, userId: number) =>
    http.delete(`/admin/spaces/${spaceId}/members/${userId}`),
  deleteSpace: (id: number, confirmName: string) =>
    http.post(`/admin/spaces/${id}/delete`, { confirm_name: confirmName }),
}
