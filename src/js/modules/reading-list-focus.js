// Capture immediately before a synchronous list rebuild, never before a fetch.
// An optional selector keeps fallback focus within one group of a shared container.
export function captureReadingListFocus(container, selector = '[data-reading-focus-key]') {
  const active = document.activeElement;
  const targets = [...container.querySelectorAll(selector)];
  const index = targets.indexOf(active);
  if (index < 0) return () => {};
  const key = active.dataset.readingFocusKey;
  const kindIndex = targets.filter(node => node.tagName === active.tagName).indexOf(active);
  const scroll = [];
  for (let node = container; node && node !== document.body; node = node.parentElement) {
    scroll.push([node, node.scrollTop, node.scrollLeft]);
  }
  return fallback => {
    if (active.isConnected || (document.activeElement !== document.body && document.activeElement !== active)) return;
    const updated = [...container.querySelectorAll(selector)];
    const same = updated.find(node => node.dataset.readingFocusKey === key);
    const sameKind = updated.filter(node => node.tagName === active.tagName);
    const target = same || sameKind[Math.min(kindIndex, sameKind.length - 1)] || updated[Math.min(index, updated.length - 1)] || fallback;
    target?.focus({ preventScroll: Boolean(same) });
    if (same) {
      for (const [node, top, left] of scroll) { node.scrollTop = top; node.scrollLeft = left; }
    }
  };
}
