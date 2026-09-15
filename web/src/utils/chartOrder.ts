export type ChartOrderField = {
  column_name: string
  field_type: string
  formula_config?: {
    kind?: string
    order_field?: string
    order_direction?: 'asc' | 'desc'
  } | null
}

type ChartRecord = Record<string, unknown>

function isMissing(value: unknown): boolean {
  return value == null || String(value).trim() === ''
}

function compareValues(left: unknown, right: unknown, numeric: boolean): number {
  if (numeric) {
    const leftNumber = Number(left)
    const rightNumber = Number(right)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber
    }
  }
  return String(left).localeCompare(String(right))
}

/**
 * Raw charts normally sort by their X-axis label. A running balance is different:
 * its points must stay in the exact order used by the balance window calculation,
 * even when the X-axis displays a descriptive field such as project or memo.
 */
export function sortRawChartRecords(
  records: ChartRecord[],
  xColumn: string,
  yColumns: string[],
  fields: ChartOrderField[],
): ChartRecord[] {
  const runningBalance = fields.find(field =>
    field.field_type === 'running_balance' && yColumns.includes(field.column_name)
  )
  const config = runningBalance?.formula_config

  if (config?.kind === 'running_balance' && config.order_field) {
    const orderField = config.order_field
    const direction = config.order_direction === 'desc' ? -1 : 1
    return [...records].sort((left, right) => {
      const leftValue = left[orderField]
      const rightValue = right[orderField]
      const leftMissing = isMissing(leftValue)
      const rightMissing = isMissing(rightValue)
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1

      const orderResult = leftMissing
        ? 0
        : compareValues(leftValue, rightValue, orderField === 'id')
      if (orderResult !== 0) return orderResult * direction

      return compareValues(left.id, right.id, true) * direction
    })
  }

  if (!xColumn) return [...records]
  return [...records].sort((left, right) =>
    String(left[xColumn]).localeCompare(String(right[xColumn]))
  )
}
