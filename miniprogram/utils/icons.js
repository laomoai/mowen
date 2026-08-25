const ION_ICON_TEXT = {
  BarChartOutline: '📊',
  AnalyticsOutline: '📈',
  StatsChartOutline: '📈',
  PieChartOutline: '◔',
  SpeedometerOutline: '◴',
  FolderOutline: '□',
  TextOutline: 'T',
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
  return ION_ICON_TEXT[name] || iconByKeyword(name) || defaultIcon(kind) || '◇'
}

function iconByKeyword(name) {
  const value = String(name || '').replace(/Outline$/, '')
  if (/Chart|Analytics|Trending|Pulse|Stats|Bar/.test(value)) return '📊'
  if (/Speedometer|Gauge|Timer/.test(value)) return '◴'
  if (/Folder|Archive|Albums/.test(value)) return '□'
  if (/Document|Reader|Newspaper|Book|Bookmark|File|Text/.test(value)) return '▤'
  if (/Grid|Table|Apps/.test(value)) return '▦'
  if (/Image|Camera|Photo|Pictures/.test(value)) return '▧'
  if (/Link|Open|Share/.test(value)) return '↗'
  if (/Calendar|Date/.test(value)) return '□'
  if (/Time|Clock|Watch/.test(value)) return '◷'
  if (/Mail|At|Send/.test(value)) return '@'
  if (/Cash|Card|Wallet|Pricetag|Receipt/.test(value)) return '¥'
  if (/Calculator|Number|Code/.test(value)) return '#'
  if (/Percent/.test(value)) return '%'
  if (/Checkbox|Checkmark|Done/.test(value)) return '☑'
  if (/Options|Ellipsis|Menu|List/.test(value)) return '⋯'
  if (/Key|Lock|Shield/.test(value)) return '▣'
  if (/People|Person|Contact/.test(value)) return '◉'
  if (/Home|Business|Store/.test(value)) return '⌂'
  if (/Rocket|Flash|Sparkles/.test(value)) return '✦'
  if (/Leaf|Flower|Nature|Earth/.test(value)) return '⌘'
  return ''
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
