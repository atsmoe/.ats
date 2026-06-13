/* ═══════════════════════════════════════════════════════════
   main.js — Entry point, dispatched by data-page attribute
   ═══════════════════════════════════════════════════════════ */

import { BackgroundManager } from './background-manager.js';
import { initNav } from './nav.js';
import { ANIM } from './anim-tokens.js';

function dismissPortalOverlay() {
  const el = document.getElementById('portal-arrival');
  if (el) {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.transition = `opacity ${ANIM.duration.normal}ms ease`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('%c 群星之间 · 编年史 %c MULTI-PAGE ',
    'color:#c9a050;font-size:20px;font-family:serif;',
    'color:#9a9078;font-size:11px;');

  const pageType = document.body.dataset.page;

  if (pageType === 'star-map') {
    dismissPortalOverlay();

    // Star map: Three.js 3D galaxy (bundled into bundle.js via esbuild)
    const { init: initStarMap3D } = await import('./star-map-3d.js');
    initStarMap3D('bg-canvas');

    const { initStarMap } = await import('./star-map.js');
    initStarMap();
    initNav();

  } else if (pageType === 'world') {
    const worldId = document.body.dataset.world;
    console.log('%c 加载世界: ' + worldId, 'color:#d4923a;');

    // Init background engine for world pages (Canvas 2D)
    BackgroundManager.init('bg-canvas', 'bg-video', 'bg-image');

    const { loadWorldData } = await import('./data-loader.js');
    const { populateBranchTabs, renderEvents, updateTimelineCover, setData: setTimelineData } = await import('./timeline-ui.js');
    const { setData: setPortalData, initPortalArrival } = await import('./portal-transition.js');

    const { WORLDS } = await import('./worlds.js');
    const world = WORLDS[worldId];
    if (world) {
      BackgroundManager.switchTo(world.bgPreset);
    }

    initNav();

    try {
      const data = await loadWorldData(worldId);
      setTimelineData(data);
      setPortalData(data);
      populateBranchTabs();
      renderEvents('mainline');
      updateTimelineCover(worldId);
    } catch (err) {
      console.error('Failed to load world data:', err);
      const coverH1 = document.querySelector('.tl-cover h1');
      const coverP = document.querySelector('.tl-cover p');
      if (coverH1) coverH1.textContent = '数据加载失败';
      if (coverP) coverP.textContent = '请确保 data/' + worldId + '.json 存在';
      dismissPortalOverlay();
    }

    initPortalArrival();

  } else if (pageType === 'about') {
    dismissPortalOverlay();

    BackgroundManager.init('bg-canvas', 'bg-video', 'bg-image');
    BackgroundManager.switchTo('star-map');
    initNav();
  }
});

document.addEventListener('click', (e) => {
  const link = e.target.closest('.cross-world-link');
  if (!link) return;

  const worldId = link.dataset.world;
  const eventId = link.dataset.target;
  if (!worldId) return;

  const targetUrl = './' + worldId + '.html' + (eventId ? '#' + eventId : '');

  import('./portal-transition.js').then(({ playPortalOutgoing }) => {
    playPortalOutgoing(e, targetUrl);
  });
});