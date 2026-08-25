const { addRecent } = require('./storage')

function rememberNode(node) {
  if (!node) return
  const ref = node.ref || node.id
  addRecent({
    key: `${node.kind}:${ref}`,
    kind: node.kind,
    ref,
    title: node.title || '未命名',
    icon: node.icon || '',
    visitedAt: Date.now(),
  })
}

function rememberRecord(tableName, record, title) {
  addRecent({
    key: `record:${tableName}:${record.id}`,
    kind: 'record',
    ref: String(record.id),
    tableName,
    title: title || `#${record.id}`,
    icon: '',
    visitedAt: Date.now(),
  })
}

module.exports = {
  rememberNode,
  rememberRecord,
}
