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
  return wx.getStorageSync(RECENT_KEY) || []
}

function addRecent(item) {
  const current = getRecent()
  const next = [item, ...current.filter((entry) => entry.key !== item.key)].slice(0, 30)
  wx.setStorageSync(RECENT_KEY, next)
}

function clearRecent() {
  wx.removeStorageSync(RECENT_KEY)
}

module.exports = {
  getConfig,
  setConfig,
  clearConfig,
  getRecent,
  addRecent,
  clearRecent,
}
