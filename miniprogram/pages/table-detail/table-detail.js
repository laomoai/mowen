const { getViewerRecords } = require('../../utils/api')
const { rememberNode, rememberRecord } = require('../../utils/recent')

Page({
  data: {
    menuTop: 48,
    menuHeight: 32,
    navHeight: 88,
    isFullscreen: false,
    tableName: '',
    title: '季度财务报表',
    fields: [],
    rows: [],
    nextCursor: '',
    loading: true,
  },

  onLoad(options) {
    const title = options.title ? decodeURIComponent(options.title) : '表格'
    this.setData({ tableName: options.table || '', title })
    this.syncNavMetrics()
    this.loadRows()
  },

  onUnload() {
    this.setPortrait()
  },

  onResize(res) {
    const size = res && res.size ? res.size : {}
    const isLandscape = Number(size.windowWidth || 0) > Number(size.windowHeight || 0)
    if (this.data.isFullscreen !== isLandscape) {
      this.setData({ isFullscreen: isLandscape })
    }
  },

  syncNavMetrics() {
    try {
      const system = wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect()
      const statusBarHeight = system.statusBarHeight || 44
      const menuTop = menu && menu.top ? menu.top : statusBarHeight + 4
      const menuHeight = menu && menu.height ? menu.height : 32
      const navHeight = menu && menu.bottom ? menu.bottom + 8 : menuTop + menuHeight + 8
      this.setData({ menuTop, menuHeight, navHeight })
    } catch (err) {
      this.setData({ menuTop: 48, menuHeight: 32, navHeight: 88 })
    }
  },

  enterFullscreen() {
    this.setData({ isFullscreen: true })
    if (wx.setPageOrientation) {
      wx.setPageOrientation({
        orientation: 'landscape',
        fail: () => wx.showToast({ title: '请旋转手机查看', icon: 'none' }),
      })
    }
  },

  exitFullscreen() {
    this.setData({ isFullscreen: false })
    this.setPortrait()
  },

  setPortrait() {
    if (!wx.setPageOrientation) return
    wx.setPageOrientation({ orientation: 'portrait' })
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/workspace/workspace' })
      },
    })
  },

  async loadRows() {
    if (!this.data.tableName) return
    this.setData({ loading: true })
    try {
      const res = await getViewerRecords(this.data.tableName, { page_size: 50 })
      const fields = normalizeFields(res.fields || [])
      const rows = normalizeRows(res.data || [], fields)
      rememberNode({ kind: 'table', ref: this.data.tableName, title: this.data.title })
      this.setData({
        loading: false,
        fields,
        rows,
        nextCursor: res.meta && res.meta.next_cursor ? res.meta.next_cursor : '',
      })
    } catch (err) {
      this.setData({ loading: false, fields: [], rows: [] })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  openRecord(event) {
    const id = event.currentTarget.dataset.id
    const row = this.data.rows.find((item) => String(item.id) === String(id))
    if (!row || !id) return
    const title = row.title || `#${id}`
    rememberRecord(this.data.tableName, row.raw, title)
    wx.navigateTo({
      url: `/pages/record-detail/record-detail?table=${encodeURIComponent(this.data.tableName)}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`,
    })
  },
})

function normalizeFields(fields) {
  const visible = fields.filter((field) => field.column_name !== 'id')
  const picked = visible.length ? visible : fields
  return picked.map((field, index) => ({
    ...field,
    title: field.title || field.column_name,
    className: index === 0 ? 'month' : valueClass(field),
  }))
}

function normalizeRows(records, fields) {
  return records.map((record) => {
    const values = fields.map((field) => ({
      key: field.column_name,
      value: stringifyValue(record[field.column_name], field.field_type),
      className: field.className,
    }))
    return {
      id: record.id,
      raw: record,
      title: firstTitle(record, fields),
      values,
    }
  })
}

function firstTitle(record, fields) {
  const field = fields.find((item) => record[item.column_name] != null && record[item.column_name] !== '')
  return field ? stringifyValue(record[field.column_name], field.field_type) : `#${record.id}`
}

function valueClass(field) {
  return field.field_type === 'currency' || field.field_type === 'number' || field.field_type === 'percent'
    ? 'profit'
    : ''
}

function stringifyValue(value, fieldType) {
  if (value == null || value === '') return '空'
  if (fieldType === 'checkbox') return value ? '是' : '否'
  if (fieldType === 'image') {
    if (value && typeof value === 'object') return value.title || value.name || '[图片]'
    return '[图片]'
  }
  if (typeof value === 'object') return value.title || value.name || value.display || JSON.stringify(value)
  return String(value)
}
