const { getViewerRecord } = require('../../utils/api')

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
  if (typeof value === 'object') return value.title || value.name || JSON.stringify(value)
  return String(value)
}
