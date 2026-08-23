import { initNav } from '../modules/nav.js';
import { ANIM } from '../modules/anim-tokens.js';

const WORLDS = [
  {
    id: 'arknights',
    index: '01',
    code: 'ARK–TERRA',
    accent: '#d9a441',
    rgb: '217, 164, 65',
    title: '泰拉',
    ip: '明日方舟 / ORIGINIUM OBSERVATION',
    summary: '天灾与源石共同改写文明的生存方式。移动城邦、国家与组织在这颗行星上留下彼此交叠的记录。',
    facts: [
      ['结构', '独立行星 / 近轨道观测'],
      ['档案', '主世界线 · 集成战略 · 泰拉图谱'],
    ],
    href: './arknights.html',
    instruction: '选择远距信号切换世界 · 方向键或数字键选择观测目标',
  },
  {
    id: 'wh40k',
    index: '02',
    code: 'WH–M42',
    accent: '#b9433e',
    rgb: '185, 67, 62',
    title: '破碎银河',
    ip: '战锤 40,000 / MILKY WAY · M42',
    summary: '大裂隙横断银河，帝国圣域与帝国暗面被风暴、战争和失联星区切开。档案沿纪元、势力与战区展开。',
    facts: [
      ['结构', '银河系 / 大裂隙之后'],
      ['档案', '银河纪元 · 九大势力 · 六大战区'],
    ],
    href: './wh40k.html',
    instruction: '选择远距信号切换世界 · 方向键或数字键选择观测目标',
  },
  {
    id: 'ff14',
    index: '03',
    code: 'FF–AETHER',
    accent: '#8fc8f3',
    rgb: '143, 200, 243',
    title: '十四世界',
    ip: '最终幻想 XIV / THE SOURCE · REFLECTIONS',
    summary: '原初世界与十三镜像同出一源。六个镜像仍保持分离，七次灵灾留下回归原初世界的以太轨迹。',
    facts: [
      ['结构', '原初世界 / 十三镜像'],
      ['档案', '世界编年 · 八段旅途 · 镜像记录'],
    ],
    href: './ff14.html',
    instruction: '选择远距信号切换世界 · 方向键或数字键选择观测目标',
  },
];

const WORLD_BY_ID = new Map(WORLDS.map((world) => [world.id, world]));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const controller = new AbortController();
const { signal } = controller;

const body = document.body;
const stage = document.getElementById('star-map-stage');
const loading = document.getElementById('star-map-loading');
const routeState = document.getElementById('star-map-route-state');
const readout = document.getElementById('star-map-readout');
const readoutIndex = document.getElementById('star-map-readout-index');
const readoutIp = document.getElementById('star-map-readout-ip');
const readoutTitle = document.getElementById('star-map-readout-title');
const readoutSummary = document.getElementById('star-map-readout-summary');
const readoutFacts = document.getElementById('star-map-readout-facts');
const enterLink = document.getElementById('star-map-enter');
const provenance = document.getElementById('star-map-provenance');
const instruction = document.getElementById('star-map-instruction');
const territoryToggle = document.getElementById('terra-territory-toggle');
const territoryStatus = document.getElementById('terra-territory-status');
const territoryLayer = document.getElementById('terra-territory-layer');
const signalButtons = [...document.querySelectorAll('[data-world-signal]')];
const sceneImages = [...document.querySelectorAll('[data-world-scene]')];

let activeWorld = WORLD_BY_ID.get(new URL(location.href).searchParams.get('world')) ?? WORLDS[0];
let readoutTimer = 0;
let travelTimer = 0;
let territoryLayerEnabled = false;
let territoryLayerAvailable = false;

function listen(target, type, handler, options = {}) {
  target?.addEventListener(type, handler, { ...options, signal });
}

function dismissPortalOverlay() {
  const overlay = document.getElementById('portal-arrival');
  if (!overlay) return;
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.transition = `opacity ${ANIM.duration.normal}ms ${ANIM.easing.out}`;
}

function configureMotionTokens() {
  const tokens = {
    '--motion-acquire': `${ANIM.observation.acquire}ms`,
    '--motion-territory-reveal': `${ANIM.observation.territoryReveal}ms`,
    '--motion-signal': `${ANIM.observation.signal}ms`,
    '--motion-reflection': `${ANIM.observation.reflection}ms`,
    '--motion-return': `${ANIM.observation.returnFlow}ms`,
    '--motion-return-flow': `${ANIM.observation.returnFlow}ms`,
    '--motion-glow': `${ANIM.observation.glow}ms`,
    '--motion-reticle': `${ANIM.observation.reticle}ms`,
    '--motion-rift': `${ANIM.observation.rift}ms`,
    '--motion-survey': `${ANIM.observation.survey}ms`,
    '--motion-ease': ANIM.easing.inOut,
    '--motion-out': ANIM.easing.out,
    '--motion-linear': ANIM.easing.linear,
  };
  Object.entries(tokens).forEach(([name, value]) => stage.style.setProperty(name, value));
}

function setTheme(world) {
  body.dataset.world = world.id;
  body.style.setProperty('--atlas-accent', world.accent);
  body.style.setProperty('--atlas-accent-rgb', world.rgb);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', world.accent);
}

function replaceFacts(facts) {
  const fragment = document.createDocumentFragment();
  facts.forEach(([term, description]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = description;
    row.append(dt, dd);
    fragment.append(row);
  });
  readoutFacts.replaceChildren(fragment);
}

function replaceInstruction(text) {
  const parts = text.split(' · ');
  instruction.replaceChildren(...parts.map((part) => {
    const span = document.createElement('span');
    span.textContent = part;
    return span;
  }));
}

function activeScene() {
  return sceneImages.find((scene) => scene.dataset.worldScene === activeWorld.id);
}

function syncLoadingState() {
  const scene = activeScene();
  const missing = !scene || scene.classList.contains('is-missing');
  const ready = Boolean(scene?.classList.contains('is-loaded'));
  body.classList.toggle('is-fallback', missing);
  loading.hidden = ready || missing;
}

function handleSceneError(event) {
  const scene = event.currentTarget;
  scene.classList.add('is-missing');
  scene.classList.remove('is-loaded');
  syncLoadingState();
}

function handleSceneLoad(event) {
  const scene = event.currentTarget;
  scene.classList.add('is-loaded');
  scene.classList.remove('is-missing');
  syncLoadingState();
}

function setTerritoryLayer(enabled) {
  territoryLayerEnabled = Boolean(enabled && territoryLayerAvailable);
  const visible = activeWorld.id === 'arknights' && territoryLayerEnabled;
  stage.classList.toggle('is-territory-visible', visible);
  territoryToggle?.setAttribute('aria-pressed', String(territoryLayerEnabled));
  if (territoryStatus) territoryStatus.textContent = territoryLayerEnabled ? 'ON' : 'OFF';
}

function handleTerritoryError() {
  territoryLayerAvailable = false;
  territoryLayer?.classList.add('is-missing');
  setTerritoryLayer(false);
  if (territoryToggle) {
    territoryToggle.disabled = true;
    territoryToggle.hidden = true;
  }
}

function handleTerritoryLoad() {
  territoryLayerAvailable = true;
  territoryLayer?.classList.remove('is-missing');
  if (territoryToggle) {
    territoryToggle.disabled = false;
    territoryToggle.hidden = activeWorld.id !== 'arknights';
  }
  setTerritoryLayer(territoryLayerEnabled);
}

function renderWorld(world, { immediate = false } = {}) {
  setTheme(world);
  sceneImages.forEach((scene) => {
    const current = scene.dataset.worldScene === world.id;
    scene.classList.toggle('is-active', current);
  });
  signalButtons.forEach((button) => {
    const current = button.dataset.worldSignal === world.id;
    button.classList.toggle('is-current', current);
    if (current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  provenance.hidden = world.id !== 'arknights';
  if (territoryToggle) {
    territoryToggle.hidden = world.id !== 'arknights' || !territoryLayerAvailable;
  }
  setTerritoryLayer(territoryLayerEnabled);

  window.clearTimeout(readoutTimer);
  readout.classList.add('is-changing');
  const apply = () => {
    readoutIndex.textContent = `WORLD ${world.index} / ${String(WORLDS.length).padStart(2, '0')} · ${world.code}`;
    readoutIp.textContent = world.ip;
    readoutTitle.textContent = world.title;
    readoutSummary.textContent = world.summary;
    replaceFacts(world.facts);
    replaceInstruction(world.instruction);
    enterLink.href = world.href;
    enterLink.setAttribute('aria-label', `进入${world.title}世界档案`);
    routeState.textContent = `ATS / ROUTE-${world.index} / ${world.code}`;
    readout.classList.remove('is-changing');
  };
  if (immediate || reducedMotion) apply();
  else readoutTimer = window.setTimeout(apply, ANIM.duration.fast);
  syncLoadingState();
}

function updateUrl(mode = 'replace') {
  const url = new URL(location.href);
  url.searchParams.set('world', activeWorld.id);
  history[mode === 'push' ? 'pushState' : 'replaceState']({ world: activeWorld.id }, '', url);
}

function selectWorld(worldId, { historyMode = 'push', immediate = false } = {}) {
  const world = WORLD_BY_ID.get(worldId);
  if (!world || (world.id === activeWorld.id && !immediate)) return;
  activeWorld = world;
  renderWorld(world, { immediate });
  updateUrl(historyMode);

  if (!immediate && !reducedMotion) {
    body.classList.add('is-travelling');
    routeState.textContent = `ACQUIRING / ${world.code}`;
    window.clearTimeout(travelTimer);
    travelTimer = window.setTimeout(
      () => body.classList.remove('is-travelling'),
      ANIM.observation.acquire,
    );
  }
}

function bindInteractions() {
  sceneImages.forEach((scene) => {
    listen(scene, 'load', handleSceneLoad);
    listen(scene, 'error', handleSceneError);
    if (scene.complete) {
      if (scene.naturalWidth > 0) handleSceneLoad({ currentTarget: scene });
      else handleSceneError({ currentTarget: scene });
    }
  });

  if (territoryLayer) {
    listen(territoryLayer, 'load', handleTerritoryLoad);
    listen(territoryLayer, 'error', handleTerritoryError);
    if (territoryLayer.complete) {
      if (territoryLayer.naturalWidth > 0) handleTerritoryLoad();
      else handleTerritoryError();
    }
  }

  listen(territoryToggle, 'click', () => {
    if (activeWorld.id !== 'arknights' || !territoryLayerAvailable) return;
    setTerritoryLayer(!territoryLayerEnabled);
  });

  signalButtons.forEach((button) => {
    listen(button, 'click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      selectWorld(button.dataset.worldSignal);
    });
  });

  listen(window, 'popstate', () => {
    const world = WORLD_BY_ID.get(new URL(location.href).searchParams.get('world')) ?? WORLDS[0];
    selectWorld(world.id, { historyMode: 'replace', immediate: true });
  });
  listen(window, 'keydown', (event) => {
    if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    const numericIndex = Number(event.key) - 1;
    if (numericIndex >= 0 && numericIndex < WORLDS.length) {
      selectWorld(WORLDS[numericIndex].id);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = WORLDS.findIndex((world) => world.id === activeWorld.id);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    selectWorld(WORLDS[(index + direction + WORLDS.length) % WORLDS.length].id);
  });
  listen(window, 'pagehide', handlePageHide);
}

function destroy() {
  controller.abort();
  window.clearTimeout(readoutTimer);
  window.clearTimeout(travelTimer);
}

function handlePageHide(event) {
  if (!event.persisted) destroy();
}

function initialize() {
  initNav();
  dismissPortalOverlay();
  configureMotionTokens();
  bindInteractions();
  renderWorld(activeWorld, { immediate: true });
  updateUrl('replace');
  body.classList.add('is-ready');
}

initialize();
