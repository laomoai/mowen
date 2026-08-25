const { getViewerRecord } = require('../../utils/api')
const { rememberTouchStart, isEdgeSwipeBack } = require('../../utils/edge-swipe')

Page({
  data: {
    loading: true,
    tableName: '',
    id: '',
    title: '记录',
    items: [],
  },

  onLoad(options) {
    const title = options.title ? decodeURIComponent(options.title) : '记录'
    this.setData({
      tableName: options.table,
      id: options.id,
      title,
    })
    wx.setNavigationBarTitle({ title })
    this.loadRecord()
  },

  async loadRecord() {
    this.setData({ loading: true })
    try {
      const res = await getViewerRecord(this.data.tableName, this.data.id)
      const record = res.data || {}
      const fields = res.fields || []
      const items = fields
        .filter((field) => field.column_name !== 'id')
        .map((field) => toFieldItem(field, record[field.column_name]))
      this.setData({ loading: false, items })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '打开失败', icon: 'none' })
    }
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/workspace/workspace' })
      },
    })
  },

  onTouchStart(event) {
    rememberTouchStart(this, event)
  },

  onTouchEnd(event) {
    if (isEdgeSwipeBack(this, event)) {
      this.goBack()
    }
  },
})

function toFieldItem(field, value) {
  const isImage = field.field_type === 'image'
  const image = isImage && value && typeof value === 'object' ? value : null
  return {
    ...field,
    isImage,
    displayUrl: image && (image.display_url || image.thumb_url),
    valueText: stringifyValue(value, field.field_type),
  }
}

function stringifyValue(value, fieldType) {
  if (value == null || value === '') return '空'
  if (fieldType === 'checkbox') return value ? '是' : '否'
  if (fieldType === 'datetime') return formatDateTime(value)
  if (fieldType === 'date') return formatDate(value)
  if (typeof value === 'object') return value.title || value.name || JSON.stringify(value)
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
