const CONFIG_KEY = 'mowen_reader_config'
const RECENT_KEY = 'mowen_reader_recent'

function getConfig() {
  return wx.getStorageSync(CONFIG_KEY) || null
}

function setConfig(config) {
  wx.setStorageSync(CONFIG_KEY, config)
}

function clearConfig() {
  wx.removeStorageSync(CONFIG_KEY)
}

function getRecent() {
  return wx.getStorageSync(currentRecentKey()) || []
}

function addRecent(item) {
  const current = getRecent()
  const next = [item, ...current.filter((entry) => entry.key !== item.key)].slice(0, 30)
  wx.setStorageSync(currentRecentKey(), next)
}

function clearRecent() {
  wx.removeStorageSync(currentRecentKey())
}

function currentRecentKey() {
  const config = getConfig()
  if (!config || !config.baseUrl || !config.apiKey) return `${RECENT_KEY}:anonymous`
  return `${RECENT_KEY}:${hashText(`${config.baseUrl}|${config.apiKey}`)}`
}

function hashText(value) {
  let hash = 5381
  const text = String(value || '')
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

module.exports = {
  getConfig,
  setConfig,
  clearConfig,
  getRecent,
  addRecent,
  clearRecent,
  currentRecentKey,
}
