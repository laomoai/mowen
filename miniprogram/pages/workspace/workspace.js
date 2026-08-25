const { rememberNode } = require('../../utils/recent')
const { getWorkspaceTree } = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 44,
    menuTop: 48,
    menuHeight: 32,
    navHeight: 88,
    avatarSize: 30,
    loading: true,
    nodes: [],
    folders: [],
    files: [],
    stack: [],
    currentParentId: null,
    currentTitle: '全部',
  },

  onShow() {
    this.syncNavMetrics()
    this.setTabSelected()
    this.loadWorkspace()
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

  async loadWorkspace() {
    this.setData({ loading: true })
    try {
      const res = await getWorkspaceTree()
      const nodes = normalizeNodes(res.data || [])
      this.setData({ loading: false, nodes })
      this.refreshItems()
    } catch (err) {
      this.setData({ loading: false, nodes: [], folders: [], files: [] })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  refreshItems() {
    const nodes = this.data.nodes
    this.setData({
      folders: nodes
        .filter((node) => node.kind === 'folder' && !node.parent_id)
        .map((node, index) => ({
          ...node,
          count: countFolderItems(nodes, node.id),
          theme: folderTheme(index),
        })),
      files: nodes
        .filter((node) => node.kind !== 'folder')
        .map((node) => ({
          ...node,
          meta: node.kind === 'table' ? '表格' : 'MD 文档',
          ext: node.kind === 'table' ? '' : '',
          theme: node.kind === 'table' ? 'sheet' : 'doc',
        })),
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
      wx.showToast({ title: `${node.count || 0} 个项目`, icon: 'none' })
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

function normalizeNodes(nodes) {
  return nodes
    .map((node) => ({
      ...node,
      id: String(node.id || ''),
      parent_id: node.parent_id || null,
      ref: node.ref || node.id,
      title: node.title || '未命名',
      sort_order: Number(node.sort_order || 0),
    }))
    .filter((node) => node.id && node.kind)
    .sort((a, b) => a.sort_order - b.sort_order)
}

function countFolderItems(nodes, folderId) {
  const childMap = new Map()
  nodes.forEach((node) => {
    if (!node.parent_id) return
    const list = childMap.get(node.parent_id) || []
    list.push(node)
    childMap.set(node.parent_id, list)
  })
  let count = 0
  const queue = [...(childMap.get(folderId) || [])]
  while (queue.length) {
    const node = queue.shift()
    if (node.kind === 'folder') {
      queue.push(...(childMap.get(node.id) || []))
    } else {
      count += 1
    }
  }
  return count
}

function folderTheme(index) {
  return ['blue', 'green', 'red'][index % 3]
}
