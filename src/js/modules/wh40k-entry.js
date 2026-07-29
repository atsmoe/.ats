import { BackgroundManager } from './background-manager.js';
import { initNav } from './nav.js';
import { ANIM } from './anim-tokens.js';
import { legacyWh40kDestination } from './wh40k-routing.js';

let interactionController = null;

function dismissPortalOverlay() {
  const overlay = document.getElementById('portal-arrival');
  if (!overlay) return;
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.transition = `opacity ${ANIM.duration.normal}ms ${ANIM.easing.out}`;
}

function replaceQuery(key, value) {
  const url = new URL(location.href);
  if (value) {
    url.searchParams.set(key, value);
    url.hash = value;
  } else {
    url.searchParams.delete(key);
    url.hash = '';
  }
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function listen(node, type, handler) {
  node.addEventListener(type, handler, { signal: interactionController.signal });
}

function initFactionIndex() {
  const cards = [...document.querySelectorAll('[data-faction-id]')];
  const filters = [...document.querySelectorAll('[data-faction-filter]')];

  function filter(group) {
    for (const card of cards) card.hidden = group !== 'all' && card.dataset.factionGroup !== group;
    for (const button of filters) {
      const active = button.dataset.factionFilter === group;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  for (const button of filters) listen(button, 'click', () => filter(button.dataset.factionFilter));
  for (const button of document.querySelectorAll('[data-faction-toggle]')) {
    listen(button, 'click', () => {
      const card = button.closest('[data-faction-id]');
      const detail = card?.querySelector('.wh-faction-detail');
      if (!card || !detail) return;
      const opening = detail.hidden;
      detail.hidden = !opening;
      card.classList.toggle('is-open', opening);
      button.setAttribute('aria-expanded', String(opening));
      replaceQuery('faction', opening ? card.dataset.factionId : '');
    });
  }

  const requested = new URLSearchParams(location.search).get('faction');
  const target = requested && document.querySelector(`[data-faction-id="${CSS.escape(requested)}"]`);
  target?.querySelector('[data-faction-toggle]')?.click();
  target?.scrollIntoView({ block: 'center' });
}

function initWarZones() {
  const cards = [...document.querySelectorAll('[data-zone-id]')];
  const points = [...document.querySelectorAll('.wh-zone-point')];

  function select(zoneId, scroll = true) {
    const target = cards.find(card => card.dataset.zoneId === zoneId);
    if (!target) return;
    for (const card of cards) {
      const active = card === target;
      card.classList.toggle('is-active', active);
      const source = card.querySelector('.wh-zone-source');
      if (source) source.hidden = !active;
      card.querySelector('.wh-zone-trigger')?.setAttribute('aria-expanded', String(active));
    }
    for (const point of points) point.classList.toggle('is-active', point.dataset.zoneTarget === zoneId);
    replaceQuery('zone', zoneId);
    if (scroll) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  for (const trigger of document.querySelectorAll('[data-zone-target]')) {
    listen(trigger, 'click', () => select(trigger.dataset.zoneTarget, !trigger.classList.contains('wh-zone-trigger')));
  }
  const requested = new URLSearchParams(location.search).get('zone');
  if (requested) select(requested, false);
}

async function connectCanonicalArchive(pageType) {
  if (pageType !== 'wh40k-factions' && pageType !== 'wh40k-war-zones') return;
  try {
    const [{ loadWorldData }, { createWh40kArchive }] = await Promise.all([
      import('./data-loader.js'),
      import('./wh40k-archive.js'),
    ]);
    const archive = createWh40kArchive(await loadWorldData('wh40k'));
    const isFactionPage = pageType === 'wh40k-factions';
    const snapshot = archive.explore({ lens: isFactionPage ? 'faction' : 'war-zones' });
    const entries = isFactionPage ? snapshot.factions : snapshot.warZones;
    const selector = isFactionPage ? '[data-faction-id]' : '[data-zone-id]';
    const key = isFactionPage ? 'factionId' : 'zoneId';
    const nodes = new Map(
      [...document.querySelectorAll(selector)].map(node => [node.dataset[key], node]),
    );

    if (nodes.size !== entries.length || entries.some(entry => !nodes.has(entry.id))) {
      throw new Error('Published catalog and canonical archive are out of sync');
    }
    for (const entry of entries) {
      nodes.get(entry.id).dataset.recordCount = String(entry.records.length);
    }
    document.body.dataset.archiveState = 'ready';
  } catch (_error) {
    document.body.dataset.archiveState = 'degraded';
  }
}

export function destroyWh40kEntry() {
  interactionController?.abort();
  interactionController = null;
}

export function initWh40kEntry() {
  destroyWh40kEntry();
  interactionController = new AbortController();
  const pageType = document.body.dataset.page;
  const legacyDestination = pageType === 'wh40k-home'
    ? legacyWh40kDestination(location.search, location.hash)
    : null;
  if (legacyDestination) {
    location.replace(`./${legacyDestination}`);
    return null;
  }

  BackgroundManager.init('bg-canvas', 'bg-video', 'bg-image');
  BackgroundManager.switchTo('wh40k');
  initNav();
  dismissPortalOverlay();

  if (pageType === 'wh40k-factions') initFactionIndex();
  if (pageType === 'wh40k-war-zones') initWarZones();
  return connectCanonicalArchive(pageType);
}
