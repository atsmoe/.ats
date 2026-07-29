/* ═══════════════════════════════════════════════════════════
   timeline-ui.js — Branch tabs, event rendering, era nav
   ═══════════════════════════════════════════════════════════ */

import { dateSortVal, eraLabel } from './data-loader.js';
import { normalizeEventSources } from './event-sources.js';

let _data = null;
let currentBranch = 'mainline';
let currentSubBranch = null;

export function setData(data) {
  _data = data;
  currentBranch = _data?.branches?.find(b => b.isDefault)?.id || 'mainline';
  currentSubBranch = null;
}

export function getCurrentBranch() { return currentBranch; }
export function getCurrentSubBranch() { return currentSubBranch; }

const tlContainer = document.getElementById('tl-container');
const eraNav = document.getElementById('era-nav');
const backToTopBtn = document.getElementById('back-to-top');

function syncVirtualTimelineOrigin() {
  if (typeof VirtualTimeline === 'undefined' || !tlContainer) return;
  const documentTop = tlContainer.getBoundingClientRect().top + window.scrollY;
  VirtualTimeline.setContainerDocumentTop(documentTop);
}

function clearTimelineFocus() {
  if (!location.hash) return;
  const url = new URL(location.href);
  url.hash = '';
  history.replaceState(history.state, '', `${url.pathname}${url.search}`);
}

function findBranchPath(branchId, branches = _data?.branches || []) {
  for (const branch of branches) {
    if (branch.id === branchId) return [branch];
    const nested = findBranchPath(branchId, branch.subBranches || []);
    if (nested) return [branch, ...nested];
  }
  return null;
}

function findBranch(branchId) {
  const path = findBranchPath(branchId);
  return path ? path[path.length - 1] : null;
}

function findEventRecord(eventId, branches = _data?.branches || []) {
  for (const branch of branches) {
    const record = (branch.events || []).find(event => event.id === eventId);
    if (record) return record;
    const nested = findEventRecord(eventId, branch.subBranches || []);
    if (nested) return nested;
  }
  return null;
}

function getEraGroups(branch) {
  if (!branch || !branch.eras || branch.eras.length === 0) return [];
  return branch.eras.map(era => ({
    type: 'era',
    eraTitle: era.title,
    events: era.events || [],
  }));
}

export function getBranchEvents(branchId) {
  if (!_data) return [];

  const branch = findBranch(branchId);
  if (!branch) return [];

  if (branchId === 'mainline') {
    return getEraGroups(branch);
  }

  const groups = [];

  if (branch.description) {
    groups.push({
      type: 'notice',
      data: {
        type: 'branch-notice',
        title: branch.name,
        description: branch.description,
        isBranchNotice: true,
      },
    });
  }

  const eraGroups = getEraGroups(branch);
  if (eraGroups.length > 0) {
    groups.push(...eraGroups);
  }

  if (branch.endings && branch.endings.length > 0) {
    groups.push({
      type: 'if-endings',
      eraTitle: '结局分支（' + branch.endings.length + '个）',
      events: branch.endings.map(e => ({
        id: e.id || branchId + '-ending-' + e.endingNumber,
        dateDisplay: '结局 ' + e.endingNumber,
        title: e.title,
        description: e.description,
        location: e.location,
        characters: e.characters || [],
        tags: [branch.type || 'IF', '结局'],
        isEnding: true,
        conditions: e.conditions,
      })),
    });
  }

  return groups;
}

/* ── Populate branch tabs ── */
export function populateBranchTabs() {
  if (!_data) return;
  const container = document.getElementById('tl-branches');
  container.innerHTML = '';
  for (const b of _data.branches) {
    const btn = document.createElement('button');
    btn.className = 'tl-branch-tab' + (b.isDefault ? ' active' : '');
    btn.type = 'button';
    btn.dataset.branch = b.id;
    btn.textContent = b.name;
    btn.setAttribute('aria-pressed', String(Boolean(b.isDefault)));
    container.appendChild(btn);
  }
  currentBranch = _data.branches.find(b => b.isDefault)?.id || 'mainline';
  currentSubBranch = null;
  updateSubTabs();
}

export function updateSubTabs() {
  const subContainer = document.getElementById('tl-sub-branches');
  subContainer.innerHTML = '';
  subContainer.style.display = 'none';

  const rootBranch = _data?.branches?.find(branch => branch.id === currentBranch);
  if (!rootBranch?.subBranches?.length) return;

  subContainer.style.display = 'flex';
  for (const sb of rootBranch.subBranches) {
    const btn = document.createElement('button');
    btn.className = 'tl-sub-tab' + (sb.status === 'pending' ? ' pending' : '');
    btn.type = 'button';
    btn.dataset.branch = sb.id;
    btn.textContent = sb.name;
    const active = sb.id === currentSubBranch;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    subContainer.appendChild(btn);
  }
}

/**
 * Synchronize the visible root/sub-branch controls with a canonical record
 * reached by hash. Rendering remains the caller's responsibility.
 */
export function syncBranchPath(branchId) {
  const path = findBranchPath(branchId);
  if (!path) return false;

  currentBranch = path[0].id;
  currentSubBranch = path.length > 1 ? path[1].id : null;

  document.querySelectorAll('.tl-branch-tab').forEach(button => {
    const active = button.dataset.branch === currentBranch;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateSubTabs();
  document.querySelectorAll('.tl-sub-tab').forEach(button => {
    const active = button.dataset.branch === currentSubBranch;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  return true;
}

/* ── Update timeline cover ── */
export function updateTimelineCover(worldId) {
  const cover = document.querySelector('.tl-cover');
  if (!cover) return;
  if (!_data || !_data.world) return;

  const w = _data.world;
  cover.querySelector('h1').textContent = w.name + (w.nameCN && w.nameCN !== w.name ? ' · ' + w.nameCN : '');
  cover.querySelector('p').textContent = w.description || '';
  cover.querySelector('.calendar-badge').textContent = w.calendarSystem
    ? w.calendarSystem.replace(/./g, c => c + ' ').trim()
    : '';
}

/* ── Render events ── */
export function renderEvents(branch) {
  const eraGroups = getBranchEvents(branch);

  if (branch === 'mainline') {
    // Use VirtualTimeline for mainline
    if (typeof VirtualTimeline === 'undefined') {
      console.warn('VirtualTimeline not loaded, falling back to direct render');
      renderEventsDirect(eraGroups, branch);
      return;
    }
    VirtualTimeline.container = tlContainer;
    syncVirtualTimelineOrigin();
    VirtualTimeline.clear();

    // Ensure axis line exists (not cleared by VirtualTimeline._renderRange)
    if (!tlContainer.querySelector('.tl-axis')) {
      const axisEl = document.createElement('div');
      axisEl.className = 'tl-axis';
      tlContainer.appendChild(axisEl);
    }

    const reservedHeight = VirtualTimeline.load(eraGroups);
    // Reserve the full scroll range before positioning a deep link. Keeping
    // this DOM write in the UI prevents the browser from clamping an early
    // scrollTo() while VirtualTimeline still has an empty container.
    tlContainer.style.height = `${reservedHeight}px`;
    VirtualTimeline.update();

    // Build era nav (visible only after cover scrolls out of view)
    buildEraNav(eraGroups);
    initEraNavObserver();
    window.scrollTo(0, 0);
  } else {
    // IF branches: direct render, hide mainline era nav
    if (typeof VirtualTimeline !== 'undefined') {
      VirtualTimeline.clear();
    }
    renderEventsDirect(eraGroups, branch);
    eraNav.innerHTML = '';
    eraNav.classList.remove('active');
    window.scrollTo(0, 0);
  }
}

/* ── Direct render for IF branches ── */
function renderEventsDirect(eraGroups) {
  tlContainer.innerHTML = '';

  // Axis line
  const axisEl = document.createElement('div');
  axisEl.className = 'tl-axis';
  tlContainer.appendChild(axisEl);

  let globalIdx = 0;
  for (const group of eraGroups) {
    if (group.type === 'era') {
      // Era header
      const header = document.createElement('div');
      header.className = 'tl-era-header';
      header.innerHTML = '<div class="era-line"></div><div class="era-title">' + eraLabel(group.eraTitle) + '</div><div class="era-line"></div>';
      tlContainer.appendChild(header);

      // Events
      for (const evt of group.events || []) {
        const eventEl = buildEventCard(evt, globalIdx);
        tlContainer.appendChild(eventEl);
        globalIdx++;
      }
    } else if (group.type === 'if-endings') {
      const header = document.createElement('div');
      header.className = 'tl-era-header';
      header.innerHTML = '<div class="era-line"></div><div class="era-title">' + group.eraTitle + '</div><div class="era-line"></div>';
      tlContainer.appendChild(header);

      for (const evt of group.events || []) {
        const eventEl = buildEventCard(evt, 0);
        eventEl.classList.add('if-ending');
        tlContainer.appendChild(eventEl);
      }
    } else if (group.type === 'notice') {
      // Simple notice div
      const notice = document.createElement('div');
      notice.className = 'diverge-inline visible';
      notice.innerHTML = '<div class="diamond"></div><span>' + (group.data.title || '') + '</span>';
      tlContainer.appendChild(notice);
    }
  }

  // Trigger intersection observer for visibility animation
  setTimeout(() => {
    document.querySelectorAll('.tl-event, .tl-era-header').forEach(el => {
      el.classList.add('visible');
    });
  }, 50);
}

function buildEventCard(evt, idx) {
  const el = document.createElement('div');
  el.className = 'tl-event ' + (idx % 2 === 0 ? 'left' : 'right');
  el.id = evt.id || '';

  // Mark large events
  if (evt.isLargeEvent) el.classList.add('large-event');
  if (evt.isKeyEvent) el.classList.add('key-event');

  let cardHTML = '<div class="event-card">';

  // Date
  if (evt.dateDisplay) {
    cardHTML += '<div class="event-date"><span class="dot"></span>' + evt.dateDisplay + '</div>';
  }

  // Title
  if (evt.title) {
    cardHTML += '<div class="event-title">' + evt.title + '</div>';
  }

  // Meta (characters + location)
  if (evt.location || (evt.characters && evt.characters.length > 0)) {
    cardHTML += '<div class="event-meta">';
    if (evt.location) cardHTML += '<span class="meta-location">' + evt.location + '</span>';
    if (evt.characters && evt.characters.length > 0) {
      if (evt.location) cardHTML += ' | ';
      cardHTML += evt.characters.join('、');
    }
    cardHTML += '</div>';
  }

  // Conditions (for IF endings)
  if (evt.conditions) {
    cardHTML += '<div class="event-conditions"><span class="cond-icon"></span>' + evt.conditions + '</div>';
  }

  // Tags
  if (evt.tags && evt.tags.length > 0) {
    cardHTML += '<div class="event-tags">';
    for (const tag of evt.tags) {
      cardHTML += '<span class="event-tag">' + tag + '</span>';
    }
    cardHTML += '</div>';
  }

  // Cross-world refs
  if (evt.crossRefs && evt.crossRefs.length > 0) {
    for (const ref of evt.crossRefs) {
      cardHTML += '<button type="button" class="event-ref cross-world-link" data-target="' + (ref.eventId || ref.id || '') + '" data-world="' + (ref.worldId || '') + '">' + (ref.label || '跨世界引用') + '</button>';
    }
  }

  cardHTML += '</div>'; // .event-card
  el.innerHTML = cardHTML;
  const card = el.querySelector('.event-card');
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'event-card-open';
  openButton.setAttribute('aria-label', `查看记录：${evt.title || ''}`);
  openButton.setAttribute('aria-haspopup', 'dialog');
  card.prepend(openButton);

  // Add axis node
  const node = document.createElement('div');
  node.className = 'axis-node';
  if (evt.id && evt.id.startsWith('evt-') && parseInt(evt.id.split('-')[1]) % 5 === 0) {
    node.classList.add('crystal');
  }
  el.appendChild(node);

  return el;
}

/* ── Era sidebar navigation ── */
function buildEraNav(eraGroups) {
  eraNav.innerHTML = '';

  // Use VirtualTimeline items when available (has accurate top offsets)
  const eraItems = (typeof VirtualTimeline !== 'undefined' && VirtualTimeline.items && VirtualTimeline.items.length > 0)
    ? VirtualTimeline.items.filter(item => item.type === 'era-header')
    : null;

  if (eraItems) {
    eraItems.forEach(item => {
      const a = document.createElement('a');
      a.className = 'era-nav-dot';
      a.href = '#';
      a.title = item.data;
      a.innerHTML = '<span class="dot"></span><span class="label">' + item.data + '</span>';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({
          top: VirtualTimeline.documentTopForLocal(item.top) + 80,
          behavior: 'smooth',
        });
      });
      eraNav.appendChild(a);
    });
    buildMobileEraNav(eraItems);
    return;
  }

  // Fallback: build from eraGroups data (direct render / IF branches)
  const fallbackEras = [];
  for (const group of eraGroups) {
    if (group.type === 'era' && group.eraTitle) {
      const a = document.createElement('a');
      a.className = 'era-nav-dot';
      a.href = '#';
      a.title = eraLabel(group.eraTitle);
      a.innerHTML = '<span class="dot"></span><span class="label">' + eraLabel(group.eraTitle) + '</span>';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const headers = document.querySelectorAll('.tl-era-header');
        const index = Array.from(a.parentElement.children).indexOf(a);
        if (headers[index]) {
          headers[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      eraNav.appendChild(a);
      fallbackEras.push({ data: eraLabel(group.eraTitle), top: 0, fallback: true, index: fallbackEras.length });
    }
  }
  if (fallbackEras.length > 0) {
    buildMobileEraNav(fallbackEras);
  }
}

/* ── Mobile era nav: floating button + popup list ── */
function buildMobileEraNav(eraItems) {
  // Remove previous mobile elements if any
  const oldTrigger = eraNav.querySelector('.era-mobile-trigger');
  const oldList = eraNav.querySelector('.era-mobile-list');
  if (oldTrigger) oldTrigger.remove();
  if (oldList) oldList.remove();

  // Remove previous document click listener (avoid accumulation on branch switch)
  if (eraNav._mobileDocClick) {
    document.removeEventListener('click', eraNav._mobileDocClick);
    eraNav._mobileDocClick = null;
  }

  if (eraItems.length === 0) return;

  // Create trigger button
  const trigger = document.createElement('button');
  trigger.className = 'era-mobile-trigger';
  trigger.textContent = '时代';
  trigger.setAttribute('aria-label', '跳转时代');

  // Create era list
  const list = document.createElement('div');
  list.className = 'era-mobile-list';

  eraItems.forEach((item, idx) => {
    const a = document.createElement('a');
    a.className = 'era-mobile-item';
    a.href = '#';
    a.textContent = item.data;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (item.fallback) {
        const headers = document.querySelectorAll('.tl-era-header');
        if (headers[item.index]) {
          headers[item.index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        window.scrollTo({
          top: VirtualTimeline.documentTopForLocal(item.top) + 80,
          behavior: 'smooth',
        });
      }
      list.classList.remove('active');
    });
    list.appendChild(a);
  });

  // Toggle list on trigger click
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    list.classList.toggle('active');
  });

  // Close list on outside click (store reference for cleanup)
  const onDocClick = (e) => {
    if (!eraNav.contains(e.target)) {
      list.classList.remove('active');
    }
  };
  document.addEventListener('click', onDocClick);
  eraNav._mobileDocClick = onDocClick;

  eraNav.appendChild(list);
  eraNav.appendChild(trigger);

  // Store references for scroll highlight updates
  eraNav._mobileList = list;
  eraNav._mobileItems = eraItems;
}

/* ── Era nav visibility: show only after cover scrolls out of view ── */
let eraNavObserver = null;

function initEraNavObserver() {
  const cover = document.querySelector('.tl-cover');
  if (!cover) return;

  eraNavObserver?.disconnect();
  eraNavObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        eraNav.classList.remove('active');
      } else {
        eraNav.classList.add('active');
      }
    }
  }, { threshold: 0 });

  eraNavObserver.observe(cover);
}

/* ── Scroll handling for era nav highlight + back-to-top ── */
let scrollTicking = false;
window.addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;

    // Back to top
    if (window.scrollY > 400) {
      backToTopBtn.classList.add('visible');
    } else {
      backToTopBtn.classList.remove('visible');
    }

    // Update era nav
    updateEraNavHighlight();

    // Virtual timeline update
    if (typeof VirtualTimeline !== 'undefined' && VirtualTimeline.container) {
      VirtualTimeline.update();
    }
  });
}, { passive: true });

function updateEraNavHighlight() {
  const dots = eraNav.querySelectorAll('.era-nav-dot');
  if (dots.length === 0) return;

  // Use VirtualTimeline items with accurate top offsets (not DOM headers)
  let eraItems;
  if (typeof VirtualTimeline !== 'undefined' && VirtualTimeline.items && VirtualTimeline.items.length > 0) {
    eraItems = VirtualTimeline.items.filter(item => item.type === 'era-header');
  }

  if (eraItems && eraItems.length > 0) {
    const scrollMid = VirtualTimeline.localTopForDocument(
      window.scrollY + window.innerHeight * 0.4,
    );
    let currentIdx = 0;
    for (let i = eraItems.length - 1; i >= 0; i--) {
      if (eraItems[i].top <= scrollMid) {
        currentIdx = i;
        break;
      }
    }
    dots.forEach(d => d.classList.remove('current'));
    if (dots[currentIdx]) dots[currentIdx].classList.add('current');

    // Update mobile era list highlight
    updateMobileEraHighlight(currentIdx);
    return;
  }

  // Fallback: use DOM headers (direct render / IF branches)
  const headers = document.querySelectorAll('.tl-era-header');
  let currentDot = null;
  let currentIdx = 0;
  for (let i = 0; i < headers.length; i++) {
    const rect = headers[i].getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.5) {
      currentDot = dots[i];
      currentIdx = i;
    }
  }
  if (!currentDot) currentDot = dots[0];
  dots.forEach(d => d.classList.remove('current'));
  if (currentDot) currentDot.classList.add('current');

  // Update mobile era list highlight
  updateMobileEraHighlight(currentIdx);
}

export function syncEraNavigation(eraGroups) {
  buildEraNav(eraGroups);
  initEraNavObserver();
  updateEraNavHighlight();
}

function updateMobileEraHighlight(currentIdx) {
  const list = eraNav._mobileList;
  if (!list) return;
  const items = list.querySelectorAll('.era-mobile-item');
  items.forEach((item, i) => {
    if (i === currentIdx) {
      item.classList.add('current');
    } else {
      item.classList.remove('current');
    }
  });
}

/* ── Back to top ── */
backToTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── Branch tab switching ── */
let branchSwitchTimer = null;

document.getElementById('tl-branches').addEventListener('click', (e) => {
  if (!e.target.classList.contains('tl-branch-tab')) return;
  const branch = e.target.dataset.branch;
  if (branchSwitchTimer) {
    clearTimeout(branchSwitchTimer);
    branchSwitchTimer = null;
  }
  if (branch === currentBranch) {
    tlContainer.style.opacity = '1';
    return;
  }

  clearTimelineFocus();
  tlContainer.style.opacity = '0';
  tlContainer.style.transition = 'opacity 0.2s ease';

  branchSwitchTimer = setTimeout(() => {
    branchSwitchTimer = null;
    document.querySelectorAll('.tl-branch-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    document.querySelectorAll('.tl-branch-tab').forEach(t => {
      t.setAttribute('aria-pressed', String(t === e.target));
    });

    currentBranch = branch;
    currentSubBranch = null;
    updateSubTabs();

    const firstSub = document.querySelector('.tl-sub-tab');
    if (firstSub) {
      currentSubBranch = firstSub.dataset.branch;
      firstSub.classList.add('active');
      firstSub.setAttribute('aria-pressed', 'true');
    }

    renderEvents(currentSubBranch || currentBranch);
    tlContainer.style.opacity = '1';
  }, 200);
});

document.getElementById('tl-sub-branches').addEventListener('click', (e) => {
  if (!e.target.classList.contains('tl-sub-tab')) return;
  const branch = e.target.dataset.branch;
  if (branchSwitchTimer) clearTimeout(branchSwitchTimer);

  clearTimelineFocus();
  tlContainer.style.opacity = '0';
  tlContainer.style.transition = 'opacity 0.2s ease';

  branchSwitchTimer = setTimeout(() => {
    branchSwitchTimer = null;
    document.querySelectorAll('.tl-sub-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    document.querySelectorAll('.tl-sub-tab').forEach(t => {
      t.setAttribute('aria-pressed', String(t === e.target));
    });
    currentSubBranch = branch;
    renderEvents(branch);
    tlContainer.style.opacity = '1';
  }, 200);
});

/* ── Event Detail Modal ── */
const modal = document.getElementById('event-modal');
let modalOpen = false;
let modalReturnFocus = null;

function onCardClick(e) {
  if (e.target.closest('.cross-world-link')) return;
  const card = e.target.closest('.event-card');
  if (!card) return;
  // Find event data from the card's parent tl-event ID
  const tlEvent = card.closest('.tl-event');
  if (!tlEvent || !tlEvent.id) return;
  // Get event data from VirtualTimeline items or data-access
  let evt = null;
  if (typeof VirtualTimeline !== 'undefined' && VirtualTimeline.items) {
    for (const item of VirtualTimeline.items) {
      if (item.type === 'event' && item.data.id === tlEvent.id) {
        evt = item.data;
        break;
      }
    }
  }
  if (!evt) evt = findEventRecord(tlEvent.id);
  if (!evt) return;
  openEventModal(evt);
}

function onKeyDown(e) {
  if (!modalOpen || !modal) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    history.back();
    return;
  }
  if (e.key !== 'Tab') return;

  const focusable = [...modal.querySelectorAll(
    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )].filter(element => !element.hasAttribute('hidden'));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function onModalOverlayClick(e) {
  if (e.target === modal && modalOpen) history.back();
}

function onPopState() {
  if (modalOpen) closeEventModal();
}

function onCloseButtonClick() {
  if (modalOpen) history.back();
}

export function initEventModal() {
  document.addEventListener('click', onCardClick);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('popstate', onPopState);
  if (modal) modal.addEventListener('click', onModalOverlayClick);
  const closeBtn = modal?.querySelector('.event-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', onCloseButtonClick);
}

export function destroyEventModal() {
  document.removeEventListener('click', onCardClick);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('popstate', onPopState);
  if (modal) modal.removeEventListener('click', onModalOverlayClick);
  const closeBtn = modal?.querySelector('.event-modal-close');
  if (closeBtn) closeBtn.removeEventListener('click', onCloseButtonClick);
  if (modalOpen) closeEventModal();
}

function openEventModal(evt) {
  if (!modal) return;
  // Fill content
  modal.querySelector('.event-modal-date').textContent = evt.dateDisplay || '';
  modal.querySelector('.event-modal-title').textContent = evt.title || '';

  const meta = modal.querySelector('.event-modal-meta');
  meta.innerHTML = '';
  if (evt.location) {
    const loc = document.createElement('span');
    loc.textContent = evt.location;
    meta.appendChild(loc);
  }
  if (evt.characters && evt.characters.length > 0) {
    if (evt.location) meta.appendChild(document.createTextNode(' | '));
    const chars = document.createElement('span');
    chars.textContent = evt.characters.join('、');
    meta.appendChild(chars);
  }

  modal.querySelector('.event-modal-desc').textContent = evt.description || '';

  // Images
  const imgEl = modal.querySelector('.event-modal-img');
  imgEl.innerHTML = '';
  imgEl.style.display = 'none';
  if (evt.images && evt.images.length > 0) {
    imgEl.style.display = 'block';
    for (let i = 0; i < evt.images.length; i++) {
      const imgData = evt.images[i];
      const img = document.createElement('img');
      img.src = imgData.src;
      img.alt = imgData.alt || evt.title || '';
      img.loading = i === 0 ? 'eager' : 'lazy'; // first image eager, rest lazy
      img.decoding = 'async';                    // don't block main thread on decode
      if (imgData.width) img.width = imgData.width;
      if (imgData.height) img.height = imgData.height;
      imgEl.appendChild(img);
    }
  }

  // Sources
  const sourcesEl = modal.querySelector('.event-modal-sources');
  sourcesEl.innerHTML = '';
  if (evt.sourceStatus) {
    const status = document.createElement('div');
    status.className = 'event-source-item event-source-status';
    const label = document.createElement('span');
    label.className = 'source-label';
    label.textContent = '来源状态：';
    status.appendChild(label);
    status.appendChild(document.createTextNode(evt.sourceStatus));
    sourcesEl.appendChild(status);
  }
  normalizeEventSources(evt).forEach(source => {
    const item = document.createElement('div');
    item.className = 'event-source-item';
    if (source.label) {
      const label = document.createElement('span');
      label.className = 'source-label';
      label.textContent = source.label + '：';
      item.appendChild(label);
    }

    const sourceText = document.createElement(source.url ? 'a' : 'span');
    sourceText.className = 'event-modal-source-link';
    sourceText.textContent = source.text;
    if (source.url) {
      sourceText.href = source.url;
      sourceText.target = '_blank';
      sourceText.rel = 'noopener noreferrer';
    }
    item.appendChild(sourceText);
    sourcesEl.appendChild(item);
  });

  // Show
  const wasOpen = modalOpen;
  if (!wasOpen) modalReturnFocus = document.activeElement;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  modalOpen = true;
  if (!wasOpen) history.pushState({ modalOpen: true }, '');
  requestAnimationFrame(() => modal.querySelector('.event-modal-close')?.focus());
}

export function showEventDetails(evt) {
  if (!evt) return;
  openEventModal(evt);
}

function closeEventModal() {
  if (!modal || !modalOpen) return;
  modal.style.display = 'none';
  document.body.style.overflow = '';
  modalOpen = false;
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  modalReturnFocus = null;
}
