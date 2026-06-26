/* ═══════════════════════════════════════════════════════════
   timeline-ui.js — Branch tabs, event rendering, era nav
   ═══════════════════════════════════════════════════════════ */

import { dateSortVal, eraLabel } from './data-loader.js';

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

function findBranch(branchId) {
  if (!_data) return null;
  for (const branch of _data.branches) {
    if (branch.id === branchId) return branch;
    if (branch.subBranches) {
      const sub = branch.subBranches.find(sb => sb.id === branchId);
      if (sub) return sub;
    }
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
        id: branchId + '-ending-' + e.endingNumber,
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
    btn.dataset.branch = b.id;
    btn.textContent = b.name;
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
  if (currentBranch !== 'if-integrated') return;

  const integrated = _data?.branches?.find(b => b.id === 'if-integrated');
  if (!integrated || !integrated.subBranches) return;

  subContainer.style.display = 'flex';
  for (const sb of integrated.subBranches) {
    const btn = document.createElement('button');
    btn.className = 'tl-sub-tab' + (sb.status === 'pending' ? ' pending' : '');
    btn.dataset.branch = sb.id;
    btn.textContent = sb.name;
    if (sb.id === currentSubBranch) btn.classList.add('active');
    subContainer.appendChild(btn);
  }
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
    VirtualTimeline.clear();

    // Ensure axis line exists (not cleared by VirtualTimeline._renderRange)
    if (!tlContainer.querySelector('.tl-axis')) {
      const axisEl = document.createElement('div');
      axisEl.className = 'tl-axis';
      tlContainer.appendChild(axisEl);
    }

    VirtualTimeline.load(eraGroups);
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
      cardHTML += '<div class="event-ref cross-world-link" data-target="' + (ref.eventId || ref.id || '') + '" data-world="' + (ref.worldId || '') + '">' + (ref.label || '跨世界引用') + '</div>';
    }
  }

  cardHTML += '</div>'; // .event-card
  el.innerHTML = cardHTML;

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
  if (typeof VirtualTimeline !== 'undefined' && VirtualTimeline.items && VirtualTimeline.items.length > 0) {
    const eraItems = VirtualTimeline.items.filter(item => item.type === 'era-header');
    eraItems.forEach(item => {
      const a = document.createElement('a');
      a.className = 'era-nav-dot';
      a.href = '#';
      a.title = item.data;
      a.innerHTML = '<span class="dot"></span><span class="label">' + item.data + '</span>';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: item.top + 80, behavior: 'smooth' });
      });
      eraNav.appendChild(a);
    });
    return;
  }

  // Fallback: build from eraGroups data (direct render / IF branches)
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
    }
  }
}

/* ── Era nav visibility: show only after cover scrolls out of view ── */
function initEraNavObserver() {
  const cover = document.querySelector('.tl-cover');
  if (!cover) return;

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        eraNav.classList.remove('active');
      } else {
        eraNav.classList.add('active');
      }
    }
  }, { threshold: 0 });

  observer.observe(cover);
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
  if (typeof VirtualTimeline !== 'undefined' && VirtualTimeline.items && VirtualTimeline.items.length > 0) {
    const eraItems = VirtualTimeline.items.filter(item => item.type === 'era-header');
    const scrollMid = window.scrollY + window.innerHeight * 0.4;
    let currentIdx = 0;
    for (let i = eraItems.length - 1; i >= 0; i--) {
      if (eraItems[i].top <= scrollMid) {
        currentIdx = i;
        break;
      }
    }
    dots.forEach(d => d.classList.remove('current'));
    if (dots[currentIdx]) dots[currentIdx].classList.add('current');
    return;
  }

  // Fallback: use DOM headers (direct render / IF branches)
  const headers = document.querySelectorAll('.tl-era-header');
  let currentDot = null;
  for (let i = 0; i < headers.length; i++) {
    const rect = headers[i].getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.5) {
      currentDot = dots[i];
    }
  }
  if (!currentDot) currentDot = dots[0];
  dots.forEach(d => d.classList.remove('current'));
  if (currentDot) currentDot.classList.add('current');
}

/* ── Back to top ── */
backToTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── Branch tab switching ── */
document.getElementById('tl-branches').addEventListener('click', (e) => {
  if (!e.target.classList.contains('tl-branch-tab')) return;
  if (e.target.classList.contains('switching')) return;
  const branch = e.target.dataset.branch;
  if (branch === currentBranch) return;

  tlContainer.style.opacity = '0';
  tlContainer.style.transition = 'opacity 0.2s ease';

  setTimeout(() => {
    document.querySelectorAll('.tl-branch-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    e.target.classList.remove('switching');

    currentBranch = branch;
    currentSubBranch = null;
    updateSubTabs();

    if (branch === 'if-integrated') {
      const firstSub = document.querySelector('.tl-sub-tab');
      if (firstSub) {
        currentSubBranch = firstSub.dataset.branch;
        firstSub.classList.add('active');
      }
    }

    renderEvents(currentSubBranch || currentBranch);
    tlContainer.style.opacity = '1';
  }, 200);
});

document.getElementById('tl-sub-branches').addEventListener('click', (e) => {
  if (!e.target.classList.contains('tl-sub-tab')) return;
  const branch = e.target.dataset.branch;

  tlContainer.style.opacity = '0';
  tlContainer.style.transition = 'opacity 0.2s ease';

  setTimeout(() => {
    document.querySelectorAll('.tl-sub-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentSubBranch = branch;
    renderEvents(branch);
    tlContainer.style.opacity = '1';
  }, 200);
});

/* ── Event Detail Modal ── */
const modal = document.getElementById('event-modal');

function onCardClick(e) {
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
  if (!evt) return;
  openEventModal(evt);
}

function onKeyDown(e) {
  if (e.key === 'Escape') closeEventModal();
}

function onModalOverlayClick(e) {
  if (e.target === modal) closeEventModal();
}

export function initEventModal() {
  document.addEventListener('click', onCardClick);
  document.addEventListener('keydown', onKeyDown);
  if (modal) modal.addEventListener('click', onModalOverlayClick);
  const closeBtn = modal?.querySelector('.event-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeEventModal);
}

export function destroyEventModal() {
  document.removeEventListener('click', onCardClick);
  document.removeEventListener('keydown', onKeyDown);
  if (modal) modal.removeEventListener('click', onModalOverlayClick);
  const closeBtn = modal?.querySelector('.event-modal-close');
  if (closeBtn) closeBtn.removeEventListener('click', closeEventModal);
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
    imgEl.style.display = '';
    if (evt.images.length === 1) {
      const img = document.createElement('img');
      img.src = evt.images[0].src;
      img.alt = evt.images[0].alt || evt.title || '';
      img.loading = 'lazy';
      imgEl.appendChild(img);
    } else {
      // Multiple images: scrollable strip
      for (const imgData of evt.images) {
        const img = document.createElement('img');
        img.src = imgData.src;
        img.alt = imgData.alt || '';
        img.loading = 'lazy';
        imgEl.appendChild(img);
      }
    }
  }

  // Sources
  const sourcesEl = modal.querySelector('.event-modal-sources');
  sourcesEl.innerHTML = '';
  if (evt.prtsSources && evt.prtsSources.length > 0) {
    evt.prtsSources.forEach(s => {
      const item = document.createElement('div');
      item.className = 'event-source-item';
      if (s.title) {
        const label = document.createElement('span');
        label.className = 'source-label';
        label.textContent = s.title + '：';
        item.appendChild(label);
      }
      const link = document.createElement('a');
      link.className = 'event-modal-source-link';
      link.href = s.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = s.text;
      item.appendChild(link);
      sourcesEl.appendChild(item);
    });
  }

  // Show
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeEventModal() {
  if (!modal) return;
  modal.style.display = 'none';
  document.body.style.overflow = '';
}
