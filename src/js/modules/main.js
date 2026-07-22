/* ═══════════════════════════════════════════════════════════
   main.js — Entry point, dispatched by data-page attribute
   ═══════════════════════════════════════════════════════════ */

import { BackgroundManager } from './background-manager.js';
import { initNav } from './nav.js';
import { ANIM } from './anim-tokens.js';

/**
 * Render a themed error card when world data fails to load.
 * UI layer only — does not touch Data or Engine layers.
 * @param {string} worldId
 * @param {Function} onRetry - callback when user clicks "重新连接"
 */
function showErrorState(worldId, onRetry) {
  const container = document.getElementById('tl-container');
  if (!container) return;

  // Hide normal timeline UI
  const branchTabs = document.getElementById('branch-tabs');
  if (branchTabs) branchTabs.style.display = 'none';

  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.minHeight = '60vh';

  const card = document.createElement('div');
  card.className = 'error-card';
  card.innerHTML = `
    <div class="error-icon">✦</div>
    <h3 class="error-title">星图信号中断</h3>
    <p class="error-desc">无法连接到 ${worldId} 的编年史数据<br>请检查网络连接后重试</p>
    <button class="error-retry-btn">重新连接</button>
  `;

  card.querySelector('.error-retry-btn').addEventListener('click', onRetry);
  container.appendChild(card);
}

function dismissPortalOverlay() {
  const el = document.getElementById('portal-arrival');
  if (el) {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.transition = `opacity ${ANIM.duration.normal}ms ease`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('%c 群星之间 · 世界档案 %c MULTI-PAGE ',
    'color:#c9a050;font-size:20px;font-family:serif;',
    'color:#9a9078;font-size:11px;');

  const pageType = document.body.dataset.page;

  if (pageType === 'world') {
    const worldId = document.body.dataset.world;
    console.log('%c 加载世界: ' + worldId, 'color:#d4923a;');

    // Init background engine for world pages (Canvas 2D)
    BackgroundManager.init('bg-canvas', 'bg-video', 'bg-image');

    const { loadWorldData } = await import('./data-loader.js');
    const { createWorldArchive } = await import('./world-archive.js');
    const { projectChronicleTimeline } = await import('./timeline-adapter.js');
    const {
      populateBranchTabs,
      renderEvents,
      updateTimelineCover,
      setData: setTimelineData,
      initEventModal,
      showEventDetails,
    } = await import('./timeline-ui.js');
    const { setData: setPortalData, initPortalArrival } = await import('./portal-transition.js');

    const { WORLDS } = await import('./worlds.js');
    const world = WORLDS[worldId];
    if (world) {
      BackgroundManager.switchTo(world.bgPreset);
    }

    initNav();

    try {
      const loadedData = await loadWorldData(worldId);
      const archive = createWorldArchive(loadedData);
      const chronicleSnapshot = archive.explore({ lens: 'chronicle' });
      const timelineData = projectChronicleTimeline(chronicleSnapshot);
      setTimelineData(timelineData);
      setPortalData(timelineData);
      populateBranchTabs();
      renderEvents('mainline');
      updateTimelineCover(worldId);

      if (worldId === 'arknights') {
        const { initArknightsArchive } = await import('./arknights-archive.js');
        initArknightsArchive({ archive, onOpenRecord: showEventDetails });
      }
    } catch (err) {
      console.error('Failed to load world data:', err);
      if (worldId === 'arknights') {
        try {
          const { initArknightsArchive } = await import('./arknights-archive.js');
          initArknightsArchive();
        } catch (_archiveError) {
          document.body.classList.remove('ark-spoiler-locked');
        }
      }
      dismissPortalOverlay();
      showErrorState(worldId, () => {
        // Retry: reload the page (simplest full reset)
        window.location.reload();
      });
    }

    initPortalArrival();
    initEventModal();

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
