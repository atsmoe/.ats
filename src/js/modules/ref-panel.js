/* ═══════════════════════════════════════════════════════════
   ref-panel.js — Cross-world reference panel + wormhole
   ═══════════════════════════════════════════════════════════ */

import { findEventById } from './data-loader.js';

const overlay = document.getElementById('overlay');
const refPanel = document.getElementById('ref-panel');
const refClose = document.getElementById('ref-close');
const btnWormhole = document.getElementById('btn-wormhole');
const wormholeCanvas = document.getElementById('wormhole');
const whCtx = wormholeCanvas.getContext('2d');
let wormholeAnim = null;
let wormholeProgress = 0;
let portalTargetUrl = null;

export function openRefPanel(eventId, worldId) {
  const evt = findEventById(eventId);
  if (!evt) return;

  document.getElementById('ref-world-label').textContent = '—— 跨世界引用 ——';
  document.getElementById('ref-event-date').textContent = evt.dateDisplay || '';
  document.getElementById('ref-event-title').textContent = evt.title || '';
  document.getElementById('ref-event-desc').textContent = evt.description || '';

  // Set wormhole target
  if (worldId) {
    portalTargetUrl = './' + worldId + '.html#' + eventId;
    btnWormhole.style.display = 'block';
  } else {
    portalTargetUrl = null;
    btnWormhole.style.display = 'none';
  }

  overlay.classList.add('active');
  refPanel.classList.add('active');
}

export function closeRefPanel() {
  overlay.classList.remove('active');
  refPanel.classList.remove('active');
}

refClose.addEventListener('click', closeRefPanel);
overlay.addEventListener('click', closeRefPanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeRefPanel();
});

btnWormhole.addEventListener('click', () => {
  if (!portalTargetUrl) return;
  closeRefPanel();
  wormholeCanvas.classList.add('active');
  wormholeProgress = 0;
  playWormhole();
});

function playWormhole() {
  if (wormholeAnim) cancelAnimationFrame(wormholeAnim);
  const W = wormholeCanvas.width;
  const H = wormholeCanvas.height;

  function step() {
    wormholeProgress += 0.012;
    if (wormholeProgress >= 1) {
      wormholeCanvas.classList.remove('active');
      whCtx.clearRect(0, 0, W, H);
      wormholeAnim = null;
      // Navigate to target world
      if (portalTargetUrl) {
        window.location.href = portalTargetUrl;
      }
      return;
    }

    whCtx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;

    // Wormhole radius
    let radius;
    if (wormholeProgress < 0.3) {
      radius = wormholeProgress / 0.3 * W * 0.4;
    } else if (wormholeProgress < 0.7) {
      radius = W * 0.4;
    } else {
      radius = (1 - wormholeProgress) / 0.3 * W * 0.4;
    }

    // Draw wormhole
    const gradient = whCtx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
    gradient.addColorStop(0, 'rgba(240,216,120,0.9)');
    gradient.addColorStop(0.3, 'rgba(201,160,80,0.6)');
    gradient.addColorStop(0.6, 'rgba(160,120,60,0.3)');
    gradient.addColorStop(0.85, 'rgba(8,8,16,0.1)');
    gradient.addColorStop(1, 'rgba(8,8,16,0)');
    whCtx.fillStyle = gradient;
    whCtx.fillRect(0, 0, W, H);

    // Spiral particles
    const numParticles = 60;
    const spinAngle = wormholeProgress * Math.PI * 8;
    for (let i = 0; i < numParticles; i++) {
      const angle = (i / numParticles) * Math.PI * 2 + spinAngle;
      const dist = (radius * 0.8) * (Math.sin(wormholeProgress * Math.PI) * 0.6 + 0.4);
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist * 0.3;
      const alpha = 1 - wormholeProgress;
      whCtx.beginPath();
      whCtx.arc(px, py, 1.5, 0, Math.PI * 2);
      whCtx.fillStyle = `rgba(240,216,120,${alpha})`;
      whCtx.fill();
    }

    wormholeAnim = requestAnimationFrame(step);
  }
  step();
}

// Resize wormhole canvas
window.addEventListener('resize', () => {
  wormholeCanvas.width = window.innerWidth;
  wormholeCanvas.height = window.innerHeight;
});
wormholeCanvas.width = window.innerWidth;
wormholeCanvas.height = window.innerHeight;
