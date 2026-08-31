<template>
  <div class="settings-page">
    <div class="settings-header">
      <h2 class="settings-title">设置</h2>
    </div>

    <n-tabs type="line" animated>
      <n-tab-pane name="account" tab="账号">
        <div class="tab-content">
          <div class="section-title" style="font-size: 13px; font-weight: 600; color: #555; margin-bottom: 12px;">修改密码</div>
          <div class="rename-form" style="max-width: 360px;">
            <label class="hint" style="display:block;margin-bottom:6px;">当前密码</label>
            <n-input v-model:value="pwdCurrent" type="password" show-password-on="click" />
            <label class="hint" style="display:block;margin:12px 0 6px;">新密码（至少 8 位）</label>
            <n-input v-model:value="pwdNew" type="password" show-password-on="click" />
            <label class="hint" style="display:block;margin:12px 0 6px;">再输入一次新密码</label>
            <n-input v-model:value="pwdNew2" type="password" show-password-on="click" @keyup.enter="handleChangePassword" />
            <n-button
              type="primary"
              size="small"
              style="margin-top: 16px;"
              :loading="changingPassword"
              @click="handleChangePassword"
            >保存新密码</n-button>
          </div>
        </div>
      </n-tab-pane>

      <n-tab-pane name="files" tab="附件">
        <div class="tab-content">
          <p class="hint" style="margin:0 0 12px;line-height:1.55">
            图片存在本机磁盘。表格字段和笔记正文里还引用着的会保留；
            上传超过 24 小时仍没人用的算闲置。
          </p>
          <div class="space-card">
            <div class="space-head">
              <span>占用 {{ formatBytes(fileStats?.bytes ?? 0) }}</span>
              <span class="hint">{{ fileStats?.total ?? 0 }} 个文件</span>
            </div>
            <div class="space-bar" aria-hidden="true">
              <div class="space-used" :style="{ width: usedPct + '%' }" />
              <div class="space-orphan" :style="{ width: orphanPct + '%' }" />
            </div>
            <div class="space-legend">
              <span><i class="dot used" />在用 {{ formatBytes(fileStats?.used_bytes ?? 0) }}</span>
              <span><i class="dot orphan" />闲置 {{ formatBytes(fileStats?.orphan_bytes ?? 0) }}（{{ fileStats?.orphan ?? 0 }} 个）</span>
            </div>
            <p class="space-sample">
              示意：一张详情图大约 200KB～1.5MB，缩略图约 10KB。100 张图大概 20～150MB。
            </p>
          </div>
          <n-button size="small" :loading="sweepingFiles" :disabled="!fileStats?.orphan" @click="handleSweepFiles">
            清理闲置图片
          </n-button>
        </div>
      </n-tab-pane>

      <!-- ─── Tab: API Keys ──────────────────────────────── -->
      <n-tab-pane name="keys" tab="API 密钥">
        <div class="tab-content">
          <n-spin v-if="keysLoading" />
          <template v-else>
            <div v-if="keys?.length" class="key-list">
              <div v-for="k in keys" :key="k.id" class="key-card" :class="{ revoked: !k.is_active }">
                <div class="key-card-main">
                  <HoverTooltipText
                    :text="k.name"
                    class-name="key-card-name"
                    as="div"
                  />
                  <div class="key-card-meta">
                    <code class="key-prefix" :title="k.key_plain ? '点击复制密钥' : ''" @click="copyPlainKey(k)">{{ maskKey(k) }}</code>
                    <n-tag :type="k.type === 'readonly' ? 'info' : 'warning'" size="tiny">
                      {{ k.type === 'readonly' ? '只读' : '读写' }}
                    </n-tag>
                    <n-tag v-if="k.scope === 'groups'" size="tiny" :bordered="false">
                      {{ k.groups?.map(g => g.name).join(', ') || '未选文件夹' }}
                    </n-tag>
                    <n-tag v-else size="tiny" :bordered="false">全部文件夹</n-tag>
                    <n-tag v-if="!k.is_active" type="error" size="tiny">已撤销</n-tag>
                    <span class="key-last-used">{{ k.last_used_at ? '上次使用 ' + formatRelativeTime(k.last_used_at) : '从未使用' }}</span>
                  </div>
                </div>
                <n-button
                  v-if="k.is_active && k.key_plain"
                  size="tiny"
                  quaternary
                  @click="copyText(skillInstallText(k.key_plain), '已复制安装语句')"
                >
                  复制安装 Skill
                </n-button>
                <n-button
                  v-if="k.is_active"
                  size="tiny"
                  type="error"
                  quaternary
                  @click="handleRevoke(k.id)"
                >
                  撤销
                </n-button>
                <n-button
                  v-else
                  size="tiny"
                  type="error"
                  quaternary
                  @click="handleDeleteKey(k.id, k.name)"
                >
                  删除
                </n-button>
              </div>
            </div>
            <div v-else class="empty-hint">还没有 API 密钥</div>

            <n-button type="primary" size="small" style="margin-top: 16px;" @click="showCreate = true">
              创建新密钥
            </n-button>
          </template>

          <!-- API Docs link -->
          <div class="section" style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #f0f0f0;">
            <div class="section-label">接口文档</div>
            <div style="display: flex; gap: 10px; margin-top: 8px;">
              <n-button tag="a" href="/api/docs" target="_blank" size="small" type="primary" ghost>
                查看接口文档
              </n-button>
              <n-button tag="a" href="/api/openapi.json" target="_blank" size="small" quaternary>
                OpenAPI JSON
              </n-button>
            </div>
            <div class="hint" style="margin-top: 8px;">AI Agent 可读这份文档，自动发现可用接口</div>
          </div>

          <div class="hint" style="margin-top: 16px;">在密钥上可复制安装 Skill，中间打码，复制的是完整语句。</div>
        </div>
      </n-tab-pane>

      <!-- ─── Tab 4: Trash ──────────────────────────────── -->
      <n-tab-pane name="trash" tab="回收站">
        <div class="tab-content">
          <div class="hint" style="margin-bottom: 16px;">
            删除的内容会在回收站保留 30 天，之后自动彻底删除
          </div>

          <!-- Category toggle -->
          <div class="trash-category-toggle">
            <button class="trash-cat-btn" :class="{ active: trashCategory === 'tables' }" @click="trashCategory = 'tables'">表格</button>
            <button class="trash-cat-btn" :class="{ active: trashCategory === 'notes' }" @click="trashCategory = 'notes'">笔记</button>
          </div>

          <!-- Tables trash -->
          <template v-if="trashCategory === 'tables'">
            <n-spin v-if="trashLoading" />
            <template v-else>
              <div v-if="trashItems?.length" class="trash-panel">
                <div class="trash-list-shell">
                  <div class="trash-list">
                    <div v-for="item in trashItems" :key="item.id" class="trash-card">
                      <div class="trash-card-main">
                        <div class="trash-card-header">
                          <HoverTooltipText
                            :text="getTrashItemTitle(item)"
                            class-name="trash-card-table"
                          />
                          <code class="trash-card-id">{{ getTrashItemBadge(item) }}</code>
                        </div>
                        <div class="trash-card-preview">
                          {{ formatTrashPreview(item.record_data) }}
                        </div>
                        <div class="trash-card-meta">
                          删除于 {{ formatTrashTime(item.deleted_at) }}
                        </div>
                      </div>
                      <div class="trash-card-actions">
                        <n-button size="tiny" type="primary" quaternary @click="handleRestore(item.id)">恢复</n-button>
                        <n-button size="tiny" type="error" quaternary @click="handlePermanentDelete(item.id)">彻底删除</n-button>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="trash-panel-footer">
                  <div v-if="trashTotal > trashPageSize" class="trash-pagination-wrap">
                    <n-pagination
                      v-model:page="trashPage"
                      v-model:page-size="trashPageSize"
                      :item-count="trashTotal"
                      :page-sizes="[20, 50, 100]"
                      show-size-picker
                      size="small"
                    />
                  </div>
                  <n-button
                    type="error"
                    size="small"
                    quaternary
                    @click="handleEmptyTrash"
                  >
                    清空回收站
                  </n-button>
                </div>
              </div>
              <div v-else class="empty-hint">回收站是空的</div>
            </template>
          </template>

          <!-- Notes trash -->
          <template v-else>
            <n-spin v-if="notesTrashLoading" />
            <template v-else>
              <div v-if="notesTrashItems?.length" class="trash-panel">
                <div class="trash-list-shell">
                  <div class="trash-list">
                    <div v-for="item in notesTrashItems" :key="item.id" class="trash-card">
                      <div class="trash-card-main">
                        <div class="trash-card-header">
                          <span class="trash-note-icon">
                            <IonIcon v-if="item.icon && item.icon.startsWith('ion:')" :name="item.icon.slice(4)" :size="14" />
                            <span v-else-if="item.icon" class="note-emoji-icon">{{ item.icon }}</span>
                            <IonIcon v-else name="DocumentOutline" :size="14" />
                          </span>
                          <HoverTooltipText
                            :text="item.title || '未命名'"
                            class-name="trash-card-table"
                          />
                        </div>
                        <div class="trash-card-meta">删除于 {{ formatNoteTrashTime(item.deleted_at) }}</div>
                      </div>
                      <div class="trash-card-actions">
                        <n-button size="tiny" type="primary" quaternary @click="handleNoteRestore(item.id)">恢复</n-button>
                        <n-button size="tiny" type="error" quaternary @click="handleNotePermDelete(item.id)">彻底删除</n-button>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="notesTrashTotal > notesTrashPageSize" class="trash-panel-footer">
                  <div class="trash-pagination-wrap">
                    <n-pagination
                      v-model:page="notesTrashPage"
                      v-model:page-size="notesTrashPageSize"
                      :item-count="notesTrashTotal"
                      :page-sizes="[20, 50, 100]"
                      show-size-picker
                      size="small"
                    />
                  </div>
                </div>
              </div>
              <div v-else class="empty-hint">回收站是空的</div>
            </template>
          </template>
        </div>
      </n-tab-pane>

      <!-- ─── Tab: Import / Export ─────────────────────────── -->
      <n-tab-pane name="import-export" tab="导入 / 导出">
        <div class="tab-content">
          <div class="hint" style="margin-bottom: 16px;">
            系统级导出在这里。表格和笔记的导入稍后会加上。
          </div>

          <div class="export-section">
            <div class="export-card">
              <div class="export-card-main">
                <div class="export-card-title">笔记打包</div>
                <div class="export-card-desc">把全部笔记、层级、图标和正文导出为一个 JSON 文件。</div>
              </div>
              <n-button size="small" type="primary" :loading="exportingNotesBundle" @click="handleExportNotesBundle">
                Export Notes
              </n-button>
            </div>

            <div class="export-card">
              <div class="export-card-main">
                <div class="export-card-title">表格打包</div>
                <div class="export-card-desc">把全部表格、字段定义、图标和记录导出为一个 JSON 文件。</div>
              </div>
              <n-button size="small" type="primary" :loading="exportingTablesBundle" @click="handleExportTablesBundle">
                Export Tables
              </n-button>
            </div>

            <div class="export-card">
              <div class="export-card-main">
                <div class="export-card-title">结构 CSV</div>
                <div class="export-card-desc">把表格和字段映射导出为 CSV，便于核对或迁移。</div>
              </div>
              <n-button size="small" @click="showExportSchema = true">导出结构 CSV</n-button>
            </div>
          </div>
        </div>
      </n-tab-pane>

      <!-- ─── Tab: Team ──────────────────────────────────────── -->
      <n-tab-pane name="team" tab="团队">
        <div class="tab-content">
          <div class="hint" style="margin-bottom: 16px;">
            团队成员共用同一套工作区。
          </div>

          <n-spin :show="teamLoading">
            <template v-if="teamData">
              <!-- Team name (owner only) -->
              <div v-if="isOwner" class="section" style="margin-bottom: 20px;">
                <div class="section-title" style="font-size: 13px; font-weight: 600; color: #555; margin-bottom: 8px;">空间名称</div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <n-input
                    v-model:value="editTeamName"
                    size="small"
                    style="width: 260px;"
                    @keyup.enter="handleRenameTeam"
                  />
                  <n-button
                    size="small"
                    type="primary"
                    :disabled="editTeamName.trim() === teamData.name"
                    :loading="renamingTeam"
                    @click="handleRenameTeam"
                  >重命名</n-button>
                </div>
              </div>
              <div v-else class="section" style="margin-bottom: 20px;">
                <div class="section-title" style="font-size: 13px; font-weight: 600; color: #555; margin-bottom: 8px;">空间名称</div>
                <div style="font-size: 14px; color: #1a1d2e;">{{ teamData.name }}</div>
              </div>

              <!-- Add member (owner only) -->
              <div v-if="isOwner" class="section" style="margin-bottom: 20px;">
                <div class="section-title" style="font-size: 13px; font-weight: 600; color: #555; margin-bottom: 8px;">添加成员</div>
                <div style="display: flex; gap: 8px;">
                  <n-input v-model:value="newMemberEmail" size="small" placeholder="邮箱地址" style="width: 260px;" @keyup.enter="handleAddMember" />
                  <n-button size="small" type="primary" :loading="addingMember" @click="handleAddMember">邀请</n-button>
                </div>
                <p class="hint">不会生成密码。我们发一封邮件，对方点链接自己设密码，7 天内有效。</p>
              </div>

              <div v-if="isOwner" class="section invite-section">
                <div class="section-title" style="font-size: 13px; font-weight: 600; color: #555; margin-bottom: 8px;">邀请码</div>
                <div class="invite-actions">
                  <n-button size="small" type="primary" :loading="creatingInvite" @click="handleCreateInvite">生成邀请码</n-button>
                  <span class="hint">默认 7 天有效，最多使用 20 次。</span>
                </div>
                <div v-if="newInviteCode" class="invite-code-row">
                  <code>{{ newInviteCode }}</code>
                  <n-button size="tiny" quaternary @click="copyText(newInviteCode, '邀请码已复制')">复制</n-button>
                </div>
                <div v-if="teamInvites?.length" class="invite-list">
                  <div v-for="invite in teamInvites" :key="invite.id" class="invite-row">
                    <div>
                      <div class="invite-title">{{ invite.revoked_at ? '已撤销' : isInviteExpired(invite.expires_at) ? '已过期' : '有效邀请码' }}</div>
                      <div class="invite-meta">
                        已用 {{ invite.used_count }} / {{ invite.max_uses || '不限' }} · {{ invite.expires_at ? `过期 ${formatRelativeTime(invite.expires_at)}` : '永不过期' }}
                      </div>
                    </div>
                    <n-button
                      v-if="!invite.revoked_at"
                      size="tiny"
                      quaternary
                      type="error"
                      @click="handleRevokeInvite(invite.id)"
                    >撤销</n-button>
                  </div>
                </div>
              </div>

              <!-- Members list -->
              <div class="section">
                <div class="section-title" style="font-size: 13px; font-weight: 600; color: #555; margin-bottom: 8px;">成员（{{ teamData.members.length }}）</div>
                <div class="user-list">
                  <div v-for="m in teamData.members" :key="m.id" class="user-row">
                    <img :src="avatarUrl(m.picture, m.email)" class="user-avatar" referrerpolicy="no-referrer" />
                    <div class="user-info">
                      <div class="user-name">{{ m.name || m.email }}</div>
                      <div class="user-email">{{ m.email }}</div>
                    </div>
                    <span class="user-last-login">{{ formatLastLogin(m.last_login) }}</span>
                    <n-tag v-if="m.id === teamData.created_by" size="small" type="warning">所有者</n-tag>
                    <div v-if="isOwner && m.id !== teamData.created_by" class="user-actions">
                      <n-button
                        size="tiny"
                        quaternary
                        :loading="resendingMember === m.id"
                        @click="handleResendInvite(m.id)"
                      >重发邀请</n-button>
                      <n-button
                        size="tiny"
                        quaternary
                        type="error"
                        :loading="removingMember === m.id"
                        @click="handleRemoveMember(m.id, m.name || m.email)"
                      >移除</n-button>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="empty-hint">暂无团队信息</div>
          </n-spin>
        </div>
      </n-tab-pane>

      <!-- ─── Tab: Appearance ──────────────────────────────────── -->
      <n-tab-pane name="appearance" tab="外观">
        <div class="tab-content">
          <div class="section">
            <div class="section-title">侧栏</div>

            <div class="appearance-row">
              <label class="appearance-label">侧栏字号</label>
              <div class="appearance-control">
                <n-slider
                  v-model:value="sidebarFontSize"
                  :min="12"
                  :max="16"
                  :step="1"
                  :marks="{ 12: '12', 13: '13', 14: '14', 15: '15', 16: '16' }"
                  style="width: 180px;"
                  @update:value="saveSidebarPrefs"
                />
                <span class="appearance-value">{{ sidebarFontSize }}px</span>
              </div>
            </div>

            <div class="appearance-row" style="margin-top: 20px;">
              <label class="appearance-label">侧栏文字颜色</label>
              <div class="appearance-control">
                <input
                  type="color"
                  v-model="sidebarTextColor"
                  class="color-picker"
                  @change="saveSidebarPrefs"
                />
                <span class="appearance-value">{{ sidebarTextColor }}</span>
              </div>
            </div>

            <div style="margin-top: 20px;">
              <n-button size="small" @click="resetSidebarPrefs">恢复默认</n-button>
            </div>
          </div>
        </div>
      </n-tab-pane>

    </n-tabs>
  </div>

  <!-- Create Key modal -->
  <n-modal v-model:show="showCreate" preset="card" style="width: 480px;" title="创建 API 密钥">
    <n-form :model="newKey" label-placement="left" label-width="80">
      <n-form-item label="名称" :rule="{ required: true, message: '请输入名称' }">
        <n-input v-model:value="newKey.name" placeholder="例如：只读 Agent 密钥" />
      </n-form-item>
      <n-form-item label="权限">
        <n-radio-group v-model:value="newKey.type">
          <n-space>
            <n-radio value="readonly">只读</n-radio>
            <n-radio value="readwrite">读写</n-radio>
          </n-space>
        </n-radio-group>
      </n-form-item>
      <n-form-item label="范围">
        <n-radio-group v-model:value="newKey.scope">
          <n-space>
            <n-radio value="all">全部文件夹</n-radio>
            <n-radio value="groups">指定文件夹</n-radio>
          </n-space>
        </n-radio-group>
      </n-form-item>
      <n-form-item v-if="newKey.scope === 'groups'" label="文件夹" class="folder-form-item">
        <div v-if="groupList?.length" class="folder-pick">
          <n-checkbox-group v-model:value="newKey.group_ids">
            <n-space>
              <n-checkbox v-for="g in groupList" :key="g.id" :value="g.id" :label="g.name" />
            </n-space>
          </n-checkbox-group>
          <p class="folder-pick-hint">包含这些文件夹及其子文件夹里的表格和笔记。</p>
        </div>
        <span v-else class="hint">还没有文件夹，请先在侧栏创建一个</span>
      </n-form-item>
    </n-form>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <n-button @click="showCreate = false">取消</n-button>
        <n-button type="primary" :loading="creating" @click="handleCreateKey">创建</n-button>
      </div>
    </template>
  </n-modal>

  <!-- New Key display modal -->
  <n-modal v-model:show="showNewKey" preset="card" style="width: 560px;" title="请保存你的 API 密钥">
    <n-alert type="warning" style="margin-bottom: 12px;">
      关闭后仍可在列表里复制安装语句。列表中密钥中间会打码。
    </n-alert>
    <n-input :value="newKeyValue" readonly type="text" />
    <div class="agent-block">
      <div class="agent-block-head">
        <span>安装 Skill</span>
        <n-button size="tiny" quaternary @click="copyText(filledSkillSnippet, '已复制')">复制</n-button>
      </div>
      <pre class="agent-snippet">{{ filledSkillSnippet }}</pre>
    </div>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <n-button @click="copyKey">复制密钥</n-button>
        <n-button type="primary" @click="showNewKey = false">我已保存</n-button>
      </div>
    </template>
  </n-modal>

  <!-- Export Schema modal -->
  <ExportSchemaModal
    v-model:show="showExportSchema"
    :tables="allTables ?? []"
    :groups="groupList ?? []"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import {
  NTabs, NTabPane, NForm, NFormItem, NInput, NButton, NText, NTag, NSpace,
  NSpin, NModal, NAlert, NRadioGroup, NRadio, NCheckboxGroup, NCheckbox,
  NSlider, NPagination, useMessage, useDialog,
} from 'naive-ui'
import { api, notesApi, teamApi, getCurrentUser, changePassword, avatarUrl, type ApiKeyInfo, type TableMeta, type TrashItem, type TeamDetail } from '@/api/client'
import ExportSchemaModal from '@/components/ExportSchemaModal.vue'
import HoverTooltipText from '@/components/HoverTooltipText.vue'
import IonIcon from '@/components/IonIcon.vue'

const message = useMessage()
const dialog = useDialog()
const queryClient = useQueryClient()
const router = useRouter()

// ── Current User ─────────────────────────────────────────────
const currentUserId = ref<number>()
const currentUserRole = ref<'admin' | 'user'>('user')

getCurrentUser().then(u => {
  currentUserId.value = u.id
  currentUserRole.value = u.role
}).catch(() => {})

const showCreate = ref(false)
const showExportSchema = ref(false)
const showNewKey = ref(false)
const newKeyValue = ref('')
const creating = ref(false)
const pwdCurrent = ref('')
const pwdNew = ref('')
const pwdNew2 = ref('')
const changingPassword = ref(false)

async function handleChangePassword() {
  if (!pwdCurrent.value || pwdNew.value.length < 8) {
    message.warning('请填写当前密码，新密码至少 8 位')
    return
  }
  if (pwdNew.value !== pwdNew2.value) {
    message.warning('两次输入的新密码不一致')
    return
  }
  changingPassword.value = true
  try {
    await changePassword(pwdCurrent.value, pwdNew.value)
    pwdCurrent.value = ''
    pwdNew.value = ''
    pwdNew2.value = ''
    message.success('密码已更新')
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    changingPassword.value = false
  }
}
const sweepingFiles = ref(false)
const { data: fileStats, refetch: refetchFileStats } = useQuery({
  queryKey: ['upload-file-stats'],
  queryFn: api.fileStats,
  retry: false,
})

function formatBytes(n: number) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const usedPct = computed(() => {
  const t = fileStats.value?.bytes ?? 0
  if (!t) return 0
  return Math.round(((fileStats.value?.used_bytes ?? 0) / t) * 100)
})
const orphanPct = computed(() => {
  const t = fileStats.value?.bytes ?? 0
  if (!t) return 0
  return Math.max(0, 100 - usedPct.value)
})

async function handleSweepFiles() {
  sweepingFiles.value = true
  try {
    const res = await api.sweepFiles()
    message.success(res.deleted ? `已删除 ${res.deleted} 个闲置文件` : '没有可清理的闲置文件')
    await refetchFileStats()
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    sweepingFiles.value = false
  }
}

const exportingNotesBundle = ref(false)
const exportingTablesBundle = ref(false)
const newKey = ref({
  name: '',
  type: 'readonly' as 'readonly' | 'readwrite',
  scope: 'all' as 'all' | 'groups',
  group_ids: [] as number[],
})

// ── API Keys ──────────────────────────────────────────────────
const { data: keys, isLoading: keysLoading } = useQuery({
  queryKey: ['admin-keys'],
  queryFn: api.getKeys,
  retry: false,
})

async function handleCreateKey() {
  if (!newKey.value.name.trim()) {
    message.warning('请输入名称')
    return
  }
  creating.value = true
  try {
    const res = await api.createKey({
      name: newKey.value.name,
      type: newKey.value.type,
      scope: newKey.value.scope,
      group_ids: newKey.value.scope === 'groups' ? newKey.value.group_ids : undefined,
      notes_scope: 'all',
    })
    newKeyValue.value = res.data.key
    showCreate.value = false
    showNewKey.value = true
    newKey.value = { name: '', type: 'readonly', scope: 'all', group_ids: [] }
    queryClient.invalidateQueries({ queryKey: ['admin-keys'] })
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    creating.value = false
  }
}

function formatLastLogin(ts: number | null): string {
  return ts ? formatRelativeTime(ts) : '从未'
}

function formatRelativeTime(ts: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function handleRevoke(id: number) {
  try {
    await api.revokeKey(id)
    message.success('密钥已撤销')
    queryClient.invalidateQueries({ queryKey: ['admin-keys'] })
  } catch (err) {
    message.error((err as Error).message)
  }
}

function handleDeleteKey(id: number, name: string) {
  dialog.warning({
    title: '删除 API 密钥',
    content: `彻底删除已撤销的密钥「${name}」？此操作无法恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.deleteKey(id)
        message.success('密钥已删除')
        queryClient.invalidateQueries({ queryKey: ['admin-keys'] })
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

function copyKey() {
  navigator.clipboard.writeText(newKeyValue.value)
  message.success('已复制到剪贴板')
}

function skillInstallText(key: string) {
  return `请根据 https://mowen.lemoai.cn/agent/mowen/SKILL.md 安装墨问，环境变量 MOWEN_KEY=${key}`
}

const filledSkillSnippet = computed(() => skillInstallText(newKeyValue.value || '你的密钥'))

function maskKey(k: ApiKeyInfo) {
  const plain = k.key_plain
  if (plain && plain.length > 12) return `${plain.slice(0, 7)}***${plain.slice(-4)}`
  return `${k.key_prefix}***`
}

function copyPlainKey(k: ApiKeyInfo) {
  if (!k.key_plain) {
    message.warning('这把旧密钥没有完整值，请新建一把')
    return
  }
  navigator.clipboard.writeText(k.key_plain)
  message.success('密钥已复制')
}

function copyText(text: string, ok: string) {
  navigator.clipboard.writeText(text)
  message.success(ok)
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function buildExportFilename(prefix: string) {
  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${prefix}_${stamp}.json`
}

const { data: groupList, isLoading: groupsLoading } = useQuery({
  queryKey: ['groups'],
  queryFn: api.getGroups,
  retry: false,
})

const { data: noteTree } = useQuery({
  queryKey: ['notes', 'tree', 'settings'],
  queryFn: notesApi.getTree,
  retry: false,
})

async function handleExportNotesBundle() {
  const notes = noteTree.value ?? []
  if (notes.length === 0) {
    message.warning('没有可导出的笔记')
    return
  }

  exportingNotesBundle.value = true
  try {
    const fullNotes = await Promise.all(notes.map(async (note) => {
      const full = await notesApi.getNote(note.id)
      return {
        id: full.id,
        title: full.title,
        icon: full.icon,
        parent_id: full.parent_id,
        sort_order: full.sort_order,
        is_locked: full.is_locked,
        created_at: full.created_at,
        updated_at: full.updated_at,
        content: full.content,
      }
    }))

    downloadJson(buildExportFilename('notes_bundle'), {
      kind: 'd1table-notes-export',
      version: 1,
      exported_at: new Date().toISOString(),
      count: fullNotes.length,
      notes: fullNotes,
    })
    message.success(`已导出 ${fullNotes.length} 篇笔记`)
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    exportingNotesBundle.value = false
  }
}

async function blobToJson<T>(blob: Blob): Promise<T> {
  return JSON.parse(await blob.text()) as T
}

async function handleExportTablesBundle() {
  const tables = allTables.value ?? []
  if (tables.length === 0) {
    message.warning('没有可导出的表格')
    return
  }

  exportingTablesBundle.value = true
  try {
    const tablePayloads = await Promise.all(tables.map(async (table) => {
      const [schema, fields, rowsBlob] = await Promise.all([
        api.getTableSchema(table.name),
        api.getFieldMeta(table.name),
        api.exportRecords(table.name, { format: 'json' }),
      ])
      const rows = await blobToJson<Array<Record<string, unknown>>>(rowsBlob)
      return {
        name: table.name,
        title: table.title,
        icon: table.icon,
        row_count: table.row_count,
        is_locked: table.is_locked,
        schema: schema.columns,
        fields,
        rows,
      }
    }))

    downloadJson(buildExportFilename('tables_bundle'), {
      kind: 'd1table-tables-export',
      version: 1,
      exported_at: new Date().toISOString(),
      count: tablePayloads.length,
      tables: tablePayloads,
    })
    message.success(`已导出 ${tablePayloads.length} 张表格`)
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    exportingTablesBundle.value = false
  }
}

const { data: allTables } = useQuery({
  queryKey: ['tables'],
  queryFn: api.getTables,
})

function getTableTitle(name: string): string {
  const t = allTables.value?.find(t => t.name === name)
  return t?.title || name
}

function isDeletedTableSnapshot(data: Record<string, unknown>): data is Record<string, unknown> & {
  __kind: 'table'
  meta?: { title?: string | null }
  field_meta?: unknown[]
  rows?: unknown[]
} {
  return data.__kind === 'table'
}

// ── Trash ──────────────────────────────────────────────────
const trashCategory = ref<'tables' | 'notes'>('tables')
const trashPage = ref(1)
const trashPageSize = ref(20)

const { data: trashResult, isLoading: trashLoading } = useQuery({
  queryKey: computed(() => ['trash', trashPage.value, trashPageSize.value]),
  queryFn: () => api.getTrash({ page: trashPage.value, page_size: trashPageSize.value }),
  retry: false,
})

const trashItems = computed(() => trashResult.value?.data)
const trashTotal = computed(() => trashResult.value?.meta.total ?? 0)

function formatTrashPreview(data: Record<string, unknown>): string {
  if (isDeletedTableSnapshot(data)) {
    const fieldCount = Array.isArray(data.field_meta) ? data.field_meta.length : 0
    const rowCount = Array.isArray(data.rows) ? data.rows.length : 0
    return `${fieldCount} 个字段 / ${rowCount} 条记录`
  }
  const entries = Object.entries(data).filter(([k]) => k !== 'id' && k !== 'created_at')
  return entries.slice(0, 3).map(([, v]) => v == null ? '—' : String(v)).join(' / ')
}

function getTrashItemTitle(item: TrashItem): string {
  if (isDeletedTableSnapshot(item.record_data)) {
    return (item.record_data.meta?.title as string | null | undefined) || item.table_name
  }
  return getTableTitle(item.table_name)
}

function getTrashItemBadge(item: TrashItem): string {
  if (isDeletedTableSnapshot(item.record_data)) {
    return `Table: ${item.table_name}`
  }
  return `ID: ${item.record_id}`
}

function formatTrashTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function handleRestore(id: number) {
  try {
    const item = trashItems.value?.find(entry => entry.id === id)
    await api.restoreTrash(id)
    message.success(item && isDeletedTableSnapshot(item.record_data) ? '表格已恢复' : '记录已恢复')
    queryClient.invalidateQueries({ queryKey: ['trash'], exact: false })
    queryClient.invalidateQueries({ queryKey: ['records'] })
    queryClient.invalidateQueries({ queryKey: ['tables'] })
    queryClient.invalidateQueries({ queryKey: ['groups'] })
  } catch (err) {
    message.error((err as Error).message)
  }
}

async function handlePermanentDelete(id: number) {
  dialog.warning({
    title: '彻底删除',
    content: '该项目将被永久删除，无法恢复。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.deleteTrash(id)
        message.success('已彻底删除')
        queryClient.invalidateQueries({ queryKey: ['trash'], exact: false })
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

// ── Notes Trash ──────────────────────────────────────────
const notesTrashPage = ref(1)
const notesTrashPageSize = ref(20)

const { data: notesTrashResult, isLoading: notesTrashLoading } = useQuery({
  queryKey: computed(() => ['notes-trash', notesTrashPage.value, notesTrashPageSize.value]),
  queryFn: () => notesApi.getTrash({ page: notesTrashPage.value, page_size: notesTrashPageSize.value }),
  retry: false,
})

const notesTrashItems = computed(() => notesTrashResult.value?.data)
const notesTrashTotal = computed(() => notesTrashResult.value?.meta.total ?? 0)

function formatNoteTrashTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function handleNoteRestore(id: string) {
  try {
    await notesApi.restoreNote(id)
    message.success('笔记已恢复')
    queryClient.invalidateQueries({ queryKey: ['notes-trash'], exact: false })
    queryClient.invalidateQueries({ queryKey: ['notes', 'tree'] })
  } catch (err) {
    message.error((err as Error).message)
  }
}

async function handleNotePermDelete(id: string) {
  dialog.warning({
    title: '彻底删除',
    content: '该笔记将被永久删除，无法恢复。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await notesApi.permanentDeleteNote(id)
        message.success('已彻底删除')
        queryClient.invalidateQueries({ queryKey: ['notes-trash'], exact: false })
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

async function handleEmptyTrash() {
  dialog.warning({
    title: '清空回收站',
    content: '回收站内全部内容将被永久删除，无法恢复。',
    positiveText: '全部删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.emptyTrash()
        message.success('回收站已清空')
        queryClient.invalidateQueries({ queryKey: ['trash'], exact: false })
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

// ── Sidebar Appearance ────────────────────────────────────
const SIDEBAR_PREFS_KEY = 'd1table_sidebar_prefs'

function loadSidebarPrefs() {
  try {
    const raw = localStorage.getItem(SIDEBAR_PREFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

const prefs = loadSidebarPrefs()
const sidebarFontSize = ref<number>(prefs.fontSize ?? 14)
const sidebarTextColor = ref<string>(prefs.textColor ?? '#37352f')

function saveSidebarPrefs() {
  localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify({
    fontSize: sidebarFontSize.value,
    textColor: sidebarTextColor.value,
  }))
  // 通知 AppLayout 更新（用 storage event）
  window.dispatchEvent(new StorageEvent('storage', {
    key: SIDEBAR_PREFS_KEY,
    newValue: localStorage.getItem(SIDEBAR_PREFS_KEY),
  }))
}

function resetSidebarPrefs() {
  sidebarFontSize.value = 14
  sidebarTextColor.value = '#37352f'
  saveSidebarPrefs()
}

// ── Team Management ──────────────────────────────────────────
const newMemberEmail = ref('')
const addingMember = ref(false)
const renamingTeam = ref(false)
const removingMember = ref<number | null>(null)
const resendingMember = ref<number | null>(null)
const editTeamName = ref('')
const creatingInvite = ref(false)
const newInviteCode = ref('')

const { data: teamData, isLoading: teamLoading } = useQuery({
  queryKey: ['team-current'],
  queryFn: async () => {
    const data = await teamApi.getTeamInfo()
    editTeamName.value = data.name
    return data
  },
  retry: false,
})

const { data: teamInvites } = useQuery({
  queryKey: ['team-current', 'invites'],
  queryFn: teamApi.listInvites,
  enabled: computed(() => !!teamData.value && !!currentUserId.value && teamData.value.created_by === currentUserId.value),
  retry: false,
})

async function handleRenameTeam() {
  const name = editTeamName.value.trim()
  if (!name) return
  renamingTeam.value = true
  try {
    await teamApi.renameTeam(name)
    message.success('团队已重命名')
    queryClient.invalidateQueries({ queryKey: ['team-current'] })
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    renamingTeam.value = false
  }
}

async function handleAddMember() {
  const email = newMemberEmail.value.trim()
  if (!email) {
    message.warning('请输入邮箱')
    return
  }
  addingMember.value = true
  try {
    const res = await teamApi.addMember(email)
    if (res.data?.existing_user) {
      message.success(`已将 ${email} 加入当前空间`)
    } else if (res.data?.mail_sent === false) {
      message.warning(`账号已建好，但邮件没发出：${res.error?.message || '请检查邮箱配置'}`)
    } else {
      message.success(`已向 ${email} 发送邀请，对方点邮件里的链接设置密码`)
    }
    newMemberEmail.value = ''
    queryClient.invalidateQueries({ queryKey: ['team-current'] })
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    addingMember.value = false
  }
}

async function handleResendInvite(userId: number) {
  resendingMember.value = userId
  try {
    await teamApi.resendInvite(userId)
    message.success('邀请已重发，请对方查收邮件')
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    resendingMember.value = null
  }
}

async function handleRemoveMember(userId: number, name: string) {
  dialog.warning({
    title: '移除成员',
    content: `将「${name}」移出当前空间？该账号如果还在其他空间，会继续保留。`,
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      removingMember.value = userId
      try {
        await teamApi.removeMember(userId)
        message.success('成员已移除')
        queryClient.invalidateQueries({ queryKey: ['team-current'] })
      } catch (err) {
        message.error((err as Error).message)
      } finally {
        removingMember.value = null
      }
    },
  })
}

async function handleCreateInvite() {
  creatingInvite.value = true
  newInviteCode.value = ''
  try {
    const invite = await teamApi.createInvite({ role: 'member', max_uses: 20, expires_in_days: 7 })
    newInviteCode.value = invite.code
    message.success('邀请码已生成，请现在复制保存')
    queryClient.invalidateQueries({ queryKey: ['team-current', 'invites'] })
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    creatingInvite.value = false
  }
}

function handleRevokeInvite(id: number) {
  dialog.warning({
    title: '撤销邀请码',
    content: '撤销后，这个邀请码不能再用于注册或加入空间。',
    positiveText: '撤销',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await teamApi.revokeInvite(id)
        message.success('邀请码已撤销')
        queryClient.invalidateQueries({ queryKey: ['team-current', 'invites'] })
      } catch (err) {
        message.error((err as Error).message)
      }
    },
  })
}

function isInviteExpired(value: number | null): boolean {
  return !!value && value < Math.floor(Date.now() / 1000)
}

// ── Owner check ─────────────────────────────────────────────
const isOwner = computed(() => {
  if (!teamData.value || !currentUserId.value) return false
  return teamData.value.created_by === currentUserId.value
})
</script>

<style scoped>
.settings-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}
.settings-header {
  margin-bottom: 24px;
}
.settings-title {
  font-size: 22px;
  font-weight: 700;
  color: #1a1d2e;
  margin: 0;
}
.tab-content {
  padding: 20px 0;
}
.section {
  margin-bottom: 24px;
}
.section-label {
  font-size: 13px;
  font-weight: 600;
  color: #555;
  margin-bottom: 8px;
}
.hint {
  font-size: 12px;
  color: #999;
  margin-top: 6px;
}
.invite-section {
  padding: 14px;
  border: 1px solid #eee;
  border-radius: 8px;
  background: #fbfbfa;
}
.invite-actions,
.invite-code-row,
.invite-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.invite-code-row {
  justify-content: space-between;
  margin-top: 12px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e9e9e6;
  border-radius: 6px;
}
.invite-code-row code {
  font-size: 12px;
  color: #1a1d2e;
}
.invite-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.invite-row {
  justify-content: space-between;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #eeeeeb;
  border-radius: 6px;
}
.invite-title {
  font-size: 13px;
  font-weight: 600;
  color: #37352f;
}
.invite-meta {
  margin-top: 2px;
  color: #777;
  font-size: 12px;
}
.agent-block { margin-top: 16px; }
.agent-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #37352f;
  margin-bottom: 6px;
}
.agent-snippet {
  margin: 0;
  padding: 12px 14px;
  background: #f7f7f5;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre-wrap;
  color: #37352f;
}
.export-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.export-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid #e8eaf0;
  border-radius: 10px;
  background: #fff;
}
.export-card-main {
  min-width: 0;
}
.export-card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1d2e;
}
.export-card-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #7b8090;
  line-height: 1.5;
}
.folder-form-item :deep(.n-form-item-blank) {
  display: block;
  width: 100%;
}
.folder-pick {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  gap: 10px;
}
.folder-pick-hint {
  margin: 0;
  font-size: 12px;
  color: #999;
  line-height: 1.5;
}
.empty-hint {
  font-size: 13px;
  color: #bbb;
  padding: 24px 0;
  text-align: center;
}
.key-display {
  display: flex;
  align-items: center;
  gap: 10px;
}
.key-masked {
  font-size: 13px;
  color: #666;
  background: #f5f6f8;
  padding: 4px 10px;
  border-radius: 4px;
}

/* ── Group cards ── */
.group-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}
.group-card {
  border: 1px solid #e8eaf0;
  border-radius: 8px;
  padding: 14px 16px;
  background: #fafbfc;
}
.group-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.group-card-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1d2e;
  cursor: pointer;
  flex: 1;
}
.group-card-name:hover {
  color: #4F6EF7;
}
.group-card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.group-card:hover .group-card-actions {
  opacity: 1;
}
.group-card-tables {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 24px;
}
.create-group-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ── Trash ── */
/* ── Trash category toggle ── */
.trash-category-toggle {
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border: 1px solid #e0e3ec;
  border-radius: 8px;
  overflow: hidden;
  width: fit-content;
}
.trash-cat-btn {
  padding: 5px 18px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: #666;
  transition: background 0.15s, color 0.15s;
}
.trash-cat-btn + .trash-cat-btn {
  border-left: 1px solid #e0e3ec;
}
.trash-cat-btn.active {
  background: #4f6ef7;
  color: #fff;
}
.trash-cat-btn:not(.active):hover {
  background: #f5f6fb;
  color: #333;
}
.trash-note-icon {
  font-size: 15px;
  flex-shrink: 0;
}
.note-emoji-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
}

.trash-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.trash-list-shell {
  max-height: min(56vh, 720px);
  overflow: auto;
  padding-right: 4px;
  scrollbar-gutter: stable;
}
.trash-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.trash-panel-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.trash-pagination-wrap {
  display: flex;
  justify-content: center;
}
.trash-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #e8eaf0;
  border-radius: 8px;
  padding: 12px 16px;
  background: #fff;
}
.trash-card-main {
  flex: 1;
  min-width: 0;
}
.trash-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.trash-card-table {
  font-size: 13px;
  font-weight: 500;
  color: #1a1d2e;
}
.trash-card-id {
  font-size: 11px;
  color: #999;
  background: #f5f6f8;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
}
.trash-card-preview {
  font-size: 12px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 400px;
}
.trash-card-meta {
  font-size: 11px;
  color: #bbb;
  margin-top: 2px;
}
.trash-card-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.space-card {
  max-width: 480px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid #e8eaf0;
  border-radius: 10px;
  background: #fff;
}
.space-head {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: #37352f;
  margin-bottom: 10px;
}
.space-bar {
  display: flex;
  height: 12px;
  border-radius: 99px;
  overflow: hidden;
  background: #eef0f4;
}
.space-used { background: #4f6ef7; }
.space-orphan { background: #f0a020; }
.space-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 10px;
  font-size: 12px;
  color: #666;
}
.space-legend .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.space-legend .dot.used { background: #4f6ef7; }
.space-legend .dot.orphan { background: #f0a020; }
.space-sample {
  margin: 10px 0 0;
  font-size: 12px;
  color: #9b9a97;
  line-height: 1.5;
}

/* ── Key list ── */
.key-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.key-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #e8eaf0;
  border-radius: 8px;
  padding: 12px 16px;
  background: #fff;
}
.key-card.revoked {
  opacity: 0.5;
  background: #fafafa;
}
.key-card-main {
  flex: 1;
  min-width: 0;
}
.key-card-name {
  font-size: 14px;
  font-weight: 500;
  color: #1a1d2e;
  margin-bottom: 4px;
}
.key-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.key-prefix {
  font-size: 11px;
  color: #999;
  background: #f5f6f8;
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.key-last-used {
  font-size: 11px;
  color: #a3a19d;
}

.note-root-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
  width: 100%;
  padding: 6px 0;
}
.note-root-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  font-size: 13px;
  color: #37352f;
}
.note-root-icon {
  flex-shrink: 0;
}
.note-root-name {
  min-width: 0;
}

/* ── Appearance ── */
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1d2e;
  margin-bottom: 16px;
}
.appearance-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
}
.appearance-label {
  font-size: 13px;
  color: #555;
  width: 140px;
  flex-shrink: 0;
}
.appearance-control {
  display: flex;
  align-items: center;
  gap: 12px;
}
.appearance-value {
  font-size: 12px;
  color: #999;
  min-width: 40px;
}
.color-picker {
  width: 36px;
  height: 28px;
  border: 1px solid #e0e2ea;
  border-radius: 4px;
  padding: 2px;
  cursor: pointer;
  background: none;
}

/* User management */
.user-list { display: flex; flex-direction: column; gap: 4px; }
.user-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
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
  background: #e8eaf0;
  color: #6b7280;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}
.user-info { flex: 1; min-width: 0; }
.user-name { font-size: 14px; font-weight: 500; color: #1a1d2e; }
.user-email { font-size: 12px; color: #8b92a5; }
.user-table-count { font-size: 12px; color: #787774; white-space: nowrap; }
.user-last-login { font-size: 11px; color: #aab0c0; flex-shrink: 0; }
.user-actions { display: flex; gap: 4px; flex-shrink: 0; }
</style>
