const { getNote, signFile } = require('../../utils/api')
const { parseMarkdown } = require('../../utils/markdown')
const { getConfig } = require('../../utils/storage')
const { rememberNode } = require('../../utils/recent')

Page({
  data: {
    loading: true,
    note: {},
    nodes: [],
    title: 'Markdown',
    updatedText: '',
  },

  onLoad(options) {
    this.noteId = options.id
    const title = options.title ? decodeURIComponent(options.title) : 'Markdown'
    this.setData({ title })
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
      rememberNode({ id: note.id, kind: 'note', ref: note.id, title, icon: note.icon || '' })
      this.setData({
        loading: false,
        note,
        title,
        nodes,
        updatedText: formatUpdated(note.updated_at),
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '打开失败', icon: 'none' })
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
    if (/^(https?:|data:|wxfile:)/.test(src)) return
    try {
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
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日更新`
}
