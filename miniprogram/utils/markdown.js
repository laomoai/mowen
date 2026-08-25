function parseMarkdown(content, resolveImageUrl) {
  const lines = String(content || '').split(/\r?\n/)
  const nodes = []
  let inCode = false
  let codeLines = []

  const flushCode = () => {
    if (!codeLines.length) return
    nodes.push({
      name: 'pre',
      attrs: { class: 'mw-code' },
      children: [{ type: 'text', text: codeLines.join('\n') }],
    })
    codeLines = []
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) flushCode()
      inCode = !inCode
      continue
    }
    if (inCode) {
      codeLines.push(line)
      continue
    }
    if (!line.trim()) {
      nodes.push({ name: 'br' })
      continue
    }

    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (imageMatch) {
      nodes.push({
        name: 'img',
        attrs: {
          class: 'mw-image',
          alt: imageMatch[1],
          src: resolveImageUrl ? resolveImageUrl(imageMatch[2]) : imageMatch[2],
        },
      })
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      nodes.push({
        name: `h${heading[1].length}`,
        attrs: { class: `mw-h${heading[1].length}` },
        children: inlineNodes(heading[2]),
      })
      continue
    }

    const quote = line.match(/^>\s*(.+)$/)
    if (quote) {
      nodes.push({
        name: 'blockquote',
        attrs: { class: 'mw-quote' },
        children: inlineNodes(quote[1]),
      })
      continue
    }

    const bullet = line.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      nodes.push({
        name: 'p',
        attrs: { class: 'mw-li' },
        children: [{ type: 'text', text: '• ' }, ...inlineNodes(bullet[1])],
      })
      continue
    }

    nodes.push({
      name: 'p',
      attrs: { class: 'mw-p' },
      children: inlineNodes(line),
    })
  }
  flushCode()
  return nodes
}

function inlineNodes(text) {
  const nodes = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let match
  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push({ type: 'text', text: text.slice(last, match.index) })
    if (match[2]) {
      nodes.push({ name: 'strong', children: [{ type: 'text', text: match[2] }] })
    } else if (match[3]) {
      nodes.push({ name: 'code', attrs: { class: 'mw-inline-code' }, children: [{ type: 'text', text: match[3] }] })
    } else if (match[4]) {
      nodes.push({ name: 'span', attrs: { class: 'mw-link' }, children: [{ type: 'text', text: match[4] }] })
    }
    last = re.lastIndex
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) })
  return nodes
}

module.exports = {
  parseMarkdown,
}
