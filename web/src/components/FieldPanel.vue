<template>
  <n-drawer v-model:show="visible" :width="340" placement="right">
    <n-drawer-content title="字段管理" :native-scrollbar="false">
      <div class="field-list">
        <div
          v-for="(field, idx) in localFields"
          :key="field.column_name"
          class="field-row"
          :class="{ 'drag-over-top': dragOverIdx === idx && draggingIdx !== null && draggingIdx > idx, 'drag-over-bottom': dragOverIdx === idx && draggingIdx !== null && draggingIdx < idx }"
          draggable="true"
          @dragstart="onDragStart(idx, $event)"
          @dragover.prevent="onDragOver(idx)"
          @drop.prevent="onDrop(idx)"
          @dragend="onDragEnd"
        >
          <!-- 字段行 -->
          <div
            class="field-item"
            :class="{ active: expandedCol === field.column_name, hidden: field.is_hidden, dragging: draggingIdx === idx }"
            @click="toggleExpand(field)"
          >
            <span class="drag-handle" @click.stop title="拖动排序">⠿</span>
            <span class="field-icon" :style="{ color: typeColor(field.field_type) }">
              <IonIcon v-if="typeIcon(field.field_type).startsWith('ion:')" :name="typeIcon(field.field_type).slice(4)" :size="14" />
              <span v-else>{{ typeIcon(field.field_type) }}</span>
            </span>
            <div class="field-title-area">
              <span class="field-name">{{ field.title }}</span>
              <span class="field-col-hint">{{ field.column_name }}</span>
            </div>
            <div class="field-actions" @click.stop>
              <button
                class="icon-btn"
                :class="{ 'eye-hidden': field.is_hidden }"
                @click="toggleHidden(field)"
                :title="field.is_hidden ? '显示字段' : '隐藏字段'"
              >
                <IonIcon :name="field.is_hidden ? 'EyeOffOutline' : 'EyeOutline'" :size="14" />
              </button>
            </div>
          </div>

          <!-- 字段编辑器（展开） -->
          <n-collapse-transition :show="expandedCol === field.column_name">
            <div class="field-editor">
              <div class="editor-section">
                <div class="editor-label">字段名称</div>
                <n-input
                  v-model:value="editForm.title"
                  size="small"
                  placeholder="Field display name"
                  @keyup.enter="saveFieldEdit(field)"
                />
              </div>

              <div class="editor-section">
                <div class="editor-label">字段类型</div>
                <div class="type-grid">
                  <button
                    v-for="t in editFieldTypes(field)"
                    :key="t.value"
                    class="type-btn"
                    :class="{ active: editForm.field_type === t.value }"
                    :style="editForm.field_type === t.value ? { borderColor: t.color, background: t.color + '18', color: t.color } : {}"
                    @click="selectType(t.value as FieldType)"
                    :title="t.label"
                  >
                    <span class="type-btn-icon">
                      <IonIcon v-if="t.icon.startsWith('ion:')" :name="t.icon.slice(4)" :size="14" />
                      <span v-else>{{ t.icon }}</span>
                    </span>
                    <span class="type-btn-label">{{ t.label }}</span>
                  </button>
                </div>
              </div>

              <div v-if="editForm.field_type === 'running_balance'" class="formula-config">
                <div class="editor-section">
                  <div class="editor-label">期初余额</div>
                  <n-input v-model:value="editForm.running_balance.opening_balance" size="small" placeholder="例如 10000.00" />
                </div>
                <div class="editor-section">
                  <div class="editor-label">收入字段（可选）</div>
                  <naive-select v-model:value="editForm.running_balance.income_field" :options="amountFieldOptions" size="small" clearable placeholder="不计收入" />
                </div>
                <div class="editor-section">
                  <div class="editor-label">支出字段（可选）</div>
                  <naive-select v-model:value="editForm.running_balance.expense_field" :options="amountFieldOptions" size="small" clearable placeholder="不计支出" />
                </div>
                <div class="editor-section">
                  <div class="editor-label">计算顺序</div>
                  <naive-select v-model:value="editForm.running_balance.order_field" :options="orderFieldOptions" size="small" placeholder="选择日期或日期时间字段" />
                  <div class="editor-help">同一时间按记录 ID 排序；无日期的记录余额为空。</div>
                  <div class="formula-summary">{{ runningBalanceSummary(editForm.running_balance) }}</div>
                </div>
              </div>

              <!-- Select 选项编辑器 -->
              <div v-if="editForm.field_type === 'select'" class="editor-section">
                <div class="editor-label">选项</div>
                <div class="select-options-editor">
                  <div
                    v-for="(opt, oi) in editForm.select_options"
                    :key="oi"
                    class="select-opt-row"
                  >
                    <input
                      v-model="opt.label"
                      class="opt-label-input"
                      placeholder="Option name"
                      @input="opt.value = opt.label"
                    />
                    <input
                      v-model="opt.color"
                      type="color"
                      class="opt-color-input"
                      title="选择颜色"
                    />
                    <button class="icon-btn" @click="editForm.select_options.splice(oi, 1)">✕</button>
                  </div>
                  <button class="add-opt-btn" @click="addSelectOption(editForm.select_options)">+ Add Option</button>
                </div>
              </div>

              <!-- Link 目标表 -->
              <div v-if="editForm.field_type === 'link'" class="editor-section">
                <div class="editor-label">关联表格</div>
                <naive-select
                  v-model:value="editForm.link_table"
                  :options="availableTables.filter(t => t.value !== props.tableName)"
                  placeholder="Select target table"
                  size="small"
                  @update:value="() => { editForm.link_display_field = null; loadTargetFields(editForm.link_table) }"
                />
              </div>
              <div v-if="editForm.field_type === 'link' && editForm.link_table && targetFieldOptions.length" class="editor-section">
                <div class="editor-label">显示字段</div>
                <naive-select
                  v-model:value="editForm.link_display_field"
                  :options="targetFieldOptions"
                  placeholder="Default (first text field)"
                  size="small"
                  clearable
                />
              </div>

              <div class="editor-footer">
                <n-button size="small" @click="cancelExpand">取消</n-button>
                <n-button size="small" type="primary" :loading="saving" @click="saveFieldEdit(field)">保存</n-button>
              </div>
            </div>
          </n-collapse-transition>
        </div>
      </div>

      <!-- 添加字段区域 -->
      <div class="add-field-section">
        <n-collapse-transition :show="showAddForm">
          <div class="add-field-form">
            <div class="editor-section">
              <div class="editor-label">字段名称</div>
              <n-input v-model:value="newField.title" size="small" placeholder="Field display name" />
            </div>
            <div class="editor-section">
              <div class="editor-label">字段类型</div>
              <div class="type-grid">
                <button
                  v-for="t in fieldTypes"
                  :key="t.value"
                  class="type-btn"
                  :class="{ active: newField.field_type === t.value }"
                  :style="newField.field_type === t.value ? { borderColor: t.color, background: t.color + '18', color: t.color } : {}"
                  @click="newField.field_type = t.value as FieldType"
                  :title="t.label"
                >
                  <span class="type-btn-icon">
                    <IonIcon v-if="t.icon.startsWith('ion:')" :name="t.icon.slice(4)" :size="14" />
                    <span v-else>{{ t.icon }}</span>
                  </span>
                  <span class="type-btn-label">{{ t.label }}</span>
                </button>
              </div>
            </div>
            <template v-if="newField.field_type === 'select'">
              <div class="editor-section">
                <div class="editor-label">选项</div>
                <div class="select-options-editor">
                  <div v-for="(opt, oi) in newField.select_options" :key="oi" class="select-opt-row">
                    <input v-model="opt.label" class="opt-label-input" placeholder="Option name" @input="opt.value = opt.label" />
                    <input v-model="opt.color" type="color" class="opt-color-input" />
                    <button class="icon-btn" @click="newField.select_options.splice(oi, 1)">✕</button>
                  </div>
                  <button class="add-opt-btn" @click="addSelectOption(newField.select_options)">+ Add Option</button>
                </div>
              </div>
            </template>
            <template v-if="newField.field_type === 'link'">
              <div class="editor-section">
                <div class="editor-label">关联表格</div>
                <naive-select
                  v-model:value="newField.link_table"
                  :options="availableTables.filter(t => t.value !== props.tableName)"
                  placeholder="Select target table"
                  size="small"
                  @update:value="() => { newField.link_display_field = null; loadTargetFields(newField.link_table) }"
                />
              </div>
              <div v-if="newField.link_table && targetFieldOptions.length" class="editor-section">
                <div class="editor-label">显示字段</div>
                <naive-select
                  v-model:value="newField.link_display_field"
                  :options="targetFieldOptions"
                  placeholder="Default (first text field)"
                  size="small"
                  clearable
                />
              </div>
            </template>
            <template v-if="newField.field_type === 'running_balance'">
              <div class="editor-section">
                <div class="editor-label">期初余额</div>
                <n-input v-model:value="newField.running_balance.opening_balance" size="small" placeholder="例如 10000.00" />
              </div>
              <div class="editor-section">
                <div class="editor-label">收入字段（可选）</div>
                <naive-select v-model:value="newField.running_balance.income_field" :options="amountFieldOptions" size="small" clearable placeholder="不计收入" />
              </div>
              <div class="editor-section">
                <div class="editor-label">支出字段（可选）</div>
                <naive-select v-model:value="newField.running_balance.expense_field" :options="amountFieldOptions" size="small" clearable placeholder="不计支出" />
              </div>
              <div class="editor-section">
                <div class="editor-label">计算顺序</div>
                <naive-select v-model:value="newField.running_balance.order_field" :options="orderFieldOptions" size="small" placeholder="选择日期或日期时间字段" />
                <div class="editor-help">余额 = 期初余额 + 累计收入 - 累计支出。</div>
              </div>
            </template>
            <div class="editor-footer">
              <n-button size="small" @click="showAddForm = false">取消</n-button>
              <n-button size="small" type="primary" :loading="adding" @click="submitAddField">添加</n-button>
            </div>
          </div>
        </n-collapse-transition>

        <n-button
          v-if="!showAddForm"
          dashed
          size="small"
          style="width:100%; margin-top:12px;"
          @click="openAddForm"
        >
          + 添加字段
        </n-button>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { useDialog, useMessage, NDrawer, NDrawerContent, NInput, NButton, NCollapseTransition, NSelect as NaiveSelect } from 'naive-ui'
import { api, type FieldMeta, type FieldType, type RunningBalanceConfig, type SelectOption } from '@/api/client'
import { useQueryClient } from '@tanstack/vue-query'
import IonIcon from './IonIcon.vue'

const props = defineProps<{
  tableName: string
  fields: FieldMeta[]
}>()

const emit = defineEmits<{ refresh: [] }>()
const visible = defineModel<boolean>('show', { default: false })

const message = useMessage()
const dialog = useDialog()
const queryClient = useQueryClient()

const localFields = ref<FieldMeta[]>([])
watch(() => props.fields, (f) => {
  localFields.value = [...f]
}, { immediate: true })

// 可选的目标表列表（link 字段用）
const availableTables = ref<Array<{ label: string; value: string }>>([])
onMounted(async () => {
  try {
    const tables = await api.getTables()
    availableTables.value = [
      { label: '笔记', value: '_notes' },
      ...tables.map(t => ({ label: t.title || t.name, value: t.name })),
    ]
  } catch {}
})

// ── 字段类型定义 ────────────────────────────────────────────────
const fieldTypes = [
  { value: 'text',     label: '文本',      icon: 'T',  color: '#666' },
  { value: 'longtext', label: '长文本', icon: '¶',  color: '#888' },
  { value: 'number',   label: '数字',    icon: '#',  color: '#4f6ef7' },
  { value: 'currency', label: '货币',  icon: '¥',  color: '#18a058' },
  { value: 'running_balance', label: '累计余额', icon: '∑', color: '#0f766e' },
  { value: 'percent',  label: '百分比',   icon: '%',  color: '#f0a020' },
  { value: 'email',    label: '邮箱',     icon: '@',  color: '#00adb5' },
  { value: 'url',      label: '链接',       icon: 'ion:LinkOutline', color: '#4f6ef7' },
  { value: 'date',     label: '日期',      icon: 'ion:CalendarOutline', color: '#8a2be2' },
  { value: 'datetime', label: '日期时间',  icon: 'ion:TimeOutline', color: '#d03050' },
  { value: 'checkbox', label: '勾选',  icon: 'ion:CheckboxOutline',  color: '#18a058' },
  { value: 'select',   label: '单选',    icon: 'ion:OptionsOutline',  color: '#f0a020' },
  { value: 'image',    label: '图片',     icon: 'ion:ImageOutline',  color: '#e91e8c' },
  { value: 'link',     label: '关联',      icon: 'ion:LinkOutline',  color: '#4f6ef7' },
  { value: 'totp',     label: '动态口令',       icon: 'ion:KeyOutline',  color: '#d03050' },
  { value: 'password', label: '密码', icon: 'ion:LockClosedOutline',  color: '#8a6d3b' },
]

type RunningBalanceDraft = Pick<RunningBalanceConfig, 'opening_balance' | 'income_field' | 'expense_field' | 'order_field'>
const emptyRunningBalance = (): RunningBalanceDraft => ({
  opening_balance: '0.00', income_field: null, expense_field: null, order_field: '',
})
const amountFieldOptions = computed(() => props.fields
  .filter(field => !field.virtual && !field.isPrimaryKey && field.column_name !== 'created_at' && ['number', 'currency'].includes(field.field_type))
  .map(field => ({ label: field.title, value: field.column_name })))
const orderFieldOptions = computed(() => props.fields
  .filter(field => !field.virtual && !field.isPrimaryKey && field.column_name !== 'created_at' && ['date', 'datetime'].includes(field.field_type))
  .map(field => ({ label: field.title, value: field.column_name })))
function editFieldTypes(field: FieldMeta) {
  return field.field_type === 'running_balance'
    ? fieldTypes.filter(type => type.value === 'running_balance')
    : fieldTypes.filter(type => type.value !== 'running_balance')
}
function formulaConfig(draft: RunningBalanceDraft): RunningBalanceConfig {
  return {
    version: 1, kind: 'running_balance', opening_balance: draft.opening_balance.trim(),
    income_field: draft.income_field, expense_field: draft.expense_field,
    order_field: draft.order_field, tie_breaker: 'id', null_as_zero: true, precision: 2,
  }
}
function validateRunningBalanceDraft(draft: RunningBalanceDraft): string | null {
  if (!/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(draft.opening_balance.trim())) return '期初余额必须是最多两位小数的数字'
  if (!draft.income_field && !draft.expense_field) return '收入和支出至少选择一个字段'
  if (draft.income_field && draft.income_field === draft.expense_field) return '收入和支出不能使用同一字段'
  if (!draft.order_field) return '请选择计算顺序字段'
  return null
}
function runningBalanceSummary(draft: RunningBalanceDraft): string {
  const income = amountFieldOptions.value.find(field => field.value === draft.income_field)?.label ?? '无收入'
  const expense = amountFieldOptions.value.find(field => field.value === draft.expense_field)?.label ?? '无支出'
  const order = orderFieldOptions.value.find(field => field.value === draft.order_field)?.label ?? '未选顺序'
  return `期初 ${draft.opening_balance || '—'} + ${income} - ${expense}，按 ${order} 累计`
}
function confirmRecalculation(): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: boolean) => { if (!settled) { settled = true; resolve(value) } }
    dialog.warning({
      title: '确认整列重算',
      content: '修改累计余额配置后，这一列的所有显示结果都会立即按新规则重算，原始流水不会被修改。',
      positiveText: '确认重算', negativeText: '取消',
      onPositiveClick: () => finish(true), onNegativeClick: () => finish(false), onClose: () => finish(false),
    })
  })
}

// ── 展开编辑 ──────────────────────────────────────────────────
const expandedCol = ref<string | null>(null)
const saving = ref(false)
const editForm = ref({
  title: '',
  field_type: 'text' as FieldType,
  select_options: [] as SelectOption[],
  link_table: null as string | null,
  link_display_field: null as string | null,
  running_balance: emptyRunningBalance(),
})

// 目标表字段列表（link 字段显示字段选择用）
const targetFieldOptions = ref<Array<{ label: string; value: string }>>([])
async function loadTargetFields(tableName: string | null) {
  targetFieldOptions.value = []
  if (!tableName || tableName === '_notes') return
  try {
    const fields = await api.getFieldMeta(tableName)
    targetFieldOptions.value = fields
      .filter(f => !['id', 'created_at'].includes(f.column_name))
      .map(f => ({ label: f.title, value: f.column_name }))
  } catch {}
}

function toggleExpand(field: FieldMeta) {
  if (expandedCol.value === field.column_name) {
    cancelExpand()
    return
  }
  expandedCol.value = field.column_name
  // link 字段的 select_options 存的是 { link_table: "xxx" }，不是数组
  let linkTable: string | null = null
  let linkDisplayField: string | null = null
  let selectOpts: SelectOption[] = []
  if (field.field_type === 'link' && field.select_options) {
    const config = field.select_options as unknown as { link_table?: string; link_display_field?: string }
    linkTable = config.link_table ?? null
    linkDisplayField = config.link_display_field ?? null
    if (linkTable) loadTargetFields(linkTable)
  } else if (field.select_options) {
    selectOpts = (field.select_options as SelectOption[]).map(o => ({ ...o }))
  }
  editForm.value = {
    title: field.title,
    field_type: field.field_type,
    select_options: selectOpts,
    link_table: linkTable,
    link_display_field: linkDisplayField,
    running_balance: field.formula_config
      ? {
          opening_balance: field.formula_config.opening_balance,
          income_field: field.formula_config.income_field,
          expense_field: field.formula_config.expense_field,
          order_field: field.formula_config.order_field,
        }
      : emptyRunningBalance(),
  }
  // 关闭新增表单
  showAddForm.value = false
}

function cancelExpand() {
  expandedCol.value = null
}

function selectType(type: FieldType) {
  editForm.value.field_type = type
  if (type === 'select' && editForm.value.select_options.length === 0) {
    addSelectOption(editForm.value.select_options)
  }
}

const SELECT_COLORS = ['#4f6ef7', '#18a058', '#f0a020', '#d03050', '#8a2be2', '#00ced1']

function generateOptId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return `opt_${id}`
}

function addSelectOption(options: SelectOption[]) {
  options.push({ id: generateOptId(), value: '', label: '', color: SELECT_COLORS[options.length % SELECT_COLORS.length] })
}

async function saveFieldEdit(field: FieldMeta) {
  if (!editForm.value.title.trim()) {
    message.warning('字段名称不能为空')
    return
  }
  if (editForm.value.field_type === 'running_balance') {
    const error = validateRunningBalanceDraft(editForm.value.running_balance)
    if (error) { message.warning(error); return }
    if (JSON.stringify(formulaConfig(editForm.value.running_balance)) !== JSON.stringify(field.formula_config)) {
      if (!await confirmRecalculation()) return
    }
  }
  saving.value = true
  try {
    const patch: Parameters<typeof api.updateFieldMeta>[2] = {}
    if (editForm.value.title.trim() !== field.title) {
      patch.title = editForm.value.title.trim()
    }
    if (editForm.value.field_type !== field.field_type) {
      patch.field_type = editForm.value.field_type
    }
    if (editForm.value.field_type === 'select') {
      patch.select_options = editForm.value.select_options.filter(o => o.label.trim())
    } else if (editForm.value.field_type === 'link' && editForm.value.link_table) {
      const linkOpts: Record<string, string> = { link_table: editForm.value.link_table }
      if (editForm.value.link_display_field) linkOpts.link_display_field = editForm.value.link_display_field
      patch.select_options = linkOpts as unknown as SelectOption[]
    } else if (field.field_type === 'select') {
      patch.select_options = []
    }
    if (editForm.value.field_type === 'running_balance') {
      patch.formula_config = formulaConfig(editForm.value.running_balance)
    }

    if (Object.keys(patch).length === 0) {
      cancelExpand()
      return
    }

    await api.updateFieldMeta(props.tableName, field.column_name, patch)
    message.success('字段已更新')
    queryClient.invalidateQueries({ queryKey: ['fields', props.tableName] })
    emit('refresh')
    cancelExpand()
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

// ── 可见性切换 ────────────────────────────────────────────────
async function toggleHidden(field: FieldMeta) {
  try {
    await api.updateFieldMeta(props.tableName, field.column_name, { is_hidden: !field.is_hidden })
    queryClient.invalidateQueries({ queryKey: ['fields', props.tableName] })
    emit('refresh')
  } catch (err) {
    message.error((err as Error).message)
  }
}

// ── 拖拽排序 ──────────────────────────────────────────────────
const draggingIdx = ref<number | null>(null)
const dragOverIdx = ref<number | null>(null)

function onDragStart(idx: number, e: DragEvent) {
  draggingIdx.value = idx
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(idx: number) {
  if (draggingIdx.value !== null && draggingIdx.value !== idx) {
    dragOverIdx.value = idx
  }
}

function onDragEnd() {
  draggingIdx.value = null
  dragOverIdx.value = null
}

async function onDrop(targetIdx: number) {
  const from = draggingIdx.value
  draggingIdx.value = null
  dragOverIdx.value = null
  if (from === null || from === targetIdx) return

  const arr = [...localFields.value]
  const [moved] = arr.splice(from, 1)
  arr.splice(targetIdx, 0, moved)
  localFields.value = arr

  try {
    await Promise.all(
      arr.map((f, i) => api.updateFieldMeta(props.tableName, f.column_name, { order_index: i * 10 }))
    )
    queryClient.invalidateQueries({ queryKey: ['fields', props.tableName] })
    emit('refresh')
  } catch (err) {
    message.error((err as Error).message)
  }
}

// ── 添加字段 ──────────────────────────────────────────────────
const showAddForm = ref(false)
const adding = ref(false)
const newField = ref({
  title: '',
  field_type: 'text' as FieldType,
  select_options: [] as SelectOption[],
  link_table: null as string | null,
  link_display_field: null as string | null,
  running_balance: emptyRunningBalance(),
})

function openAddForm() {
  newField.value = { title: '', field_type: 'text', select_options: [], link_table: null, link_display_field: null, running_balance: emptyRunningBalance() }
  showAddForm.value = true
  cancelExpand()
}


async function submitAddField() {
  if (!newField.value.title.trim()) {
    message.warning('请输入字段显示名称')
    return
  }
  if (newField.value.field_type === 'link' && !newField.value.link_table) {
    message.warning('请选择目标表格')
    return
  }
  if (newField.value.field_type === 'running_balance') {
    const error = validateRunningBalanceDraft(newField.value.running_balance)
    if (error) { message.warning(error); return }
  }
  adding.value = true
  try {
    await api.addField(props.tableName, {
      title: newField.value.title.trim(),
      field_type: newField.value.field_type,
      select_options: newField.value.field_type === 'select' ? newField.value.select_options : undefined,
      link_table: newField.value.field_type === 'link' ? newField.value.link_table ?? undefined : undefined,
      link_display_field: newField.value.field_type === 'link' ? newField.value.link_display_field ?? undefined : undefined,
      formula_config: newField.value.field_type === 'running_balance' ? formulaConfig(newField.value.running_balance) : undefined,
    })
    message.success('字段已添加')
    queryClient.invalidateQueries({ queryKey: ['fields', props.tableName] })
    emit('refresh')
    showAddForm.value = false
  } catch (err) {
    message.error((err as Error).message)
  } finally {
    adding.value = false
  }
}

// ── 暴露方法供父组件调用 ──────────────────────────────────────
function expand(colName: string) {
  const field = localFields.value.find(f => f.column_name === colName)
  if (!field) return
  visible.value = true
  nextTick(() => toggleExpand(field))
}

defineExpose({ expand })

// ── 类型图标 & 颜色 ────────────────────────────────────────────
function typeIcon(type: FieldType): string {
  return fieldTypes.find(t => t.value === type)?.icon ?? 'T'
}

function typeColor(type: FieldType): string {
  return fieldTypes.find(t => t.value === type)?.color ?? '#666'
}
</script>

<style scoped>
.field-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-row {
  position: relative;
}
.field-row.drag-over-top::before,
.field-row.drag-over-bottom::after {
  content: '';
  display: block;
  height: 2px;
  background: #4f6ef7;
  border-radius: 2px;
  margin: 1px 0;
}
.field-item.dragging {
  opacity: 0.4;
}
.drag-handle {
  font-size: 14px;
  color: #bbb;
  cursor: grab;
  padding: 0 2px;
  flex-shrink: 0;
  line-height: 1;
  user-select: none;
}
.drag-handle:hover { color: #888; }
.field-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  background: #f8f9fc;
  border: 1px solid #eef0f5;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}
.field-item:hover { background: #f0f2ff; }
.field-item.active {
  background: #eef1ff;
  border-color: #c5ccf5;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.field-item.hidden { opacity: 0.5; }
.field-icon {
  font-size: 13px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
  font-weight: 700;
}
.field-title-area {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.field-name {
  font-size: 13px;
  color: #333;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field-col-hint {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
}
.field-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 13px;
  color: #888;
  transition: background 0.1s;
}
.icon-btn:hover:not(:disabled) { background: #e8eaf0; color: #333; }
.icon-btn:disabled { opacity: 0.3; cursor: default; }
.eye-hidden { opacity: 0.4; }

/* ── 字段编辑器 ─────────────────────── */
.field-editor {
  background: #f4f5fb;
  border: 1px solid #c5ccf5;
  border-top: none;
  border-radius: 0 0 6px 6px;
  padding: 12px;
  margin-bottom: 2px;
}
.editor-section {
  margin-bottom: 12px;
}
.editor-label {
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  border: 1px solid #e0e2ea;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  color: #555;
  transition: all 0.15s;
  font-size: 11px;
}
.type-btn:hover {
  border-color: #4f6ef7;
  color: #4f6ef7;
  background: #f0f2ff;
}
.type-btn.active {
  font-weight: 600;
}
.type-btn-icon {
  font-size: 14px;
  line-height: 1;
}
.type-btn-label {
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.editor-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}
.editor-help {
  margin-top: 5px;
  color: #8a8f9c;
  font-size: 11px;
  line-height: 1.45;
}
.formula-config {
  padding: 10px;
  margin-bottom: 12px;
  border: 1px solid #c9e4df;
  border-radius: 6px;
  background: #f3faf8;
}
.formula-summary {
  margin-top: 8px;
  color: #0f766e;
  font-size: 11px;
  line-height: 1.45;
}

/* ── Select 选项编辑器 ─────────────────── */
.select-options-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.select-opt-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.opt-label-input {
  flex: 1;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  padding: 3px 7px;
  font-size: 13px;
  outline: none;
  background: #fff;
}
.opt-label-input:focus { border-color: #4f6ef7; }
.opt-color-input {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
}
.add-opt-btn {
  background: none;
  border: 1px dashed #ccc;
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 12px;
  color: #888;
  cursor: pointer;
  margin-top: 2px;
}
.add-opt-btn:hover { border-color: #4f6ef7; color: #4f6ef7; }
.link-table-display {
  font-size: 13px;
  color: #4f6ef7;
  padding: 4px 8px;
  background: rgba(79, 110, 247, 0.08);
  border-radius: 4px;
  font-weight: 500;
}

/* ── 添加字段区域 ─────────────────────── */
.add-field-section { margin-top: 16px; }
.add-field-form {
  background: #f8f9fc;
  border: 1px solid #e8eaf0;
  border-radius: 8px;
  padding: 12px;
}
</style>
