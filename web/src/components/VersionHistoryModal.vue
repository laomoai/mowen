<template>
  <AppModal v-model:show="visible" title="历史版本" width="780px" height="min(680px, 86vh)">
    <div class="history-layout">
      <aside class="history-list">
        <div v-if="loading" class="history-empty">加载中…</div>
        <div v-else-if="!revisions.length" class="history-empty">暂无历史版本</div>
        <button
          v-for="revision in revisions"
          :key="revision.id"
          class="history-item"
          :class="{ active: selected?.id === revision.id }"
          @click="selectRevision(revision.id)"
        >
          <strong>v{{ revision.entity_version }}</strong>
          <span>{{ revision.action === 'restore' ? '恢复前的版本' : revision.changed_fields.join('、') || '内容更新' }}</span>
          <small>{{ formatTime(revision.created_at) }}</small>
        </button>
      </aside>
      <main class="history-detail">
        <div v-if="detailLoading" class="history-empty">读取差异中…</div>
        <template v-else-if="selected">
          <div class="history-toolbar">
            <div>
              <strong>版本 v{{ selected.entity_version }}</strong>
              <span>与当前版本 v{{ currentVersion }} 对比</span>
            </div>
            <button class="restore-btn" :disabled="restoring" @click="restoreSelected">
              {{ restoring ? '恢复中…' : '恢复到此版本' }}
            </button>
          </div>
          <div v-if="!selected.changes.length" class="history-empty">与当前内容无差异</div>
          <div v-for="change in selected.changes" :key="change.field" class="diff-card">
            <div class="diff-field">{{ fieldLabel(change.field) }}</div>
            <div class="diff-grid">
              <div><small>此历史版本</small><pre>{{ displayValue(change.before) }}</pre></div>
              <div><small>当前版本</small><pre>{{ displayValue(change.after) }}</pre></div>
            </div>
          </div>
        </template>
        <div v-else class="history-empty">选择一个版本查看差异</div>
      </main>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import AppModal from './AppModal.vue'
import { api, notesApi, type RevisionDetail, type RevisionSummary } from '@/api/client'

const props = defineProps<{ kind: 'record' | 'note'; entityId: string | number; tableName?: string; fieldLabels?: Record<string, string> }>()
const emit = defineEmits<{ restored: [] }>()
const visible = defineModel<boolean>('show', { default: false })
const revisions = ref<RevisionSummary[]>([])
const selected = ref<RevisionDetail | null>(null)
const currentVersion = ref(1)
const loading = ref(false)
const detailLoading = ref(false)
const restoring = ref(false)
const message = useMessage()
const dialog = useDialog()

watch(visible, value => { if (value) void loadHistory() })
watch(() => props.entityId, () => { if (visible.value) void loadHistory() })

async function loadHistory() {
  loading.value = true
  selected.value = null
  try {
    const result = props.kind === 'record'
      ? await api.getRecordRevisions(props.tableName!, Number(props.entityId))
      : await notesApi.getRevisions(String(props.entityId))
    revisions.value = result.data
    currentVersion.value = result.current_version
    if (result.data[0]) await selectRevision(result.data[0].id)
  } catch (error) { message.error((error as Error).message) }
  finally { loading.value = false }
}

async function selectRevision(revisionId: number) {
  detailLoading.value = true
  try {
    selected.value = props.kind === 'record'
      ? await api.getRecordRevision(props.tableName!, Number(props.entityId), revisionId)
      : await notesApi.getRevision(String(props.entityId), revisionId)
  } catch (error) { message.error((error as Error).message) }
  finally { detailLoading.value = false }
}

function restoreSelected() {
  if (!selected.value) return
  dialog.warning({
    title: '确认恢复',
    content: '当前内容会先保存为一个新的历史版本，仍可撤回。',
    positiveText: '恢复', negativeText: '取消',
    onPositiveClick: async () => {
      restoring.value = true
      try {
        if (props.kind === 'record') await api.restoreRecordRevision(props.tableName!, Number(props.entityId), selected.value!.id, currentVersion.value)
        else await notesApi.restoreRevision(String(props.entityId), selected.value!.id, currentVersion.value)
        message.success('已恢复，恢复前的内容已保留在历史中')
        emit('restored')
        visible.value = false
      } catch (error) { message.error((error as Error).message) }
      finally { restoring.value = false }
    },
  })
}

const fieldLabel = (field: string) => props.fieldLabels?.[field] ?? ({ content: '正文', title: '标题', icon: '图标', parent_id: '上级笔记' }[field] ?? field)
const displayValue = (value: unknown) => value == null ? '∅' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const formatTime = (seconds: number) => new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false })
</script>

<style scoped>
.history-layout{display:grid;grid-template-columns:220px 1fr;height:100%;min-height:420px}.history-list{border-right:1px solid #e7e7e7;overflow:auto;padding-right:10px}.history-item{display:flex;width:100%;flex-direction:column;gap:3px;text-align:left;border:0;border-radius:8px;background:transparent;padding:10px;cursor:pointer;color:inherit}.history-item:hover,.history-item.active{background:#f1f4ff}.history-item span,.history-item small{font-size:12px;color:#777}.history-detail{overflow:auto;padding-left:18px}.history-toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.history-toolbar>div{display:flex;flex-direction:column;gap:3px}.history-toolbar span{font-size:12px;color:#777}.restore-btn{border:0;border-radius:7px;background:#4f6ef7;color:white;padding:8px 12px;cursor:pointer}.restore-btn:disabled{opacity:.55}.diff-card{border:1px solid #e7e7e7;border-radius:9px;margin-bottom:12px;overflow:hidden}.diff-field{font-weight:600;padding:8px 10px;background:#fafafa}.diff-grid{display:grid;grid-template-columns:1fr 1fr}.diff-grid>div{min-width:0;padding:10px}.diff-grid>div+div{border-left:1px solid #eee}.diff-grid small{color:#777}.diff-grid pre{margin:7px 0 0;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;font:12px/1.5 ui-monospace,monospace}.history-empty{padding:28px;color:#888;text-align:center}@media(max-width:640px){.history-layout{grid-template-columns:1fr;display:block}.history-list{border-right:0;border-bottom:1px solid #e7e7e7;max-height:190px;padding:0 0 8px}.history-detail{padding:14px 0 0}.diff-grid{grid-template-columns:1fr}.diff-grid>div+div{border-left:0;border-top:1px solid #eee}}
</style>
