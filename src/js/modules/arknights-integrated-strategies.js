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
  const continuity = element('aside', 'is-continuity-note');
  continuity.appendChild(element('span', '', 'WORLDLINE STATUS'));
  continuity.appendChild(element('strong', '', '世界线性质'));
  continuity.appendChild(element('p', '', snapshot.context.continuityNote));
  grid.appendChild(continuity);

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

function createStoryBeats(snapshot) {
  const section = element('section', 'is-story');
  section.appendChild(createSectionHeading(
    '03 / STORY SEQUENCE',
    '剧情脉络',
    '从共同起点到结局分歧的关键阶段。',
  ));
  const grid = element('div', 'is-story-grid');
  for (const [index, beat] of (snapshot.context.storyBeats || []).entries()) {
    const article = element('article', 'is-story-beat');
    article.appendChild(element('span', '', `STEP / ${String(index + 1).padStart(2, '0')}`));
    article.appendChild(element('h3', '', beat.title));
    article.appendChild(element('p', '', beat.description));
    grid.appendChild(article);
  }
  section.appendChild(grid);
  return section;
}

function createTopology(snapshot, theme, selectedId, onSelect, signal) {
  const section = element('section', `is-topology is-topology--${snapshot.context.topologyMode}`);
  section.appendChild(createSectionHeading('04 / ENDING PATHS', theme.topologyLabel, theme.topologyNote));
  const track = element('div', 'is-topology-track');
  track.setAttribute('role', 'tablist');
  track.setAttribute('aria-label', '结局路径图');
  const priorityByRecord = new Map(
    (snapshot.context.endingPriority?.items || []).map(item => [item.recordId, item]),
  );
  const ids = recordIds(snapshot);
  ids.forEach((recordId, index) => {
    const record = snapshot.recordsById[recordId];
    const priority = priorityByRecord.get(recordId);
    const button = element('button', 'is-topology-node');
    button.type = 'button';
    button.dataset.record = recordId;
    button.dataset.pathRank = String(priority?.priority ?? index);
    if (priority?.triggerMode) button.dataset.triggerMode = priority.triggerMode;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(recordId === selectedId));
    button.setAttribute(
      'aria-label',
      `${record.title}，优先级 P${priority?.priority ?? index}，关键条件：${priority?.routeKey || '默认路线'}`,
    );
    const meta = element('span', 'is-topology-node-meta');
    meta.append(
      element('span', 'is-topology-code', record.code || `0${index + 1}`),
      element(
        'span',
        'is-topology-rank',
        priority?.triggerMode === 'event'
          ? `P${priority.priority} / 事件终战`
          : `P${priority?.priority ?? index}`,
      ),
    );
    button.appendChild(meta);
    const sigil = element('i', 'is-topology-sigil');
    sigil.setAttribute('aria-hidden', 'true');
    button.appendChild(sigil);
    button.appendChild(element('strong', '', record.title));
    button.appendChild(element('small', 'is-topology-key', priority?.routeKey || '默认路线'));
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

function createRouteList(title, items, className = '') {
  if (!items?.length) return null;
  const section = element('section', `is-route-list ${className}`.trim());
  section.appendChild(element('h4', '', title));
  const list = element('ul', '');
  for (const item of items) list.appendChild(element('li', '', item));
  section.appendChild(list);
  return section;
}

function createEndingPriority(priorityData, currentRecordId) {
  if (!priorityData?.items?.length) return null;
  const section = element('section', 'is-route-priority');
  section.appendChild(element('h4', '', '终局判定优先级'));
  section.appendChild(element('p', 'is-route-priority-note', priorityData.note));
  const list = element('ol', 'is-route-priority-list');
  for (const item of priorityData.items) {
    const row = element('li', 'is-route-priority-item');
    row.classList.toggle('is-current', item.recordId === currentRecordId);
    row.dataset.priority = String(item.priority);
    const heading = element('div', 'is-route-priority-heading');
    heading.append(
      element(
        'span',
        'is-route-priority-badge',
        item.triggerMode === 'event' ? `P${item.priority} / 事件终战` : `P${item.priority}`,
      ),
      element('strong', '', item.outcome),
    );
    row.append(
      heading,
      element('small', 'is-route-priority-key', item.routeKey),
      element('p', '', item.condition),
    );
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}

function createRouteStep(step, index, optional = false) {
  const item = element('li', 'is-route-step');
  const marker = element('span', 'is-route-step-index', optional
    ? `OPTION / ${String(index + 1).padStart(2, '0')}`
    : `STEP / ${String(index + 1).padStart(2, '0')}`);
  const meta = element('p', 'is-route-step-meta', [step.stage, step.node].filter(Boolean).join(' / '));
  const title = element('h5', '', step.event);
  item.append(marker, meta, title);

  const details = element('dl', 'is-route-step-details');
  for (const [label, value] of [
    ['出现条件', step.trigger],
    ['选择', step.choice],
    ['获得 / 变化', step.result],
    ['补充', step.note],
  ]) {
    if (!value) continue;
    details.append(element('dt', '', label), element('dd', '', value));
  }
  item.appendChild(details);
  return item;
}

function createRouteGuide(record, selected, endingPriority) {
  const guide = record.routeGuide;
  if (!guide) return null;

  const details = element('details', 'is-route-guide');
  details.dataset.routeFor = record.id;
  details.open = selected;
  const summary = element('summary', 'is-route-summary');
  summary.append(
    element('span', '', 'ROUTE GUIDE'),
    element('strong', '', selected ? '完整路线已展开' : '查看完整路线'),
    element('small', '', `${guide.steps.length} 个必要步骤${guide.optionalSteps?.length ? ` / ${guide.optionalSteps.length} 个可选步骤` : ''}`),
  );
  details.appendChild(summary);

  const body = element('div', 'is-route-body');
  if (guide.availability) {
    const availability = element('p', 'is-route-availability', guide.availability);
    availability.prepend(element('strong', '', '开放状态 '));
    body.appendChild(availability);
  }

  const prerequisites = createRouteList('局外前置', guide.prerequisites, 'is-route-prerequisites');
  if (prerequisites) body.appendChild(prerequisites);

  const route = element('section', 'is-route-sequence');
  route.appendChild(element('h4', '', '本局路线'));
  const steps = element('ol', 'is-route-steps');
  guide.steps.forEach((step, index) => steps.appendChild(createRouteStep(step, index)));
  route.appendChild(steps);
  body.appendChild(route);

  const state = element('div', 'is-route-state-grid');
  const required = createRouteList('终局必须满足', guide.requiredState, 'is-route-required');
  const priority = createEndingPriority(endingPriority, record.id);
  if (required) state.appendChild(required);
  if (priority) state.appendChild(priority);
  if (state.childElementCount) body.appendChild(state);

  const final = element('section', 'is-route-final');
  final.append(element('span', '', 'FINAL BATTLE'), element('h4', '', guide.finalBattle.operation));
  const finalDetails = element('dl', '');
  for (const [label, value] of [
    ['所在区域', guide.finalBattle.stage],
    ['主要敌人', guide.finalBattle.boss],
    ['进入方式', guide.finalBattle.entry],
  ]) {
    if (!value) continue;
    finalDetails.append(element('dt', '', label), element('dd', '', value));
  }
  final.appendChild(finalDetails);
  body.appendChild(final);

  if (guide.optionalSteps?.length) {
    const optional = element('section', 'is-route-optional');
    optional.appendChild(element('h4', '', '可选支援'));
    const optionalSteps = element('ol', 'is-route-steps');
    guide.optionalSteps.forEach((step, index) => {
      optionalSteps.appendChild(createRouteStep(step, index, true));
    });
    optional.appendChild(optionalSteps);
    body.appendChild(optional);
  }

  const warnings = createRouteList('提示', guide.warnings, 'is-route-warnings');
  if (warnings) body.appendChild(warnings);
  details.appendChild(body);
  details.addEventListener('toggle', () => {
    const label = details.querySelector('.is-route-summary strong');
    if (label) label.textContent = details.open ? '完整路线已展开' : '查看完整路线';
  });
  return details;
}

function createEndingCard(record, index, selectedId, onSelect, signal, endingPriority) {
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

  const routeGuide = createRouteGuide(record, record.id === selectedId, endingPriority);
  if (routeGuide) article.appendChild(routeGuide);

  const sources = element('div', 'is-ending-sources');
  for (const source of record.sources || []) sources.appendChild(sourceLink(source));
  article.appendChild(sources);
  article.addEventListener(
    'click',
    event => {
      if (!event.target.closest('a, button, .is-route-guide')) {
        onSelect(record.id, { scroll: false });
      }
    },
    { signal },
  );
  return article;
}

function createRelations(snapshot, theme) {
  const section = element('section', 'is-relations');
  section.appendChild(createSectionHeading(
    '06 / RELATED RECORDS',
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
    '05 / OUTCOME RECORDS',
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
      snapshot.context.endingPriority,
    ));
  });
  section.appendChild(grid);
  return section;
}

function createSources(snapshot) {
  const section = element('section', 'is-topic-sources');
  section.appendChild(createSectionHeading(
    '07 / SOURCES & REVIEW',
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
      const routeGuide = node.querySelector?.('.is-route-guide');
      if (routeGuide && selected) routeGuide.open = true;
    });
    writeRequestedRecord(recordId);
    const card = content.querySelector(`.is-ending-card[data-record="${recordId}"]`);
    if (scroll) card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (focus) card?.querySelector('.is-ending-select')?.focus({ preventScroll: true });
  }

  content.replaceChildren(
    createOverview(snapshot, theme),
    createPremise(snapshot),
    createStoryBeats(snapshot),
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
