const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft']);
const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight']);
const DEFAULT_WHEEL_THRESHOLD = 48;
const DEFAULT_WHEEL_GESTURE_IDLE = 180;
const DEFAULT_SCROLL_EDGE_TOLERANCE = 2;

function directionForKey(key) {
  if (PREVIOUS_KEYS.has(key)) return -1;
  if (NEXT_KEYS.has(key)) return 1;
  return 0;
}

function hasModifier(event) {
  return Boolean(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
}

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName?.toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  return typeof target.closest === 'function'
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function normalizeWheelDelta(event, viewportHeight) {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return 0;
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * viewportHeight();
  return event.deltaY;
}

function isAtScrollEdge(scrollState, direction, tolerance) {
  if (!scrollState) return true;
  const scrollTop = Number(scrollState.scrollTop) || 0;
  const scrollHeight = Number(scrollState.scrollHeight) || 0;
  const clientHeight = Number(scrollState.clientHeight) || 0;
  if (direction < 0) return scrollTop <= tolerance;
  return scrollHeight - clientHeight - scrollTop <= tolerance;
}

export function createEventModalNavigator({
  getEvents,
  getCurrentEventId,
  openEvent,
  now = () => performance.now(),
  viewportHeight = () => window.innerHeight,
  getScrollState = () => null,
  wheelThreshold = DEFAULT_WHEEL_THRESHOLD,
  wheelGestureIdle = DEFAULT_WHEEL_GESTURE_IDLE,
  scrollEdgeTolerance = DEFAULT_SCROLL_EDGE_TOLERANCE,
}) {
  let wheelAccumulator = 0;
  let wheelDirection = 0;
  let wheelLastTimestamp = Number.NEGATIVE_INFINITY;
  let wheelGestureConsumed = false;

  function move(direction) {
    const events = getEvents();
    const currentIndex = events.findIndex(event => event.id === getCurrentEventId());
    if (currentIndex < 0) return false;

    const adjacentEvent = events[currentIndex + direction];
    if (!adjacentEvent) return false;
    openEvent(adjacentEvent, direction);
    return true;
  }

  return {
    handleKey(event) {
      if (hasModifier(event) || isEditableTarget(event.target)) return false;
      const direction = directionForKey(event.key);
      if (direction === 0) return false;
      event.preventDefault();
      move(direction);
      return true;
    },

    handleWheel(event) {
      if (hasModifier(event)) return false;
      const delta = normalizeWheelDelta(event, viewportHeight);
      if (delta === 0) return false;

      const direction = Math.sign(delta);
      const timestamp = now();
      if (timestamp - wheelLastTimestamp > wheelGestureIdle) {
        wheelAccumulator = 0;
        wheelDirection = 0;
        wheelGestureConsumed = false;
      }
      wheelLastTimestamp = timestamp;

      if (!isAtScrollEdge(getScrollState(), direction, scrollEdgeTolerance)) {
        wheelAccumulator = 0;
        wheelDirection = 0;
        return false;
      }
      if (wheelGestureConsumed) return false;

      if (direction !== wheelDirection) {
        wheelAccumulator = 0;
        wheelDirection = direction;
      }
      wheelAccumulator += delta;
      if (Math.abs(wheelAccumulator) < wheelThreshold) return false;

      wheelAccumulator = 0;
      wheelDirection = 0;
      if (!move(direction)) return false;
      wheelGestureConsumed = true;
      event.preventDefault();
      return true;
    },

    reset() {
      wheelAccumulator = 0;
      wheelDirection = 0;
      wheelLastTimestamp = Number.NEGATIVE_INFINITY;
      wheelGestureConsumed = false;
    },
  };
}
