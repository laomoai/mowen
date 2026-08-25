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
    icon: '',
    fields: [],
    rows: [],
    nextCursor: '',
    filterOpen: false,
    searchText: '',
    loading: true,
  },

  onLoad(options) {
    const title = options.title ? decodeURIComponent(options.title) : '表格'
    const icon = options.icon ? decodeURIComponent(options.icon) : ''
    this.setData({ tableName: options.table || '', title, icon })
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
      const params = { page_size: 50 }
      if (this.data.searchText) params['filter[__all]'] = this.data.searchText
      const res = await getViewerRecords(this.data.tableName, params)
      const table = res.table || {}
      const title = table.title || this.data.title
      const icon = table.icon || this.data.icon || '▦'
      const fields = normalizeFields(res.fields || [])
      const rows = normalizeRows(res.data || [], fields)
      rememberNode({ kind: 'table', ref: this.data.tableName, title, icon })
      wx.setNavigationBarTitle({ title })
      this.setData({
        loading: false,
        title,
        icon,
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

  toggleFilter() {
    this.setData({ filterOpen: !this.data.filterOpen })
  },

  onSearchInput(event) {
    this.setData({ searchText: event.detail.value })
  },

  applyFilter() {
    this.loadRows()
  },

  clearFilter() {
    this.setData({ searchText: '' })
    this.loadRows()
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
  if (fieldType === 'datetime') return formatDateTime(value)
  if (fieldType === 'date') return formatDate(value)
  if (fieldType === 'image') {
    if (value && typeof value === 'object') return value.title || value.name || '[图片]'
    return '[图片]'
  }
  if (typeof value === 'object') return value.title || value.name || value.display || JSON.stringify(value)
  return String(value)
}

function formatDateTime(value) {
  const date = parseDate(value)
  if (!date) return String(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDate(value) {
  const date = parseDate(value)
  if (!date) return String(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const n = Number(value)
  if (!Number.isNaN(n) && n > 0) {
    const date = new Date(n < 1e10 ? n * 1000 : n)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function pad(value) {
  return String(value).padStart(2, '0')
}
