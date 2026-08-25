const ION_ICON_TEXT = {
  BarChartOutline: '📊',
  AnalyticsOutline: '📈',
  StatsChartOutline: '📈',
  PieChartOutline: '◔',
  FolderOutline: '□',
  DocumentTextOutline: '▤',
  DocumentOutline: '▤',
  ReaderOutline: '▤',
  GridOutline: '▦',
  ListOutline: '☰',
  ImageOutline: '▧',
  LinkOutline: '↗',
  CalendarOutline: '□',
  TimeOutline: '◷',
  MailOutline: '@',
  CashOutline: '¥',
  CalculatorOutline: '#',
  PercentOutline: '%',
  CheckboxOutline: '☑',
  OptionsOutline: '⋯',
  KeyOutline: '⚿',
  LockClosedOutline: '▣',
  BookOutline: '▤',
  BookmarkOutline: '▥',
  PeopleOutline: '◉',
  PersonOutline: '◉',
  HomeOutline: '⌂',
  RocketOutline: '⌁',
  LeafOutline: '⌘',
}

function formatIcon(icon, kind) {
  const value = String(icon || '').trim()
  if (!value) return defaultIcon(kind)
  if (!value.startsWith('ion:')) return value
  const name = value.slice(4)
  return ION_ICON_TEXT[name] || defaultIcon(kind) || '◇'
}

function defaultIcon(kind) {
  if (kind === 'table') return '▦'
  if (kind === 'record') return '#'
  if (kind === 'folder') return ''
  if (kind === 'note') return '▤'
  return ''
}

module.exports = {
  formatIcon,
  defaultIcon,
}
