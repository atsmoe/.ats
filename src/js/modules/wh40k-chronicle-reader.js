import { normalizeEventSources } from './event-sources.js';
import { getWh40kVerificationState } from './wh40k-verification.js';
export { getWh40kVerificationState } from './wh40k-verification.js';

const DATE_UNCERTAIN_PATTERN = /约|前|后|初|中|末|远古|创世|形成|恒星时代|CURRENT|RECURRING|M\d+\s*-\s*M\d+/i;

function mainline(data) {
  return (data?.branches || []).find(branch => branch.id === 'mainline') || data?.branches?.[0];
}

function recordIndex(data) {
  return new Map(
    (mainline(data)?.eras || [])
      .flatMap(era => era.events || [])
      .filter(record => record?.id)
      .map(record => [record.id, record]),
  );
}

export function isWh40kDateUncertain(dateDisplay = '') {
  return DATE_UNCERTAIN_PATTERN.test(String(dateDisplay));
}

export function buildWh40kChapterArchive(data, mapping) {
  const records = recordIndex(data);
  const excludedIds = new Set(data?.coverage?.excludedRecordIds || []);
  const chapterById = new Map();
  const eventToChapter = new Map();
  const eras = (mapping?.eras || []).map(era => {
    const chapters = (era.chapters || []).map(chapter => {
      const events = chapter.eventIds.map(id => records.get(id)).filter(Boolean);
      const anchorIds = new Set(chapter.anchorEventIds || []);
      const entry = {
        ...chapter,
        eraId: era.id,
        eraTitle: era.title,
        events,
        unavailableEventIds: chapter.eventIds.filter(id => !records.has(id)),
        anchors: events.filter(record => anchorIds.has(record.id)),
        contemporaries: events.filter(record => !anchorIds.has(record.id)),
      };
      chapterById.set(entry.id, entry);
      for (const eventId of chapter.eventIds) eventToChapter.set(eventId, entry.id);
      return entry;
    });
    return { ...era, chapters };
  });

  return {
    baseline: mapping?.baseline || '',
    rules: mapping?.rules || [],
    excludedIds,
    eras,
    chapters: eras.flatMap(era => era.chapters),
    chapterById,
    eventToChapter,
  };
}

export function validateWh40kChapterMapping(data, mapping) {
  const sourceIds = [...new Set([
    ...(mainline(data)?.eras || []).flatMap(era => (era.events || []).map(event => event.id)),
    ...(data?.coverage?.excludedRecordIds || []),
  ])];
  const mappedIds = (mapping?.eras || []).flatMap(era => (
    (era.chapters || []).flatMap(chapter => chapter.eventIds || [])
  ));
  const duplicates = mappedIds.filter((id, index) => mappedIds.indexOf(id) !== index);
  return {
    sourceCount: sourceIds.length,
    mappedCount: mappedIds.length,
    missing: sourceIds.filter(id => !mappedIds.includes(id)),
    unknown: mappedIds.filter(id => !sourceIds.includes(id)),
    duplicates: [...new Set(duplicates)],
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, action, signal) {
  const node = element('button', className, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action, signal ? { signal } : undefined);
  return node;
}

function appendList(container, values, className) {
  for (const value of values || []) container.appendChild(element('span', className, value));
}

function queryLocation(archive) {
  const params = new URLSearchParams(location.search);
  let eventId = location.hash.replace(/^#/, '');
  try { eventId = decodeURIComponent(eventId); } catch (_error) { /* keep raw hash */ }
  const chapterId = params.get('chapter') || archive.eventToChapter.get(eventId);
  return {
    chapterId: archive.chapterById.has(chapterId) ? chapterId : null,
    eventId: archive.eventToChapter.has(eventId) ? eventId : null,
  };
}

function readerUrl(chapterId, eventId = '') {
  const url = new URL(location.href);
  url.searchParams.set('chapter', chapterId);
  url.hash = eventId || '';
  return `${url.pathname}${url.search}${url.hash}`;
}

function canonicalUrl() {
  const url = new URL(location.href);
  url.searchParams.delete('chapter');
  url.hash = '';
  return `${url.pathname}${url.search}`;
}

function renderChapterIndex(root, archive, openChapter, signal) {
  const intro = element('header', 'wh-chapter-index-head');
  intro.append(
    element('p', 'wh-reader-kicker', 'ORDO CHRONOS / ERA DOSSIERS'),
    element('h2', '', '纪元卷宗'),
    element('p', '', `${archive.eras.length} 个纪元 · ${archive.chapters.length} 个章节 · ${archive.chapters.reduce((sum, chapter) => sum + chapter.events.length, 0)} 条记录`),
  );
  if (archive.excludedIds.size) {
    intro.appendChild(element(
      'p',
      'wh-reader-warning',
      `${archive.excludedIds.size} 条记录保留原文并标记为“来源争议 / 复核中”。`,
    ));
  }
  root.appendChild(intro);

  archive.eras.forEach((era, eraIndex) => {
    const section = element('section', 'wh-era-dossier');
    section.id = `era-${era.id}`;
    const head = element('header', 'wh-era-dossier-head');
    head.append(
      element('span', 'wh-era-number', String(eraIndex + 1).padStart(2, '0')),
      element('h3', '', era.title),
      element('p', '', era.summary),
    );
    const factions = element('div', 'wh-era-factions');
    factions.setAttribute('aria-label', '涉及势力');
    appendList(factions, era.factions, 'wh-dossier-token');
    head.appendChild(factions);
    section.appendChild(head);

    const list = element('div', 'wh-chapter-grid');
    for (const chapter of era.chapters) {
      const card = element('article', 'wh-chapter-card');
      card.id = `chapter-${chapter.id}`;
      const trigger = button('wh-chapter-open', '', () => openChapter(chapter.id, null, true), signal);
      trigger.setAttribute('aria-label', `阅读章节：${chapter.title}`);
      trigger.append(
        element('span', 'wh-chapter-code', chapter.id.toUpperCase().replaceAll('-', ' / ')),
        element('strong', '', chapter.title),
        element('span', 'wh-chapter-summary', chapter.summary),
      );
      const meta = element('span', 'wh-chapter-meta');
      meta.append(
        element('span', '', `${chapter.events.length} 条记录`),
        element('span', '', `${chapter.anchors.length} 个关键节点`),
      );
      trigger.appendChild(meta);
      card.appendChild(trigger);
      list.appendChild(card);
    }
    section.appendChild(list);
    root.appendChild(section);
  });
}

function renderEventArticle(record, chapter, archive, selectEvent, secondary = false, signal) {
  const article = element('article', `wh-reader-event${secondary ? ' is-secondary' : ' is-anchor'}`);
  article.id = `reader-${record.id}`;
  article.dataset.eventId = record.id;
  article.tabIndex = -1;
  const status = getWh40kVerificationState(record, archive.excludedIds);
  const date = element('div', 'wh-reader-event-date');
  date.append(element('time', '', record.dateDisplay || '日期未载'));
  if (isWh40kDateUncertain(record.dateDisplay)) date.append(element('span', 'is-uncertain', '日期范围 / 不确定'));
  date.append(element('span', `wh-status is-${status.code}`, status.label));
  article.append(date, element('h3', '', record.title), element('p', 'wh-reader-copy', record.description || ''));
  article.addEventListener('focusin', () => selectEvent(record), { signal });
  article.addEventListener('click', () => selectEvent(record), { signal });
  if (chapter.anchorEventIds.includes(record.id)) article.dataset.anchor = 'true';
  return article;
}

function renderSourcePanel(panel, record, archive) {
  panel.replaceChildren();
  const status = getWh40kVerificationState(record, archive.excludedIds);
  const heading = element('header', 'wh-reader-context-head');
  heading.append(element('span', `wh-status is-${status.code}`, status.label), element('h3', '', record.title));
  if (isWh40kDateUncertain(record.dateDisplay)) heading.append(element('p', 'wh-reader-warning', `日期标注：${record.dateDisplay}；该表达含范围或不确定性。`));
  panel.appendChild(heading);

  const facts = element('dl', 'wh-reader-facts');
  const addFact = (term, value) => {
    if (!value) return;
    facts.append(element('dt', '', term), element('dd', '', value));
  };
  addFact('势力 / 人物', (record.characters || []).join('、'));
  addFact('地点', record.location);
  addFact('记录 ID', record.id);
  panel.appendChild(facts);

  if (record.images?.length) {
    const media = element('div', 'wh-reader-media');
    for (const image of record.images) {
      const img = element('img');
      img.src = image.src;
      img.alt = image.alt || record.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      if (image.width) img.width = image.width;
      if (image.height) img.height = image.height;
      media.appendChild(img);
    }
    panel.appendChild(media);
  } else {
    panel.appendChild(element('p', 'wh-reader-no-media', '本记录未附图像档案。'));
  }

  const sources = element('section', 'wh-reader-sources');
  sources.appendChild(element('h4', '', '来源'));
  const normalized = normalizeEventSources(record);
  if (!normalized.length) sources.appendChild(element('p', '', '来源条目尚未登记。'));
  for (const source of normalized) {
    const link = element(source.url ? 'a' : 'span', 'wh-reader-source', source.text);
    if (source.url) {
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    sources.appendChild(link);
  }
  panel.appendChild(sources);
}

function createReader(root, archive, listenerController) {
  const { signal } = listenerController;
  const siteNav = document.getElementById('nav');
  const overlay = element('div', 'wh-reader-overlay');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'wh-reader-title');
  overlay.setAttribute('aria-describedby', 'wh-reader-summary');
  overlay.setAttribute('aria-keyshortcuts', 'Escape / [ ]');

  const shell = element('div', 'wh-reader-shell');
  const rail = element('aside', 'wh-reader-rail');
  const railHead = element('header', 'wh-reader-rail-head');
  railHead.append(element('span', 'wh-reader-kicker', 'ARCHIVE SEQUENCE'), element('h2', '', '纪元 / 章节'));
  const search = element('input', 'wh-reader-search');
  search.type = 'search';
  search.placeholder = '筛选章节（/）';
  search.setAttribute('aria-label', '筛选章节');
  railHead.appendChild(search);
  const railList = element('nav', 'wh-reader-rail-list');
  railList.setAttribute('aria-label', '章节目录');
  rail.append(railHead, railList);

  const reading = element('div', 'wh-reader-reading');
  reading.setAttribute('role', 'region');
  reading.setAttribute('aria-label', '章节正文');
  reading.tabIndex = 0;
  const chapterHead = element('header', 'wh-reader-chapter-head');
  const progress = element('div', 'wh-reader-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', '章节阅读进度');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  const progressBar = element('span');
  progress.appendChild(progressBar);
  const body = element('div', 'wh-reader-body');
  reading.append(chapterHead, progress, body);

  const context = element('aside', 'wh-reader-context');
  context.setAttribute('aria-live', 'polite');
  context.setAttribute('aria-label', '当前记录档案');
  const close = button('wh-reader-close', '关闭卷宗', () => closeReader(true), signal);
  const quick = element('p', 'wh-reader-shortcuts', 'Esc 关闭 · / 筛选 · [ ] 前后章');
  context.append(close, quick);
  const contextBody = element('div', 'wh-reader-context-body');
  context.appendChild(contextBody);
  shell.append(rail, reading, context);
  overlay.appendChild(shell);
  root.appendChild(overlay);

  let currentChapter = null;
  let currentEvent = null;
  let returnFocus = null;
  let returnScrollY = 0;
  let openedFromIndex = false;
  let scrollTicking = false;

  function setUrl(eventId, mode = 'replace') {
    const url = readerUrl(currentChapter.id, eventId);
    const state = { whReader: true, openedFromIndex, chapterId: currentChapter.id, eventId };
    history[`${mode}State`](state, '', url);
  }

  function selectEvent(record, updateUrl = true) {
    if (!record || currentEvent?.id === record.id) return;
    currentEvent = record;
    renderSourcePanel(contextBody, record, archive);
    const index = currentChapter.events.findIndex(item => item.id === record.id);
    const percent = currentChapter.events.length ? Math.round(((index + 1) / currentChapter.events.length) * 100) : 0;
    progress.setAttribute('aria-valuenow', String(percent));
    progressBar.style.width = `${percent}%`;
    if (updateUrl) setUrl(record.id);
    railList.querySelectorAll('[data-chapter-id]').forEach(node => {
      node.classList.toggle('is-current', node.dataset.chapterId === currentChapter.id);
    });
  }

  function renderRail() {
    railList.replaceChildren();
    for (const era of archive.eras) {
      const group = element('section', 'wh-reader-rail-era');
      group.appendChild(element('h3', '', era.title));
      for (const chapter of era.chapters) {
        const item = button('wh-reader-rail-chapter', chapter.title, () => openChapter(chapter.id, null, false), signal);
        item.dataset.chapterId = chapter.id;
        item.dataset.search = `${era.title} ${chapter.title} ${chapter.summary} ${chapter.factions.join(' ')}`.toLowerCase();
        group.appendChild(item);
      }
      railList.appendChild(group);
    }
  }

  function renderChapter(chapter, eventId) {
    currentChapter = chapter;
    currentEvent = null;
    chapterHead.replaceChildren();
    chapterHead.append(
      element('p', 'wh-reader-kicker', chapter.eraTitle),
      element('h1', '', chapter.title),
      element('p', '', chapter.summary),
    );
    chapterHead.querySelector('h1').id = 'wh-reader-title';
    chapterHead.querySelector('p:last-child').id = 'wh-reader-summary';
    const tokens = element('div', 'wh-reader-chapter-tokens');
    appendList(tokens, chapter.factions, 'wh-dossier-token');
    chapterHead.appendChild(tokens);

    body.replaceChildren();
    for (let index = 0; index < chapter.events.length;) {
      const record = chapter.events[index];
      if (chapter.anchorEventIds.includes(record.id)) {
        body.appendChild(renderEventArticle(record, chapter, archive, selectEvent, false, signal));
        index += 1;
        continue;
      }
      const run = [];
      while (index < chapter.events.length && !chapter.anchorEventIds.includes(chapter.events[index].id)) {
        run.push(chapter.events[index]);
        index += 1;
      }
      const details = element('details', 'wh-reader-contemporaries');
      details.appendChild(element('summary', '', `同期记录 · ${run.length}`));
      for (const secondary of run) {
        details.appendChild(renderEventArticle(secondary, chapter, archive, selectEvent, true, signal));
      }
      if (eventId && run.some(item => item.id === eventId)) details.open = true;
      body.appendChild(details);
    }
    reading.scrollTop = 0;
    const target = chapter.events.find(record => record.id === eventId) || chapter.events[0];
    selectEvent(target, false);
    if (eventId) {
      requestAnimationFrame(() => {
        const targetNode = document.getElementById(`reader-${eventId}`);
        targetNode?.scrollIntoView({ block: 'start', behavior: 'auto' });
        targetNode?.focus({ preventScroll: true });
      });
    } else {
      reading.focus({ preventScroll: true });
    }
  }

  function openChapter(chapterId, eventId = null, push = false) {
    const chapter = archive.chapterById.get(chapterId);
    if (!chapter || !chapter.events.length) return false;
    const wasClosed = overlay.hidden;
    if (wasClosed) {
      returnFocus = document.activeElement;
      returnScrollY = window.scrollY;
      openedFromIndex = push || Boolean(history.state?.whReader && history.state.openedFromIndex);
      overlay.hidden = false;
      document.body.classList.add('wh-reader-open');
      siteNav?.setAttribute('inert', '');
      [...root.children]
        .filter(node => node !== overlay)
        .forEach(node => node.setAttribute('inert', ''));
    }
    renderChapter(chapter, eventId);
    setUrl(eventId || chapter.events[0].id, push && wasClosed ? 'push' : 'replace');
    return true;
  }

  function closeReader(fromControl = false) {
    if (overlay.hidden) return;
    if (fromControl && openedFromIndex && history.state?.whReader) {
      history.back();
      return;
    }
    overlay.hidden = true;
    document.body.classList.remove('wh-reader-open');
    siteNav?.removeAttribute('inert');
    [...root.children]
      .filter(node => node !== overlay)
      .forEach(node => node.removeAttribute('inert'));
    currentChapter = null;
    currentEvent = null;
    if (location.hash || new URLSearchParams(location.search).has('chapter')) {
      history.replaceState({}, '', canonicalUrl());
    }
    window.scrollTo({ top: returnScrollY, behavior: 'auto' });
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  function adjacentChapter(delta) {
    const index = archive.chapters.findIndex(chapter => chapter.id === currentChapter?.id);
    const target = archive.chapters[index + delta];
    if (target) openChapter(target.id, null, false);
  }

  function onKeydown(event) {
    if (overlay.hidden) return;
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const editing = event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReader(true);
      return;
    }
    if (event.key === '/' && !editing) {
      event.preventDefault();
      search.focus();
      return;
    }
    if (!editing && (event.key === '[' || event.key === ']')) {
      event.preventDefault();
      adjacentChapter(event.key === '[' ? -1 : 1);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('button:not([disabled]):not([hidden]), a[href], input, [tabindex="0"]')]
      .filter(node => node.getClientRects().length > 0);
    if (!focusable.length) return;
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

  reading.addEventListener('scroll', () => {
    if (scrollTicking || !currentChapter) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      const articles = [...body.querySelectorAll('.wh-reader-event')]
        .filter(article => article.getClientRects().length > 0);
      const readingTop = reading.getBoundingClientRect().top;
      let active = articles[0];
      for (const article of articles) {
        if (article.getBoundingClientRect().top <= readingTop + reading.clientHeight * 0.36) active = article;
      }
      const record = currentChapter.events.find(item => item.id === active?.dataset.eventId);
      selectEvent(record);
    });
  }, { passive: true, signal });

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    railList.querySelectorAll('[data-chapter-id]').forEach(node => {
      node.hidden = Boolean(query) && !node.dataset.search.includes(query);
    });
  }, { signal });
  document.addEventListener('keydown', onKeydown, { signal });
  window.addEventListener('popstate', () => {
    const requested = queryLocation(archive);
    if (!requested.chapterId) closeReader(false);
    else openChapter(requested.chapterId, requested.eventId, false);
  }, { signal });
  function destroy() {
    listenerController.abort();
    document.body.classList.remove('wh-reader-open');
    siteNav?.removeAttribute('inert');
    [...root.children].forEach(node => node.removeAttribute('inert'));
  }
  window.addEventListener('pagehide', event => {
    if (!event.persisted) destroy();
  }, { signal });
  renderRail();
  return { openChapter, closeReader, destroy };
}

export async function initWh40kChronicleReader(data) {
  const root = document.getElementById('wh40k-reader');
  if (!root) return null;
  const response = await fetch('./assets/data/wh40k-chapters.json');
  if (!response.ok) throw new Error(`WH40K chapter map failed to load: ${response.status}`);
  const mapping = await response.json();
  const validation = validateWh40kChapterMapping(data, mapping);
  if (validation.missing.length || validation.unknown.length || validation.duplicates.length) {
    throw new Error(`WH40K chapter map mismatch: ${JSON.stringify(validation)}`);
  }
  const archive = buildWh40kChapterArchive(data, mapping);
  root.replaceChildren();
  const listenerController = new AbortController();
  const reader = createReader(root, archive, listenerController);
  renderChapterIndex(root, archive, reader.openChapter, listenerController.signal);
  const requested = queryLocation(archive);
  if (requested.chapterId) reader.openChapter(requested.chapterId, requested.eventId, false);
  document.body.dataset.whReaderState = 'ready';
  return { archive, ...reader };
}
