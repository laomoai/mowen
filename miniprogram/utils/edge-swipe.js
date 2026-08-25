function rememberTouchStart(page, event) {
  const touch = event.touches && event.touches[0]
  page.touchStartX = touch ? touch.clientX : 0
  page.touchStartY = touch ? touch.clientY : 0
}

function isEdgeSwipeBack(page, event) {
  const touch = event.changedTouches && event.changedTouches[0]
  if (!touch) return false
  const dx = touch.clientX - page.touchStartX
  const dy = touch.clientY - page.touchStartY
  return page.touchStartX <= 32 && dx > 70 && Math.abs(dy) < 50
}

module.exports = {
  rememberTouchStart,
  isEdgeSwipeBack,
}
