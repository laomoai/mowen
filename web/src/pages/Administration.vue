<template>
  <div class="admin-page">
    <div class="admin-header">
      <h2 class="admin-title">管理后台</h2>
      <n-button type="primary" size="small" @click="showAddSpace = true">添加空间</n-button>
    </div>

    <n-spin :show="spacesLoading">
      <div v-if="spaces?.length" class="space-grid">
        <div
          v-for="s in spaces"
          :key="s.id"
          class="space-card"
          @click="openSpaceDetail(s.id)"
        >
          <div class="space-card-name">{{ s.name }}</div>
          <div class="space-card-owner">{{ s.owner_email || 'No owner' }}</div>
          <div class="space-card-stats">
            <span>{{ s.member_count }} members</span>
            <span>{{ s.table_count }} tables</span>
            <span>{{ s.note_count }} notes</span>
          </div>
        </div>
      </div>
      <div v-else-if="!spacesLoading" class="empty-hint">还没有空间</div>
    </n-spin>
  </div>

  <!-- 添加空间 modal -->
  <n-modal v-model:show="showAddSpace" preset="card" style="width: 420px;" title="添加空间">
    <n-form label-placement="left" label-width="100">
      <n-form-item label="空间名称">
        <n-input v-model:value="newSpace.name" placeholder="例如：市场团队" />
      </n-form-item>
      <n-form-item label="所有者邮箱">
        <n-input v-model:value="newSpace.owner_email" placeholder="owner@example.com" />
      </n-form-item>
    </n-form>
    <div class="hint">所有者邮箱必须是系统中还不存在的新用户。</div>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <n-button @click="showAddSpace = false">取消</n-button>
        <n-button type="primary" :loading="creatingSpace" @click="handleCreateSpace">创建</n-button>
      </div>
    </template>
  </n-modal>

  <!-- Space Detail modal -->
  <n-modal v-model:show="showDetail" preset="card" style="width: 640px;" title="空间详情">
    <n-spin :show="detailLoading">
      <template v-if="spaceDetail">
        <!-- Space name edit -->
        <div class="detail-section" style="margin-bottom: 16px;">
          <div class="detail-section-title">空间名称</div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <n-input v-model:value="editSpaceName" size="small" style="width: 280px;" @keyup.enter="handleRenameSpace" />
            <n-button
              size="small"
              type="primary"
              :disabled="editSpaceName.trim() === spaceDetail.name"
              :loading="renamingSpace"
              @click="handleRenameSpace"
            >重命名</n-button>
          </div>
        </div>

        <div class="detail-meta">
          <span>所有者：{{ spaceDetail.owner_email || '无' }}</span>
        </div>

        <div class="detail-section-title">成员（{{ spaceDetail.members.length }}）</div>
        <div v-if="spaceDetail.members.length" class="member-list-scroll">
          <div v-for="m in spaceDetail.members" :key="m.id" class="user-row">
            <img :src="avatarUrl(m.picture, m.email)" class="user-avatar" referrerpolicy="no-referrer" />
            <div class="user-info">
              <div class="user-name">{{ m.name || m.email }}</div>
              <div class="user-email">{{ m.email }}</div>
            </div>
            <span class="user-last-login">{{ formatLastLogin(m.last_login) }}</span>
            <n-tag :type="m.role === 'admin' ? 'warning' : 'info'" size="small">{{ m.role }}</n-tag>
            <n-button
              v-if="m.id !== spaceDetail.created_by"
              size="tiny"
              type="error"
              quaternary
              :loading="removingMember === m.id"
              @click="handleRemoveMember(m)"
            >移除</n-button>
            <n-tag v-else size="small" :bordered="false" type="success">所有者</n-tag>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 16px;">
          <n-input v-model:value="newMemberEmail" size="small" placeholder="邮箱地址" style="width: 260px;" @keyup.enter="handleAddMember" />
          <n-button size="small" type="primary" :loading="addingMember" @click="handleAddMember">添加成员</n-button>
        </div>

        <!-- 删除空间 -->
        <div class="danger-zone">
          <div class="detail-section-title" style="color: #d03050;">危险操作</div>
          <div class="hint" style="margin-bottom: 8px;">将永久删除该空间及其全部数据（表格、笔记、成员），不可恢复。</div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <n-input v-model:value="deleteConfirmName" size="small" :placeholder="`输入「${spaceDetail?.name}」以确认`" style="width: 280px;" />
            <n-button
              size="small"
              type="error"
              :disabled="deleteConfirmName !== spaceDetail?.name"
              :loading="deletingSpace"
              @click="handleDeleteSpace"
            >删除空间</n-button>
          </div>
        </div>
      </template>
    </n-spin>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { NButton, NInput, NModal, NForm, NFormItem, NTag, NSpin, useMessage, useDialog } from 'naive-ui'
import { administrationApi, avatarUrl, type SpaceDetail } from '@/api/client'

function formatLastLogin(ts: number | null): string {
  if (!ts) return '从未'
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const message = useMessage()
const dialog = useDialog()
const queryClient = useQueryClient()

// ── Space list ───────────────────────────────────────────────
const { data: spaces, isLoading: spacesLoading } = useQuery({
  queryKey: ['admin-spaces'],
  queryFn: administrationApi.getSpaces,
})

// ── 添加空间 ────────────────────────────────────────────────
const showAddSpace = ref(false)
const creatingSpace = ref(false)
const newSpace = reactive({ name: '', owner_email: '' })

async function handleCreateSpace() {
  if (!newSpace.name.trim()) { message.warning('请填写空间名称'); return }
  if (!newSpace.owner_email.trim()) { message.warning('请填写所有者邮箱'); return }
  creatingSpace.value = true
  try {
    await administrationApi.createSpace({ name: newSpace.name.trim(), owner_email: newSpace.owner_email.trim() })
    message.success('空间已创建')
    showAddSpace.value = false
    newSpace.name = ''
    newSpace.owner_email = ''
    queryClient.invalidateQueries({ queryKey: ['admin-spaces'] })
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    creatingSpace.value = false
  }
}

// ── Space Detail ─────────────────────────────────────────────
const showDetail = ref(false)
const detailLoading = ref(false)
const spaceDetail = ref<SpaceDetail | null>(null)
const activeSpaceId = ref<number | null>(null)

const editSpaceName = ref('')
const renamingSpace = ref(false)

async function openSpaceDetail(id: number) {
  showDetail.value = true
  detailLoading.value = true
  activeSpaceId.value = id
  try {
    spaceDetail.value = await administrationApi.getSpace(id)
    editSpaceName.value = spaceDetail.value.name
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    detailLoading.value = false
  }
}

async function handleRenameSpace() {
  const name = editSpaceName.value.trim()
  if (!name || !activeSpaceId.value) return
  renamingSpace.value = true
  try {
    await administrationApi.renameSpace(activeSpaceId.value, name)
    message.success('空间已重命名')
    await refreshDetail()
    queryClient.invalidateQueries({ queryKey: ['admin-spaces'] })
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    renamingSpace.value = false
  }
}

async function refreshDetail() {
  if (activeSpaceId.value) {
    spaceDetail.value = await administrationApi.getSpace(activeSpaceId.value)
  }
}

// ── 添加成员 ───────────────────────────────────────────────
const newMemberEmail = ref('')
const addingMember = ref(false)

async function handleAddMember() {
  const email = newMemberEmail.value.trim()
  if (!email) { message.warning('请输入邮箱'); return }
  if (!activeSpaceId.value) return
  addingMember.value = true
  try {
    await administrationApi.addMember(activeSpaceId.value, email)
    message.success(`已添加成员 ${email}`)
    newMemberEmail.value = ''
    await refreshDetail()
    queryClient.invalidateQueries({ queryKey: ['admin-spaces'] })
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    addingMember.value = false
  }
}

// ── Remove Member ────────────────────────────────────────────
const removingMember = ref<number | null>(null)

function handleRemoveMember(m: { id: number; name: string; email: string }) {
  dialog.warning({
    title: '移除成员',
    content: `将「${m.name || m.email}」移出该空间？如果该账号还在其他空间，会继续保留。`,
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (!activeSpaceId.value) return
      removingMember.value = m.id
      try {
        await administrationApi.removeMember(activeSpaceId.value, m.id)
        message.success('成员已移除')
        await refreshDetail()
        queryClient.invalidateQueries({ queryKey: ['admin-spaces'] })
      } catch (err) {
        message.error((err as Error).message)
      } finally {
        removingMember.value = null
      }
    },
  })
}

// ── 删除空间 ─────────────────────────────────────────────
const deleteConfirmName = ref('')
const deletingSpace = ref(false)

async function handleDeleteSpace() {
  if (!activeSpaceId.value || !spaceDetail.value) return
  if (deleteConfirmName.value !== spaceDetail.value.name) return
  deletingSpace.value = true
  try {
    await administrationApi.deleteSpace(activeSpaceId.value, deleteConfirmName.value)
    message.success('空间已删除')
    showDetail.value = false
    deleteConfirmName.value = ''
    queryClient.invalidateQueries({ queryKey: ['admin-spaces'] })
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    deletingSpace.value = false
  }
}
</script>

<style scoped>
.admin-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}
.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.admin-title {
  font-size: 22px;
  font-weight: 700;
  color: #1a1d2e;
  margin: 0;
}

.space-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.space-card {
  border: 1px solid #e8eaf0;
  border-radius: 10px;
  padding: 16px 18px;
  background: #fafbfc;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.space-card:hover {
  border-color: #c5cbe0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.space-card-name {
  font-size: 15px;
  font-weight: 600;
  color: #1a1d2e;
}
.space-card-owner {
  font-size: 12px;
  color: #8b92a5;
  margin-top: 4px;
}
.space-card-stats {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  font-size: 12px;
  color: #7b8090;
}

.empty-hint {
  font-size: 13px;
  color: #bbb;
  padding: 24px 0;
  text-align: center;
}
.hint {
  font-size: 12px;
  color: #999;
  margin-top: 6px;
}

.detail-meta {
  font-size: 13px;
  color: #7b8090;
  margin-bottom: 16px;
}
.detail-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #555;
  margin-bottom: 8px;
}
.member-list-scroll {
  min-height: 200px;
  max-height: min(60vh, 600px);
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-gutter: stable;
}

.user-list { display: flex; flex-direction: column; gap: 4px; }
.user-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  transition: background 0.12s;
}
.user-row:hover { background: #f5f6fa; }
.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}
.user-avatar-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e0e3ec;
  font-size: 14px;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
}
.user-info { flex: 1; min-width: 0; }
.user-name { font-size: 14px; font-weight: 500; color: #1a1d2e; }
.user-email { font-size: 12px; color: #8b92a5; }
.user-last-login { font-size: 11px; color: #aab0c0; flex-shrink: 0; }

.danger-zone {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #fee2e2;
}
</style>
