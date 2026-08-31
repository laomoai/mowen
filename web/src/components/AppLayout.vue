<template>
  <div class="app-layout" :class="{ resizing: isResizing, narrow, 'drawer-open': drawerOpen }">
    <header v-if="narrow" class="mob-bar">
      <button type="button" class="mob-bar-btn" aria-label="工作区" @click="drawerOpen = !drawerOpen">☰</button>
      <span class="mob-bar-title">{{ mobileTitle }}</span>
      <button
        type="button"
        class="mob-bar-ai"
        :class="{ active: assistantOpen }"
        @click="assistantOpen = !assistantOpen"
      >AI</button>
    </header>
    <div v-if="narrow && drawerOpen" class="drawer-mask" @click="drawerOpen = false" />
    <!-- Sidebar -->
    <aside class="sidebar" :style="narrow ? undefined : { width: sidebarWidth + 'px' }">
      <div class="sidebar-header">
        <button type="button" class="logo-btn" @click="router.push('/')">
          <img src="/logo.svg" class="logo-img" alt="墨问" />
          <span class="logo">墨问</span>
        </button>
        <button
          v-if="!narrow"
          type="button"
          class="ai-launch"
          :class="{ active: assistantOpen }"
          title="AI 助手"
          @click.stop="assistantOpen = !assistantOpen"
        >
          <span class="ai-launch-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <defs>
                <linearGradient id="aiGrad" x1="2" y1="3" x2="22" y2="21" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#7C5CFF"/>
                  <stop offset="0.55" stop-color="#3B82F6"/>
                  <stop offset="1" stop-color="#22D3EE"/>
                </linearGradient>
              </defs>
              <path fill="url(#aiGrad)" d="M12 2.2l1.15 4.4c.3 1.14 1.2 2.04 2.34 2.34L20 10l-4.51 1.06c-1.14.3-2.04 1.2-2.34 2.34L12 17.8l-1.15-4.4c-.3-1.14-1.2-2.04-2.34-2.34L4 10l4.51-1.06c1.14-.3 2.04-1.2 2.34-2.34L12 2.2z"/>
              <circle cx="18.6" cy="5.2" r="1.35" fill="#F472B6"/>
              <circle cx="6.2" cy="17.6" r="1.05" fill="#22D3EE"/>
            </svg>
          </span>
          <span class="ai-launch-text">AI</span>
        </button>
      </div>

      <div v-if="currentUser?.spaces?.length && currentUser.spaces.length > 1" class="space-switcher">
        <select class="space-select" :value="currentSpaceId" @change="handleSwitchSpace">
          <option v-for="space in currentUser.spaces" :key="space.id" :value="space.id">
            {{ space.name }}
          </option>
        </select>
      </div>

      <div class="panel-header">
        <input v-model="workspaceSearch" class="panel-search-input" placeholder="搜索…" />
        <div v-if="!narrow" class="add-wrap" ref="addWrapRef">
          <button class="panel-add-btn" title="添加" @click="toggleAddMenu">+</button>
          <div v-if="showAddMenu" class="add-menu">
            <button @click="openFolderModal()">文件夹</button>
            <button @click="openCreateTable()">表格</button>
            <button @click="openNoteModal()">笔记</button>
          </div>
        </div>
      </div>

      <!-- Scrollable content area -->
      <div class="sidebar-scroll">
        <div class="table-list">
          <n-spin v-if="workspaceLoading" size="small" style="padding: 20px; display: flex; justify-content: center;" />
          <div v-else-if="workspaceRoots.length === 0" class="panel-empty">
            {{ workspaceSearch ? '没有匹配项' : '工作区是空的' }}
          </div>
          <WorkspaceTreeItem
            v-for="node in workspaceRoots"
            :key="`${node.id}:${node.parent_id || ''}`"
            :node="node"
            :children="workspaceChildrenMap.get(node.id) ?? []"
            :children-map="workspaceChildrenMap"
            :active-table="activeTable"
            :active-note-id="activeNoteId"
            :expanded-ids="expandedWorkspace"
            :item-style="tableItemStyle"
            :drop-target-id="wsDropState.id"
            :drop-position="wsDropState.position"
            :folder-options="folderOptions"
            @select="selectWorkspaceNode"
            @toggle="toggleWorkspaceFolder"
            @add-here="onAddHere"
            @add-in="onAddIn"
            @rename="openRenameModal"
            @move="onManageMove"
            @delete-folder="onDeleteFolder"
            @delete="onDeleteLeaf"
            @archive="onArchiveNode"
            @change-icon="openFolderIconPicker"
            @reorder="handleWorkspaceReorder"
            @update:drop-state="wsDropState = $event"
          />
        </div>

        <div
          class="kb-entry"
          :class="{ active: route.path.startsWith('/archive') || route.path.startsWith('/knowledge-base') }"
          @click="router.push('/archive')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span>归档</span>
          <span v-if="archivedFolders?.length" class="kb-badge">{{ archivedFolders.length }}</span>
        </div>
      </div>

      <!-- Footer -->
      <div class="sidebar-footer">
        <transition name="menu-slide">
          <div v-if="showUserMenu" class="user-menu" @click.stop>
            <div class="user-menu-item" @click.stop="handleMenuItem('settings')">
              <n-icon :component="SettingsIcon" size="16" />
              <span>设置</span>
            </div>
            <div v-if="currentUser?.role === 'admin'" class="user-menu-item" @click.stop="handleMenuItem('administration')">
              <n-icon :component="AdminIcon" size="16" />
              <span>管理后台</span>
            </div>
            <div class="user-menu-divider" />
            <div class="user-menu-item" @click.stop="handleMenuItem('logout')">
              <n-icon :component="LogoutIcon" size="16" />
              <span>退出登录</span>
            </div>
          </div>
        </transition>
        <div v-if="currentUser" class="user-trigger" @click="showUserMenu = !showUserMenu">
          <img
            :src="avatarUrl(currentUser.picture, currentUser.email)"
            class="user-avatar"
            referrerpolicy="no-referrer"
            :alt="currentUser.name"
          />
          <div class="user-details">
            <div class="user-name">{{ currentUser.name }}</div>
            <div class="user-email">{{ currentUser.email }}</div>
          </div>
          <span class="user-chevron">⋯</span>
        </div>
      </div>
    </aside>

    <!-- Resize handle -->
    <div
      v-if="!narrow"
      class="resize-handle"
      :class="{ active: isResizing }"
      @mousedown.prevent="startResize"
    />

    <!-- Main content area -->
    <main class="main-content">
      <router-view />
    </main>
    <AssistantPanel v-show="assistantOpen" v-model:open="assistantOpen" />

    <NotePreviewModal />
    <CreateTableModal v-model:show="showCreateTable" :folder-id="createTargetFolder" @created="onTableCreated" />
    <AppModal v-model:show="showFolderIconPicker" title="更换文件夹图标" width="360px" height="auto">
      <icon-picker :current-icon="folderIconTarget?.icon ?? null" @select="onFolderIconSelect" />
    </AppModal>
    <WorkspaceNameModal
      v-model:show="showNameModal"
      :title="nameModalTitle"
      :kicker="nameModalKind === 'note' ? '笔记' : '工作区'"
      :hint="nameModalHint"
      :placeholder="nameModalPlaceholder"
      :confirm-label="nameModalConfirm"
      :initial="folderModalInitial"
      @confirm="submitNameModal"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, reactive, onMounted, onUnmounted, watch, defineAsyncComponent } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { NIcon, NSpin, useMessage, useDialog } from 'naive-ui'
import {
  GridOutline as TableIcon,
  SettingsOutline as SettingsIcon,
  LogOutOutline as LogoutIcon,
  DocumentTextOutline as NotesIcon,
  ShieldCheckmarkOutline as AdminIcon,
} from '@vicons/ionicons5'
import { api, notesApi, http, avatarUrl, workspaceApi, switchSpace, getCurrentUser, type TableMeta, type NoteListItem, type WorkspaceNode } from '@/api/client'
import { refreshWorkspace, openWorkspaceNode } from '@/composables/workspaceNav'
import { useNarrow } from '@/composables/useNarrow'
import { ASSISTANT_ASK } from '@/composables/assistantAsk'
import { getCachedUser, resetAuthState } from '@/router'
import { registerClipboardToast } from '@/utils/clipboard'
import HoverTooltipText from './HoverTooltipText.vue'
import IonIcon from './IonIcon.vue'
import NoteTreeItem from './NoteTreeItem.vue'
import NotePreviewModal from './NotePreviewModal.vue'
import WorkspaceTreeItem from './WorkspaceTreeItem.vue'
import CreateTableModal from './CreateTableModal.vue'
import WorkspaceNameModal from './WorkspaceNameModal.vue'
import AssistantPanel from './AssistantPanel.vue'
import AppModal from './AppModal.vue'

const IconPicker = defineAsyncComponent(() => import('./IconPicker.vue'))

const message = useMessage()
const dialog = useDialog()
registerClipboardToast((content, opts) => message.success(content, opts))
const router = useRouter()
const route = useRoute()
const queryClient = useQueryClient()
const RECENT_KEY = 'd1table_recent_access'

const workspaceSearch = ref('')
const showAddMenu = ref(false)
const addWrapRef = ref<HTMLElement | null>(null)
const showCreateTable = ref(false)
const showNameModal = ref(false)
const nameModalKind = ref<'folder' | 'rename' | 'note'>('folder')
const folderModalInitial = ref('')
const renameTargetId = ref<string | null>(null)
const createTargetFolder = ref<string | null>(null)
const wsDropState = ref<{ id: string | null; position: 'above' | 'child' | null }>({ id: null, position: null })
const EXPANDED_WS_KEY = 'd1table_expanded_workspace'
const expandedWorkspace = reactive(new Set<string>(
  JSON.parse(localStorage.getItem(EXPANDED_WS_KEY) ?? '[]') as string[],
))

const { data: workspaceNodes, isLoading: workspaceLoading } = useQuery({
  queryKey: ['workspace'],
  queryFn: workspaceApi.getTree,
  refetchInterval: 10_000,
})

const workspaceChildrenMap = computed(() => {
  const map = new Map<string, WorkspaceNode[]>()
  const q = workspaceSearch.value.trim().toLowerCase()
  for (const n of workspaceNodes.value ?? []) {
    if (q && n.kind !== 'folder' && !n.title.toLowerCase().includes(q)) continue
    if (!n.parent_id) continue
    const arr = map.get(n.parent_id) ?? []
    arr.push(n)
    map.set(n.parent_id, arr)
  }
  return map
})

const workspaceRoots = computed(() => {
  const q = workspaceSearch.value.trim().toLowerCase()
  return (workspaceNodes.value ?? []).filter((n) => {
    if (n.parent_id) return false
    if (!q) return true
    if (n.kind === 'folder') return true
    return n.title.toLowerCase().includes(q)
  })
})

function saveExpandedWs() {
  localStorage.setItem(EXPANDED_WS_KEY, JSON.stringify([...expandedWorkspace]))
}

function toggleWorkspaceFolder(id: string) {
  if (expandedWorkspace.has(id)) expandedWorkspace.delete(id)
  else expandedWorkspace.add(id)
  saveExpandedWs()
}

function selectWorkspaceNode(node: WorkspaceNode) {
  openWorkspaceNode(router, node)
  drawerOpen.value = false
}

const folderOptions = computed(() =>
  (workspaceNodes.value ?? []).filter((n) => n.kind === 'folder').map((n) => ({ id: n.id, title: n.title })),
)

const nameModalTitle = computed(() => {
  if (nameModalKind.value === 'rename') return '重命名文件夹'
  if (nameModalKind.value === 'note') return '新建笔记'
  return '新建文件夹'
})
const nameModalHint = computed(() => {
  if (nameModalKind.value === 'note') return '命名后会打开编辑器。'
  return '文件夹只用来整理侧栏，本身没有独立页面。'
})
const nameModalPlaceholder = computed(() => (
  nameModalKind.value === 'note' ? '例如：会议记录' : '例如：客户、研究、归档'
))
const nameModalConfirm = computed(() => (nameModalKind.value === 'rename' ? '保存' : '创建'))

function toggleAddMenu() {
  showAddMenu.value = !showAddMenu.value
}

function onAddHere(folderId: string) {
  createTargetFolder.value = folderId
  showAddMenu.value = true
}

function onAddIn(payload: { folderId: string; kind: 'folder' | 'table' | 'note' }) {
  createTargetFolder.value = payload.folderId
  if (payload.kind === 'table') {
    openCreateTable()
    return
  }
  if (payload.kind === 'note') {
    openNoteModal()
    return
  }
  openFolderModal()
}

function openFolderModal() {
  showAddMenu.value = false
  nameModalKind.value = 'folder'
  folderModalInitial.value = ''
  renameTargetId.value = null
  showNameModal.value = true
}

function openNoteModal() {
  showAddMenu.value = false
  nameModalKind.value = 'note'
  folderModalInitial.value = ''
  showNameModal.value = true
}

const showFolderIconPicker = ref(false)
const folderIconTarget = ref<WorkspaceNode | null>(null)

function openFolderIconPicker(node: WorkspaceNode) {
  if (node.kind !== 'folder') return
  folderIconTarget.value = node
  showFolderIconPicker.value = true
}

async function onFolderIconSelect(icon: string | null) {
  if (!folderIconTarget.value) return
  showFolderIconPicker.value = false
  try {
    await workspaceApi.updateFolderIcon(folderIconTarget.value.id, icon)
    await refreshWorkspace(queryClient)
  } catch (err) {
    message.error((err as Error).message)
  }
  folderIconTarget.value = null
}

function openRenameModal(node: WorkspaceNode) {
  if (node.kind !== 'folder') return
  nameModalKind.value = 'rename'
  folderModalInitial.value = node.title
  renameTargetId.value = node.id
  showNameModal.value = true
}

async function submitNameModal(name: string) {
  try {
    if (nameModalKind.value === 'rename' && renameTargetId.value) {
      await workspaceApi.renameFolder(renameTargetId.value, name)
    } else if (nameModalKind.value === 'note') {
      const folderId = createTargetFolder.value
      const result = await notesApi.createNote({
        title: name,
        folder_id: folderId,
      })
      if (folderId) expandedWorkspace.add(folderId)
      saveExpandedWs()
      createTargetFolder.value = null
      showNameModal.value = false
      await refreshWorkspace(queryClient)
      router.push(`/notes/${result.id}`)
      return
    } else {
      const folder = await workspaceApi.createFolder({ title: name, parent_id: createTargetFolder.value })
      if (createTargetFolder.value) expandedWorkspace.add(createTargetFolder.value)
      if (folder?.id) expandedWorkspace.add(folder.id)
      saveExpandedWs()
      createTargetFolder.value = null
    }
    showNameModal.value = false
    await refreshWorkspace(queryClient)
  } catch (err) {
    message.error((err as Error).message)
  }
}

async function onManageMove(payload: { id: string; parent_id: string | null }) {
  try {
    await workspaceApi.move({ id: payload.id, parent_id: payload.parent_id })
    await refreshWorkspace(queryClient)
  } catch (err) {
    message.error((err as Error).message)
  }
}

function openCreateTable() {
  showAddMenu.value = false
  showCreateTable.value = true
}

async function onTableCreated(name: string) {
  if (createTargetFolder.value) {
    expandedWorkspace.add(createTargetFolder.value)
    saveExpandedWs()
  }
  createTargetFolder.value = null
  await refreshWorkspace(queryClient)
  router.push(`/tables/${name}`)
}

function onArchiveNode(node: WorkspaceNode) {
  if (node.kind !== 'folder') return
  dialog.warning({
    title: '归档整个文件夹',
    content: '文件夹里的表格和笔记会一起从侧栏收起，归档架中只读。需要时再整柜恢复。',
    positiveText: '归档',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await workspaceApi.archiveFolder(node.id)
        await refreshWorkspace(queryClient)
        queryClient.invalidateQueries({ queryKey: ['workspace', 'archived'] })
        message.success('已收入归档架')
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

function onDeleteLeaf(node: WorkspaceNode) {
  const ref = node.ref || (node.id.includes('::') ? node.id.slice(0, node.id.indexOf('::')) : node.id)
  const tableName = node.kind === 'table' ? (node.ref || ref.replace(/^wn_t_/, '')) : ''
  const noteId = node.kind === 'note' ? (node.ref || '') : ''
  if (node.kind === 'table' && !tableName) return
  if (node.kind === 'note' && !noteId) return

  dialog.warning({
    title: node.kind === 'table' ? '删除表格' : '删除笔记',
    content: node.kind === 'table'
      ? `删除「${node.title || '未命名'}」？整张表和记录会移到回收站。`
      : `删除「${node.title || '未命名'}」？笔记会移到回收站。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        if (node.kind === 'table') {
          await api.deleteTable(tableName)
          if (route.params.tableName === tableName) router.push('/')
        } else {
          await notesApi.deleteNote(noteId)
          if (route.params.noteId === noteId) router.push('/')
        }
        await refreshWorkspace(queryClient)
        queryClient.invalidateQueries({ queryKey: ['notes-trash'], exact: false })
        message.success(node.kind === 'table' ? '表格已移到回收站' : '笔记已移到回收站')
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

function onDeleteFolder(id: string) {
  dialog.warning({
    title: '删除文件夹',
    content: '只能删除空文件夹。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await workspaceApi.deleteFolder(id)
        await refreshWorkspace(queryClient)
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

async function handleWorkspaceReorder(payload: { dragId: string; dropId: string; mode: 'above' | 'child' }) {
  const nodes = workspaceNodes.value ?? []
  const drop = nodes.find((n) => n.id === payload.dropId)
  if (!drop) return
  const parentId = payload.mode === 'child' && drop.kind === 'folder' ? drop.id : drop.parent_id
  try {
    await workspaceApi.move({ id: payload.dragId, parent_id: parentId, sort_order: drop.sort_order })
    await refreshWorkspace(queryClient)
  } catch (err) {
    message.error((err as Error).message)
  }
}

function onGlobalPointerDown(e: PointerEvent) {
  const target = e.target as Node
  if (showAddMenu.value && addWrapRef.value && !addWrapRef.value.contains(target)) {
    showAddMenu.value = false
  }
}

onMounted(() => document.addEventListener('pointerdown', onGlobalPointerDown, true))
onUnmounted(() => document.removeEventListener('pointerdown', onGlobalPointerDown, true))

watch(() => route.path, () => { showAddMenu.value = false })

// ── Sidebar resize ──────────────────────────────────────────────
const SIDEBAR_WIDTH_KEY = 'd1table_sidebar_width'
const sidebarWidth = ref(parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '220'))
const isResizing = ref(false)

function startResize(e: MouseEvent) {
  isResizing.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value

  const onMouseMove = (ev: MouseEvent) => {
    sidebarWidth.value = Math.max(180, Math.min(480, startWidth + ev.clientX - startX))
  }
  const onMouseUp = () => {
    isResizing.value = false
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// ── Sidebar tab ─────────────────────────────────────────────────
const SIDEBAR_TAB_KEY = 'd1table_sidebar_tab'
const sidebarTab = ref<'tables' | 'notes'>(
  route.path.startsWith('/notes') ? 'notes'
    : route.path.startsWith('/tables') ? 'tables'
    : (localStorage.getItem(SIDEBAR_TAB_KEY) as 'tables' | 'notes') ?? 'tables'
)

watch(sidebarTab, (tab) => localStorage.setItem(SIDEBAR_TAB_KEY, tab))

watch(() => route.path, (path) => {
  if (path.startsWith('/notes')) sidebarTab.value = 'notes'
  else if (path.startsWith('/tables')) sidebarTab.value = 'tables'
})

// ── Tables ──────────────────────────────────────────────────────
const { data: tables } = useQuery({
  queryKey: ['tables'],
  queryFn: api.getTables,
})

const { data: groups } = useQuery({
  queryKey: ['groups'],
  queryFn: api.getGroups,
  retry: false,
})

const activeTable = computed(() => {
  const match = route.params.tableName
  return typeof match === 'string' ? match : null
})

// ── Group collapse（持久化到 localStorage）──────────────────────────
const EXPANDED_GROUPS_KEY = 'd1table_expanded_groups'

function loadExpandedGroups(): Set<number> {
  try {
    const raw = localStorage.getItem(EXPANDED_GROUPS_KEY)
    if (raw) return new Set(JSON.parse(raw) as number[])
  } catch { /* ignore */ }
  return new Set([-1])
}

const expandedGroups = reactive(loadExpandedGroups())

function savePreferencesToServer() {
  api.savePreferences({
    table_order: tableOrder.value,
    expanded_groups: [...expandedGroups],
    group_order: groupOrder.value,
  }).catch(() => { /* localStorage is the fallback */ })
}

onMounted(async () => {
  try {
    const prefs = await api.getPreferences()
    if (Array.isArray(prefs.table_order) && (prefs.table_order as string[]).length > 0) {
      tableOrder.value = prefs.table_order as string[]
      localStorage.setItem('d1table_table_order', JSON.stringify(prefs.table_order))
    }
    if (Array.isArray(prefs.expanded_groups)) {
      expandedGroups.clear()
      ;(prefs.expanded_groups as number[]).forEach(id => expandedGroups.add(id))
      localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify(prefs.expanded_groups))
    }
    if (Array.isArray(prefs.group_order) && (prefs.group_order as number[]).length > 0) {
      groupOrder.value = prefs.group_order as number[]
      localStorage.setItem('d1table_group_order', JSON.stringify(prefs.group_order))
    }
  } catch { /* fallback to localStorage values already loaded */ }
})

function toggleGroup(id: number) {
  if (expandedGroups.has(id)) expandedGroups.delete(id)
  else expandedGroups.add(id)
  localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...expandedGroups]))
  savePreferencesToServer()
}

// ── 分组排序 ────────────────────────────────────────────────────
const groupOrder = ref<number[]>(
  JSON.parse(localStorage.getItem('d1table_group_order') ?? 'null') ?? []
)

const draggedGroupId = ref<number | null>(null)

function onGroupDragStart(e: DragEvent, id: number) {
  draggedGroupId.value = id
  e.dataTransfer!.effectAllowed = 'move'
}

function onGroupDragOver(e: DragEvent) {
  e.dataTransfer!.dropEffect = 'move'
}

function onGroupDrop(e: DragEvent, targetId: number) {
  e.preventDefault()
  if (!draggedGroupId.value || draggedGroupId.value === targetId) return

  const currentOrder = groupedTables.value.map(g => g.id)
  const from = currentOrder.indexOf(draggedGroupId.value)
  const to = currentOrder.indexOf(targetId)
  if (from === -1 || to === -1) return

  currentOrder.splice(from, 1)
  currentOrder.splice(to, 0, draggedGroupId.value)

  groupOrder.value = currentOrder
  localStorage.setItem('d1table_group_order', JSON.stringify(currentOrder))
  draggedGroupId.value = null
  savePreferencesToServer()
}

function onGroupDragEnd() {
  draggedGroupId.value = null
}

function sortGroups<T extends { id: number }>(list: T[]): T[] {
  if (!groupOrder.value.length) return list
  const idx = (id: number) => {
    const i = groupOrder.value.indexOf(id)
    return i === -1 ? 9999 : i
  }
  return [...list].sort((a, b) => idx(a.id) - idx(b.id))
}

// Compute grouped table list
const groupedTables = computed(() => {
  if (!groups.value || !tables.value || groups.value.length === 0) return []

  const result = groups.value
    .filter(g => g.tables.length > 0)
    .map(g => {
      if (!expandedGroups.has(g.id) && !localStorage.getItem(EXPANDED_GROUPS_KEY)) {
        expandedGroups.add(g.id)
        localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...expandedGroups]))
      }
      return {
        id: g.id,
        name: g.name,
        tables: tables.value!.filter(t => g.tables.includes(t.name)),
      }
    })
    .filter(g => g.tables.length > 0)
  return sortGroups(result)
})

const ungroupedTables = computed(() => {
  if (!tables.value) return []
  if (!groups.value || groups.value.length === 0) return tables.value

  const groupedNames = new Set(groups.value.flatMap(g => g.tables))
  return tables.value.filter(t => !groupedNames.has(t.name))
})

function navigateToTable(name: string) {
  try {
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}') as Record<string, number>
    recent[name] = Date.now()
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    localStorage.setItem(RECENT_KEY, JSON.stringify({ [name]: Date.now() }))
  }
  router.push(`/tables/${name}`)
}

// ── Inline edit table display name ──────────────────────────────────────────
const editingTable = ref<string | null>(null)
const editTableTitle = ref('')
const tableEditInputRef = ref<HTMLInputElement>()

function startTableEdit(table: TableMeta) {
  editingTable.value = table.name
  editTableTitle.value = table.title || table.name
  nextTick(() => tableEditInputRef.value?.focus())
}

function cancelTableEdit() {
  editingTable.value = null
}

async function saveTableTitle(table: TableMeta) {
  const newTitle = editTableTitle.value.trim()
  if (!newTitle || newTitle === (table.title || table.name)) {
    cancelTableEdit()
    return
  }
  try {
    await api.updateTableTitle(table.name, newTitle)
    message.success('表格名称已更新')
    queryClient.invalidateQueries({ queryKey: ['tables'] })
  } catch (err) {
    message.error((err as Error).message)
  }
  cancelTableEdit()
}

// ── 拖拽排序 ────────────────────────────────────────────────────────
const tableOrder = ref<string[]>(
  JSON.parse(localStorage.getItem('d1table_table_order') ?? 'null') ?? []
)

function sortedTables(list: TableMeta[]) {
  if (!tableOrder.value.length) return list
  const idx = (name: string) => {
    const i = tableOrder.value.indexOf(name)
    return i === -1 ? 9999 : i
  }
  return [...list].sort((a, b) => idx(a.name) - idx(b.name))
}

const draggedTable = ref<string | null>(null)

function onDragStart(e: DragEvent, name: string) {
  draggedTable.value = name
  e.dataTransfer!.effectAllowed = 'move'
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
}

function onDrop(e: DragEvent, targetName: string) {
  e.preventDefault()
  if (!draggedTable.value || draggedTable.value === targetName) return

  const allTableNames = [
    ...groupedTables.value.flatMap(g => g.tables.map(t => t.name)),
    ...ungroupedTables.value.map(t => t.name),
  ]
  const order = tableOrder.value.length
    ? [...new Set([...tableOrder.value, ...allTableNames])]
    : [...allTableNames]

  const from = order.indexOf(draggedTable.value)
  const to = order.indexOf(targetName)
  if (from === -1 || to === -1) return

  order.splice(from, 1)
  order.splice(to, 0, draggedTable.value)

  tableOrder.value = order
  localStorage.setItem('d1table_table_order', JSON.stringify(order))
  draggedTable.value = null
  savePreferencesToServer()
}

function onDragEnd() {
  draggedTable.value = null
}

// ── 侧边栏外观偏好 ────────────────────────────────────────
const SIDEBAR_PREFS_KEY = 'd1table_sidebar_prefs'

function loadSidebarPrefs() {
  try {
    const raw = localStorage.getItem(SIDEBAR_PREFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

const sidebarPrefs = ref(loadSidebarPrefs())

function onStorageChange(e: StorageEvent) {
  if (e.key === SIDEBAR_PREFS_KEY) {
    sidebarPrefs.value = loadSidebarPrefs()
  }
}
window.addEventListener('storage', onStorageChange)
onUnmounted(() => window.removeEventListener('storage', onStorageChange))

const tableItemStyle = computed(() => ({
  fontSize: `${sidebarPrefs.value.fontSize ?? 14}px`,
  color: sidebarPrefs.value.textColor ?? '#37352f',
}))

const noteItemStyle = computed(() => ({
  fontSize: `${sidebarPrefs.value.fontSize ?? 14}px`,
  color: sidebarPrefs.value.textColor ?? '#37352f',
}))

const noteSearchStyle = computed(() => ({
  fontSize: `${Math.max(12, (sidebarPrefs.value.fontSize ?? 14) - 1)}px`,
  color: sidebarPrefs.value.textColor ?? '#37352f',
}))

// ── Notes tree ──────────────────────────────────────────────────
const { data: notesTree, isLoading: notesTreeLoading } = useQuery({
  queryKey: ['notes', 'tree'],
  queryFn: notesApi.getTree,
})

const { data: archivedFolders } = useQuery({
  queryKey: ['workspace', 'archived'],
  queryFn: () => workspaceApi.listArchivedFolders(),
})

const noteRootNotes = computed(() => (notesTree.value ?? []).filter(n => !n.parent_id))

const noteChildrenMap = computed(() => {
  const map = new Map<string, NoteListItem[]>()
  for (const n of notesTree.value ?? []) {
    if (n.parent_id) {
      const arr = map.get(n.parent_id) ?? []
      arr.push(n)
      map.set(n.parent_id, arr)
    }
  }
  return map
})

// Notes expanded folders persistence
const NOTE_EXPANDED_KEY = 'd1table_note_expanded'
function loadNoteExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTE_EXPANDED_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}
const noteExpandedFolders = ref(loadNoteExpanded())

function saveNoteExpanded() {
  localStorage.setItem(NOTE_EXPANDED_KEY, JSON.stringify([...noteExpandedFolders.value]))
}

function toggleNoteFolder(id: string) {
  if (noteExpandedFolders.value.has(id)) noteExpandedFolders.value.delete(id)
  else noteExpandedFolders.value.add(id)
  saveNoteExpanded()
}

// Notes search
const noteSearch = ref('')

const sidebarVisibleNoteIds = computed(() => {
  const query = noteSearch.value.trim().toLowerCase()
  if (!query) return null

  const notes = notesTree.value ?? []
  const byId = new Map(notes.map((note) => [note.id, note]))
  const visible = new Set<string>()

  for (const note of notes) {
    if (!note.title.toLowerCase().includes(query)) continue
    let current: NoteListItem | undefined = note
    while (current) {
      visible.add(current.id)
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }
  }

  return visible
})

const sidebarVisibleChildrenMap = computed(() => {
  const visibleIds = sidebarVisibleNoteIds.value
  if (!visibleIds) return noteChildrenMap.value

  const map = new Map<string, NoteListItem[]>()
  for (const [parentId, children] of noteChildrenMap.value.entries()) {
    const filteredChildren = children.filter((child) => visibleIds.has(child.id))
    if (filteredChildren.length > 0) {
      map.set(parentId, filteredChildren)
    }
  }
  return map
})

const sidebarVisibleRootNotes = computed(() => {
  const visibleIds = sidebarVisibleNoteIds.value
  if (!visibleIds) return noteRootNotes.value
  return noteRootNotes.value.filter((note) => visibleIds.has(note.id))
})

const sidebarExpandedNoteIds = computed(() => {
  if (!sidebarVisibleNoteIds.value) return noteExpandedFolders.value
  return new Set([...noteExpandedFolders.value, ...sidebarVisibleNoteIds.value])
})

// Active note from route
const activeNoteId = computed(() => {
  const id = route.params.noteId
  return typeof id === 'string' ? id : null
})

function selectNote(id: string) {
  router.push(`/notes/${id}`)
}

// Notes CRUD
async function createNewNote() {
  try {
    const result = await notesApi.createNote({ title: '未命名' })
    queryClient.invalidateQueries({ queryKey: ['notes', 'tree'] })
    router.push(`/notes/${result.id}`)
  } catch (err) {
    message.error((err as Error).message)
  }
}

function archiveNote(noteId: string) {
  dialog.warning({
    title: '归档笔记',
    content: '归档这篇笔记？可在归档架中恢复。',
    positiveText: '归档',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await notesApi.archiveNote(noteId)
        queryClient.invalidateQueries({ queryKey: ['notes', 'tree'] })
        queryClient.invalidateQueries({ queryKey: ['notes', 'archived-roots'] })
        if (route.params.noteId === noteId) {
          router.push('/')
        }
        message.success('笔记已归档', { duration: 3000 })
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

async function createChildNote(parentId: string) {
  try {
    const result = await notesApi.createNote({ title: '未命名', parent_id: parentId })
    queryClient.invalidateQueries({ queryKey: ['notes', 'tree'] })
    noteExpandedFolders.value.add(parentId)
    saveNoteExpanded()
    router.push(`/notes/${result.id}`)
  } catch (err) {
    message.error((err as Error).message)
  }
}

// Notes drag reorder
const noteDropState = ref<{ id: string | null; position: 'above' | 'child' | null }>({
  id: null, position: null,
})

async function handleNoteReorder({ dragId, dropId, mode }: { dragId: string; dropId: string; mode: 'above' | 'child' }) {
  const allNotes = notesTree.value ?? []
  const dropNote = allNotes.find(n => n.id === dropId)
  if (!dropNote) return

  try {
    if (mode === 'child') {
      await notesApi.updateNote(dragId, { parent_id: dropId, sort_order: 0 })
      noteExpandedFolders.value.add(dropId)
      saveNoteExpanded()
    } else {
      const siblings = allNotes
        .filter(n => n.parent_id === dropNote.parent_id)
        .sort((a, b) => a.sort_order - b.sort_order)
      const dropIndex = siblings.findIndex(n => n.id === dropId)
      const prevOrder = dropIndex > 0 ? siblings[dropIndex - 1].sort_order : dropNote.sort_order - 1000
      const gap = dropNote.sort_order - prevOrder

      if (gap <= 1) {
        for (let i = 0; i < siblings.length; i++) {
          if (siblings[i].id !== dragId) {
            await notesApi.updateNote(siblings[i].id, { sort_order: (i + 1) * 1000 })
          }
        }
        const newDropIndex = siblings.findIndex(n => n.id === dropId)
        const newOrder = newDropIndex > 0 ? newDropIndex * 1000 - 500 : 500
        await notesApi.updateNote(dragId, { sort_order: newOrder, parent_id: dropNote.parent_id ?? null })
      } else {
        const newOrder = Math.floor((prevOrder + dropNote.sort_order) / 2)
        await notesApi.updateNote(dragId, { sort_order: newOrder, parent_id: dropNote.parent_id ?? null })
      }
    }
    queryClient.invalidateQueries({ queryKey: ['notes', 'tree'] })
  } catch (err) {
    message.error((err as Error).message)
  }
}

// ── User menu ───────────────────────────────────────────────────
const currentUser = ref(getCachedUser())
const showUserMenu = ref(false)
const narrow = useNarrow()
const drawerOpen = ref(false)
const ASSIST_KEY = 'mowen_assistant_collapsed'
const assistantOpen = ref(!narrow.value && localStorage.getItem(ASSIST_KEY) !== '1')
watch(assistantOpen, (v) => {
  if (!narrow.value) localStorage.setItem(ASSIST_KEY, v ? '0' : '1')
})
watch(narrow, (isNarrow) => {
  if (isNarrow) {
    assistantOpen.value = false
    drawerOpen.value = false
  }
})

const mobileTitle = computed(() => {
  if (route.path.startsWith('/notes')) return '笔记'
  if (route.path.startsWith('/tables')) return '表格'
  if (route.path.startsWith('/settings')) return '设置'
  if (route.path.startsWith('/administration')) return '管理'
  if (route.path.startsWith('/archive') || route.path.startsWith('/knowledge-base')) return '归档'
  return '墨问'
})

function onAssistantAsk() {
  assistantOpen.value = true
  drawerOpen.value = false
}

onMounted(() => window.addEventListener(ASSISTANT_ASK, onAssistantAsk))
onUnmounted(() => window.removeEventListener(ASSISTANT_ASK, onAssistantAsk))

watch(() => route.path, () => { drawerOpen.value = false })

watch(() => route.fullPath, () => {
  currentUser.value = getCachedUser()
})

const currentSpaceId = computed(() => currentUser.value?.current_team?.id || currentUser.value?.team?.id || '')

async function handleSwitchSpace(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value)
  if (!Number.isInteger(value) || value <= 0 || value === currentSpaceId.value) return
  try {
    await switchSpace(value)
    resetAuthState()
    currentUser.value = await getCurrentUser()
    queryClient.invalidateQueries()
    router.push('/')
    message.success('已切换空间')
  } catch (err) {
    message.error((err as Error).message)
  }
}

function handleMenuItem(key: string) {
  showUserMenu.value = false
  if (key === 'settings') {
    void router.push('/settings')
    return
  }
  if (key === 'administration') {
    void router.push('/administration')
    return
  }
  if (key === 'logout') logout()
}

function onDocClick(e: MouseEvent) {
  if (!(e.target as Element).closest('.sidebar-footer')) {
    showUserMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

async function logout() {
  try {
    await http.post('/auth/logout')
  } catch { /* ignore */ }
  resetAuthState()
  router.replace('/login')
}
</script>

<style scoped>
/* ── Layout ────────────────────────────────────────────────── */
.app-layout {
  display: flex;
  height: 100dvh;
  min-height: 100dvh;
  overflow: hidden;
  padding-top: var(--net-banner-h, 0px);
  box-sizing: border-box;
}
.app-layout.narrow {
  flex-direction: column;
}
.app-layout.resizing {
  cursor: col-resize;
  user-select: none;
}
.sidebar {
  display: flex;
  flex-direction: column;
  background: #f7f7f5;
  border-right: 1px solid #e9e9e7;
  flex-shrink: 0;
  min-width: 180px;
  max-width: 480px;
  min-height: 0;
  height: 100%;
}
.mob-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 10px;
  padding-top: env(safe-area-inset-top);
  background: #f7f7f5;
  border-bottom: 1px solid #e9e9e7;
  flex-shrink: 0;
  z-index: 30;
}
.mob-bar-btn,
.mob-bar-ai {
  border: 0;
  background: transparent;
  color: #37352f;
  font-size: 16px;
  font-weight: 600;
  padding: 8px 10px;
  border-radius: 8px;
  min-width: 40px;
}
.mob-bar-ai.active { background: #eceae6; }
.mob-bar-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.28);
  z-index: 40;
}
.app-layout.narrow .sidebar {
  position: fixed;
  top: var(--net-banner-h, 0px);
  left: 0;
  width: min(84vw, 320px);
  max-width: 320px;
  min-width: 0;
  height: calc(100dvh - var(--net-banner-h, 0px));
  z-index: 50;
  transform: translateX(-105%);
  transition: transform 0.2s ease;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
.app-layout.narrow.drawer-open .sidebar {
  transform: translateX(0);
}
.app-layout.narrow .main-content {
  flex: 1;
}
.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.12) transparent;
}
.sidebar-scroll::-webkit-scrollbar { width: 6px; }
.sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 3px; }
.sidebar-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
.resize-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
  position: relative;
  z-index: 10;
  margin-left: -2px;
  margin-right: -2px;
}
.resize-handle:hover,
.resize-handle.active {
  background: rgba(55, 53, 47, 0.15);
}
.main-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* ── Header ────────────────────────────────────────────────── */
.sidebar-header {
  padding: 20px 16px 12px;
  border-bottom: 1px solid #e9e9e7;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.logo-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  min-width: 0;
}
.logo-img {
  width: 26px;
  height: 26px;
  object-fit: contain;
  flex-shrink: 0;
  opacity: 1;
}
.logo {
  font-size: 16px;
  font-weight: 700;
  color: #37352f;
  letter-spacing: 0;
}
.space-switcher {
  padding: 0 12px 12px;
  border-bottom: 1px solid #ececea;
}
.space-select {
  width: 100%;
  height: 30px;
  border: 1px solid #e3e3df;
  border-radius: 8px;
  background: #fff;
  color: #37352f;
  font-size: 13px;
  padding: 0 8px;
  outline: none;
}
.ai-launch {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  padding: 4px 8px 4px 6px;
  border-radius: 8px;
  cursor: pointer;
  color: #37352f;
  flex-shrink: 0;
}
.ai-launch:hover,
.ai-launch.active {
  background: #efeafd;
}
.ai-launch-icon {
  display: flex;
  align-items: center;
}
.ai-launch-text {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

/* ── Tabs ──────────────────────────────────────────────────── */
.sidebar-tabs {
  display: flex;
  padding: 6px 8px;
  gap: 2px;
  flex-shrink: 0;
  border-bottom: 1px solid #e9e9e7;
}
.sidebar-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 0;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #787774;
  transition: background 0.12s, color 0.12s;
}
.sidebar-tab:hover {
  background: rgba(55, 53, 47, 0.06);
  color: #37352f;
}
.sidebar-tab.active {
  background: rgba(55, 53, 47, 0.1);
  color: #37352f;
}

/* ── Tables panel ──────────────────────────────────────────── */
.table-list {
  padding: 8px 0;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  cursor: pointer;
  color: #787774;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}
.group-header:hover { color: #37352f; }
.group-header[draggable="true"] { cursor: grab; }
.group-header[draggable="true"]:active { cursor: grabbing; }
.group-header.drag-target {
  border-top: 2px solid #4f6ef7;
  padding-top: 4px;
}
.group-arrow {
  font-size: 12px;
  transition: transform 0.15s;
  display: inline-block;
  width: 10px;
}
.group-arrow.expanded { transform: rotate(90deg); }
.group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-count {
  font-size: 10px;
  background: rgba(55, 53, 47, 0.06);
  padding: 1px 5px;
  border-radius: 8px;
  color: #787774;
}
.table-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  cursor: pointer;
  border-radius: 3px;
  margin: 0 6px;
  transition: background 0.12s;
}
.table-item.grouped { padding-left: 28px; }
.table-item:hover { background: rgba(55, 53, 47, 0.08); }
.table-item.active {
  background: rgba(55, 53, 47, 0.1);
  font-weight: 500;
}
.table-icon { flex-shrink: 0; opacity: 0.5; }
.table-item.active .table-icon { opacity: 0.8; }
.table-icon-cell {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: #37352f;
}
.table-emoji-icon { font-size: 14px; line-height: 1; }
.table-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.table-name-input {
  flex: 1;
  background: #fff;
  border: 1px solid #b3b0ab;
  border-radius: 3px;
  color: #37352f;
  padding: 2px 6px;
  font-size: 13px;
  outline: none;
  min-width: 0;
}
.table-item[draggable="true"] { cursor: grab; }
.table-item[draggable="true"]:active { cursor: grabbing; }

/* ── Notes panel ───────────────────────────────────────────── */
.notes-panel {
  padding: 0;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
}
.panel-search-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #e9e9e7;
  border-radius: 4px;
  font-size: 12px;
  color: #37352f;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
  min-width: 0;
}
.panel-search-input:focus { border-color: #b3b0ab; }
.panel-search-input::placeholder { color: #b3b0ab; }
.panel-add-btn {
  background: none;
  border: 1px solid #e9e9e7;
  border-radius: 3px;
  width: 26px;
  height: 26px;
  font-size: 16px;
  color: #787774;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.1s;
}
.add-wrap { position: relative; flex-shrink: 0; }
.add-menu {
  position: absolute;
  right: 0;
  top: 28px;
  z-index: 20;
  background: #fff;
  border: 1px solid #e9e9e7;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  min-width: 120px;
  padding: 4px;
}
.add-menu button {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: 0;
  padding: 6px 10px;
  font-size: 13px;
  color: #37352f;
  cursor: pointer;
  border-radius: 4px;
}
.add-menu button:hover { background: rgba(55,53,47,0.06); }
.panel-add-btn:hover {
  background: rgba(55, 53, 47, 0.08);
  color: #37352f;
}
.panel-list {
  padding: 0 4px;
}
.panel-empty {
  padding: 20px 16px;
  text-align: center;
  font-size: 13px;
  color: #a3a19d;
}

.kb-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: #787774;
  cursor: pointer;
  border-top: 1px solid #e9e9e7;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}
.kb-entry:hover {
  background: #f1f1ef;
  color: #37352f;
}
.kb-entry.active {
  color: #37352f;
  background: #f1f1ef;
}
.kb-badge {
  font-size: 11px;
  background: #e9e9e7;
  color: #787774;
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: auto;
}

/* ── Footer ────────────────────────────────────────────────── */
.sidebar-footer {
  flex-shrink: 0;
  margin-top: auto;
  border-top: 1px solid #e9e9e7;
}
.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.12s;
}
.user-trigger:hover { background: rgba(55, 53, 47, 0.06); }
.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
}
.user-details { min-width: 0; flex: 1; }
.user-name {
  font-size: 13px;
  color: #37352f;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-email {
  font-size: 11px;
  color: #787774;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-chevron {
  font-size: 16px;
  color: #a3a19d;
  flex-shrink: 0;
  letter-spacing: -2px;
}
.user-menu {
  background: #fff;
  border: 1px solid #e9e9e7;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.06);
  overflow: hidden;
}
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  font-size: 13px;
  color: #37352f;
  cursor: pointer;
  transition: background 0.1s;
}
.user-menu-item:hover { background: rgba(55,53,47,0.06); }
.user-menu-divider { height: 1px; background: #e9e9e7; }
.menu-slide-enter-active, .menu-slide-leave-active { transition: transform 0.12s, opacity 0.12s; }
.menu-slide-enter-from, .menu-slide-leave-to { transform: translateY(6px); opacity: 0; }
</style>
