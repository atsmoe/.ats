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

function initTerraMapDialog() {
  const dialog = document.getElementById('terra-map-dialog');
  const openButton = document.querySelector('[data-terra-map-open]');
  const closeButton = dialog?.querySelector('[data-terra-map-close]');
  const zoomButton = dialog?.querySelector('[data-terra-map-zoom]');
  const viewport = dialog?.querySelector('.terra-map-viewport');
  if (!dialog || !openButton || !closeButton || !zoomButton || !viewport) return;

  const clamp = value => Math.min(1, Math.max(0, value));

  function setZoomed(zoomed, focus = { x: 0.5, y: 0.5 }) {
    viewport.classList.toggle('is-zoomed', zoomed);
    zoomButton.setAttribute('aria-pressed', String(zoomed));
    zoomButton.textContent = zoomed ? '还原 1×' : '放大 2×';

    requestAnimationFrame(() => {
      if (!zoomed) {
        viewport.scrollTo({ left: 0, top: 0 });
        return;
      }

      viewport.scrollTo({
        left: clamp(focus.x) * viewport.scrollWidth - viewport.clientWidth / 2,
        top: clamp(focus.y) * viewport.scrollHeight - viewport.clientHeight / 2,
      });
    });
  }

  function toggleZoom(focus) {
    setZoomed(!viewport.classList.contains('is-zoomed'), focus);
  }

  openButton.addEventListener('click', () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
  });
  closeButton.addEventListener('click', () => dialog.close());
  zoomButton.addEventListener('click', () => toggleZoom());
  viewport.addEventListener('dblclick', event => {
    const bounds = viewport.getBoundingClientRect();
    toggleZoom({
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    });
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => setZoomed(false));
}

export async function initArknightsEntry() {
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

  if (pageType === 'arknights-home') initTerraMapDialog();

  if (pageType === 'arknights-chronicle') {
    const { initArknightsChronicle } = await import('./arknights-chronicle-reader.js');
    return initArknightsChronicle();
  }

  if (pageType === 'arknights-is-index' || pageType === 'arknights-is-topic') {
    return initArchivePage(pageType);
  }
  return null;
}
