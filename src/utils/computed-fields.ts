import { isValidIdentifier } from './schema-cache'

export type RunningBalanceConfig = {
  version: 1
  kind: 'running_balance'
  opening_balance: string
  income_field: string | null
  expense_field: string | null
  order_field: string
  tie_breaker: 'id'
  null_as_zero: true
  precision: 2
}

export type ComputedFieldMeta = {
  column_name: string
  field_type: string
  formula_config: unknown | null
}

export type PhysicalField = {
  name: string
  fieldType: string
}

export type RunningBalanceField = {
  columnName: string
  config: RunningBalanceConfig
}

const DECIMAL_RE = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/

export class FormulaConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormulaConfigError'
  }
}

export function parseRunningBalanceConfig(value: unknown): RunningBalanceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FormulaConfigError('累计余额配置不能为空')
  }
  const input = value as Record<string, unknown>
  const opening = String(input.opening_balance ?? '').trim()
  const income = input.income_field == null || input.income_field === '' ? null : String(input.income_field)
  const expense = input.expense_field == null || input.expense_field === '' ? null : String(input.expense_field)
  const order = String(input.order_field ?? '')

  if (input.version !== 1 || input.kind !== 'running_balance') {
    throw new FormulaConfigError('不支持的累计余额配置版本')
  }
  if (!DECIMAL_RE.test(opening) || !Number.isFinite(Number(opening))) {
    throw new FormulaConfigError('期初余额必须是最多两位小数的有效数字')
  }
  if ((!income && !expense) || (income && expense && income === expense)) {
    throw new FormulaConfigError('收入和支出至少选择一个，且不能选择同一字段')
  }
  for (const name of [income, expense, order].filter((item): item is string => !!item)) {
    if (!isValidIdentifier(name)) throw new FormulaConfigError('配置包含无效字段')
  }
  if (!order) throw new FormulaConfigError('必须选择交易时间字段')
  if (input.tie_breaker !== 'id' || input.null_as_zero !== true || input.precision !== 2) {
    throw new FormulaConfigError('累计余额排序、空值或精度配置无效')
  }

  return {
    version: 1,
    kind: 'running_balance',
    opening_balance: opening,
    income_field: income,
    expense_field: expense,
    order_field: order,
    tie_breaker: 'id',
    null_as_zero: true,
    precision: 2,
  }
}

export function validateRunningBalanceConfig(value: unknown, physicalFields: PhysicalField[]): RunningBalanceConfig {
  const config = parseRunningBalanceConfig(value)
  const fields = new Map(physicalFields.map(field => [field.name, field.fieldType]))
  for (const name of [config.income_field, config.expense_field, config.order_field].filter((item): item is string => !!item)) {
    if (name === 'id' || name === 'created_at') {
      throw new FormulaConfigError('累计余额不能使用系统字段')
    }
  }
  for (const name of [config.income_field, config.expense_field].filter((item): item is string => !!item)) {
    if (!['number', 'currency'].includes(fields.get(name) ?? '')) {
      throw new FormulaConfigError(`字段 ${name} 必须是数字或货币类型`)
    }
  }
  if (!['date', 'datetime'].includes(fields.get(config.order_field) ?? '')) {
    throw new FormulaConfigError(`字段 ${config.order_field} 必须是日期或日期时间类型`)
  }
  return config
}

export function getRunningBalanceField(fields: ComputedFieldMeta[]): RunningBalanceField | null {
  const field = fields.find(item => item.field_type === 'running_balance')
  if (!field) return null
  if (!isValidIdentifier(field.column_name)) throw new FormulaConfigError('累计余额字段名无效')
  return { columnName: field.column_name, config: parseRunningBalanceConfig(field.formula_config) }
}

function quoted(name: string): string {
  if (!isValidIdentifier(name)) throw new FormulaConfigError('累计余额字段标识符无效')
  return `"${name}"`
}

export function buildRunningBalanceSource(tableName: string, field: RunningBalanceField): { sql: string; params: Array<string | number> } {
  const config = field.config
  const table = quoted(tableName)
  const result = quoted(field.columnName)
  const order = quoted(config.order_field)
  const income = config.income_field ? `COALESCE(CAST(${quoted(config.income_field)} AS NUMERIC), 0)` : '0'
  const expense = config.expense_field ? `COALESCE(CAST(${quoted(config.expense_field)} AS NUMERIC), 0)` : '0'
  const missingOrder = `(${order} IS NULL OR TRIM(CAST(${order} AS TEXT)) = '')`

  return {
    sql: `(SELECT t.*,
      CASE WHEN ${missingOrder} THEN NULL ELSE
        ROUND(CAST(? AS NUMERIC) + SUM(
          CASE WHEN ${missingOrder} THEN 0 ELSE ${income} - ${expense} END
        ) OVER (
          ORDER BY CASE WHEN ${missingOrder} THEN 1 ELSE 0 END, ${order} ASC, "id" ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ), 2)
      END AS ${result}
    FROM ${table} AS t) AS "__mowen_computed"`,
    params: [config.opening_balance],
  }
}

export function runningBalanceIndexName(tableName: string, orderField: string): string {
  const value = `${tableName}:${orderField}`
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `idx_rb_${(hash >>> 0).toString(16)}`
}
