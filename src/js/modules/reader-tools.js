import { createReadingStore, READER_DEFAULTS } from './reader-preferences.js';
import { worldRecordHref } from './world-routing.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initReaderTools({ host, content, worldId, getCurrent, resolveRecord, navigate }) {
  let storage;
  try { storage = localStorage; } catch { /* reader stays usable without storage */ }
  const store = createReadingStore(storage, worldId);
  store.pruneBookmarks(id => Boolean(resolveRecord(id)));
  const controller = new AbortController();
  const { signal } = controller;
  const panel = element('details', 'reader-tools');
  panel.append(element('summary', '', '阅读设置与书签'));
  const fields = element('div', 'reader-tools-fields');
  const controls = new Map();
  for (const [key, label, choices] of [
    ['size', '正文字号', [['normal', '标准'], ['large', '较大'], ['larger', '大号']]],
    ['leading', '行距', [['normal', '标准'], ['relaxed', '宽松']]],
    ['width', '正文行宽', [['comfortable', '舒适'], ['wide', '宽幅']]],
    ['spoilers', '剧情正文', [['full', '显示正文'], ['titles', '收起正文']]],
  ]) {
    const wrapper = element('label', '', label);
    const select = element('select');
    select.setAttribute('aria-label', label);
    select.dataset.readerSetting = key;
    for (const [value, text] of choices) {
      const option = element('option', '', text);
      option.value = value;
      select.append(option);
    }
    wrapper.append(select);
    fields.append(wrapper);
    controls.set(key, select);
  }
  panel.append(fields);
  const actions = element('div', 'reader-bookmark-actions');
  const bookmark = element('button', '', '收藏当前记录');
  bookmark.type = 'button';
  const reset = element('button', '', '恢复默认');
  reset.type = 'button';
  actions.append(bookmark, reset);
  const list = element('ul', 'reader-bookmarks');
  list.setAttribute('aria-label', '本世界的书签');
  const status = element('p', 'reader-tools-status');
  status.setAttribute('role', 'status');
  panel.append(actions, list, status);
  host.prepend(panel);
  content.dataset.readingContent = '';

  function apply() {
    const preferences = store.preferences();
    for (const [key, select] of controls) {
      select.value = preferences[key];
      content.setAttribute(`data-reader-${key}`, preferences[key]);
    }
  }
  function refresh() {
    const current = getCurrent();
    const saved = store.bookmarks();
    bookmark.disabled = !current;
    bookmark.textContent = saved.includes(current?.id) ? '取消当前书签' : '收藏当前记录';
    bookmark.setAttribute('aria-pressed', String(saved.includes(current?.id)));
    bookmark.title = current?.title || '请先选择一条记录';
  }
  function renderBookmarks() {
    list.replaceChildren();
    for (const id of store.bookmarks()) {
      const record = resolveRecord(id);
      if (!record) continue;
      const item = element('li');
      const link = element('a', '', `${record.title} · ${record.dateDisplay || '日期未载'}`);
      link.href = worldRecordHref({ worldId, eventId: id });
      link.dataset.readerBookmark = id;
      const remove = element('button', '', '移除');
      remove.type = 'button';
      remove.dataset.readerRemove = id;
      remove.setAttribute('aria-label', `移除书签：${record.title}`);
      item.append(link, remove);
      list.append(item);
    }
    status.textContent = store.available
      ? `书签 ${list.children.length}/30 · 仅保存在当前浏览器。标题本身也可能含剧透。`
      : '浏览器未允许保存；本次设置与书签在离页后可能丢失。';
    refresh();
  }
  fields.addEventListener('change', () => {
    store.savePreferences(Object.fromEntries([...controls].map(([key, control]) => [key, control.value])));
    apply();
    renderBookmarks();
  }, { signal });
  reset.addEventListener('click', () => { store.savePreferences(READER_DEFAULTS); apply(); renderBookmarks(); }, { signal });
  bookmark.addEventListener('click', () => {
    const record = getCurrent();
    if (record && !store.toggleBookmark(record.id)) status.textContent = '最多保存 30 条书签，请先移除一条。';
    else renderBookmarks();
  }, { signal });
  list.addEventListener('click', event => {
    const remove = event.target.closest('[data-reader-remove]');
    if (remove) {
      store.toggleBookmark(remove.dataset.readerRemove);
      renderBookmarks();
      bookmark.focus();
      return;
    }
    const link = event.target.closest('[data-reader-bookmark]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(link.dataset.readerBookmark);
  }, { signal });
  apply();
  renderBookmarks();
  return { refresh, destroy() { controller.abort(); panel.remove(); } };
}
