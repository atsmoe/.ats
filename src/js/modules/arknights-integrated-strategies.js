import {
  getIntegratedStrategyHref,
  getIntegratedStrategyTheme,
} from './arknights-themes.js';

const SPOILER_STORAGE_KEY = 'ats:spoiler:arknights:v1';
let topicController = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function sourceLink(source) {
  const link = element('a', 'is-source-link', source.title || source.url);
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const kind = element('span', '', (source.kind || 'source').toUpperCase());
  link.prepend(kind);
  return link;
}

function readConsent() {
  try {
    return localStorage.getItem(SPOILER_STORAGE_KEY) === 'accepted';
  } catch (_error) {
    return false;
  }
}

function saveConsent() {
  try {
    localStorage.setItem(SPOILER_STORAGE_KEY, 'accepted');
  } catch (_error) {
    // Consent remains active for this document when storage is unavailable.
  }
}

function setSpoilerState(root, locked) {
  const content = root.querySelector('[data-topic-content]');
  const gate = root.querySelector('#ark-spoiler-gate');
  root.dataset.spoilerLocked = String(locked);
  const backgroundRegions = [
    document.getElementById('nav'),
    document.getElementById('nav-mobile-menu'),
    root.querySelector('.is-topic-masthead'),
    content,
    document.querySelector('footer'),
  ].filter(Boolean);
  for (const region of backgroundRegions) region.inert = locked;
  if (gate) {
    gate.hidden = !locked;
    gate.inert = !locked;
    gate.setAttribute('aria-hidden', String(!locked));
  }
  document.body.classList.toggle('ark-spoiler-locked', locked);
  if (locked) requestAnimationFrame(() => gate?.querySelector('[data-spoiler-accept]')?.focus());
}

function trapSpoilerFocus(gate, event) {
  if (event.key !== 'Tab' || gate.hidden) return;
  const focusable = [...gate.querySelectorAll('button:not([disabled]), a[href]')];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function recordIds(snapshot) {
  return snapshot.sections.flatMap(section => section.recordIds);
}

function readRequestedRecord(validIds) {
  const requested = new URLSearchParams(location.search).get('record');
  return validIds.includes(requested) ? requested : validIds[0];
}

function writeRequestedRecord(recordId) {
  const url = new URL(location.href);
  url.searchParams.set('record', recordId);
  url.hash = recordId;
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function createSectionHeading(code, title, copy) {
  const heading = element('header', 'is-section-heading');
  heading.appendChild(element('span', '', code));
  heading.appendChild(element('h2', '', title));
  if (copy) heading.appendChild(element('p', '', copy));
  return heading;
}

function createOverview(snapshot, theme) {
  const section = element('section', 'is-overview');
  section.appendChild(createSectionHeading('01 / OVERVIEW', '主题概览'));
  const grid = element('div', 'is-overview-grid');
  grid.appendChild(element('p', 'is-overview-copy', snapshot.context.description));

  section.appendChild(grid);
  return section;
}

function createPremise(snapshot) {
  const section = element('section', 'is-premise');
  section.appendChild(createSectionHeading('02 / COMMON PREMISE', '共同起点'));
  const copy = element('blockquote', '', snapshot.context.sharedPremise || snapshot.context.description);
  section.appendChild(copy);
  return section;
}

function createTopology(snapshot, theme, selectedId, onSelect, signal) {
  const section = element('section', `is-topology is-topology--${snapshot.context.topologyMode}`);
  section.appendChild(createSectionHeading('03 / ENDING PATHS', theme.topologyLabel, theme.topologyNote));
  const track = element('div', 'is-topology-track');
  track.setAttribute('role', 'tablist');
  track.setAttribute('aria-label', '结局路径图');
  const ids = recordIds(snapshot);
  ids.forEach((recordId, index) => {
    const record = snapshot.recordsById[recordId];
    const button = element('button', 'is-topology-node');
    button.type = 'button';
    button.dataset.record = recordId;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(recordId === selectedId));
    button.appendChild(element('span', '', record.code || `0${index + 1}`));
    button.appendChild(element('strong', '', record.title));
    button.addEventListener(
      'click',
      () => onSelect(recordId, { scroll: true, focus: true }),
      { signal },
    );
    track.appendChild(button);
  });
  section.appendChild(track);
  return section;
}

function createEndingCard(record, index, selectedId, onSelect, signal) {
  const article = element('article', 'is-ending-card');
  article.id = record.id;
  article.dataset.record = record.id;
  article.classList.toggle('active', record.id === selectedId);
  article.tabIndex = -1;

  const header = element('header', 'is-ending-heading');
  const number = element('span', '', record.code || `OUTCOME / ${String(index + 1).padStart(2, '0')}`);
  const title = element('h3', '', record.title);
  header.append(number, title);
  article.appendChild(header);

  const selectButton = element(
    'button',
    'is-ending-select',
    record.id === selectedId ? '当前记录' : '聚焦记录',
  );
  selectButton.type = 'button';
  selectButton.setAttribute('aria-label', `选择结局记录：${record.title}`);
  selectButton.setAttribute('aria-pressed', String(record.id === selectedId));
  selectButton.addEventListener(
    'click',
    () => onSelect(record.id, { scroll: false }),
    { signal },
  );
  article.appendChild(selectButton);

  const metaValues = [record.location, ...(record.characters || []).slice(0, 4)].filter(Boolean);
  if (metaValues.length) article.appendChild(element('p', 'is-ending-meta', metaValues.join(' / ')));
  article.appendChild(element('p', 'is-ending-copy', record.description || '该记录暂无摘要。'));
  if (record.conditions) {
    const conditions = element('p', 'is-ending-conditions');
    conditions.appendChild(element('strong', '', '观测条件'));
    conditions.append(` ${record.conditions}`);
    article.appendChild(conditions);
  }

  const aftermath = element('p', 'is-ending-aftermath');
  aftermath.appendChild(element('strong', '', '后续'));
  aftermath.append(` ${record.aftermath}`);
  article.appendChild(aftermath);

  const sources = element('div', 'is-ending-sources');
  for (const source of record.sources || []) sources.appendChild(sourceLink(source));
  article.appendChild(sources);
  article.addEventListener(
    'click',
    event => {
      if (!event.target.closest('a, button')) onSelect(record.id, { scroll: false });
    },
    { signal },
  );
  return article;
}

function createRelations(snapshot, theme) {
  const section = element('section', 'is-relations');
  section.appendChild(createSectionHeading(
    '05 / RELATED RECORDS',
    '关联记录',
    '每个条目均可直达对应资料页。',
  ));
  const index = element('div', 'is-entity-index');
  const list = element('div', 'is-entity-list');
  for (const entityId of snapshot.context.entityIds || []) {
    const label = theme.entities[entityId] || entityId;
    const item = element('a', '', `${label} ↗`);
    item.dataset.entity = entityId;
    item.href = `https://prts.wiki/index.php?search=${encodeURIComponent(label)}`;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    list.appendChild(item);
  }
  index.appendChild(list);
  section.appendChild(index);
  return section;
}

function createEndings(snapshot, selectedId, onSelect, signal) {
  const section = element('section', 'is-endings');
  section.appendChild(createSectionHeading(
    '04 / OUTCOME RECORDS',
    '结局记录',
    `${recordIds(snapshot).length} 条当前已核验记录。选择节点或记录查看详情，也可以分享当前视图。`,
  ));
  const grid = element('div', 'is-ending-grid');
  recordIds(snapshot).forEach((recordId, index) => {
    grid.appendChild(createEndingCard(
      snapshot.recordsById[recordId],
      index,
      selectedId,
      onSelect,
      signal,
    ));
  });
  section.appendChild(grid);
  return section;
}

function createSources(snapshot) {
  const section = element('section', 'is-topic-sources');
  section.appendChild(createSectionHeading(
    '06 / SOURCES & REVIEW',
    '来源与核验',
    `最近核验：${snapshot.context.lastReviewedAt || '未记录'}。摘要据所列资料整理，详情以来源页为准。`,
  ));
  const links = element('div', 'is-source-list');
  for (const source of snapshot.context.sources || []) links.appendChild(sourceLink(source));
  section.appendChild(links);
  return section;
}

export function initIntegratedStrategyIndex({ archive }) {
  const root = document.querySelector('[data-is-index]');
  if (!root || !archive) return null;
  const snapshot = archive.explore({ lens: 'collection', contextId: 'if-integrated' });
  for (const context of snapshot.contexts) {
    const card = root.querySelector(`[data-context="${context.id}"]`);
    const theme = getIntegratedStrategyTheme(context.id);
    if (!card || !theme) continue;
    card.dataset.theme = theme.slug;
    card.href = getIntegratedStrategyHref(context.id);
    let meta = card.querySelector('.is-index-runtime-meta');
    if (!meta) {
      meta = element('span', 'is-index-runtime-meta');
      card.querySelector('i')?.before(meta);
    }
    meta.textContent = `${context.recordCount} 结局 / 核验 ${context.lastReviewedAt || '—'}`;
  }
  return snapshot;
}

export function initIntegratedStrategyTopic({ archive, contextId }) {
  destroyIntegratedStrategyInteractions();
  const root = document.getElementById('is-topic');
  const content = root?.querySelector('[data-topic-content]');
  if (!root || !content || !archive) return null;
  topicController = new AbortController();
  const { signal } = topicController;
  content.setAttribute('aria-busy', 'true');
  const theme = getIntegratedStrategyTheme(contextId);
  if (!theme) throw new Error(`No theme configuration for "${contextId}"`);

  const snapshot = archive.explore({ lens: 'context', contextId });
  const ids = recordIds(snapshot);
  let selectedId = readRequestedRecord(ids);
  root.dataset.theme = theme.slug;
  root.style.setProperty('--is-accent', theme.accent);
  root.style.setProperty('--is-accent-alt', theme.accentAlt);
  root.querySelector('[data-topic-kicker]').textContent = theme.kicker;
  root.querySelector('[data-topic-status]').textContent = snapshot.context.status === 'updating'
    ? 'LIVE DATA / 持续核验'
    : 'ARCHIVE COMPLETE / 已收录';
  root.querySelector('[data-topic-reviewed]').textContent = `REVIEW / ${snapshot.context.lastReviewedAt || '—'}`;

  function updateSelection(recordId, { scroll = false, focus = false } = {}) {
    if (!ids.includes(recordId)) return;
    selectedId = recordId;
    content.querySelectorAll('[data-record]').forEach(node => {
      const selected = node.dataset.record === recordId;
      node.classList.toggle('active', selected);
      if (node.getAttribute('role') === 'tab') node.setAttribute('aria-selected', String(selected));
      const selectButton = node.querySelector?.('.is-ending-select');
      if (selectButton) {
        selectButton.setAttribute('aria-pressed', String(selected));
        selectButton.textContent = selected ? '当前记录' : '聚焦记录';
      }
    });
    writeRequestedRecord(recordId);
    const card = content.querySelector(`.is-ending-card[data-record="${recordId}"]`);
    if (scroll) card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (focus) card?.querySelector('.is-ending-select')?.focus({ preventScroll: true });
  }

  content.replaceChildren(
    createOverview(snapshot, theme),
    createPremise(snapshot),
    createTopology(snapshot, theme, selectedId, updateSelection, signal),
    createEndings(snapshot, selectedId, updateSelection, signal),
    createRelations(snapshot, theme),
    createSources(snapshot),
  );
  content.setAttribute('aria-busy', 'false');

  const initiallyLocked = !readConsent();
  setSpoilerState(root, initiallyLocked);
  const gate = root.querySelector('#ark-spoiler-gate');
  gate?.addEventListener('keydown', event => trapSpoilerFocus(gate, event), { signal });
  root.querySelector('[data-spoiler-accept]')?.addEventListener(
    'click',
    () => {
      saveConsent();
      setSpoilerState(root, false);
      const requestedCard = new URLSearchParams(location.search).has('record')
        ? content.querySelector(`.is-ending-card[data-record="${selectedId}"]`)
        : null;
      if (requestedCard) {
        requestedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        requestedCard.focus({ preventScroll: true });
      } else {
        const title = root.querySelector('#is-topic-title');
        title?.setAttribute('tabindex', '-1');
        title?.focus();
      }
    },
    { signal },
  );
  return snapshot;
}

export function destroyIntegratedStrategyInteractions() {
  topicController?.abort();
  topicController = null;
  const root = document.getElementById('is-topic');
  if (root) setSpoilerState(root, false);
}

export function renderIntegratedStrategyError(message = '主题档案暂时无法读取。') {
  const content = document.querySelector('[data-topic-content], [data-is-index]');
  if (!content) return;
  const error = element('div', 'is-topic-error');
  error.appendChild(element('strong', '', 'SIGNAL LOST'));
  error.appendChild(element('p', '', message));
  const link = element('a', '', '返回泰拉观测入口');
  link.href = './arknights.html';
  error.appendChild(link);
  content.replaceChildren(error);
  content.setAttribute('aria-busy', 'false');
}
