import { createReaderProgressStore } from './reader-progress.js';

const STORAGE_KEY = 'ats.ff14.reader.progress.v1';
const LONG_TEXT_LIMIT = 1100;

function findBranch(branches, branchId) {
  for (const branch of branches || []) {
    if (branch.id === branchId) return branch;
    const nested = findBranch(branch.subBranches, branchId);
    if (nested) return nested;
  }
  return null;
}

function indexRecords(branches, records = new Map()) {
  for (const branch of branches || []) {
    for (const era of branch.eras || []) {
      for (const record of era.events || []) records.set(record.id, record);
    }
    for (const child of branch.subBranches || []) indexRecords([child], records);
  }
  return records;
}

export function splitLongText(text, limit = LONG_TEXT_LIMIT) {
  const value = String(text || '');
  if (value.length <= limit) return value ? [value] : [];
  const chunks = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + limit, value.length);
    if (end < value.length) {
      const floor = start + Math.floor(limit * 0.55);
      const candidates = [
        value.lastIndexOf('\n\n', end - 1),
        value.lastIndexOf('。', end - 1),
        value.lastIndexOf('！', end - 1),
        value.lastIndexOf('？', end - 1),
      ].filter(index => index >= floor);
      if (candidates.length) end = Math.max(...candidates) + 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

export function createProgressStore(storage) {
  return createReaderProgressStore(storage, STORAGE_KEY);
}

export function createCrossWorldHistoryState(origin, currentState = {}) {
  return {
    originEntry: { ...currentState, ff14ReaderSnapshot: origin },
    targetEntry: { ff14ReaderReturn: origin },
  };
}

export function buildReaderModel(timelineData, chapterMap) {
  const records = indexRecords(timelineData?.branches || []);
  const chapters = (chapterMap?.chapters || []).map(chapter => ({
    ...chapter,
    events: chapter.eventIds.map(eventId => {
      const record = records.get(eventId);
      if (!record) throw new Error(`FFXIV reader chapter references missing record ${eventId}`);
      return record;
    }),
  }));
  return {
    roots: (timelineData?.branches || []).map(branch => ({ id: branch.id, name: branch.name })),
    chapters,
    chapterByEventId: new Map(chapters.flatMap(chapter => (
      chapter.eventIds.map(eventId => [eventId, chapter])
    ))),
    records,
  };
}

function appendTextElement(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text || '';
  parent.appendChild(element);
  return element;
}

function renderSources(container, record) {
  appendTextElement(container, 'h3', null, '来源');
  const sources = record.sources || [];
  if (!sources.length) {
    appendTextElement(container, 'p', 'ff-reader-empty', record.sourceStatus || '此记录未附独立来源链接。');
    return;
  }
  for (const source of sources) {
    const link = document.createElement(source.url ? 'a' : 'span');
    link.className = 'ff-reader-source';
    link.textContent = source.title || source.label || source.text || source.url || '来源记录';
    if (source.url) {
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    container.appendChild(link);
  }
}

function renderContext(panel, record, chapter) {
  panel.innerHTML = '';
  appendTextElement(panel, 'p', 'ff-reader-context-kicker', chapter.branchName);
  appendTextElement(panel, 'h2', null, record.title);
  if (record.location) {
    appendTextElement(panel, 'h3', null, '地点');
    appendTextElement(panel, 'p', null, record.location);
  }
  if (record.characters?.length) {
    appendTextElement(panel, 'h3', null, '人物');
    appendTextElement(panel, 'p', null, record.characters.join('、'));
  }
  if (record.images?.length) {
    const gallery = document.createElement('div');
    gallery.className = 'ff-reader-context-images';
    record.images.forEach((image, index) => {
      const img = document.createElement('img');
      img.src = image.src;
      img.alt = image.alt || record.title;
      img.loading = index ? 'lazy' : 'eager';
      img.decoding = 'async';
      if (image.width) img.width = image.width;
      if (image.height) img.height = image.height;
      gallery.appendChild(img);
    });
    panel.appendChild(gallery);
  }
  renderSources(panel, record);
}

function renderEvent(record, chapter) {
  const article = document.createElement('article');
  article.className = 'ff-reader-event';
  article.id = record.id;
  article.dataset.eventId = record.id;
  article.tabIndex = -1;
  appendTextElement(article, 'p', 'ff-reader-event-date', record.dateDisplay);
  appendTextElement(article, 'h3', null, record.title);
  if (record.location || record.characters?.length) {
    appendTextElement(article, 'p', 'ff-reader-event-meta', [
      record.location,
      record.characters?.join('、'),
    ].filter(Boolean).join(' · '));
  }

  const segments = splitLongText(record.description);
  segments.forEach((segment, index) => {
    const section = document.createElement('section');
    section.className = 'ff-reader-prose';
    if (segments.length > 1) appendTextElement(section, 'h4', null, index ? `续记 ${index + 1}` : '正文');
    appendTextElement(section, 'p', null, segment);
    article.appendChild(section);
  });

  if (record.crossRefs?.length) {
    const refs = document.createElement('nav');
    refs.className = 'ff-reader-crossrefs';
    refs.setAttribute('aria-label', '关联世界线');
    for (const ref of record.crossRefs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.readerTarget = ref.eventId || ref.id || '';
      button.textContent = ref.label || '前往关联记录';
      refs.appendChild(button);
    }
    article.appendChild(refs);
  }
  article.dataset.chapterId = chapter.id;
  return article;
}

export async function initFf14Reader({ timelineData }) {
  const root = document.getElementById('ff14-reader-root');
  const legacyTimeline = document.getElementById('tl-container');
  if (!root || !legacyTimeline) return null;

  const response = await fetch('./assets/data/ff14-chapters.json');
  if (!response.ok) throw new Error(`Unable to load FFXIV chapter map: ${response.status}`);
  const chapterMap = await response.json();
  const model = buildReaderModel(timelineData, chapterMap);
  let storage = null;
  try { storage = window.localStorage; } catch (_error) { /* storage can be denied */ }
  const progressStore = createProgressStore(storage);
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const listenerController = new AbortController();
  const { signal } = listenerController;
  let activeRootId = 'mainline';
  let activeEventId = null;
  let observer = null;
  let saveTimer = null;
  let navigationFrame = 0;
  let navigationToken = 0;
  let fallbackScrollFrame = 0;
  let isSwitchingBranch = false;

  legacyTimeline.hidden = true;
  document.getElementById('tl-branches').hidden = true;
  document.getElementById('tl-sub-branches').hidden = true;
  document.getElementById('era-nav').hidden = true;
  document.getElementById('back-to-top').hidden = true;
  root.hidden = false;
  root.innerHTML = `
    <nav class="ff-reader-branches" aria-label="记录分支"></nav>
    <div class="ff-reader-return" hidden><button type="button">← 返回原记录</button></div>
    <div class="ff-reader-progress" role="progressbar" aria-label="章节进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
    <div class="ff-reader-layout">
      <nav class="ff-reader-directory" aria-label="章节目录"></nav>
      <div class="ff-reader-manuscript" id="ff-reader-manuscript" role="region" aria-label="章节正文" tabindex="-1"></div>
      <aside class="ff-reader-context" aria-label="当前记录信息" aria-live="polite"></aside>
    </div>
  `;
  const branchNav = root.querySelector('.ff-reader-branches');
  const directory = root.querySelector('.ff-reader-directory');
  const manuscript = root.querySelector('.ff-reader-manuscript');
  const context = root.querySelector('.ff-reader-context');
  const progress = root.querySelector('.ff-reader-progress');
  const progressBar = root.querySelector('.ff-reader-progress span');
  const returnBar = root.querySelector('.ff-reader-return');

  function chaptersFor(rootId) {
    return model.chapters.filter(chapter => chapter.rootBranchId === rootId);
  }

  function updateUrl(eventId, mode = 'replace', state = history.state) {
    const url = new URL(location.href);
    url.hash = eventId || '';
    const eventRootId = model.chapterByEventId.get(eventId)?.rootBranchId || activeRootId;
    const nextState = eventId
      ? {
        ...(state || {}),
        ff14ReaderSnapshot: { rootBranchId: eventRootId, eventId },
      }
      : state;
    history[`${mode}State`](nextState, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function snapshot() {
    return activeEventId ? { rootBranchId: activeRootId, eventId: activeEventId } : null;
  }

  function saveProgress(rootId = activeRootId, eventId = activeEventId) {
    if (!rootId || !eventId) return;
    const chapter = model.chapterByEventId.get(eventId);
    progressStore.write(rootId, { eventId, chapterId: chapter?.id || null });
  }

  function setActiveRecord(recordElement, { syncUrl = true } = {}) {
    if (!recordElement) return;
    activeEventId = recordElement.dataset.eventId;
    const chapter = model.chapterByEventId.get(activeEventId);
    const record = model.records.get(activeEventId);
    root.querySelectorAll('[data-reader-chapter]').forEach(link => {
      const active = link.dataset.readerChapter === chapter?.id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const branchChapters = chaptersFor(activeRootId);
    const chapterIndex = Math.max(0, branchChapters.findIndex(item => item.id === chapter?.id));
    const percentage = Math.round(((chapterIndex + 1) / Math.max(1, branchChapters.length)) * 100);
    progressBar.style.width = `${percentage}%`;
    progress.setAttribute('aria-valuenow', String(percentage));
    progress.setAttribute('aria-valuetext', `${chapterIndex + 1} / ${branchChapters.length} 章`);
    if (record && chapter) renderContext(context, record, chapter);
    clearTimeout(saveTimer);
    const rootId = activeRootId;
    const eventId = activeEventId;
    saveTimer = setTimeout(() => saveProgress(rootId, eventId), 120);
    if (syncUrl && !isSwitchingBranch && location.hash !== `#${encodeURIComponent(activeEventId)}`) {
      updateUrl(activeEventId);
    }
  }

  function observeRecords() {
    observer?.disconnect();
    if (typeof IntersectionObserver !== 'function') return;
    observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top - 150) - Math.abs(b.boundingClientRect.top - 150));
      if (visible[0]) setActiveRecord(visible[0].target);
    }, { rootMargin: '-12% 0px -68% 0px', threshold: [0, 0.01] });
    manuscript.querySelectorAll('.ff-reader-event').forEach(event => observer.observe(event));
  }

  function currentRecordFromViewport() {
    const marker = Math.min(220, window.innerHeight * 0.3);
    const records = [...manuscript.querySelectorAll('.ff-reader-event')]
      .filter(node => node.getClientRects().length > 0);
    let current = records[0];
    for (const record of records) {
      if (record.getBoundingClientRect().top <= marker) current = record;
      else break;
    }
    return current;
  }

  function onFallbackScroll() {
    if (fallbackScrollFrame) return;
    fallbackScrollFrame = requestAnimationFrame(() => {
      fallbackScrollFrame = 0;
      setActiveRecord(currentRecordFromViewport());
    });
  }

  function scrollToEvent(eventId, { focus = false, updateHash = true } = {}) {
    const target = document.getElementById(eventId);
    if (!target) return false;
    target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    setActiveRecord(target, { syncUrl: updateHash });
    if (focus) target.focus({ preventScroll: true });
    return true;
  }

  function renderDirectory(chapters) {
    directory.innerHTML = '';
    const grouped = new Map();
    for (const chapter of chapters) {
      const key = `${chapter.branchName}\u0000${chapter.eraTitle}`;
      if (!grouped.has(key)) grouped.set(key, { branchName: chapter.branchName, eraTitle: chapter.eraTitle, chapters: [] });
      grouped.get(key).chapters.push(chapter);
    }
    for (const group of grouped.values()) {
      const section = document.createElement('section');
      appendTextElement(section, 'p', 'ff-reader-directory-world', group.branchName);
      appendTextElement(section, 'h2', null, group.eraTitle);
      for (const chapter of group.chapters) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.readerChapter = chapter.id;
        const keyCount = chapter.keyEventIds.length;
        button.innerHTML = `<span></span><small>${chapter.eventIds.length} 则${keyCount ? ` · ${keyCount} 个关键节点` : ''}</small>`;
        button.querySelector('span').textContent = chapter.title;
        section.appendChild(button);
        if (keyCount) {
          const keyList = document.createElement('ul');
          keyList.className = 'ff-reader-key-events';
          for (const eventId of chapter.keyEventIds) {
            const item = document.createElement('li');
            const keyButton = document.createElement('button');
            keyButton.type = 'button';
            keyButton.dataset.readerEvent = eventId;
            keyButton.textContent = model.records.get(eventId)?.title || eventId;
            item.appendChild(keyButton);
            keyList.appendChild(item);
          }
          section.appendChild(keyList);
        }
      }
      directory.appendChild(section);
    }
  }

  function renderManuscript(chapters) {
    manuscript.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const chapter of chapters) {
      const section = document.createElement('section');
      section.className = 'ff-reader-chapter';
      section.id = `chapter-${chapter.id}`;
      section.dataset.chapterId = chapter.id;
      const header = document.createElement('header');
      appendTextElement(header, 'p', 'ff-reader-chapter-range', chapter.versionRange || chapter.eraTitle);
      appendTextElement(header, 'h2', null, chapter.title);
      if (chapter.summary) appendTextElement(header, 'p', 'ff-reader-chapter-summary', chapter.summary);
      section.appendChild(header);
      for (const event of chapter.events) section.appendChild(renderEvent(event, chapter));
      const footer = document.createElement('footer');
      footer.className = 'ff-reader-chapter-nav';
      const chapterIndex = chapters.indexOf(chapter);
      if (chapterIndex > 0) {
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.dataset.readerChapter = chapters[chapterIndex - 1].id;
        previous.textContent = `← ${chapters[chapterIndex - 1].title}`;
        footer.appendChild(previous);
      }
      if (chapterIndex < chapters.length - 1) {
        const next = document.createElement('button');
        next.type = 'button';
        next.dataset.readerChapter = chapters[chapterIndex + 1].id;
        next.textContent = `${chapters[chapterIndex + 1].title} →`;
        footer.appendChild(next);
      }
      section.appendChild(footer);
      fragment.appendChild(section);
    }
    manuscript.appendChild(fragment);
  }

  function switchBranch(rootId, requestedEventId, {
    focus = false,
    updateHistory = true,
    historyMode = 'replace',
    historyState = history.state,
  } = {}) {
    const previousRootId = activeRootId;
    const previousEventId = activeEventId;
    clearTimeout(saveTimer);
    saveTimer = null;
    saveProgress(previousRootId, previousEventId);
    navigationToken += 1;
    const token = navigationToken;
    if (navigationFrame) cancelAnimationFrame(navigationFrame);
    isSwitchingBranch = true;
    activeRootId = rootId;
    activeEventId = null;
    const chapters = chaptersFor(rootId);
    renderDirectory(chapters);
    renderManuscript(chapters);
    branchNav.querySelectorAll('button').forEach(button => {
      const active = button.dataset.readerBranch === rootId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    observeRecords();
    const stored = progressStore.read(rootId)?.eventId;
    const belongsToBranch = eventId => model.chapterByEventId.get(eventId)?.rootBranchId === rootId;
    const eventId = [requestedEventId, stored, chapters[0]?.eventIds[0]].find(belongsToBranch);
    navigationFrame = requestAnimationFrame(() => {
      navigationFrame = 0;
      if (token !== navigationToken || activeRootId !== rootId) return;
      if (!scrollToEvent(eventId, { focus, updateHash: false })) {
        isSwitchingBranch = false;
        return;
      }
      if (updateHistory) updateUrl(eventId, historyMode, historyState);
      isSwitchingBranch = false;
    });
  }

  function goToEvent(eventId, options = {}) {
    const chapter = model.chapterByEventId.get(eventId);
    if (!chapter) return false;
    if (chapter.rootBranchId !== activeRootId) switchBranch(chapter.rootBranchId, eventId, options);
    else scrollToEvent(eventId, options);
    return true;
  }

  for (const branch of model.roots) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.readerBranch = branch.id;
    button.textContent = branch.name;
    button.setAttribute('aria-pressed', 'false');
    branchNav.appendChild(button);
  }

  branchNav.addEventListener('click', event => {
    const button = event.target.closest('[data-reader-branch]');
    if (!button || button.dataset.readerBranch === activeRootId) return;
    switchBranch(button.dataset.readerBranch, null, { focus: true, historyMode: 'push' });
  }, { signal });
  branchNav.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...branchNav.querySelectorAll('button')];
    let index = buttons.indexOf(document.activeElement);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[index].click();
    buttons[index].focus();
  }, { signal });

  root.addEventListener('click', event => {
    const eventButton = event.target.closest('[data-reader-event]');
    if (eventButton) {
      scrollToEvent(eventButton.dataset.readerEvent, { focus: true });
      return;
    }
    const chapterButton = event.target.closest('[data-reader-chapter]');
    if (chapterButton) {
      const chapter = model.chapters.find(item => item.id === chapterButton.dataset.readerChapter);
      if (chapter) scrollToEvent(chapter.eventIds[0], { focus: true });
      return;
    }
    const crossRef = event.target.closest('[data-reader-target]');
    if (!crossRef) return;
    const origin = snapshot();
    const crossState = createCrossWorldHistoryState(origin, history.state || {});
    if (origin) history.replaceState(crossState.originEntry, '', location.href);
    const target = crossRef.dataset.readerTarget;
    updateUrl(target, 'push', crossState.targetEntry);
    returnBar.hidden = !origin;
    goToEvent(target, { focus: true, updateHash: false, updateHistory: false });
  }, { signal });

  returnBar.querySelector('button').addEventListener('click', () => history.back(), { signal });
  window.addEventListener('popstate', event => {
    const target = event.state?.ff14ReaderSnapshot?.eventId || location.hash.slice(1);
    if (target) goToEvent(target, { focus: true, updateHash: false, updateHistory: false });
    else switchBranch('mainline', null, { focus: true, updateHistory: false });
    returnBar.hidden = !event.state?.ff14ReaderReturn;
  }, { signal });

  if (typeof IntersectionObserver !== 'function') {
    window.addEventListener('scroll', onFallbackScroll, { passive: true, signal });
  }

  function destroy() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (navigationFrame) cancelAnimationFrame(navigationFrame);
    navigationFrame = 0;
    if (fallbackScrollFrame) cancelAnimationFrame(fallbackScrollFrame);
    fallbackScrollFrame = 0;
    observer?.disconnect();
    observer = null;
    saveProgress();
    listenerController.abort();
  }

  window.addEventListener('pagehide', event => {
    if (event.persisted) saveProgress();
    else destroy();
  }, { signal });

  const hashEventId = location.hash.slice(1);
  const hashChapter = model.chapterByEventId.get(hashEventId);
  switchBranch(hashChapter?.rootBranchId || 'mainline', hashChapter ? hashEventId : null, {
    focus: Boolean(hashChapter),
    updateHistory: false,
  });
  returnBar.hidden = !history.state?.ff14ReaderReturn;
  return { model, goToEvent, saveProgress, destroy };
}
