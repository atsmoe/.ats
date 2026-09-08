/* ═══════════════════════════════════════════════════════════
   star-map.js — Galaxy marker interaction + detail overlay
   Works with star-map-3d.js (Three.js handles rendering)
   ═══════════════════════════════════════════════════════════ */

import { GALAXIES } from './galaxies.js';
import { ANIM } from './anim-tokens.js';

let detailGalaxy = null;
let detailTrigger = null;
let interactionController = null;
let navigationTimer = null;

// DOM refs
let galaxyTooltipEl, gtName, gtSub;
let galaxyDetailEl, detailOverlay, detailCloseBtn;
let detailTitleEl, detailSubEl, detailDescEl, detailCalendarEl, detailEnterBtn;
let galaxyCanvas, galaxyCtx;

function listen(node, type, handler, options = {}) {
  node.addEventListener(type, handler, {
    ...options,
    signal: interactionController.signal,
  });
}

function showGalaxyDetail(gid, trigger = null) {
  const g = GALAXIES[gid];
  if (!g) return;
  detailGalaxy = gid;
  detailTrigger = trigger || document.activeElement?.closest?.('.galaxy-marker') || null;
  window.__detailGalaxy = gid;
  detailTitleEl.textContent = g.name;
  detailSubEl.textContent = g.subtitle;
  detailDescEl.textContent = g.description;
  detailCalendarEl.textContent = g.calendar;
  galaxyDetailEl.removeAttribute('inert');
  galaxyDetailEl.setAttribute('aria-hidden', 'false');
  galaxyDetailEl.classList.add('active');
  document.body.style.overflow = 'hidden';
  renderGalaxyPreview(gid);
  const closeButton = detailCloseBtn;
  requestAnimationFrame(() => closeButton?.focus());
}

function hideGalaxyDetail({ restoreFocus = true } = {}) {
  const triggerToRestore = detailTrigger;
  detailGalaxy = null;
  window.__detailGalaxy = null;
  galaxyDetailEl.classList.remove('active');
  galaxyDetailEl.setAttribute('inert', '');
  galaxyDetailEl.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (restoreFocus && triggerToRestore?.isConnected) {
    requestAnimationFrame(() => triggerToRestore?.focus());
  }
  detailTrigger = null;
}

function renderGalaxyPreview(gid) {
  if (!galaxyCtx) return;
  const g = GALAXIES[gid];
  const W = 640, H = 640;
  const cx = W / 2, cy = H / 2;
  galaxyCtx.clearRect(0, 0, W, H);

  for (let i = 3; i >= 0; i--) {
    const r = g.coreRadius * (3 + i * 8);
    const a = [0.35, 0.15, 0.06, 0.02][i];
    const grad = galaxyCtx.createRadialGradient(cx, cy, g.coreRadius, cx, cy, r);
    grad.addColorStop(0, `rgba(${g.coreColor[0]},${g.coreColor[1]},${g.coreColor[2]},${a})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    galaxyCtx.fillStyle = grad;
    galaxyCtx.fillRect(0, 0, W, H);
  }
  galaxyCtx.beginPath();
  galaxyCtx.arc(cx, cy, g.coreRadius * 0.8, 0, Math.PI * 2);
  galaxyCtx.fillStyle = `rgba(${g.coreColor[0]},${g.coreColor[1]},${g.coreColor[2]},0.9)`;
  galaxyCtx.fill();

  const rng = (seed) => { let s = seed; return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; }; };
  const rand = rng(gid === 'arknights' ? 42 : gid === 'wh40k' ? 137 : 256);

  if (g.armCount > 0) {
    for (let arm = 0; arm < g.armCount; arm++) {
      const baseAngle = (arm / g.armCount) * Math.PI * 2;
      for (let i = 0; i < g.armStars / g.armCount; i++) {
        const dist = (rand() * 0.9 + 0.1) * g.armMaxR * 1.8;
        const angle = baseAngle + (dist / (g.armMaxR * 1.8)) * g.armSpiral * Math.PI * 2 + (rand() - 0.5) * 0.8;
        const scatter = (rand() - 0.5) * g.armWidth * (0.3 + dist / (g.armMaxR * 1.8) * 0.7) * 2;
        const px = cx + Math.cos(angle) * dist + (rand() - 0.5) * scatter;
        const py = cy + Math.sin(angle) * dist * 0.5 + (rand() - 0.5) * scatter * 0.3;
        const brightness = rand();
        const r2 = 0.5 + brightness * 2;
        const warmth = rand() < g.warmBias ? 0.4 + rand() * 0.6 : rand() * 0.4;
        const cr = Math.round(140 + warmth * 100);
        const cg = Math.round(140 + warmth * 40 - (1 - warmth) * 20);
        const cb = Math.round(200 - warmth * 100);
        const alpha = 0.3 + brightness * 0.5;
        galaxyCtx.beginPath();
        galaxyCtx.arc(px, py, r2, 0, Math.PI * 2);
        galaxyCtx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        galaxyCtx.fill();
      }
    }
  } else {
    const clumpCount = 5;
    for (let c = 0; c < clumpCount; c++) {
      const clumpR = rand() * g.armMaxR;
      const clumpAngle = rand() * Math.PI * 2;
      for (let i = 0; i < g.armStars / clumpCount; i++) {
        const dx = (rand() - 0.5) * g.armWidth * 1.5;
        const dy = (rand() - 0.5) * g.armWidth * 0.8;
        const brightness = rand();
        const r2 = 0.5 + brightness * 1.8;
        const warm = rand() < 0.3;
        const cr = warm ? Math.round(200 + rand() * 40) : Math.round(140 + rand() * 60);
        const cg = warm ? Math.round(80 + rand() * 40) : Math.round(140 + rand() * 40);
        const cb = warm ? Math.round(40 + rand() * 30) : Math.round(180 + rand() * 40);
        galaxyCtx.beginPath();
        galaxyCtx.arc(cx + Math.cos(clumpAngle) * clumpR + dx, cy + Math.sin(clumpAngle) * clumpR * 0.55 + dy, r2, 0, Math.PI * 2);
        galaxyCtx.fillStyle = `rgba(${cr},${cg},${cb},${0.2 + brightness * 0.4})`;
        galaxyCtx.fill();
      }
    }
  }

  if (g.warpRift) {
    galaxyCtx.save();
    galaxyCtx.translate(cx + 30, cy - 20);
    galaxyCtx.rotate(0.3);
    galaxyCtx.globalAlpha = 0.15;
    const riftGrad = galaxyCtx.createLinearGradient(-50, 0, 50, 0);
    riftGrad.addColorStop(0, 'rgba(0,0,0,0)');
    riftGrad.addColorStop(0.3, 'rgba(120,30,180,0.5)');
    riftGrad.addColorStop(0.5, 'rgba(160,50,200,0.7)');
    riftGrad.addColorStop(0.7, 'rgba(120,30,180,0.5)');
    riftGrad.addColorStop(1, 'rgba(0,0,0,0)');
    galaxyCtx.fillStyle = riftGrad;
    galaxyCtx.fillRect(-50, -3, 100, 6);
    galaxyCtx.restore();
  }
  galaxyCtx.beginPath();
  galaxyCtx.arc(cx, cy, 3, 0, Math.PI * 2);
  galaxyCtx.fillStyle = 'rgba(255,240,200,0.8)';
  galaxyCtx.fill();
}

export function destroyStarMap() {
  interactionController?.abort();
  interactionController = null;
  if (navigationTimer) {
    clearTimeout(navigationTimer);
    navigationTimer = null;
  }
  if (detailGalaxy && galaxyDetailEl) {
    hideGalaxyDetail({ restoreFocus: false });
  }
}

export function initStarMap() {
  destroyStarMap();
  interactionController = new AbortController();

  galaxyTooltipEl = document.getElementById('galaxy-tooltip');
  gtName = document.getElementById('gt-name');
  gtSub = document.getElementById('gt-sub');
  galaxyDetailEl = document.getElementById('galaxy-detail');
  detailOverlay = document.getElementById('detail-overlay');
  detailCloseBtn = document.getElementById('detail-close');
  detailTitleEl = document.getElementById('detail-title');
  detailSubEl = document.getElementById('detail-sub');
  detailDescEl = document.getElementById('detail-desc');
  detailCalendarEl = document.getElementById('detail-calendar');
  detailEnterBtn = document.getElementById('detail-enter-btn');
  galaxyCanvas = document.getElementById('galaxy-canvas');
  galaxyCtx = galaxyCanvas ? galaxyCanvas.getContext('2d') : null;

  // Marker hover/click
  const markers = document.querySelectorAll('.galaxy-marker');
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  markers.forEach(marker => {
    const gid = marker.dataset.world;
    const g = GALAXIES[gid];
    if (!g) return;

    function positionTooltip() {
      gtName.textContent = g.name;
      gtSub.textContent = g.subtitle;
      const mx = parseInt(marker.style.left);
      const my = parseInt(marker.style.top);
      const tipW = 220;
      const tipH = 100;
      let tx = mx + 60;
      let ty = my - 20;
      if (tx + tipW > window.innerWidth - 12) tx = mx - tipW - 20;
      if (ty < 12) ty = 12;
      if (ty + tipH > window.innerHeight - 12) ty = window.innerHeight - tipH - 12;
      galaxyTooltipEl.style.left = tx + 'px';
      galaxyTooltipEl.style.top = ty + 'px';
    }

    listen(marker, 'mouseenter', () => {
      positionTooltip();
      galaxyTooltipEl.classList.add('visible');
      marker.classList.add('hovered');
    });

    listen(marker, 'mouseleave', () => {
      if (!marker.classList.contains('selected')) {
        galaxyTooltipEl.classList.remove('visible');
        marker.classList.remove('hovered');
      }
    });

    listen(marker, 'focus', () => {
      positionTooltip();
      galaxyTooltipEl.classList.add('visible');
      marker.classList.add('hovered');
    });

    listen(marker, 'blur', () => {
      if (!marker.classList.contains('selected')) {
        galaxyTooltipEl.classList.remove('visible');
        marker.classList.remove('hovered');
      }
    });

    listen(marker, 'keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      showGalaxyDetail(gid, marker);
    });

    if (isTouchDevice) {
      listen(marker, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!marker.classList.contains('selected')) {
          // First tap: show tooltip + highlight
          document.querySelectorAll('.galaxy-marker.selected').forEach(m => m.classList.remove('selected'));
          positionTooltip();
          galaxyTooltipEl.classList.add('visible');
          marker.classList.add('selected');
        } else {
          // Second tap: open detail
          marker.classList.remove('selected');
          galaxyTooltipEl.classList.remove('visible');
          showGalaxyDetail(gid, marker);
        }
      });
    } else {
      listen(marker, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showGalaxyDetail(gid, marker);
      });
    }
  });

  // Tap outside to deselect on touch devices
  if (isTouchDevice) {
    listen(document, 'click', (e) => {
      if (!e.target.closest('.galaxy-marker')) {
        document.querySelectorAll('.galaxy-marker.selected').forEach(m => {
          m.classList.remove('selected');
        });
        if (galaxyTooltipEl) galaxyTooltipEl.classList.remove('visible');
      }
    });
  }

  // Detail close
  listen(detailOverlay, 'click', () => { if (detailGalaxy) hideGalaxyDetail(); });
  listen(detailCloseBtn, 'click', () => { if (detailGalaxy) hideGalaxyDetail(); });
  listen(detailEnterBtn, 'click', () => {
    if (detailGalaxy) {
      const g = GALAXIES[detailGalaxy];
      const worldId = g.worldId || detailGalaxy;
      hideGalaxyDetail({ restoreFocus: false });
      navigationTimer = setTimeout(() => {
        navigationTimer = null;
        window.location.href = './' + worldId + '.html';
      }, 300);
    }
  });
  listen(document, 'keydown', (e) => {
    if (!detailGalaxy) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      hideGalaxyDetail();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [detailCloseBtn, detailEnterBtn].filter(Boolean);
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
  });
  listen(window, 'pagehide', event => {
    if (!event.persisted) destroyStarMap();
  });
}
