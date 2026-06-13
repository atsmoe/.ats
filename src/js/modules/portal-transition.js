/* ═══════════════════════════════════════════════════════════
   portal-transition.js — Portal outgoing + incoming animations
   ═══════════════════════════════════════════════════════════ */

import { dateSortVal, eraLabel } from './data-loader.js';

let _data = null;

export function setData(data) {
  _data = data;
}

function getMainlineEraGroups() {
  if (!_data) return [];
  const mainBranch = _data.branches?.find(b => b.id === 'mainline' || b.isDefault);
  if (!mainBranch) return [];
  const eras = mainBranch.eras;
  if (!eras || eras.length === 0) return [];
  return eras.map(era => ({
    type: 'era',
    eraTitle: era.title,
    events: era.events || [],
  }));
}

export function initPortalArrival() {
  const hash = window.location.hash;
  if (!hash) {
    dismissPortal();
    return;
  }

  const eventId = hash.replace('#', '');
  const portalDiv = document.getElementById('portal-arrival');
  if (!portalDiv) {
    dismissPortal();
    return;
  }

  if (!_data) {
    console.warn('portal-arrival: no data loaded');
    dismissPortal();
    return;
  }

  const eraGroups = getMainlineEraGroups();
  let targetIdx = -1;
  let flatEvents = [];
  for (const group of eraGroups) {
    if (group.events) {
      for (let i = 0; i < group.events.length; i++) {
        if (group.events[i].id === eventId) {
          targetIdx = flatEvents.length;
        }
        flatEvents.push(group.events[i]);
      }
    }
  }

  if (targetIdx < 0) {
    dismissPortal();
    return;
  }

  if (typeof VirtualTimeline !== 'undefined') {
    VirtualTimeline.clear();
  }

  const container = document.getElementById('tl-container');
  if (container) {
    container.innerHTML = '';
    let globalIdx = 0;
    for (const group of eraGroups) {
      if (group.type === 'era' || group.eraTitle) {
        const header = document.createElement('div');
        header.className = 'tl-era-header visible';
        header.innerHTML = '<div class="era-line"></div><div class="era-title">' + (group.eraTitle || group.type) + '</div><div class="era-line"></div>';
        container.appendChild(header);
        for (const evt of (group.events || [])) {
          const el = buildSimpleEventCard(evt, globalIdx, eventId);
          container.appendChild(el);
          globalIdx++;
        }
      }
    }
  }

  const targetEl = document.getElementById(eventId);
  if (targetEl) {
    targetEl.scrollIntoView({ block: 'center' });
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      playArrivalAnimation(portalDiv, eventId);
    });
  });
}

function buildSimpleEventCard(evt, idx, targetId) {
  const el = document.createElement('div');
  el.className = 'tl-event ' + (idx % 2 === 0 ? 'left' : 'right') + ' visible';
  el.id = evt.id || '';
  const isTarget = evt.id === targetId;

  let cardHTML = '<div class="event-card' + (isTarget ? '" style="border-color:rgba(240,216,120,0.6);box-shadow:0 0 32px rgba(240,216,120,0.15);"' : '"') + '>';
  if (evt.dateDisplay) cardHTML += '<div class="event-date"><span class="dot"></span>' + evt.dateDisplay + '</div>';
  if (evt.title) cardHTML += '<div class="event-title">' + evt.title + '</div>';
  if (evt.location || (evt.characters && evt.characters.length > 0)) {
    cardHTML += '<div class="event-meta">' + [evt.location, evt.characters?.join('、')].filter(Boolean).join(' | ') + '</div>';
  }
  if (evt.description) cardHTML += '<div class="event-desc">' + evt.description + '</div>';
  cardHTML += '</div>';
  el.innerHTML = cardHTML;

  const node = document.createElement('div');
  node.className = 'axis-node' + (isTarget ? ' crystal' : '');
  el.appendChild(node);

  return el;
}

function playArrivalAnimation(portalDiv, eventId) {
  const targetEl = document.getElementById(eventId);
  if (!targetEl) {
    dismissPortal();
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const W = window.innerWidth;
  const H = window.innerHeight;

  // Use canvas particle overlay for reverse wormhole
  const wormholeCanvas = document.getElementById('wormhole');
  const whCtx = wormholeCanvas.getContext('2d');
  let progress = 0;

  function step() {
    progress += 0.02;
    if (progress >= 1) {
      whCtx.clearRect(0, 0, W, H);
      wormholeCanvas.classList.remove('active');
      dismissPortal();
      // Restore virtual scrolling
      if (typeof VirtualTimeline !== 'undefined' && typeof renderEvents === 'function') {
        renderEvents('mainline');
      }
      return;
    }

    whCtx.clearRect(0, 0, W, H);
    const t = 1 - progress; // Reverse: start large, shrink to target

    // Wormhole radius shrinking
    const maxRadius = Math.max(W, H);
    const targetRadius = 40;
    const radius = targetRadius + maxRadius * t * t;

    const cx = centerX;
    const cy = centerY;
    const gradient = whCtx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
    gradient.addColorStop(0, `rgba(240,216,120,${t * 0.9})`);
    gradient.addColorStop(0.3, `rgba(201,160,80,${t * 0.6})`);
    gradient.addColorStop(0.6, `rgba(160,120,60,${t * 0.3})`);
    gradient.addColorStop(0.85, 'rgba(8,8,16,0.1)');
    gradient.addColorStop(1, 'rgba(8,8,16,0)');
    whCtx.fillStyle = gradient;
    whCtx.fillRect(0, 0, W, H);

    // Spiral particles converging
    const numParticles = 60;
    const spinAngle = t * Math.PI * 8;
    for (let i = 0; i < numParticles; i++) {
      const angle = (i / numParticles) * Math.PI * 2 + spinAngle;
      const dist = radius * 0.8;
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist * 0.3;
      const alpha = t;
      whCtx.beginPath();
      whCtx.arc(px, py, 1.5, 0, Math.PI * 2);
      whCtx.fillStyle = `rgba(240,216,120,${alpha})`;
      whCtx.fill();
    }

    // Also fade overlay div
    portalDiv.style.opacity = Math.max(0, t * 2 - 0.5);

    requestAnimationFrame(step);
  }

  wormholeCanvas.classList.add('active');
  step();
}

function dismissPortal() {
  const portalDiv = document.getElementById('portal-arrival');
  if (portalDiv) {
    portalDiv.classList.add('fade-out');
    setTimeout(() => {
      if (portalDiv.parentNode) portalDiv.parentNode.removeChild(portalDiv);
    }, 500);
  }
}

/**
 * Outgoing portal effect — triggered on cross-world link click
 * @param {Event} e - click event
 * @param {string} targetUrl - destination URL
 */
export function playPortalOutgoing(e, targetUrl) {
  e.preventDefault();
  const clickX = e.clientX;
  const clickY = e.clientY;

  const wormholeCanvas = document.getElementById('wormhole');
  const whCtx = wormholeCanvas.getContext('2d');
  const W = wormholeCanvas.width = window.innerWidth;
  const H = wormholeCanvas.height = window.innerHeight;
  let progress = 0;

  function step() {
    progress += 0.025;
    if (progress >= 1) {
      whCtx.clearRect(0, 0, W, H);
      window.location.href = targetUrl;
      return;
    }

    whCtx.clearRect(0, 0, W, H);

    // Wormhole expanding from click point
    const radius = progress * progress * Math.max(W, H);

    const gradient = whCtx.createRadialGradient(clickX, clickY, radius * 0.1, clickX, clickY, radius);
    gradient.addColorStop(0, `rgba(240,216,120,${progress * 0.9})`);
    gradient.addColorStop(0.3, `rgba(201,160,80,${progress * 0.7})`);
    gradient.addColorStop(0.7, `rgba(8,8,16,${progress * 0.5})`);
    gradient.addColorStop(1, 'rgba(8,8,16,0)');
    whCtx.fillStyle = gradient;
    whCtx.fillRect(0, 0, W, H);

    // Spiral particles expanding out
    const numParticles = 80;
    const spinAngle = progress * Math.PI * 6;
    for (let i = 0; i < numParticles; i++) {
      const angle = (i / numParticles) * Math.PI * 2 + spinAngle;
      const dist = radius * (0.3 + progress * 0.7);
      const px = clickX + Math.cos(angle) * dist;
      const py = clickY + Math.sin(angle) * dist * 0.3;
      const alpha = progress;
      whCtx.beginPath();
      whCtx.arc(px, py, 1 + progress * 2, 0, Math.PI * 2);
      whCtx.fillStyle = `rgba(240,216,120,${alpha})`;
      whCtx.fill();
    }

    requestAnimationFrame(step);
  }

  wormholeCanvas.classList.add('active');
  step();
}
