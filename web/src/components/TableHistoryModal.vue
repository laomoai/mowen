<template>
  <AppModal v-model:show="visible" title="表格历史版本" width="900px" height="min(720px, 88vh)">
    <div class="history-layout">
      <aside class="history-list">
        <div v-if="loading" class="history-empty">加载中…</div>
        <div v-else-if="!revisions.length" class="history-empty">暂无历史版本；下一次数据变更后会开始记录</div>
        <button
          v-for="revision in revisions"
          :key="revision.id"
          class="history-item"
          :class="{ active: selected?.id === revision.id }"
          @click="selectRevision(revision.id)"
        >
          <strong>表格 v{{ revision.target_version }}</strong>
          <span>{{ actionLabel(revision.action) }} · {{ revision.changed_record_ids.length }} 条记录</span>
          <small>{{ formatTime(revision.created_at) }}</small>
        </button>
      </aside>
      <main class="history-detail">
        <div v-if="detailLoading" class="history-empty">正在重建整表差异…</div>
        <template v-else-if="selected">
          <div class="history-toolbar">
            <div>
              <strong>整表版本 v{{ selected.target_version }}</strong>
              <span>与当前整表版本 v{{ currentVersion }} 对比，共 {{ selected.changes.length }} 条记录不同</span>
            </div>
            <button class="restore-btn" :disabled="restoring" @click="restoreSelected">
              {{ restoring ? '恢复中…' : '整表恢复到此版本' }}
            </button>
          </div>
          <div v-if="!selected.changes.length" class="history-empty">与当前表格数据无差异</div>
          <section v-for="row in selected.changes" :key="row.record_id" class="row-diff">
            <div class="row-heading">
              <strong>记录 #{{ row.record_id }}</strong>
              <span :class="`change-${row.type}`">{{ rowTypeLabel(row.type) }}</span>
            </div>
            <div v-for="change in row.fields" :key="change.field" class="diff-card">
              <div class="diff-field">{{ fieldLabel(change.field) }}</div>
              <div class="diff-grid">
                <div><small>此表格版本</small><pre>{{ displayValue(change.before) }}</pre></div>
                <div><small>当前表格</small><pre>{{ displayValue(change.after) }}</pre></div>
              </div>
            </div>
          </section>
        </template>
        <div v-else class="history-empty">选择一个表格版本查看整表差异</div>
      </main>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import AppModal from './AppModal.vue'
import { api, type TableRevisionDetail, type TableRevisionSummary } from '@/api/client'

const props = defineProps<{ tableName: string; fieldLabels?: Record<string, string> }>()
const emit = defineEmits<{ restored: [] }>()
const visible = defineModel<boolean>('show', { default: false })
const revisions = ref<TableRevisionSummary[]>([])
const selected = ref<TableRevisionDetail | null>(null)
const currentVersion = ref(1)
const loading = ref(false)
const detailLoading = ref(false)
const restoring = ref(false)
const message = useMessage()
const dialog = useDialog()

watch(visible, value => { if (value) void loadHistory() })
watch(() => props.tableName, () => { if (visible.value) void loadHistory() })

async function loadHistory() {
  loading.value = true
  selected.value = null
  try {
    const result = await api.getTableRevisions(props.tableName)
    revisions.value = result.data
    currentVersion.value = result.current_version
    if (result.data[0]) await selectRevision(result.data[0].id)
  } catch (error) { message.error((error as Error).message) }
  finally { loading.value = false }
}

async function selectRevision(revisionId: number) {
  detailLoading.value = true
  try { selected.value = await api.getTableRevision(props.tableName, revisionId) }
  catch (error) { message.error((error as Error).message) }
  finally { detailLoading.value = false }
}

function restoreSelected() {
  if (!selected.value) return
  dialog.warning({
    title: '确认整表恢复',
    content: `整张表将恢复到 v${selected.value.target_version}。恢复前的整表状态会保存为一个新版本，可再次撤回。表结构和字段设置不会变化。`,
    positiveText: '恢复整张表', negativeText: '取消',
    onPositiveClick: async () => {
      restoring.value = true
      try {
        await api.restoreTableRevision(props.tableName, selected.value!.id, currentVersion.value)
        message.success('整张表已恢复，恢复前状态已保留')
        emit('restored')
        visible.value = false
      } catch (error) { message.error((error as Error).message) }
      finally { restoring.value = false }
    },
  })
}

const actionLabel = (action: TableRevisionSummary['action']) => ({ insert: '新增记录前', update: '修改记录前', delete: '删除记录前', batch_insert: '批量新增前', restore: '整表恢复前' }[action])
const rowTypeLabel = (type: TableRevisionDetail['changes'][number]['type']) => ({ added: '当前新增', removed: '当前已删除', modified: '内容有变化' }[type])
const fieldLabel = (field: string) => props.fieldLabels?.[field] ?? field
const displayValue = (value: unknown) => value == null ? '∅' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const formatTime = (seconds: number) => new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false })
</script>

<style scoped>
.history-layout{display:grid;grid-template-columns:240px 1fr;height:100%;min-height:460px}.history-list{border-right:1px solid #e7e7e7;overflow:auto;padding-right:10px}.history-item{display:flex;width:100%;flex-direction:column;gap:3px;text-align:left;border:0;border-radius:8px;background:transparent;padding:10px;cursor:pointer;color:inherit}.history-item:hover,.history-item.active{background:#f1f4ff}.history-item span,.history-item small{font-size:12px;color:#777}.history-detail{overflow:auto;padding-left:18px}.history-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}.history-toolbar>div{display:flex;flex-direction:column;gap:3px}.history-toolbar span{font-size:12px;color:#777}.restore-btn{border:0;border-radius:7px;background:#4f6ef7;color:white;padding:8px 12px;cursor:pointer;white-space:nowrap}.restore-btn:disabled{opacity:.55}.row-diff{border:1px solid #e1e4ea;border-radius:10px;margin-bottom:14px;overflow:hidden}.row-heading{display:flex;justify-content:space-between;padding:9px 11px;background:#f7f8fa}.row-heading span{font-size:12px}.change-added{color:#16803c}.change-removed{color:#c12b2b}.change-modified{color:#8a5b00}.diff-card+.diff-card{border-top:1px solid #eee}.diff-field{font-weight:600;padding:7px 10px;background:#fcfcfc}.diff-grid{display:grid;grid-template-columns:1fr 1fr}.diff-grid>div{min-width:0;padding:9px 10px}.diff-grid>div+div{border-left:1px solid #eee}.diff-grid small{color:#777}.diff-grid pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;font:12px/1.5 ui-monospace,monospace}.history-empty{padding:28px;color:#888;text-align:center}@media(max-width:640px){.history-layout{display:block}.history-list{border-right:0;border-bottom:1px solid #e7e7e7;max-height:190px;padding:0 0 8px}.history-detail{padding:14px 0 0}.history-toolbar{align-items:flex-start;flex-direction:column}.diff-grid{grid-template-columns:1fr}.diff-grid>div+div{border-left:0;border-top:1px solid #eee}}
</style>
