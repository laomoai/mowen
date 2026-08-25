const { clearConfig, clearRecent, getConfig } = require('../../utils/storage')
const { validateConnection } = require('../../utils/api')

Page({
  data: {
    baseUrl: '',
    keyType: '',
    scope: '',
    workspaceSubtitle: '基础版 · 已同步',
    loading: false,
  },

  onShow() {
    const config = getConfig()
    if (!config) {
      wx.reLaunch({ url: '/pages/setup/setup' })
      return
    }
    this.setData({
      baseUrl: config.baseUrl,
      keyType: config.keyType || '未知',
      scope: config.scope || '未知',
      workspaceSubtitle: workspaceSubtitle(config),
    })
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/recent/recent' })
      },
    })
  },

  async revalidate() {
    const config = getConfig()
    if (!config) return
    this.setData({ loading: true })
    try {
      await validateConnection(config.baseUrl, config.apiKey)
      wx.showToast({ title: '连接正常', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '验证失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  clearAll() {
    wx.showModal({
      title: '清除 API Key',
      content: '会同时清空最近访问记录。',
      confirmText: '清除',
      confirmColor: '#ba1a1a',
      success(res) {
        if (!res.confirm) return
        clearConfig()
        clearRecent()
        wx.reLaunch({ url: '/pages/setup/setup' })
      },
    })
  },
})

function workspaceSubtitle(config) {
  const workspace = config.workspace || {}
  const total = Number(workspace.folder_count || 0) + Number(workspace.note_count || 0) + Number(workspace.table_count || 0)
  const scope = config.scope === 'groups' ? '文件夹授权' : '全部授权'
  return `${scope} · ${total} 个项目`
}
