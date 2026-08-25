Component({
  data: {
    selected: 0,
    dots: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    list: [
      '/pages/recent/recent',
      '/pages/workspace/workspace',
    ],
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index)
      const url = this.data.list[index]
      if (!url) return
      wx.switchTab({ url })
    },
  },
})
