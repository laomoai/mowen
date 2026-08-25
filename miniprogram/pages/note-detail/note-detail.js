const { getNote, signFile } = require('../../utils/api')
const { parseMarkdown } = require('../../utils/markdown')
const { getConfig } = require('../../utils/storage')
const { rememberNode } = require('../../utils/recent')
const { formatIcon } = require('../../utils/icons')
const { rememberTouchStart, isEdgeSwipeBack } = require('../../utils/edge-swipe')

Page({
  data: {
    loading: true,
    note: {},
    nodes: [],
    title: 'Markdown',
    icon: '',
    updatedText: '',
  },

  onLoad(options) {
    this.noteId = options.id
    const title = options.title ? decodeURIComponent(options.title) : 'Markdown'
    const icon = options.icon ? decodeURIComponent(options.icon) : ''
    this.setData({ title, icon: formatIcon(icon, 'note') })
    wx.setNavigationBarTitle({ title })
    this.loadNote()
  },

  async loadNote() {
    this.setData({ loading: true })
    try {
      const res = await getNote(this.noteId)
      const note = res.data || {}
      const content = await signMarkdownImages(note.content || '')
      const nodes = parseMarkdown(content)
      const title = note.title || this.data.title || 'Markdown'
      const icon = formatIcon(note.icon || this.data.icon, 'note')
      rememberNode({ id: note.id, kind: 'note', ref: note.id, title, icon: note.icon || '' })
      wx.setNavigationBarTitle({ title })
      this.setData({
        loading: false,
        note,
        title,
        icon,
        nodes,
        updatedText: formatUpdated(note.updated_at),
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '打开失败', icon: 'none' })
    }
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/workspace/workspace' })
      },
    })
  },

  onTouchStart(event) {
    rememberTouchStart(this, event)
  },

  onTouchEnd(event) {
    if (isEdgeSwipeBack(this, event)) {
      this.goBack()
    }
  },
})

async function signMarkdownImages(markdown) {
  const sources = Array.from(new Set(
    String(markdown || '')
      .match(/!\[[^\]]*]\(([^)]+)\)/g)
      ?.map((item) => item.match(/\(([^)]+)\)/)?.[1])
      .filter(Boolean) || [],
  ))
  if (!sources.length) return markdown

  const replacements = {}
  await Promise.all(sources.map(async (src) => {
    if (/^(data:|wxfile:)/.test(src)) return
    try {
      const fileKey = fileKeyFromSource(src)
      if (fileKey) {
        const res = await signFile(fileKey)
        const signed = res.data && res.data.url
        if (signed) replacements[src] = absoluteUrl(signed)
        return
      }
      if (/^https?:/.test(src)) return
      if (src.startsWith('/')) {
        replacements[src] = absoluteUrl(src)
        return
      }
      const res = await signFile(src)
      const signed = res.data && res.data.url
      if (signed) replacements[src] = absoluteUrl(signed)
    } catch (err) {
      replacements[src] = src
    }
  }))

  return Object.keys(replacements).reduce((text, src) => {
    return text.split(`(${src})`).join(`(${replacements[src]})`)
  }, markdown)
}

function fileKeyFromSource(src) {
  const value = String(src || '')
  const path = pathFromSource(value)
  const match = path.match(/^\/api\/files\/(.+)$/)
  if (!match) return ''
  return decodeURIComponent(match[1].split('?')[0])
}

function pathFromSource(value) {
  if (value.startsWith('/')) return value
  if (!/^https?:/.test(value)) return value
  try {
    return new URL(value).pathname
  } catch (err) {
    return value
  }
}

function absoluteUrl(value) {
  if (/^https?:/.test(value)) return value
  const config = getConfig()
  const baseUrl = config && config.baseUrl ? String(config.baseUrl).replace(/\/+$/, '') : ''
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`
}

function formatUpdated(value) {
  if (!value) return ''
  const date = new Date(Number(value) * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}
