Page({
  data: {
    loading: false,
    note: {},
    nodes: [],
    updatedText: '',
  },

  onLoad(options) {
    this.noteId = options.id
  },
})
