Page({
  data: {
    menuTop: 48,
    menuHeight: 32,
    navHeight: 88,
    isFullscreen: false,
    tableName: '',
    title: '季度财务报表',
    rows: [
      { month: '7月', income: '125,000', expense: '82,400', profit: '42,600' },
      { month: '8月', income: '142,500', expense: '91,200', profit: '51,300' },
      { month: '9月', income: '158,200', expense: '105,800', profit: '52,400' },
      { month: '10月', income: '134,800', expense: '89,500', profit: '45,300' },
    ],
    nextCursor: '',
    loading: false,
  },

  onLoad(options) {
    this.setData({ tableName: options.table || '' })
    this.syncNavMetrics()
  },

  onUnload() {
    this.setPortrait()
  },

  onResize(res) {
    const size = res && res.size ? res.size : {}
    const isLandscape = Number(size.windowWidth || 0) > Number(size.windowHeight || 0)
    if (this.data.isFullscreen !== isLandscape) {
      this.setData({ isFullscreen: isLandscape })
    }
  },

  syncNavMetrics() {
    try {
      const system = wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect()
      const statusBarHeight = system.statusBarHeight || 44
      const menuTop = menu && menu.top ? menu.top : statusBarHeight + 4
      const menuHeight = menu && menu.height ? menu.height : 32
      const navHeight = menu && menu.bottom ? menu.bottom + 8 : menuTop + menuHeight + 8
      this.setData({ menuTop, menuHeight, navHeight })
    } catch (err) {
      this.setData({ menuTop: 48, menuHeight: 32, navHeight: 88 })
    }
  },

  enterFullscreen() {
    this.setData({ isFullscreen: true })
    if (wx.setPageOrientation) {
      wx.setPageOrientation({
        orientation: 'landscape',
        fail: () => wx.showToast({ title: '请旋转手机查看', icon: 'none' }),
      })
    }
  },

  exitFullscreen() {
    this.setData({ isFullscreen: false })
    this.setPortrait()
  },

  setPortrait() {
    if (!wx.setPageOrientation) return
    wx.setPageOrientation({ orientation: 'portrait' })
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/workspace/workspace' })
      },
    })
  },
})
