const { rememberNode } = require('../../utils/recent')
const { getWorkspaceTree } = require('../../utils/api')
const { getConfig } = require('../../utils/storage')
const { formatIcon, titleWithoutIcon } = require('../../utils/icons')
const { rememberTouchStart, isEdgeSwipeBack } = require('../../utils/edge-swipe')

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
    avatarUrl: '',
  },

  onShow() {
    this.syncNavMetrics()
    this.setTabSelected()
    this.refreshAvatar()
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
    const parentId = this.data.currentParentId
    this.setData({
      folders: nodes
        .filter((node) => node.kind === 'folder' && node.parent_id === parentId)
        .map((node, index) => ({
          ...node,
          count: countFolderItems(nodes, node.id),
          countText: `${countFolderItems(nodes, node.id)} 个文件`,
          theme: folderTheme(index),
          displayIcon: formatIcon(node.icon, 'folder'),
          displayTitle: titleWithoutIcon(node.title, node.icon, 'folder'),
        })),
      files: nodes
        .filter((node) => node.kind !== 'folder' && (parentId ? node.parent_id === parentId : true))
        .map((node) => ({
          ...node,
          meta: node.kind === 'table'
            ? `${Number(node.row_count || 0)} 条记录`
            : 'MD 文档',
          ext: formatIcon(node.icon, node.kind),
          displayTitle: titleWithoutIcon(node.title, node.icon, node.kind),
          theme: node.kind === 'table' ? 'sheet' : 'doc',
        })),
    })
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  refreshAvatar() {
    const config = getConfig()
    this.setData({
      avatarUrl: avatarUrl(config, config && config.user),
    })
  },

  openNode(event) {
    const id = event.currentTarget.dataset.id
    const node = this.data.nodes.find((item) => item.id === id)
    if (!node) return
    if (node.kind === 'folder') {
      this.setData({
        stack: [...this.data.stack, { id: this.data.currentParentId, title: this.data.currentTitle }],
        currentParentId: node.id,
        currentTitle: node.title || '文件夹',
      })
      this.refreshItems()
      return
    }
    rememberNode(node)
    if (node.kind === 'note') {
      wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${encodeURIComponent(node.ref || node.id)}&title=${encodeURIComponent(node.title || '')}&icon=${encodeURIComponent(node.icon || '')}` })
    } else if (node.kind === 'table') {
      wx.navigateTo({ url: `/pages/table-detail/table-detail?table=${encodeURIComponent(node.ref)}&title=${encodeURIComponent(node.title || '')}&icon=${encodeURIComponent(node.icon || '')}` })
    }
  },

  goFolderBack() {
    const stack = [...this.data.stack]
    const prev = stack.pop()
    this.setData({
      stack,
      currentParentId: prev ? prev.id : null,
      currentTitle: prev ? prev.title : '全部',
    })
    this.refreshItems()
  },

  onTouchStart(event) {
    rememberTouchStart(this, event)
  },

  onTouchEnd(event) {
    if (!this.data.stack.length) return
    if (isEdgeSwipeBack(this, event)) {
      this.goFolderBack()
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
      row_count: node.row_count == null ? null : Number(node.row_count || 0),
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

function absoluteUrl(config, value) {
  if (!value) return ''
  if (/^https?:/.test(value)) return value
  const baseUrl = config && config.baseUrl ? String(config.baseUrl).replace(/\/+$/, '') : ''
  return `${baseUrl}${String(value).startsWith('/') ? value : `/${value}`}`
}

function avatarUrl(config, user) {
  const email = user && user.email ? String(user.email).trim().toLowerCase() : 'user'
  const picture = user && user.picture ? String(user.picture).trim() : ''
  if (picture && !picture.includes('/api/avatars/')) return absoluteUrl(config, picture)
  return absoluteUrl(config, `/api/avatars/${encodeURIComponent(email || 'user')}?v=color`)
}
