const { clearConfig, clearRecent, getConfig, setConfig } = require('../../utils/storage')
const { validateConnection } = require('../../utils/api')

Page({
  data: {
    baseUrl: '',
    keyType: '',
    scope: '',
    profileName: '墨问用户',
    profileInitial: '墨',
    profileEmail: '',
    profilePicture: '',
    workspaceTitle: '个人写作空间',
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
      profileName: (config.user && config.user.name) || '墨问用户',
      profileInitial: initialOf((config.user && config.user.name) || '墨问用户'),
      profileEmail: (config.user && config.user.email) || '',
      profilePicture: avatarUrl(config, config.user),
      workspaceTitle: (config.team && config.team.name) || (config.workspace && config.workspace.title) || '个人写作空间',
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
      const res = await validateConnection(config.baseUrl, config.apiKey)
      const data = res.data || {}
      const nextConfig = {
        ...config,
        keyType: data.key_type,
        scope: data.scope,
        user: data.user,
        team: data.team,
        workspace: data.workspace,
        savedAt: Date.now(),
      }
      setConfig(nextConfig)
      this.setData({
        profileName: (data.user && data.user.name) || '墨问用户',
        profileInitial: initialOf((data.user && data.user.name) || '墨问用户'),
        profileEmail: (data.user && data.user.email) || '',
        profilePicture: avatarUrl(nextConfig, data.user),
        workspaceTitle: (data.team && data.team.name) || (data.workspace && data.workspace.title) || '个人写作空间',
        workspaceSubtitle: workspaceSubtitle(nextConfig),
      })
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
  const files = Number(workspace.note_count || 0) + Number(workspace.table_count || 0)
  const scope = config.scope === 'groups' ? '文件夹授权' : '全部授权'
  return `${scope} · ${files} 个文件`
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

function initialOf(value) {
  return String(value || '墨').slice(0, 1)
}
