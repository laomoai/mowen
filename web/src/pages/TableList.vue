<template>
  <div class="dashboard">
    <div class="dashboard-inner">
      <div class="dash-header">
        <div>
          <h1 class="dash-title">{{ currentSpaceName }}</h1>
          <p class="dash-desc">最近用过的表格和笔记，以及按文件夹整理的内容</p>
        </div>
        <div class="new-wrap">
          <button class="new-table-btn" @click="showNewMenu = !showNewMenu">
            <span class="btn-icon">+</span>
            新建
          </button>
          <div v-if="showNewMenu" class="new-menu">
            <button @click="openCreateFolder">文件夹</button>
            <button @click="openCreateTable">表格</button>
            <button @click="openCreateNote">笔记</button>
          </div>
        </div>
      </div>

      <div class="search-wrap">
        <span class="search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input v-model="searchQuery" type="text" class="search-input" placeholder="搜索表格或笔记…" />
      </div>

      <n-spin v-if="isLoading" style="padding: 80px; display: flex; justify-content: center;" />

      <template v-else>
        <section class="group-section">
          <div class="group-section-header">
            <h2 class="group-section-name">最近</h2>
            <span class="group-section-count">{{ recentItems.length }}</span>
          </div>
          <div v-if="recentItems.length === 0" class="group-empty">打开过的表格和笔记会出现在这里。</div>
          <div v-else class="table-cards">
            <article
              v-for="item in recentItems"
              :key="`${item.kind}:${item.id}`"
              class="table-card"
              @click="openItem(item)"
            >
              <div class="card-left">
                <div class="card-icon" @click.stop="openItemIcon(item)" title="更换图标">
                  <NodeGlyph :icon="item.icon" :kind="item.kind" />
                </div>
                <div class="card-info">
                  <span class="card-title">{{ item.title || '未命名' }}</span>
                  <div class="card-meta">
                    <span class="card-kind">{{ item.kind === 'table' ? '表格' : '笔记' }}</span>
                    <span v-if="item.at" class="card-last-access">{{ formatRecentTime(item.at) }}</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section v-for="folder in folderSections" :key="folder.id" class="group-section">
          <div class="group-section-header">
            <div class="group-header-left">
              <button class="folder-icon-btn" title="更换图标" @click="openFolderIcon(folder)">
                <NodeGlyph :icon="folder.icon" kind="folder" />
              </button>
              <h2 class="group-section-name">{{ folder.title || '未命名文件夹' }}</h2>
              <span class="group-section-count">{{ folder.items.length }}</span>
            </div>
          </div>
          <div v-if="folder.items.length === 0" class="group-empty">这个文件夹还是空的，用侧栏 ••• 添加。</div>
          <div v-else class="table-cards">
            <article
              v-for="item in folder.items"
              :key="item.id"
              class="table-card"
              @click="openItem(item)"
            >
              <div class="card-left">
                <div class="card-icon" @click.stop="openItemIcon(item)" title="更换图标">
                  <NodeGlyph :icon="item.icon" :kind="item.kind" />
                </div>
                <div class="card-info">
                  <span class="card-title">{{ item.title || '未命名' }}</span>
                  <div class="card-meta">
                    <span class="card-kind">{{ item.kind === 'table' ? '表格' : '笔记' }}</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section v-if="looseItems.length" class="group-section">
          <div class="group-section-header">
            <h2 class="group-section-name">未放入文件夹</h2>
            <span class="group-section-count">{{ looseItems.length }}</span>
          </div>
          <div class="table-cards">
            <article
              v-for="item in looseItems"
              :key="item.id"
              class="table-card"
              @click="openItem(item)"
            >
              <div class="card-left">
                <div class="card-icon" @click.stop="openItemIcon(item)" title="更换图标">
                  <NodeGlyph :icon="item.icon" :kind="item.kind" />
                </div>
                <div class="card-info">
                  <span class="card-title">{{ item.title || '未命名' }}</span>
                  <div class="card-meta">
                    <span class="card-kind">{{ item.kind === 'table' ? '表格' : '笔记' }}</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <div v-if="!isLoading && !hasAnything" class="empty-state">
          <div class="empty-icon-big">✦</div>
          <p class="empty-text">工作区还是空的。先建一个文件夹、表格或笔记。</p>
        </div>
      </template>

      <AppModal v-model:show="showIconPicker" title="更换图标" width="360px" height="auto">
        <icon-picker :current-icon="iconTarget?.icon ?? null" @select="onIconSelect" />
      </AppModal>

      <AppModal v-model:show="showNameModal" :title="nameKind === 'folder' ? '新建文件夹' : '新建笔记'" width="420px" height="auto">
        <div class="rename-form">
          <input
            v-model="newName"
            class="ng-input"
            :placeholder="nameKind === 'folder' ? '文件夹名称' : '笔记标题'"
            @keyup.enter="submitName"
          />
          <div class="ng-footer">
            <button class="ng-btn" @click="showNameModal = false">取消</button>
            <button class="ng-btn primary" :disabled="!newName.trim()" @click="submitName">创建</button>
          </div>
        </div>
      </AppModal>

      <CreateTableModal
        v-model:show="showCreateTable"
        @created="onTableCreated"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, h, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { NSpin, useMessage } from 'naive-ui'
import { api, getCurrentUser, notesApi, workspaceApi, type WorkspaceKind, type WorkspaceNode } from '@/api/client'
import CreateTableModal from '@/components/CreateTableModal.vue'
import AppModal from '@/components/AppModal.vue'
import IonIcon from '@/components/IonIcon.vue'
import { formatRecentTime, loadRecentAccess } from '@/utils/recentAccess'

const IconPicker = defineAsyncComponent(() => import('@/components/IconPicker.vue'))

const router = useRouter()
const queryClient = useQueryClient()
const message = useMessage()

const { data: nodes, isLoading } = useQuery({
  queryKey: ['workspace'],
  queryFn: workspaceApi.getTree,
})

const { data: currentUser } = useQuery({
  queryKey: ['current-user'],
  queryFn: getCurrentUser,
})

const currentSpaceName = computed(() => currentUser.value?.current_team?.name || currentUser.value?.team?.name || '工作区')

const searchQuery = ref('')
const showNewMenu = ref(false)
const showCreateTable = ref(false)
const showNameModal = ref(false)
const nameKind = ref<'folder' | 'note'>('folder')
const newName = ref('')
const showIconPicker = ref(false)
const iconTarget = ref<DashItem | null>(null)

type DashItem = {
  id: string
  kind: Exclude<WorkspaceKind, 'folder'> | 'folder'
  title: string
  icon: string | null
  ref: string | null
  at?: number
}

const NodeGlyph = (props: { icon: string | null; kind: WorkspaceKind }) => {
  if (props.icon && !props.icon.startsWith('ion:')) {
    return h('span', { class: 'card-icon-emoji' }, props.icon)
  }
  if (props.icon?.startsWith('ion:')) {
    return h(IonIcon, { name: props.icon.slice(4), size: 20 })
  }
  const fallback = props.kind === 'folder' ? 'FolderOutline' : props.kind === 'table' ? 'GridOutline' : 'DocumentOutline'
  return h(IonIcon, { name: fallback, size: 20 })
}

const visibleNodes = computed(() => (nodes.value ?? []).filter((n) => !n.archived_at))

const q = computed(() => searchQuery.value.trim().toLowerCase())

function matches(n: WorkspaceNode) {
  if (!q.value) return true
  return (n.title || '').toLowerCase().includes(q.value)
}

const folders = computed(() =>
  visibleNodes.value.filter((n) => n.kind === 'folder').sort((a, b) => a.sort_order - b.sort_order),
)

function toItem(n: WorkspaceNode, at?: number): DashItem {
  return { id: n.id, kind: n.kind, title: n.title, icon: n.icon, ref: n.ref, at }
}

const folderSections = computed(() => {
  return folders.value.map((folder) => {
    const items = visibleNodes.value
      .filter((n) => n.parent_id === folder.id && n.kind !== 'folder' && matches(n))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((n) => toItem(n))
    if (q.value && items.length === 0 && !matches(folder)) return null
    return { id: folder.id, title: folder.title, icon: folder.icon, items }
  }).filter((x): x is { id: string; title: string; icon: string | null; items: DashItem[] } => !!x)
})

const looseItems = computed(() =>
  visibleNodes.value
    .filter((n) => !n.parent_id && n.kind !== 'folder' && matches(n))
    .map((n) => toItem(n)),
)

const recentItems = computed(() => {
  const list = visibleNodes.value
  const byRef = new Map<string, WorkspaceNode>()
  for (const n of list) {
    if (n.kind === 'table' && n.ref) byRef.set(`table:${n.ref}`, n)
    if (n.kind === 'note' && n.ref) byRef.set(`note:${n.ref}`, n)
  }
  const seen = new Set<string>()
  const out: DashItem[] = []
  for (const rec of loadRecentAccess()) {
    const n = byRef.get(`${rec.kind}:${rec.id}`)
    if (!n || !matches(n)) continue
    const key = `${rec.kind}:${rec.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(toItem(n, rec.at))
    if (out.length >= 12) break
  }
  return out
})

const hasAnything = computed(() =>
  recentItems.value.length + folderSections.value.length + looseItems.value.length > 0,
)

function openItem(item: DashItem) {
  if (item.kind === 'table' && item.ref) router.push(`/tables/${item.ref}`)
  else if (item.kind === 'note' && item.ref) router.push(`/notes/${item.ref}`)
}

function openItemIcon(item: DashItem) {
  if (item.kind === 'folder') {
    openFolderIcon(item)
    return
  }
  iconTarget.value = item
  showIconPicker.value = true
}

function openFolderIcon(folder: { id: string; icon: string | null; title?: string }) {
  iconTarget.value = { id: folder.id, kind: 'folder', title: folder.title || '', icon: folder.icon, ref: null }
  showIconPicker.value = true
}

async function onIconSelect(icon: string | null) {
  const target = iconTarget.value
  showIconPicker.value = false
  iconTarget.value = null
  if (!target) return
  try {
    if (target.kind === 'folder') await workspaceApi.updateFolderIcon(target.id, icon)
    else if (target.kind === 'table' && target.ref) {
      await api.updateTableIcon(target.ref, icon)
    } else if (target.kind === 'note' && target.ref) {
      await notesApi.updateNote(target.ref, { icon })
    }
    queryClient.invalidateQueries({ queryKey: ['workspace'] })
    queryClient.invalidateQueries({ queryKey: ['tables'] })
    queryClient.invalidateQueries({ queryKey: ['notes'] })
  } catch (err) {
    message.error((err as Error).message)
  }
}

function closeNewMenu() {
  showNewMenu.value = false
}

function openCreateTable() {
  closeNewMenu()
  showCreateTable.value = true
}

function openCreateFolder() {
  closeNewMenu()
  nameKind.value = 'folder'
  newName.value = ''
  showNameModal.value = true
}

function openCreateNote() {
  closeNewMenu()
  nameKind.value = 'note'
  newName.value = ''
  showNameModal.value = true
}

async function submitName() {
  const title = newName.value.trim()
  if (!title) return
  try {
    if (nameKind.value === 'folder') {
      await workspaceApi.createFolder({ title })
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      showNameModal.value = false
      message.success('文件夹已创建')
    } else {
      const result = await notesApi.createNote({ title })
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      showNameModal.value = false
      router.push(`/notes/${result.id}`)
    }
  } catch (err) {
    message.error((err as Error).message)
  }
}

function onTableCreated(name: string) {
  queryClient.invalidateQueries({ queryKey: ['workspace'] })
  queryClient.invalidateQueries({ queryKey: ['tables'] })
  router.push(`/tables/${name}`)
}

function onDocClick(e: MouseEvent) {
  const el = e.target as HTMLElement
  if (!el.closest('.new-wrap')) showNewMenu.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.dashboard {
  height: 100%;
  overflow-y: auto;
  background: #fff;
  color: #37352f;
}
.dashboard-inner {
  max-width: 860px;
  margin: 0 auto;
  padding: 48px 24px 80px;
}
.dash-header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}
@media (min-width: 640px) {
  .dash-header {
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-end;
  }
}
.dash-title {
  font-size: 30px;
  font-weight: 700;
  color: #37352f;
  margin: 0 0 4px;
  letter-spacing: -0.02em;
}
.dash-desc {
  font-size: 14px;
  color: #787774;
  margin: 0;
}
.new-wrap { position: relative; align-self: flex-start; }
.new-table-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #37352f;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.new-table-btn:hover { background: #2f2d2a; }
.btn-icon { font-size: 16px; line-height: 1; }
.new-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  background: #fff;
  border: 1px solid #e9e9e7;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 15, 15, 0.08);
  min-width: 140px;
  z-index: 20;
  padding: 4px;
}
.new-menu button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 14px;
  color: #37352f;
  cursor: pointer;
}
.new-menu button:hover { background: #f1f1ef; }
.search-wrap { position: relative; margin-bottom: 36px; }
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #787774;
  display: flex;
  pointer-events: none;
}
.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 16px 8px 36px;
  background: #f7f7f5;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 14px;
  color: #37352f;
  outline: none;
}
.search-input:focus {
  background: #fff;
  box-shadow: inset 0 0 0 1px rgba(35, 131, 226, 0.5), 0 0 0 2px rgba(35, 131, 226, 0.2);
}
.group-section { margin-bottom: 40px; }
.group-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.group-header-left { display: flex; align-items: center; gap: 10px; }
.folder-icon-btn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: #f7f7f5;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.folder-icon-btn:hover { background: #e9e9e7; }
.group-section-name {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.group-section-count {
  font-size: 13px;
  color: #787774;
  background: #f1f1ef;
  padding: 2px 10px;
  border-radius: 12px;
}
.group-empty { font-size: 13px; color: #9b9a97; }
.table-cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 640px) {
  .table-cards { grid-template-columns: repeat(2, 1fr); }
}
.table-card {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid #e9e9e7;
  border-radius: 8px;
  cursor: pointer;
}
.table-card:hover { background: #f9f9f8; }
.card-left { display: flex; align-items: center; gap: 14px; min-width: 0; overflow: hidden; }
.card-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f7f7f5;
  border-radius: 6px;
}
.card-icon:hover { background: #e9e9e7; }
.card-icon-emoji { font-size: 20px; line-height: 1; }
.card-info { min-width: 0; overflow: hidden; }
.card-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-meta { display: flex; gap: 8px; margin-top: 4px; }
.card-kind, .card-last-access { font-size: 12px; color: #787774; }
.empty-state { text-align: center; padding: 80px 20px; color: #787774; }
.empty-icon-big { font-size: 40px; margin-bottom: 16px; }
.rename-form { display: flex; flex-direction: column; gap: 16px; }
.ng-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e9e9e7;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}
.ng-footer { display: flex; justify-content: flex-end; gap: 8px; }
.ng-btn {
  border: 1px solid #e9e9e7;
  background: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
}
.ng-btn.primary { background: #37352f; color: #fff; border-color: #37352f; }
.ng-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
