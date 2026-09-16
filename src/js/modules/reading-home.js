import { readSavedReading, resolveSavedReading } from './reading-home-model.js';
import { loadWorldData } from './data-loader.js';

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
  const status = panel.querySelector('[role="status"]');
  const retry = panel.querySelector('[data-reading-home-retry]');
  const titleNodes = panel.querySelector('[data-reading-home-titles]')?.content.querySelectorAll('[data-event-id]') || [];
  const displayTitles = new Map([...titleNodes].map(node => [node.dataset.eventId, node.textContent]));
  let storage;
  try { storage = localStorage; } catch { /* optional browser storage */ }
  let saved;
  let loaded = false;
  let generation = 0;

  function appendGroup(title, items, className) {
    if (!items.length) return;
    const section = element('section', className);
    section.append(element('h3', null, `${title} · ${items.length}`));
    const list = element('ul', 'reading-home-list');
    for (const item of items) {
      const row = element('li');
      const link = element('a');
      link.href = item.href;
      link.append(element('span', 'reading-home-meta', [item.context, item.date].filter(Boolean).join(' · ')));
      link.append(element('strong', null, displayTitles.get(item.eventId) || item.title));
      row.append(link);
      list.append(row);
    }
    section.append(list);
    body.append(section);
  }

  async function load() {
    if (loaded || !panel.open || panel.hidden || signal.aborted) return;
    loaded = true;
    const token = ++generation;
    panel.dataset.readingState = 'loading';
    status.textContent = '正在查找已保存的记录…';
    retry.hidden = true;
    try {
      const data = await loadWorldData(worldId);
      if (signal.aborted || token !== generation) return;
      const result = resolveSavedReading(data, saved);
      body.replaceChildren();
      appendGroup('已保存的阅读位置', result.positions, 'reading-home-positions');
      appendGroup('书签', result.bookmarks, 'reading-home-bookmarks');
      panel.dataset.readingState = 'ready';
      status.textContent = result.unavailable
        ? '部分记录暂时无法找到，已保留原有保存内容。'
        : '选择标题即可接着读。';
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
    panel.hidden = !saved.positions.length && !saved.bookmarks.length;
    panel.dataset.readingState = panel.hidden ? 'empty' : 'saved';
    body.replaceChildren();
    status.textContent = '';
    retry.hidden = true;
    if (panel.hidden) panel.open = false;
    else load();
  }

  panel.addEventListener('toggle', load, { signal });
  retry.addEventListener('click', load, { signal });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); }, { signal });
  window.addEventListener('storage', event => {
    if (event.storageArea !== storage) return;
    if (event.key === null || [`ats.${worldId}.reader.progress.v1`, `ats.${worldId}.reader.bookmarks.v1`].includes(event.key)) refresh();
  }, { signal });
  window.addEventListener('pagehide', event => { if (!event.persisted) destroyReadingHome(); }, { signal });
  refresh();
}
