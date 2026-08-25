const { getRecent } = require('../../utils/storage')

Page({
  data: {
    items: [],
  },

  onShow() {
    this.setTabSelected()
    this.loadRecent()
  },

  setTabSelected() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  openRecent(event) {
    const key = event.currentTarget.dataset.key
    const item = this.data.items.find((entry) => entry.key === key)
    if (!item) return
    if (item.kind === 'note') {
      wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${encodeURIComponent(item.ref)}&title=${encodeURIComponent(item.title || '')}&icon=${encodeURIComponent(item.icon || '')}` })
    } else if (item.kind === 'table') {
      wx.navigateTo({ url: `/pages/table-detail/table-detail?table=${encodeURIComponent(item.ref)}&title=${encodeURIComponent(item.title || '')}&icon=${encodeURIComponent(item.icon || '')}` })
    } else if (item.kind === 'record') {
      wx.navigateTo({ url: `/pages/record-detail/record-detail?table=${encodeURIComponent(item.tableName)}&id=${encodeURIComponent(item.ref)}&title=${encodeURIComponent(item.title || '')}` })
    }
  },

  loadRecent() {
    const items = getRecent().map((entry) => ({
      ...entry,
      iconText: iconForKind(entry.kind, entry.icon),
      meta: metaForEntry(entry),
    }))
    this.setData({ items })
  },
})

function iconForKind(kind, icon) {
  if (icon) return icon
  if (kind === 'table') return '▦'
  if (kind === 'record') return '#'
  return '▤'
}

function metaForEntry(entry) {
  const kindText = entry.kind === 'table' ? '表格' : entry.kind === 'record' ? '记录' : 'MD'
  return `${formatVisitedAt(entry.visitedAt)}访问  ·  ${kindText}`
}

function formatVisitedAt(value) {
  const date = new Date(value || Date.now())
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())} `
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 `
}

function pad(value) {
  return String(value).padStart(2, '0')
}
