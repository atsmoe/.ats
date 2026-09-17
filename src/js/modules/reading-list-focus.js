// Capture immediately before a synchronous list rebuild, never before a fetch.
export function captureReadingListFocus(container) {
  const active = document.activeElement;
  const targets = [...container.querySelectorAll('[data-reading-focus-key]')];
  const index = targets.indexOf(active);
  if (index < 0) return () => {};
  const key = active.dataset.readingFocusKey;
  const scroll = [];
  for (let node = container; node && node !== document.body; node = node.parentElement) {
    scroll.push([node, node.scrollTop, node.scrollLeft]);
  }
  return fallback => {
    if (active.isConnected || (document.activeElement !== document.body && document.activeElement !== active)) return;
    const updated = [...container.querySelectorAll('[data-reading-focus-key]')];
    const same = updated.find(node => node.dataset.readingFocusKey === key);
    const target = same || updated[Math.min(index, updated.length - 1)] || fallback;
    target?.focus({ preventScroll: Boolean(same) });
    if (same) {
      for (const [node, top, left] of scroll) { node.scrollTop = top; node.scrollLeft = left; }
    }
  };
}
