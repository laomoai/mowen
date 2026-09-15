import assert from 'node:assert/strict'
import { sortRawChartRecords } from '../web/src/utils/chartOrder'

const fields = [
  { column_name: 'project', field_type: 'text' },
  {
    column_name: 'balance',
    field_type: 'running_balance',
    formula_config: { kind: 'running_balance', order_field: 'id', order_direction: 'asc' as const },
  },
]

const records = [
  { id: 6, project: 'davienovel.cn 域名购买', balance: 3437 },
  { id: 5, project: 'davienovel.com 域名购买', balance: 3475 },
  { id: 4, project: '大伟AI小说家认证', balance: 3560 },
  { id: 3, project: 'Cursor pro', balance: 3860 },
  { id: 2, project: '资金入池', balance: 4000 },
  { id: 1, project: '资金入池', balance: 2000 },
]

const balanceOrder = sortRawChartRecords(records, 'project', ['balance'], fields)
assert.deepEqual(
  balanceOrder.map(row => [row.id, row.balance]),
  [[1, 2000], [2, 4000], [3, 3860], [4, 3560], [5, 3475], [6, 3437]],
  '累计余额图表必须使用公式的 ID 正序，而不是项目名称排序',
)

const ordinaryOrder = sortRawChartRecords(records, 'project', [], fields)
assert.deepEqual(
  ordinaryOrder.map(row => row.project),
  [...records].map(row => row.project).sort((a, b) => a.localeCompare(b)),
  '普通原始图表继续按 X 轴标签排序',
)

const descendingFields = [{
  ...fields[1],
  formula_config: { kind: 'running_balance', order_field: 'id', order_direction: 'desc' as const },
}]
const descendingOrder = sortRawChartRecords(records, 'project', ['balance'], descendingFields)
assert.deepEqual(descendingOrder.map(row => row.id), [6, 5, 4, 3, 2, 1])

const datedRecords = [
  { id: 4, project: '待补日期', booked_at: null, balance: null },
  { id: 3, project: '第三笔', booked_at: '2026-09-13', balance: 70 },
  { id: 2, project: '第二笔', booked_at: '2026-09-12', balance: 80 },
  { id: 1, project: '第一笔', booked_at: '2026-09-12', balance: 100 },
]
const dateFields = [{
  column_name: 'balance',
  field_type: 'running_balance',
  formula_config: { kind: 'running_balance', order_field: 'booked_at', order_direction: 'asc' as const },
}]
const dateOrder = sortRawChartRecords(datedRecords, 'project', ['balance'], dateFields)
assert.deepEqual(
  dateOrder.map(row => row.id),
  [1, 2, 3, 4],
  '日期相同时按 ID 打破平局，日期为空的记录保持在末尾',
)

console.log('chart order smoke ok')
