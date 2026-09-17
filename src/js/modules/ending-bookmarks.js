import { createReadingStore } from './reader-preferences.js';

export function initEndingBookmarks({ root, records, signal }) {
  let storage;
  try { storage = localStorage; } catch { /* temporary bookmarks still work */ }
  const store = createReadingStore(storage, 'arknights');
  const entries = [];
  const note = root.querySelector('[data-ending-bookmark-note]');
  for (const card of root.querySelectorAll('.is-ending-card')) {
    const record = records[card.dataset.record];
    if (!record) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'is-ending-bookmark';
    const status = document.createElement('p');
    status.className = 'is-ending-bookmark-status';
    status.id = `bookmark-status-${record.id}`;
    status.setAttribute('role', 'status');
    button.setAttribute('aria-describedby', status.id);
    card.querySelector('.is-ending-actions').append(button);
    card.querySelector('.is-ending-actions').after(status);
    entries.push({ record, button, status });
    button.addEventListener('click', () => {
      for (const entry of entries) entry.status.textContent = '';
      const accepted = store.setBookmark(record.id, button.getAttribute('aria-pressed') !== 'true');
      refresh();
      if (!accepted) {
        status.textContent = '最多保存 30 条书签，请先在编年页的“阅读设置与书签”中移除一条。';
      } else if (!store.available) {
        status.textContent = '浏览器未允许保存；本次更改仅在当前页面有效。';
      } else {
        status.textContent = store.bookmarks().includes(record.id)
          ? `已收藏「${record.title}」，可从泰拉首页的“接着读”打开。`
          : `已取消「${record.title}」的书签。`;
      }
    }, { signal });
  }

  function refresh() {
    const saved = store.bookmarks();
    for (const { record, button } of entries) {
      const active = saved.includes(record.id);
      button.textContent = active ? '取消书签' : '收藏结局';
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${active ? '取消书签' : '收藏结局'}：${record.title}`);
    }
    if (note) note.textContent = store.available
      ? `书签 ${saved.length}/30 · 可收藏结局，从泰拉首页的“接着读”打开。仅保存在当前浏览器。`
      : '浏览器未允许保存；书签仅在当前页面临时保留。';
  }
  function reload() {
    store.reloadBookmarks();
    for (const entry of entries) entry.status.textContent = '';
    refresh();
  }
  window.addEventListener('storage', event => {
    if (event.storageArea === storage && (event.key === null || event.key === 'ats.arknights.reader.bookmarks.v1')) reload();
  }, { signal });
  window.addEventListener('pageshow', event => { if (event.persisted) reload(); }, { signal });
  refresh();
}
