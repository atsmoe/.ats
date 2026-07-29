import { BackgroundManager } from './background-manager.js';
import { initNav } from './nav.js';
import { ANIM } from './anim-tokens.js';
import { legacyArknightsDestination } from './arknights-routing.js';

function dismissPortalOverlay() {
  const overlay = document.getElementById('portal-arrival');
  if (!overlay) return;
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.transition = `opacity ${ANIM.duration.normal}ms ${ANIM.easing.out}`;
}

async function initArchivePage(pageType) {
  const { loadWorldData } = await import('./data-loader.js');
  const { createWorldArchive } = await import('./world-archive.js');
  const {
    initIntegratedStrategyIndex,
    initIntegratedStrategyTopic,
    renderIntegratedStrategyError,
  } = await import('./arknights-integrated-strategies.js');

  try {
    const archive = createWorldArchive(await loadWorldData('arknights'));
    if (pageType === 'arknights-is-index') {
      initIntegratedStrategyIndex({ archive });
    } else {
      initIntegratedStrategyTopic({
        archive,
        contextId: document.body.dataset.context,
      });
    }
  } catch (error) {
    renderIntegratedStrategyError();
    document.body.classList.remove('ark-spoiler-locked');
  }
}

export function initArknightsEntry() {
  const pageType = document.body.dataset.page;
  const legacyDestination = pageType === 'arknights-home'
    ? legacyArknightsDestination(location.search, location.hash)
    : null;
  if (legacyDestination) {
    location.replace(`./${legacyDestination}`);
    return null;
  }

  BackgroundManager.init('bg-canvas', 'bg-video', 'bg-image');
  BackgroundManager.switchTo('arknights');
  initNav();
  dismissPortalOverlay();

  if (pageType === 'arknights-is-index' || pageType === 'arknights-is-topic') {
    return initArchivePage(pageType);
  }
  return null;
}
