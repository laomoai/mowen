const { setConfig } = require('../../utils/storage')
const { normalizeBaseUrl, validateConnection } = require('../../utils/api')

Page({
  data: {
    baseUrl: 'https://mowen.lemoai.cn',
    apiKey: '',
    settingsOpen: false,
    loading: false,
    error: '',
  },

  onBaseUrlInput(event) {
    this.setData({ baseUrl: event.detail.value, error: '' })
  },

  onApiKeyInput(event) {
    this.setData({ apiKey: event.detail.value, error: '' })
  },

  toggleSettings() {
    this.setData({ settingsOpen: !this.data.settingsOpen })
  },

  async connect() {
    const baseUrl = normalizeBaseUrl(this.data.baseUrl)
    const apiKey = String(this.data.apiKey || '').trim()
    if (!baseUrl || !apiKey) {
      this.setData({ error: '请填写服务地址和 API Key' })
      return
    }

    this.setData({ loading: true, error: '' })
    try {
      const res = await validateConnection(baseUrl, apiKey)
      setConfig({
        baseUrl,
        apiKey,
        keyType: res.data && res.data.key_type,
        scope: res.data && res.data.scope,
        user: res.data && res.data.user,
        team: res.data && res.data.team,
        workspace: res.data && res.data.workspace,
        savedAt: Date.now(),
      })
      wx.switchTab({ url: '/pages/recent/recent' })
    } catch (err) {
      this.setData({ error: err.message || '连接失败，请检查 API Key' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
