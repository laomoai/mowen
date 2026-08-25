const { getConfig } = require('./storage')

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function request(path, options = {}) {
  const config = getConfig()
  if (!config || !config.baseUrl || !config.apiKey) {
    return Promise.reject(new Error('请先设置 API Key'))
  }
  return wxRequest(config.baseUrl, config.apiKey, path, options)
}

function wxRequest(baseUrl, apiKey, path, options = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      success(res) {
        const status = res.statusCode || 0
        const body = res.data || {}
        if (status >= 200 && status < 300) {
          resolve(body)
          return
        }
        const message = body.error && body.error.message ? body.error.message : `请求失败：${status}`
        reject(new Error(message))
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络不可用'))
      },
    })
  })
}

function validateConnection(baseUrl, apiKey) {
  return wxRequest(baseUrl, apiKey, '/api/viewer/me')
}

function getWorkspaceTree() {
  return request('/api/workspace/tree')
}

function getNote(id) {
  return request(`/api/notes/${encodeURIComponent(id)}`)
}

function getViewerRecords(tableName, params = {}) {
  const query = buildQuery(params)
  return request(`/api/viewer/tables/${encodeURIComponent(tableName)}/records${query}`)
}

function getViewerRecord(tableName, id, params = {}) {
  const query = buildQuery(params)
  return request(`/api/viewer/tables/${encodeURIComponent(tableName)}/records/${encodeURIComponent(id)}${query}`)
}

function signFile(key) {
  return request(`/api/files/sign?key=${encodeURIComponent(key)}`)
}

function buildQuery(params) {
  const pairs = []
  Object.keys(params).forEach((key) => {
    const value = params[key]
    if (value === undefined || value === null || value === '') return
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  })
  return pairs.length ? `?${pairs.join('&')}` : ''
}

module.exports = {
  normalizeBaseUrl,
  validateConnection,
  getWorkspaceTree,
  getNote,
  getViewerRecords,
  getViewerRecord,
  signFile,
}
