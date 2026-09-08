import { searchTerms, compactSearchExcerpt } from './archive-search-text.js';

const WORLD_IDS = ['all', 'arknights', 'wh40k', 'ff14'];
const PAGE_SIZE = 10;

function cleanQuery(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 160);
}

function readLocation() {
  const params = new URLSearchParams(location.search);
  return {
    query: cleanQuery(params.get('q')),
    world: WORLD_IDS.includes(params.get('world')) ? params.get('world') : 'all',
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Keep only text and highlighting from index excerpts. No attributes or other tags survive.
function appendExcerpt(parent, html) {
  const template = document.createElement('template');
  template.innerHTML = compactSearchExcerpt(html || '');
  function append(target, nodes) {
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) target.append(document.createTextNode(node.textContent));
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'MARK') target.append(element('mark', '', node.textContent));
        else append(target, node.childNodes);
      }
    }
  }
  append(parent, template.content.childNodes);
}

function resultCard(result) {
  const meta = result.meta || {};
  const item = element('li', 'search-result');
  item.dataset.world = meta.worldId;
  const header = element('div', 'search-result-meta');
  header.append(element('span', 'search-world-badge', meta.world));
  header.append(element('span', '', [meta.context, meta.date || meta.section].filter(Boolean).join(' · ')));
  item.append(header);
  if (meta.warning) item.append(element('p', 'search-result-warning', meta.warning));
  const title = element('h2');
  const link = element('a', 'search-result-link', meta.title);
  const url = new URL(result.url, location.href);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Unexpected search destination');
  }
  link.href = url.href;
  title.append(link);
  const excerpt = element('p', 'search-excerpt');
  appendExcerpt(excerpt, result.excerpt);
  item.append(title, excerpt);
  return item;
}

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Search timed out')), 15000); }),
  ]).finally(() => clearTimeout(timer));
}

export function initArchiveSearch(root) {
  const form = root.querySelector('form');
  const input = root.querySelector('input[type="search"]');
  const worlds = root.querySelector('fieldset');
  const clear = root.querySelector('.search-clear');
  const status = root.querySelector('#search-status');
  const retry = root.querySelector('.search-retry');
  const discover = root.querySelector('.search-discover');
  const section = root.querySelector('.search-results-section');
  const list = root.querySelector('.search-results');
  const more = root.querySelector('.search-more');
  const listeners = new AbortController();
  const on = (target, type, listener) => target.addEventListener(type, listener, { signal: listeners.signal });
  let state = readLocation();
  let sequence = 0;
  let timer;
  let composing = false;
  let enginePromise;
  let attempts = 0;
  let results = [];
  let shown = 0;
  let loadingMore = false;
  let typingSession = false;

  async function engine() {
    if (!enginePromise) {
      const url = new URL('./pagefind/pagefind.js', location.href);
      if (attempts) url.searchParams.set('retry', String(attempts));
      enginePromise = import(url.href).then(module => module.createInstance({
        baseUrl: new URL('./', location.href).pathname,
        excerptLength: 36,
      }));
    }
    return enginePromise;
  }

  function releaseEngine() {
    enginePromise?.then(api => api.destroy()).catch(() => {});
    enginePromise = undefined;
  }

  function syncControls() {
    input.value = state.query;
    worlds.querySelector(`input[value="${state.world}"]`).checked = true;
    clear.hidden = !input.value;
  }

  function syncLocation(mode) {
    const url = new URL(location.href);
    if (state.query) url.searchParams.set('q', state.query);
    else url.searchParams.delete('q');
    if (state.world !== 'all') url.searchParams.set('world', state.world);
    else url.searchParams.delete('world');
    if (url.href !== location.href) history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
  }

  function invalidate() {
    clearTimeout(timer);
    sequence += 1;
    results = [];
    shown = 0;
    loadingMore = false;
    list.replaceChildren();
    section.hidden = true;
    more.hidden = true;
    more.disabled = false;
    retry.hidden = true;
    section.setAttribute('aria-busy', 'false');
    return sequence;
  }

  function showError(token) {
    if (token !== sequence) return;
    releaseEngine();
    attempts += 1;
    section.setAttribute('aria-busy', 'false');
    status.textContent = '检索暂时无法完成，请检查网络后重试。';
    retry.hidden = false;
    discover.hidden = shown > 0;
    more.disabled = false;
    loadingMore = false;
  }

  async function appendResults(token, focusFirst = false) {
    loadingMore = true;
    more.disabled = true;
    section.setAttribute('aria-busy', 'true');
    const batch = await withTimeout(Promise.all(results.slice(shown, shown + PAGE_SIZE).map(result => result.data())));
    if (token !== sequence) return;
    const fragment = document.createDocumentFragment();
    for (const result of batch) fragment.append(resultCard(result));
    const first = fragment.querySelector('a');
    list.append(fragment);
    shown += batch.length;
    section.hidden = false;
    section.setAttribute('aria-busy', 'false');
    more.hidden = shown >= results.length;
    more.disabled = false;
    loadingMore = false;
    status.textContent = `找到 ${results.length} 条记录 · 已显示 ${shown} 条`;
    if (focusFirst) first?.focus({ preventScroll: true });
  }

  async function search(mode = 'replace') {
    const token = invalidate();
    state = { query: cleanQuery(input.value), world: worlds.querySelector(':checked').value };
    syncLocation(mode === 'typing' ? (typingSession ? 'replace' : 'push') : mode);
    typingSession = mode === 'typing';
    clear.hidden = !input.value;
    discover.hidden = Boolean(state.query);
    if (!state.query) {
      status.textContent = '输入一个名字，或直接探索下方的世界。';
      return;
    }
    status.textContent = '正在检索档案…';
    try {
      const api = await withTimeout(engine());
      if (token !== sequence) return;
      const responses = await withTimeout(Promise.all(searchTerms(state.query).map(term => api.search(term, {
        filters: state.world === 'all' ? {} : { world: state.world },
      }))));
      if (token !== sequence) return;
      const matches = responses.slice(1).map(response => new Set(response.results.map(result => result.id)));
      results = (responses[0]?.results || []).filter(result => matches.every(ids => ids.has(result.id)));
      if (!results.length) {
        status.textContent = `没有找到与“${state.query}”相关的记录。试试更短的关键词，或切换到全部世界。`;
        discover.hidden = false;
        return;
      }
      await appendResults(token);
    } catch {
      showError(token);
    }
  }

  function schedule() {
    invalidate();
    clear.hidden = !input.value;
    status.textContent = cleanQuery(input.value) ? '等待检索…' : '输入一个名字，或直接探索下方的世界。';
    discover.hidden = Boolean(cleanQuery(input.value));
    if (!composing) timer = setTimeout(() => search('typing'), 220);
  }

  on(input, 'input', schedule);
  on(input, 'blur', () => { typingSession = false; });
  on(input, 'compositionstart', () => { composing = true; invalidate(); });
  on(input, 'compositionend', () => { composing = false; schedule(); });
  on(form, 'submit', event => {
    event.preventDefault();
    if (!composing) search('push');
  });
  on(worlds, 'change', () => { if (!composing) search('push'); });
  on(clear, 'click', () => {
    input.value = '';
    search('push');
    input.focus();
  });
  on(retry, 'click', () => search());
  on(more, 'click', async () => {
    if (loadingMore) return;
    const token = sequence;
    try { await appendResults(token, true); } catch { showError(token); }
  });
  on(root, 'click', event => {
    const link = event.target.closest('[data-search-query]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    input.value = link.dataset.searchQuery;
    worlds.querySelector('[value="all"]').checked = true;
    search('push');
    input.focus();
  });
  on(window, 'popstate', () => {
    state = readLocation();
    syncControls();
    search();
  });

  syncControls();
  input.disabled = false;
  worlds.disabled = false;
  root.querySelector('[type="submit"]').disabled = false;
  search();

  return () => {
    listeners.abort();
    clearTimeout(timer);
    sequence += 1;
    releaseEngine();
  };
}
