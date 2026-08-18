import { createWorldAtlasStage } from './world-atlas-stage.js';
import { initNav } from './nav.js';
import { ANIM } from './anim-tokens.js';

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
    instruction: '拖动旋转泰拉 · 滚轮调整观测距离 · 点击远距信号切换世界',
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
    instruction: '拖动查看银河盘 · 滚轮调整观测距离 · 点击远距信号切换世界',
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
    instruction: '拖动查看十四世界 · 滚轮调整观测距离 · 点击远距信号切换世界',
  },
];

const WORLD_BY_ID = new Map(WORLDS.map((world) => [world.id, world]));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const controller = new AbortController();
const { signal } = controller;

const body = document.body;
const canvas = document.getElementById('bg-canvas');
const stageShell = document.getElementById('star-map-stage');
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
const signalButtons = [...document.querySelectorAll('[data-world-signal]')];

let stage = null;
let activeWorld = WORLD_BY_ID.get(new URL(location.href).searchParams.get('world')) ?? WORLDS[0];
let frameId = 0;
let previousFrame = performance.now();
let travelTimer = 0;
let readoutTimer = 0;
let pointerDown = false;
let pointerMoved = false;
let pointerStart = { x: 0, y: 0 };
let pointerLast = { x: 0, y: 0 };

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

function renderWorld(world, { immediate = false } = {}) {
  setTheme(world);
  signalButtons.forEach((button) => {
    const current = button.dataset.worldSignal === world.id;
    button.classList.toggle('is-current', current);
    button.setAttribute('aria-current', current ? 'true' : 'false');
  });
  provenance.hidden = world.id !== 'arknights';

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
  else readoutTimer = window.setTimeout(apply, 150);
}

function updateUrl(mode = 'replace') {
  const url = new URL(location.href);
  url.searchParams.set('world', activeWorld.id);
  history[mode === 'push' ? 'pushState' : 'replaceState']({ world: activeWorld.id }, '', url);
}

function selectWorld(worldId, { historyMode = 'push', immediate = false } = {}) {
  const world = WORLD_BY_ID.get(worldId);
  if (!world) return;
  if (world.id === activeWorld.id && !immediate) return;
  activeWorld = world;
  stage?.focusWorld(world.id, { immediate });
  requestFrame();
  renderWorld(world, { immediate });
  updateUrl(historyMode);

  if (!immediate && !reducedMotion) {
    body.classList.add('is-travelling');
    routeState.textContent = `TRAVELLING / ${world.code}`;
    window.clearTimeout(travelTimer);
    travelTimer = window.setTimeout(() => body.classList.remove('is-travelling'), 1420);
  }
}

function resolveSignalCollision(layout, first, second, height) {
  if (!first || !second) return;
  if (Math.hypot(first.x - second.x, first.y - second.y) >= 150) return;
  if (first.y <= second.y) {
    first.y = Math.max(88, first.y - 72);
    second.y = Math.min(height - 125, second.y + 72);
  } else {
    second.y = Math.max(88, second.y - 72);
    first.y = Math.min(height - 125, first.y + 72);
  }
  layout.set(first.id, first);
  layout.set(second.id, second);
}

function updateSignalPositions() {
  if (!stage) return;
  const positions = stage.screenPositions();
  const shell = stageShell.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const layout = new Map();
  const marginX = window.innerWidth < 760 ? 36 : 78;
  const marginTop = window.innerWidth < 760 ? 62 : 86;
  const marginBottom = window.innerWidth < 760 ? 330 : 130;

  signalButtons.forEach((button) => {
    const worldId = button.dataset.worldSignal;
    const position = positions[worldId];
    if (!position) return;
    const rawX = position.x + canvasRect.left - shell.left;
    const rawY = position.y + canvasRect.top - shell.top;
    const entry = {
      id: worldId,
      x: clamp(rawX, marginX, shell.width - marginX),
      y: clamp(rawY, marginTop, shell.height - marginBottom),
      rawX,
      rawY,
      depth: position.depth,
    };
    layout.set(worldId, entry);
  });

  const remote = WORLDS.filter((world) => world.id !== activeWorld.id).map((world) => layout.get(world.id));
  resolveSignalCollision(layout, remote[0], remote[1], shell.height);

  signalButtons.forEach((button) => {
    const entry = layout.get(button.dataset.worldSignal);
    if (!entry) return;
    button.style.setProperty('--x', `${entry.x}px`);
    button.style.setProperty('--y', `${entry.y}px`);
    button.style.setProperty('--depth', String(entry.depth));
    button.classList.toggle('is-edge-left', entry.rawX <= marginX + 1);
    button.classList.toggle('is-edge-right', entry.rawX >= shell.width - marginX - 1);
  });
}

function resize() {
  stage?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  requestFrame();
}

function frame(now) {
  frameId = 0;
  const delta = Math.min(.05, Math.max(0, (now - previousFrame) / 1000));
  previousFrame = now;
  stage?.frame({ delta, now });
  updateSignalPositions();
  if (!reducedMotion) requestFrame();
}

function requestFrame() {
  if (!stage || frameId) return;
  previousFrame = performance.now();
  frameId = requestAnimationFrame(frame);
}

function normalizedPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    y: -(((event.clientY - bounds.top) / bounds.height) * 2 - 1),
  };
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  pointerDown = true;
  pointerMoved = false;
  pointerStart = { x: event.clientX, y: event.clientY };
  pointerLast = { ...pointerStart };
  canvas.setPointerCapture?.(event.pointerId);
  canvas.classList.add('is-dragging');
}

function onPointerMove(event) {
  if (!pointerDown) return;
  const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  if (distance > 5) pointerMoved = true;
  stage?.dragBy(event.clientX - pointerLast.x, event.clientY - pointerLast.y);
  requestFrame();
  pointerLast = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event) {
  if (!pointerDown) return;
  pointerDown = false;
  canvas.releasePointerCapture?.(event.pointerId);
  canvas.classList.remove('is-dragging');
  if (pointerMoved) return;
  const point = normalizedPointer(event);
  const pickedWorld = stage?.pick(point.x, point.y);
  if (pickedWorld && pickedWorld !== activeWorld.id) selectWorld(pickedWorld);
}

function bindInteractions() {
  signalButtons.forEach((button) => {
    listen(button, 'click', (event) => {
      event.preventDefault();
      selectWorld(button.dataset.worldSignal);
    });
  });
  listen(canvas, 'pointerdown', onPointerDown);
  listen(canvas, 'pointermove', onPointerMove);
  listen(canvas, 'pointerup', onPointerUp);
  listen(canvas, 'pointercancel', onPointerUp);
  listen(canvas, 'wheel', (event) => {
    event.preventDefault();
    stage?.zoomBy(event.deltaY);
    requestFrame();
  }, { passive: false });
  listen(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    stage?.suspend(true);
    enterFallback(new Error('WebGL context lost'));
  });
  listen(window, 'resize', resize);
  listen(window, 'popstate', () => {
    const world = WORLD_BY_ID.get(new URL(location.href).searchParams.get('world')) ?? WORLDS[0];
    selectWorld(world.id, { historyMode: 'replace', immediate: true });
  });
  listen(window, 'keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    const index = WORLDS.findIndex((world) => world.id === activeWorld.id);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    selectWorld(WORLDS[(index + direction + WORLDS.length) % WORLDS.length].id);
  });
  listen(document, 'visibilitychange', () => {
    stage?.suspend(document.hidden);
    if (!document.hidden) requestFrame();
  });
  listen(window, 'pagehide', destroy, { once: true });
}

function enterFallback(error) {
  console.error('[spatial atlas] WebGL stage unavailable.', error);
  cancelAnimationFrame(frameId);
  frameId = 0;
  body.classList.add('is-fallback');
  loading.hidden = true;
}

function destroy() {
  controller.abort();
  cancelAnimationFrame(frameId);
  window.clearTimeout(travelTimer);
  window.clearTimeout(readoutTimer);
  stage?.destroy();
}

async function initialize() {
  initNav();
  dismissPortalOverlay();
  renderWorld(activeWorld, { immediate: true });
  updateUrl('replace');
  bindInteractions();

  try {
    stage = createWorldAtlasStage({ canvas, initialWorld: activeWorld.id, reducedMotion });
    canvas.classList.add('interactive');
    resize();
    requestFrame();
    await stage.ready;
    loading.hidden = true;
  } catch (error) {
    enterFallback(error);
  }
}

initialize();
