import { readSavedReading, resolveSavedReading } from './reading-home-model.js';
import { loadWorldData } from './data-loader.js';
import { captureReadingListFocus } from './reading-list-focus.js';
import { createReadingStore } from './reader-preferences.js';
import { createReaderProgressStore } from './reader-progress.js';

let controller;

export function destroyReadingHome() {
  controller?.abort();
  controller = null;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initReadingHome() {
  destroyReadingHome();
  controller = new AbortController();
  const { signal } = controller;
  const panel = document.querySelector('[data-reading-home]');
  if (!panel) return;
  const worldId = panel.dataset.readingHome;
  const body = panel.querySelector('.reading-home-body');
  const summary = panel.querySelector('summary');
  const readingStart = panel.closest('.reading-entrance')?.querySelector('.reading-paths a');
  const status = panel.querySelector('.reading-home-note[role="status"]');
  const retry = panel.querySelector('[data-reading-home-retry]');
  const filter = panel.querySelector('.reading-home-filter');
  const filterInput = filter.querySelector('input');
  const clearFilter = filter.querySelector('button');
  const filterStatus = filter.querySelector('[role="status"]');
  const titleNodes = panel.querySelector('[data-reading-home-titles]')?.content.querySelectorAll('[data-event-id]') || [];
  const displayTitles = new Map([...titleNodes].map(node => [node.dataset.eventId, node.textContent]));
  let storage;
  try { storage = localStorage; } catch { /* optional browser storage */ }
  const bookmarkStore = createReadingStore(storage, worldId);
  const progressStore = createReaderProgressStore(storage, `ats.${worldId}.reader.progress.v1`);
  let saved;
  let loaded = false;
  let generation = 0;
  let unsavedRemoval = false;
  let positionNotice = '';
  let resolved;
  const normalize = text => text.normalize('NFKC').toLowerCase();
  let filterTerms = [];
  let composing = false;

  function appendGroup(title, items, className) {
    if (!items.length) return 0;
    const section = element('section', className);
    section.append(element('h3', null, `${title} · ${items.length}`));
    const isPosition = className === 'reading-home-positions';
    const list = element('ul', 'reading-home-list');
    let matched = 0;
    for (const item of items) {
      const title = item.unavailable ? item.title : displayTitles.get(item.eventId) || item.title;
      const meta = item.unavailable
        ? [item.context, isPosition ? '已保留，可手动清除。' : '已保留，可手动移除。'].filter(Boolean).join(' · ')
        : [item.context, item.date].filter(Boolean).join(' · ');
      if (className === 'reading-home-bookmarks' && !filterTerms.every(term => normalize(`${title} ${meta}`).includes(term))) continue;
      matched++;
      const row = element('li');
      const entry = element(item.unavailable ? 'div' : 'a', item.unavailable ? 'reading-home-unavailable' : null);
      if (!item.unavailable) {
        entry.href = item.href;
        entry.dataset.readingFocusKey = `${className}:${className === 'reading-home-positions' ? item.rootId : item.eventId}`;
      }
      entry.append(element('span', 'reading-home-meta', meta));
      entry.append(element('strong', null, title));
      row.append(entry);
      const remove = element('button', 'reading-home-remove', isPosition ? '清除' : '移除');
      remove.type = 'button';
      if (isPosition) {
        remove.dataset.readingHomeClear = item.rootId;
        remove.dataset.eventId = item.eventId;
        remove.dataset.readingFocusKey = `clear:${item.rootId}`;
        remove.setAttribute('aria-label', `清除阅读位置：${[item.context, title].filter(Boolean).join(' · ')}`);
      } else {
        remove.dataset.readingHomeRemove = item.eventId;
        remove.dataset.readingFocusKey = `remove:${item.eventId}`;
        remove.setAttribute('aria-label', `移除书签：${title}`);
      }
      row.append(remove);
      list.append(row);
    }
    section.append(list);
    if (isPosition) section.append(element('p', 'reading-home-position-note', '继续阅读时会重新保存位置。'));
    body.append(section);
    return matched;
  }

  function render() {
    if (!resolved) return;
    const bookmarkHadFocus = body.querySelector('.reading-home-bookmarks')?.contains(document.activeElement);
    const positionHadFocus = body.querySelector('.reading-home-positions')?.contains(document.activeElement);
    const group = positionHadFocus ? '.reading-home-positions ' : bookmarkHadFocus ? '.reading-home-bookmarks ' : '';
    const restoreFocus = captureReadingListFocus(body, `${group}[data-reading-focus-key]`);
    const filterHadFocus = filter.contains(document.activeElement);
    body.replaceChildren();
    appendGroup('已保存的阅读位置', resolved.positions, 'reading-home-positions');
    const matched = appendGroup('书签', resolved.bookmarks, 'reading-home-bookmarks');
    filter.hidden = !resolved.bookmarks.length && !filterInput.value;
    clearFilter.disabled = !filterInput.value;
    filterStatus.textContent = !filterTerms.length ? '' : resolved.bookmarks.length && !matched
      ? '没有匹配的书签。试试其他关键词，或清空查找。'
      : `找到 ${matched} / ${resolved.bookmarks.length} 条书签。`;
    if (filterHadFocus && filter.hidden) summary.focus({ preventScroll: true });
    restoreFocus(bookmarkHadFocus && filterTerms.length ? filterInput : summary);
  }

  function searchBookmarks() {
    filterTerms = normalize(filterInput.value).trim().split(/\s+/).filter(Boolean);
    if (!filterInput.value && !saved.positions.length && !saved.bookmarks.length && !unsavedRemoval) refresh();
    else render();
  }

  function resetFilter() {
    filterInput.value = '';
    filterInput.focus({ preventScroll: true });
    searchBookmarks();
  }

  function renderStatus() {
    status.textContent = [
      positionNotice,
      unsavedRemoval ? '本页已移除书签，但浏览器未允许保存，刷新后可能重新出现。' : '',
      resolved?.unavailable ? '部分记录暂时无法找到，已保留原有保存内容。' : '',
    ].filter(Boolean).join(' ') || '选择标题即可接着读。';
  }

  async function load() {
    if (loaded || !panel.open || panel.hidden || signal.aborted) return;
    loaded = true;
    const token = ++generation;
    panel.dataset.readingState = 'loading';
    status.textContent = '正在查找已保存的记录…';
    if (document.activeElement === retry) summary.focus({ preventScroll: true });
    retry.hidden = true;
    try {
      const data = await loadWorldData(worldId);
      if (signal.aborted || token !== generation) return;
      resolved = resolveSavedReading(data, saved);
      render();
      panel.dataset.readingState = 'ready';
      renderStatus();
    } catch {
      if (signal.aborted || token !== generation) return;
      loaded = false;
      panel.dataset.readingState = 'error';
      status.textContent = '暂时无法载入记录，请检查网络后重试。保存内容仍在当前浏览器中。';
      retry.hidden = false;
    }
  }

  function refresh() {
    generation += 1;
    loaded = false;
    saved = readSavedReading(storage, worldId);
    bookmarkStore.reloadBookmarks();
    saved.bookmarks = bookmarkStore.bookmarks();
    const hadFocus = panel.contains(document.activeElement);
    panel.hidden = !saved.positions.length && !saved.bookmarks.length && !unsavedRemoval && !filterInput.value;
    panel.dataset.readingState = panel.hidden ? 'empty' : 'saved';
    status.textContent = '';
    if (!panel.hidden && document.activeElement === retry) summary.focus({ preventScroll: true });
    retry.hidden = true;
    if (panel.hidden) {
      panel.open = false;
      body.replaceChildren();
      if (hadFocus) readingStart?.focus();
    } else {
      // Keep the current links usable until their replacements are ready.
      if (!panel.open) body.replaceChildren();
      load();
    }
  }

  panel.addEventListener('toggle', load, { signal });
  filterInput.addEventListener('compositionstart', () => { composing = true; }, { signal });
  filterInput.addEventListener('compositionend', () => { composing = false; searchBookmarks(); }, { signal });
  filterInput.addEventListener('input', event => {
    if (!composing && !event.isComposing) searchBookmarks();
  }, { signal });
  filterInput.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !filterInput.value) return;
    if (composing || event.isComposing) { event.stopPropagation(); return; }
    event.preventDefault();
    event.stopPropagation();
    resetFilter();
  }, { signal });
  clearFilter.addEventListener('click', resetFilter, { signal });
  body.addEventListener('click', event => {
    const clear = event.target.closest('[data-reading-home-clear]');
    if (clear && body.contains(clear)) {
      const result = progressStore.remove(clear.dataset.readingHomeClear, clear.dataset.eventId);
      positionNotice = result === 'changed' ? '阅读位置已更新，请核对后再清除。'
        : result === 'unavailable' ? '未能清除阅读位置，保存内容保持不变。请稍后重试。' : '';
      if (result === 'unavailable') { renderStatus(); return; }
      refresh();
      return;
    }
    const remove = event.target.closest('[data-reading-home-remove]');
    if (!remove || !body.contains(remove)) return;
    // Removing an old row must not re-add a bookmark removed in another tab.
    if (!bookmarkStore.setBookmark(remove.dataset.readingHomeRemove, false)) return;
    unsavedRemoval = !bookmarkStore.available;
    refresh();
  }, { signal });
  retry.addEventListener('click', load, { signal });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); }, { signal });
  window.addEventListener('storage', event => {
    if (event.storageArea !== storage) return;
    if (event.key === null || [`ats.${worldId}.reader.progress.v1`, `ats.${worldId}.reader.bookmarks.v1`].includes(event.key)) refresh();
  }, { signal });
  window.addEventListener('pagehide', event => { if (!event.persisted) destroyReadingHome(); }, { signal });
  refresh();
}
