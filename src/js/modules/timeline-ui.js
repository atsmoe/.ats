/* ═══════════════════════════════════════════════════════════
   timeline-ui.js — Branch tabs, event rendering, era nav
   ═══════════════════════════════════════════════════════════ */

import { timelineData } from './data-loader.js';
import { dateSortVal, eraLabel } from './data-loader.js';

export let currentBranch = 'mainline';
export let currentSubBranch = null;

const tlContainer = document.getElementById('tl-container');
const eraNav = document.getElementById('era-nav');
const backToTopBtn = document.getElementById('back-to-top');

/* ── Get branch events ── */
export function getBranchEvents(branchId) {
  if (!timelineData) return [];

  // Mainline: eras from the default branch (or root-level fallback)
  if (branchId === 'mainline') {
    const branches = timelineData.subEntities[0].timeline.branches;
    const mainBranch = branches.find(b => b.id === 'mainline');
    // Use branch-level eras if populated, otherwise fall back to root-level eras
    const eras = (mainBranch && mainBranch.eras && mainBranch.eras.length > 0)
      ? mainBranch.eras
      : timelineData.eras || [];
    if (!eras.length) return [];
    return eras.map(era => ({
      type: 'era',
      eraTitle: era.title,
      events: era.events || [],
    }));
  }

  // IF sub-branches
  const branches = timelineData.subEntities[0].timeline.branches;
  let branchDef = branches.find(b => b.id === branchId);
  if (!branchDef) {
    const integrated = branches.find(b => b.id === 'if-integrated');
    if (integrated && integrated.subBranches) {
      branchDef = integrated.subBranches.find(sb => sb.id === branchId);
    }
  }
  if (!branchDef) return [];

  const groups = [];

  // Branch notice
  if (branchDef.description) {
    groups.push({
      type: 'notice',
      data: {
        type: 'branch-notice',
        title: branchDef.name,
        description: branchDef.description,
        isBranchNotice: true,
      },
    });
  }

  // IF endings as event cards
  if (branchDef.endings && branchDef.endings.length > 0) {
    groups.push({
      type: 'if-endings',
      eraTitle: '结局分支（' + branchDef.endings.length + '个）',
      events: branchDef.endings.map(e => ({
        id: branchId + '-ending-' + e.endingNumber,
        dateDisplay: '结局 ' + e.endingNumber,
        title: e.title,
        description: e.description,
        location: e.location,
        characters: e.characters || [],
        tags: [branchDef.type || 'IF', '结局'],
        isEnding: true,
        conditions: e.conditions,
      })),
    });
  }

  return groups;
}

/* ── Populate branch tabs ── */
export function populateBranchTabs() {
  if (!timelineData) return;
  const branches = timelineData.subEntities[0].timeline.branches;
  const container = document.getElementById('tl-branches');
  container.innerHTML = '';
  branches.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'tl-branch-tab' + (b.isDefault ? ' active' : '');
    btn.dataset.branch = b.id;
    btn.textContent = b.name;
    container.appendChild(btn);
  });
  currentBranch = branches.find(b => b.isDefault)?.id || 'mainline';
  currentSubBranch = null;
  updateSubTabs();
}

export function updateSubTabs() {
  const subContainer = document.getElementById('tl-sub-branches');
  subContainer.innerHTML = '';
  subContainer.style.display = 'none';
  if (currentBranch !== 'if-integrated') return;

  const branches = timelineData.subEntities[0].timeline.branches;
  const integrated = branches.find(b => b.id === 'if-integrated');
  if (!integrated || !integrated.subBranches) return;

  subContainer.style.display = 'flex';
  integrated.subBranches.forEach(sb => {
    const btn = document.createElement('button');
    btn.className = 'tl-sub-tab' + (sb.status === 'pending' ? ' pending' : '');
    btn.dataset.branch = sb.id;
    btn.textContent = sb.name;
    if (sb.id === currentSubBranch) btn.classList.add('active');
    subContainer.appendChild(btn);
  });
}

/* ── Update timeline cover ── */
export function updateTimelineCover(worldId) {
  const cover = document.querySelector('.tl-cover');
  if (!cover) return;
  const data = timelineData;
  if (!data || !data.world) return;

  const w = data.world;
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

  let cardHTML = '<div class="event-card">';

  // Date
  if (evt.dateDisplay) {
    cardHTML += '<div class="event-date"><span class="dot"></span>' + evt.dateDisplay + '</div>';
  }

  // Title
  if (evt.title) {
    cardHTML += '<div class="event-title">' + evt.title + '</div>';
  }

  // Meta
  if (evt.location || (evt.characters && evt.characters.length > 0)) {
    cardHTML += '<div class="event-meta">';
    if (evt.location) cardHTML += evt.location;
    if (evt.characters && evt.characters.length > 0) {
      if (evt.location) cardHTML += ' | ';
      cardHTML += evt.characters.join('、');
    }
    cardHTML += '</div>';
  }

  // Description
  if (evt.description) {
    cardHTML += '<div class="event-desc">' + evt.description + '</div>';
  }

  // Conditions
  if (evt.conditions) {
    cardHTML += '<div class="event-conditions"><span class="cond-icon">◆</span>' + evt.conditions + '</div>';
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

  cardHTML += '</div>';
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

/* ── 3D Card tilt ── */
document.addEventListener('mousemove', (e) => {
  const cards = document.querySelectorAll('.event-card:hover');
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rx = (e.clientY - cy) / (rect.height / 2) * -8;
    const ry = (e.clientX - cx) / (rect.width / 2) * 8;
    card.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) scale3d(1.02,1.02,1.02)`;
  });
});

document.addEventListener('mouseover', (e) => {
  const card = e.target.closest('.event-card');
  if (card) card.style.transition = 'transform 0.15s ease-out, box-shadow 0.3s, border-color 0.3s';
});

document.addEventListener('mouseout', (e) => {
  const card = e.target.closest('.event-card');
  if (card) {
    card.style.transition = 'transform 0.4s ease-out, box-shadow 0.3s, border-color 0.3s';
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
  }
});
