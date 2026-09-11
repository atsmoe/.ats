import { getBranches } from './data-access.js';
import { normalizeEventSources } from './event-sources.js';
import { worldRecordHref } from './world-routing.js';
import { createReaderProgressStore } from './reader-progress.js';
import {
  arknightsReaderProgress,
  arknightsReaderTarget,
  buildArknightsChapters,
  isMajorArknightsEvent,
} from './arknights-chronicle-model.js';

const WORLD_ID = 'arknights';

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function recordHref(record) {
  return `#${encodeURIComponent(record.id)}`;
}

function renderSource(source) {
  const item = element('li', 'ark-reader-source');
  if (source.label) item.append(element('span', 'ark-reader-source-label', `${source.label}：`));
  const content = element(source.url ? 'a' : 'span', '', source.text);
  if (source.url) {
    content.href = source.url;
    content.target = '_blank';
    content.rel = 'noopener noreferrer';
  }
  item.append(content);
  return item;
}

function renderRecord(record) {
  const article = element('article', 'ark-reader-record');
  article.id = record.id;
  article.dataset.eventId = record.id;
  article.tabIndex = -1;
  if (isMajorArknightsEvent(record)) article.classList.add('is-major');

  const header = element('header', 'ark-reader-record-head');
  const date = element('time', 'ark-reader-record-date', record.dateDisplay || '时间待确认');
  const title = element('h3', 'ark-reader-record-title', record.title || '未命名记录');
  header.append(date, title);
  article.append(header);

  const description = element('p', 'ark-reader-record-description', record.description || '');
  description.dataset.arknightsDescription = '';
  article.append(description);

  if (record.tags?.length) {
    const tags = element('div', 'ark-reader-inline-tags');
    record.tags.forEach(tag => tags.append(element('span', '', tag)));
    article.append(tags);
  }
  if (record.crossRefs?.length) {
    const refs = element('div', 'ark-reader-crossrefs');
    record.crossRefs.forEach(ref => {
      if (!ref.worldId || !(ref.eventId || ref.id)) return;
      const link = element('a', 'ark-reader-crossref', ref.label || '关联档案');
      link.href = worldRecordHref({ worldId: ref.worldId, eventId: ref.eventId || ref.id });
      refs.append(link);
    });
    article.append(refs);
  }
  return article;
}

function renderChapter(chapter) {
  const section = element('section', 'ark-reader-chapter');
  section.id = chapter.id;
  section.dataset.chapterId = chapter.id;
  const header = element('header', 'ark-reader-chapter-head');
  header.tabIndex = -1;
  header.append(
    element('p', 'ark-reader-chapter-era', chapter.eraTitle),
    element('h2', '', chapter.title),
    element('p', 'ark-reader-chapter-intro', chapter.intro),
  );
  section.append(header);

  for (const entry of chapter.entries) {
    if (entry.type === 'event') {
      section.append(renderRecord(entry.records[0]));
      continue;
    }
    const details = element('details', 'ark-reader-concurrent');
    const summary = element('summary', '', `同期记录 · ${entry.dateDisplay} · ${entry.records.length} 条`);
    details.append(summary);
    const records = element('div', 'ark-reader-concurrent-records');
    entry.records.forEach(record => records.append(renderRecord(record)));
    details.append(records);
    section.append(details);
  }
  return section;
}

export async function initArknightsChronicle() {
  const directory = document.getElementById('ark-chronicle-directory');
  const directoryList = document.getElementById('ark-chapter-list');
  const reader = document.getElementById('ark-reader');
  const readerIndex = document.getElementById('ark-reader-index-list');
  const readerScroll = document.getElementById('ark-reader-scroll');
  const readerContent = document.getElementById('ark-reader-content');
  const context = document.getElementById('ark-reader-context');
  const contextPanel = reader?.querySelector('.ark-reader-context-panel');
  const resumeLink = directory?.querySelector('[data-ark-reader-resume]');
  const closeButton = reader?.querySelector('[data-ark-reader-close]');
  const previousButton = reader?.querySelector('[data-ark-reader-previous]');
  const nextButton = reader?.querySelector('[data-ark-reader-next]');
  const progress = reader?.querySelector('[data-ark-reader-progress]');
  const progressText = reader?.querySelector('[data-ark-reader-progress-text]');
  const siteNav = document.getElementById('nav');
  if (!directory || !directoryList || !reader || !readerIndex || !readerScroll || !readerContent || !context) return null;

  const branches = await getBranches(WORLD_ID);
  const mainline = branches.find(branch => branch.id === 'mainline');
  if (!mainline) throw new Error('Arknights chronicle requires the canonical mainline branch');
  const model = buildArknightsChapters(mainline.eras || []);
  const allRecords = model.chapters.flatMap(chapter => chapter.records);
  const chapterById = new Map(model.chapters.map((chapter, index) => [chapter.id, { chapter, index }]));
  const recordIndexById = new Map(allRecords.map((record, index) => [record.id, index]));
  const listenerController = new AbortController();
  const { signal } = listenerController;
  let storage = null;
  try { storage = window.localStorage; } catch (_error) { /* storage can be denied */ }
  const progressStore = createReaderProgressStore(storage, 'ats.arknights.reader.progress.v1');
  const narrowScreen = window.matchMedia?.('(max-width: 980px)');
  let isOpen = false;
  let returnFocus = null;
  let pageScrollY = 0;
  let currentEventId = null;
  let currentChapterIndex = 0;
  let currentRecordNode = null;
  let currentIndexLink = null;
  let scrollFrame = 0;
  let navigationFrame = 0;
  let isNavigating = false;
  let navigationScrollTop = null;
  let recordObserver = null;

  directoryList.innerHTML = '';
  model.chapters.forEach((chapter, index) => {
    const card = element('article', 'ark-chapter-card');
    const meta = element('p', 'ark-chapter-card-meta', `${chapter.records.length} 条记录 · ${chapter.keyEventCount} 个关键节点`);
    const title = element('h2');
    const link = element('a', 'ark-chapter-open', chapter.title);
    link.href = `#${chapter.id}`;
    link.dataset.arkReaderTarget = chapter.id;
    title.append(link);
    const intro = element('p', 'ark-chapter-card-intro', chapter.intro);
    card.append(meta, title, intro);
    if (chapter.representative) {
      const representative = element('a', 'ark-chapter-representative');
      representative.href = recordHref(chapter.representative);
      representative.dataset.arkReaderTarget = chapter.representative.id;
      representative.append(
        element('span', '', '代表事件'),
        element('strong', '', chapter.representative.title),
        element('time', '', chapter.representative.dateDisplay || '时间待确认'),
      );
      card.append(representative);
    }
    card.style.setProperty('--ark-chapter-order', String(index));
    directoryList.append(card);
  });

  readerIndex.innerHTML = '';
  readerContent.innerHTML = '';
  model.chapters.forEach(chapter => {
    const link = element('a', 'ark-reader-index-link', chapter.title);
    link.href = `#${chapter.id}`;
    link.dataset.arkReaderTarget = chapter.id;
    readerIndex.append(link);
    readerContent.append(renderChapter(chapter));
  });
  const indexLinks = [...readerIndex.querySelectorAll('.ark-reader-index-link')];
  const recordNodes = [...readerContent.querySelectorAll('.ark-reader-record')];
  const recordNodeById = new Map(recordNodes.map(node => [node.dataset.eventId, node]));
  const chapterHeadById = new Map(
    [...readerContent.querySelectorAll('.ark-reader-chapter')]
      .map(section => [section.id, section.querySelector('.ark-reader-chapter-head')]),
  );

  function updateResumeLink() {
    const saved = progressStore.read(mainline.id);
    const position = model.recordsById.get(saved?.eventId);
    if (!resumeLink) return;
    resumeLink.hidden = !position;
    if (!position) return;
    resumeLink.href = recordHref(position.record);
    resumeLink.dataset.arkReaderTarget = position.record.id;
    resumeLink.querySelector('[data-ark-reader-resume-title]').textContent = position.record.title;
  }

  function saveProgress() {
    if (isOpen && currentEventId) progressStore.write(mainline.id, { eventId: currentEventId });
  }

  function updateContextLayout() {
    if (!contextPanel) return;
    if (narrowScreen?.matches && context.contains(document.activeElement)) {
      contextPanel.querySelector('summary')?.focus({ preventScroll: true });
    }
    contextPanel.open = !narrowScreen?.matches;
  }

  function setContext(record) {
    if (!record || record.id === currentEventId) return;
    currentEventId = record.id;
    const position = model.recordsById.get(record.id);
    if (position) currentChapterIndex = position.chapterPosition;
    currentRecordNode?.classList.remove('is-current');
    currentRecordNode = recordNodeById.get(record.id) || null;
    currentRecordNode?.classList.add('is-current');
    currentIndexLink?.classList.remove('is-current');
    currentIndexLink?.removeAttribute('aria-current');
    currentIndexLink = indexLinks[currentChapterIndex] || null;
    currentIndexLink?.classList.add('is-current');
    currentIndexLink?.setAttribute('aria-current', 'location');

    context.innerHTML = '';
    context.append(
      element('p', 'ark-reader-context-label', '当前档案'),
      element('h2', 'ark-reader-context-title', record.title || '未命名记录'),
      element('p', 'ark-reader-context-date', record.dateDisplay || '时间待确认'),
    );
    if (record.characters?.length) {
      const people = element('section', 'ark-reader-context-section');
      people.append(element('h3', '', '人物与组织'), element('p', '', record.characters.join('、')));
      context.append(people);
    }
    if (record.location) {
      const place = element('section', 'ark-reader-context-section');
      place.append(element('h3', '', '地点'), element('p', '', record.location));
      context.append(place);
    }
    const sources = normalizeEventSources(record);
    if (sources.length) {
      const sourceSection = element('section', 'ark-reader-context-section');
      sourceSection.append(element('h3', '', '来源'));
      const list = element('ul', 'ark-reader-source-list');
      sources.forEach(source => list.append(renderSource(source)));
      sourceSection.append(list);
      context.append(sourceSection);
    }
    if (record.images?.length) {
      const imageSection = element('section', 'ark-reader-context-section ark-reader-images');
      imageSection.append(element('h3', '', '图像'));
      record.images.forEach((image, index) => {
        const img = element('img');
        img.src = image.src;
        img.alt = image.alt || record.title || '';
        img.loading = index === 0 ? 'eager' : 'lazy';
        img.decoding = 'async';
        if (image.width) img.width = image.width;
        if (image.height) img.height = image.height;
        imageSection.append(img);
      });
      context.append(imageSection);
    }
    const recordIndex = recordIndexById.get(record.id) ?? 0;
    const percentage = arknightsReaderProgress(recordIndex, allRecords.length);
    if (progress) {
      progress.value = percentage;
      progress.setAttribute('aria-valuetext', `${recordIndex + 1} / ${allRecords.length}`);
    }
    if (progressText) progressText.textContent = `${recordIndex + 1} / ${allRecords.length}`;
    if (previousButton) previousButton.disabled = currentChapterIndex <= 0;
    if (nextButton) nextButton.disabled = currentChapterIndex >= model.chapters.length - 1;
    if (isOpen && location.hash !== recordHref(record)) {
      history.replaceState(history.state, '', recordHref(record));
    }
    saveProgress();
  }

  function currentRecordFromViewport() {
    const records = recordNodes.filter(record => record.getClientRects().length > 0);
    const marker = readerScroll.getBoundingClientRect().top + Math.min(180, readerScroll.clientHeight * 0.3);
    let current = records[0];
    for (const record of records) {
      if (record.getBoundingClientRect().top <= marker) current = record;
      else break;
    }
    return current?.dataset.eventId ? model.recordsById.get(current.dataset.eventId)?.record : null;
  }

  function onReaderScroll() {
    if (scrollFrame || isNavigating || !isOpen) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!isOpen || isNavigating || readerScroll.scrollTop === navigationScrollTop) return;
      setContext(currentRecordFromViewport());
    });
  }

  function observeCurrentRecord() {
    if (typeof IntersectionObserver !== 'function') return false;
    recordObserver = new IntersectionObserver(entries => {
      if (!isOpen || isNavigating || readerScroll.scrollTop === navigationScrollTop) return;
      const current = entries
        .filter(entry => entry.isIntersecting && entry.target.getClientRects().length > 0)
        .sort((left, right) => (
          Math.abs(left.boundingClientRect.top - 160) - Math.abs(right.boundingClientRect.top - 160)
        ))[0]?.target;
      const record = current?.dataset.eventId
        ? model.recordsById.get(current.dataset.eventId)?.record
        : null;
      if (record) setContext(record);
    }, {
      root: readerScroll,
      rootMargin: '-16% 0px -68% 0px',
      threshold: [0, 0.01],
    });
    recordNodes.forEach(node => recordObserver.observe(node));
    return true;
  }

  function revealTarget(target, focus = true) {
    if (navigationFrame) cancelAnimationFrame(navigationFrame);
    isNavigating = true;
    let node = null;
    if (target?.type === 'event') {
      node = recordNodeById.get(target.id);
      const details = node?.closest('details');
      if (details) details.open = true;
      const record = model.recordsById.get(target.id)?.record;
      if (record) setContext(record);
    } else if (target?.type === 'chapter') {
      node = chapterHeadById.get(target.id);
      const chapter = chapterById.get(target.id);
      if (chapter?.chapter.records[0]) setContext(chapter.chapter.records[0]);
    }
    if (!node) node = readerContent.querySelector('.ark-reader-chapter-head');
    // Long chapter jumps are immediate: intermediate records must not replace
    // the explicit destination or its saved reading position.
    node?.scrollIntoView({ behavior: 'instant', block: 'start' });
    navigationScrollTop = readerScroll.scrollTop;
    if (focus) node?.focus({ preventScroll: true });
    navigationFrame = requestAnimationFrame(() => {
      navigationFrame = 0;
      if (!isOpen) return;
      node?.scrollIntoView({ behavior: 'instant', block: 'start' });
      navigationScrollTop = readerScroll.scrollTop;
      isNavigating = false;
    });
  }

  function openReader(target, push = false, opener = null) {
    if (!isOpen) {
      pageScrollY = window.scrollY;
      returnFocus = opener || document.activeElement;
      reader.hidden = false;
      reader.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ark-reader-open');
      directory.setAttribute('inert', '');
      siteNav?.setAttribute('inert', '');
      isOpen = true;
    }
    if (push) {
      const hash = target?.id ? `#${encodeURIComponent(target.id)}` : '#ark-chapter-1-1';
      history.pushState({ ...(history.state || {}), arkReaderOrigin: true }, '', hash);
    }
    revealTarget(target);
  }

  function closeReader({ restoreFocus = true, clearHash = false } = {}) {
    if (!isOpen) return;
    saveProgress();
    updateResumeLink();
    isOpen = false;
    reader.hidden = true;
    reader.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ark-reader-open');
    directory.removeAttribute('inert');
    siteNav?.removeAttribute('inert');
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    if (navigationFrame) cancelAnimationFrame(navigationFrame);
    navigationFrame = 0;
    isNavigating = false;
    if (clearHash && arknightsReaderTarget(location.hash)) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    window.scrollTo({ top: pageScrollY, behavior: 'auto' });
    if (restoreFocus) requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else directory.focus({ preventScroll: true });
    });
  }

  function closeFromControl() {
    if (history.state?.arkReaderOrigin) history.back();
    else closeReader({ clearHash: true });
  }

  function goToChapter(index) {
    const chapter = model.chapters[Math.max(0, Math.min(index, model.chapters.length - 1))];
    if (!chapter) return;
    const target = { type: 'chapter', id: chapter.id };
    history.replaceState(history.state, '', `#${chapter.id}`);
    revealTarget(target);
  }

  function onTargetClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const link = event.target.closest('[data-ark-reader-target]');
    if (!link) return;
    const target = arknightsReaderTarget(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    if (!isOpen) {
      openReader(target, true, link);
      return;
    }
    if (location.hash !== link.getAttribute('href')) {
      history.replaceState(history.state, '', link.getAttribute('href'));
    }
    revealTarget(target);
  }

  function onKeydown(event) {
    if (!isOpen) return;
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFromControl();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...reader.querySelectorAll('button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.closest('[hidden]') && node.getClientRects().length > 0);
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

  function syncHistory() {
    const target = arknightsReaderTarget(location.hash);
    if (target) openReader(target, false);
    else closeReader();
  }

  function destroy() {
    saveProgress();
    if (navigationFrame) cancelAnimationFrame(navigationFrame);
    navigationFrame = 0;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    recordObserver?.disconnect();
    recordObserver = null;
    directory.removeAttribute('inert');
    siteNav?.removeAttribute('inert');
    listenerController.abort();
  }

  function onPageHide(event) {
    saveProgress();
    if (!event.persisted) destroy();
  }

  directory.addEventListener('click', onTargetClick, { signal });
  reader.addEventListener('click', onTargetClick, { signal });
  if (!observeCurrentRecord()) {
    readerScroll.addEventListener('scroll', onReaderScroll, { passive: true, signal });
  }
  closeButton?.addEventListener('click', closeFromControl, { signal });
  previousButton?.addEventListener('click', () => goToChapter(currentChapterIndex - 1), { signal });
  nextButton?.addEventListener('click', () => goToChapter(currentChapterIndex + 1), { signal });
  document.addEventListener('keydown', onKeydown, { signal });
  window.addEventListener('popstate', syncHistory, { signal });
  window.addEventListener('hashchange', syncHistory, { signal });
  window.addEventListener('pagehide', onPageHide, { signal });
  narrowScreen?.addEventListener('change', updateContextLayout, { signal });
  updateContextLayout();
  updateResumeLink();

  const initialTarget = arknightsReaderTarget(location.hash);
  if (initialTarget) openReader(initialTarget, false);
  else setContext(allRecords[0]);

  directory.dataset.chapterCount = String(model.chapters.length);
  directory.dataset.recordCount = String(allRecords.length);
  return { ...model, recordCount: allRecords.length, destroy };
}
