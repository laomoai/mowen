Page({
  data: {
    items: [
      { key: 'ux', kind: 'note', ref: 'ux', iconText: '📖', title: 'The Impact of AI on the UX Design Process', meta: '今天 09:41 修改  ·  @UX Research Team 前修改' },
      { key: 'design', kind: 'note', ref: 'design', iconText: '🎨', title: 'Design System Q4 Update Guidelines', meta: '昨天 16:30 修改  ·  @Sarah Jenkins 前修改' },
      { key: 'feedback', kind: 'table', ref: 'feedback', iconText: '📊', title: 'Q3 User Feedback Synthesis & Analysis', meta: '10月24日创建  ·  @ILEARNMORE.CN 前修改' },
      { key: 'growth', kind: 'note', ref: 'growth', iconText: '🌱', title: 'Personal Growth: 2024 Goals', meta: '10月15日创建  ·  仅自己可见' },
      { key: 'launch', kind: 'table', ref: 'launch', iconText: '🚀', title: 'Product Launch Checklist – MVP', meta: '10月12日创建  ·  @Mike Chen 前修改' },
    ],
  },

  onShow() {
    this.setTabSelected()
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
      wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${encodeURIComponent(item.ref)}&title=${encodeURIComponent(item.title || '')}` })
    } else if (item.kind === 'table') {
      wx.navigateTo({ url: `/pages/table-detail/table-detail?table=${encodeURIComponent(item.ref)}&title=${encodeURIComponent(item.title || '')}` })
    } else if (item.kind === 'record') {
      wx.navigateTo({ url: `/pages/record-detail/record-detail?table=${encodeURIComponent(item.tableName)}&id=${encodeURIComponent(item.ref)}&title=${encodeURIComponent(item.title || '')}` })
    }
  },
})
