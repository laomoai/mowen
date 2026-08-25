const { rememberNode } = require('../../utils/recent')

Page({
  data: {
    statusBarHeight: 44,
    menuTop: 48,
    menuHeight: 32,
    navHeight: 88,
    avatarSize: 30,
    loading: false,
    nodes: [
      { id: 'folder-1', kind: 'folder', title: '工作汇报', count: 12, theme: 'blue' },
      { id: 'folder-2', kind: 'folder', title: '项目协同', count: 8, theme: 'green' },
      { id: 'folder-3', kind: 'folder', title: '设计资产', count: 24, theme: 'red' },
      { id: 'file-1', kind: 'note', ref: 'summary', title: '2023年度总结报告.docx', meta: '10月24日 · 2.4 MB', ext: '', theme: 'doc' },
      { id: 'file-2', kind: 'table', ref: 'finance', title: 'Q4财务预算及开支明细.xlsx', meta: '10月20日 · 1.1 MB', ext: '', theme: 'sheet' },
      { id: 'file-3', kind: 'note', ref: 'manual', title: '产品V2.0设计规范手册.pdf', meta: '10月18日 · 8.5 MB', ext: 'PDF', theme: 'pdf' },
    ],
    folders: [],
    files: [],
    stack: [],
    currentParentId: null,
    currentTitle: '全部',
  },

  onShow() {
    this.syncNavMetrics()
    this.setTabSelected()
    this.refreshItems()
  },

  syncNavMetrics() {
    try {
      const system = wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect()
      const statusBarHeight = system.statusBarHeight || 44
      const menuTop = menu && menu.top ? menu.top : statusBarHeight + 4
      const menuHeight = menu && menu.height ? menu.height : 32
      const navHeight = menu && menu.bottom ? menu.bottom + 8 : menuTop + menuHeight + 8
      const avatarSize = Math.max(28, Math.min(32, menuHeight))
      this.setData({ statusBarHeight, menuTop, menuHeight, navHeight, avatarSize })
    } catch (err) {
      this.setData({ statusBarHeight: 44, menuTop: 48, menuHeight: 32, navHeight: 88, avatarSize: 30 })
    }
  },

  setTabSelected() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  refreshItems() {
    this.setData({
      folders: this.data.nodes.filter((node) => node.kind === 'folder'),
      files: this.data.nodes.filter((node) => node.kind !== 'folder'),
    })
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  openNode(event) {
    const id = event.currentTarget.dataset.id
    const node = this.data.nodes.find((item) => item.id === id)
    if (!node) return
    if (node.kind === 'folder') {
      wx.showToast({ title: '静态预览', icon: 'none' })
      return
    }
    rememberNode(node)
    if (node.kind === 'note') {
      wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${encodeURIComponent(node.ref || node.id)}&title=${encodeURIComponent(node.title || '')}` })
    } else if (node.kind === 'table') {
      wx.navigateTo({ url: `/pages/table-detail/table-detail?table=${encodeURIComponent(node.ref)}&title=${encodeURIComponent(node.title || '')}` })
    }
  },
})
