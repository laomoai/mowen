<template>
  <div style="height: 100%; display: flex; flex-direction: column; overflow: hidden;">
    <ArchiveBackBar />
    <n-spin v-if="fieldsLoading" style="padding: 60px;" />
    <n-result
      v-else-if="fieldsError"
      status="error"
      :title="`无法加载表格 ${tableName}`"
      :description="(fieldsError as Error).message"
    />
    <DataGrid
      v-else-if="fields && displayMode === 'grid'"
      :table-name="tableName"
      :fields="fields"
      :table-title="tableTitle"
      :table-icon="tableIcon"
      :total-count="totalCount"
      :is-locked="isTableLocked"
      :highlight-id="highlightId"
      @refresh="refetchTables"
      @switch-view="switchView"
      @highlight-handled="clearHighlight"
    />
    <GalleryView
      v-else-if="fields && displayMode === 'gallery'"
      :table-name="tableName"
      :fields="fields"
      :table-title="tableTitle"
      :table-icon="tableIcon"
      :total-count="totalCount"
      :is-locked="isTableLocked"
      @refresh="refetchTables"
      @switch-view="switchView"
    />
    <ChartView
      v-else-if="fields && displayMode === 'chart'"
      :table-name="tableName"
      :fields="fields"
      :table-title="tableTitle"
      :table-icon="tableIcon"
      :total-count="totalCount"
      @switch-view="switchView"
    />
    <KanbanView
      v-else-if="fields && displayMode === 'kanban'"
      :table-name="tableName"
      :fields="fields"
      :table-title="tableTitle"
      :table-icon="tableIcon"
      :total-count="totalCount"
      :is-locked="isTableLocked"
      @refresh="refetchTables"
      @switch-view="switchView"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useNarrow } from '@/composables/useNarrow'
import { NSpin, NResult } from 'naive-ui'
import { api } from '@/api/client'
import ArchiveBackBar from '@/components/ArchiveBackBar.vue'
import { trackRecentAccess } from '@/utils/recentAccess'
import DataGrid from '@/components/DataGrid.vue'
import GalleryView from '@/components/GalleryView.vue'
import ChartView from '@/components/ChartView.vue'
import KanbanView from '@/components/KanbanView.vue'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()

const tableName = computed(() => route.params.tableName as string)
const highlightId = ref<string | null>((route.query.highlight as string) ?? null)
type ViewMode = 'grid' | 'gallery' | 'chart' | 'kanban'

function getStoredViewMode(table: string): ViewMode {
  const stored = localStorage.getItem(`mowen_viewmode_${table}`)
  return (['grid', 'gallery', 'chart', 'kanban'].includes(stored ?? '') ? stored : 'grid') as ViewMode
}

const viewMode = ref<ViewMode>(getStoredViewMode(tableName.value))
const narrow = useNarrow()
const displayMode = computed(() => (narrow.value ? 'gallery' : viewMode.value))

// 监听路由变化（从 link 跳转过来）
watch(() => route.query.highlight, (v) => {
  if (v) {
    highlightId.value = String(v)
    if (!narrow.value) viewMode.value = 'grid'
  }
})

function clearHighlight() {
  highlightId.value = null
  // 清除 URL 上的 highlight 参数，避免刷新时重复触发
  if (route.query.highlight) {
    const { highlight: _, ...rest } = route.query
    router.replace({ query: rest })
  }
}

// 切换表时恢复该表上次的视图
watch(tableName, (newTable) => {
  viewMode.value = getStoredViewMode(newTable)
  trackRecentAccess('table', newTable)
}, { immediate: true })

function switchView(v: string) {
  const mode = v as ViewMode
  viewMode.value = mode
  localStorage.setItem(`mowen_viewmode_${tableName.value}`, mode)
}

const {
  data: fields,
  isLoading: fieldsLoading,
  error: fieldsError,
} = useQuery({
  queryKey: computed(() => ['fields', tableName.value]),
  queryFn: () => api.getFieldMeta(tableName.value),
})

// 用 useQuery 订阅 tables 数据（响应式，缓存更新后自动重算）
const { data: tablesData } = useQuery({
  queryKey: ['tables'],
  queryFn: api.getTables,
})

const { data: tableSchema } = useQuery({
  queryKey: computed(() => ['table-schema', tableName.value]),
  queryFn: () => api.getTableSchema(tableName.value),
})

const totalCount = computed(() =>
  tablesData.value?.find(t => t.name === tableName.value)?.row_count ?? null
)

const tableTitle = computed(() =>
  tableSchema.value?.title ?? tablesData.value?.find(t => t.name === tableName.value)?.title ?? null
)

const tableIcon = computed(() =>
  tableSchema.value?.icon ?? tablesData.value?.find(t => t.name === tableName.value)?.icon ?? null
)

const isTableLocked = computed(() =>
  !!(tableSchema.value?.is_locked || tableSchema.value?.archived_at
    || tablesData.value?.find(t => t.name === tableName.value)?.is_locked)
)

watch([tableTitle, tableIcon, tableName], ([title, icon, name]) => {
  const display = title || name
  const prefix = icon && !icon.startsWith('ion:') ? icon + ' ' : ''
  document.title = `${prefix}${display} - 墨问`
}, { immediate: true })

onUnmounted(() => { document.title = '墨问' })

function refetchTables() {
  queryClient.invalidateQueries({ queryKey: ['tables'] })
  queryClient.invalidateQueries({ queryKey: ['workspace'] })
}
</script>
