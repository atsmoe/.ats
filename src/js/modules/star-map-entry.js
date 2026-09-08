/* ═══════════════════════════════════════════════════════════
   star-map-entry.js — Star map page entry point
   Keeps Three.js out of the world-page bundle.
   ═══════════════════════════════════════════════════════════ */

import { init as initStarMap3D, destroy as destroyStarMap3D } from './star-map-3d.js';
import { initStarMap, destroyStarMap } from './star-map.js';
import { initNav } from './nav.js';
import { ANIM } from './anim-tokens.js';

function dismissPortalOverlay() {
  const el = document.getElementById('portal-arrival');
  if (!el) return;

  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  el.style.transition = `opacity ${ANIM.duration.normal}ms ${ANIM.easing.out}`;
}

function init() {
  dismissPortalOverlay();
  initNav();
  try {
    initStarMap3D('bg-canvas');
    initStarMap();
  } catch (error) {
    document.body.classList.add('star-map-fallback');
    destroyStarMap();
    destroyStarMap3D();
    console.warn('[star-map] Showing world links after scene initialization failed.', error);
  }
}

// The bundle is loaded with `defer`, so the DOM is ready when it executes.
init();
