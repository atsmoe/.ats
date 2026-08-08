import { createCosmicStage } from './b4-cosmic-stage.js';

const WORLDS = [
  {
    id: 'arknights',
    ip: '明日方舟',
    name: '泰拉',
    code: 'ARK–TERRA',
    latin: 'ORIGINIUM OBSERVATION',
    summary: '移动城邦为躲避天灾持续迁徙，源石支撑工业与技艺，也传播矿石病。',
    href: './arknights.html',
    accent: '#00c6e6',
    rgb: '0,198,230',
    secondary: '#dba34c',
    secondaryRgb: '219,163,76',
    ghost: 'TERRA',
    caption: 'ARKNIGHTS',
    state: 'ARCHIVE ONLINE',
  },
  {
    id: 'wh40k',
    ip: '战锤 40,000',
    name: '破碎银河',
    code: 'WH–M42',
    latin: 'VOID CHART / IMPERIUM NIHILUS',
    summary: '大裂隙横断银河，阻隔通讯与航行；帝国舰队仍在亚空间风暴间维持战区补给。',
    href: './wh40k.html',
    accent: '#a73730',
    rgb: '167,55,48',
    secondary: '#c6b287',
    secondaryRgb: '198,178,135',
    ghost: 'M42',
    caption: 'WARHAMMER 40,000',
    state: 'ARCHIVE ONLINE',
  },
  {
    id: 'ff14',
    ip: '最终幻想 XIV',
    name: '水晶星海',
    code: 'FF–AETHER',
    latin: 'THE CRYSTAL CALLS',
    summary: '原初世界与六个尚存镜像隔着位面并存；另七个镜像已在灵灾中回归原初世界。',
    href: './ff14.html',
    accent: '#8fc8f3',
    rgb: '143,200,243',
    secondary: '#d8c68b',
    secondaryRgb: '216,198,139',
    ghost: 'AETHER',
    caption: 'FINAL FANTASY XIV',
    state: 'ARCHIVE ONLINE',
  },
];

const root = document.getElementById('b4-root');
const stage = document.getElementById('b4-stage');
const canvas = document.getElementById('b4-space');
const loading = document.getElementById('b4-loading');
const progress = document.getElementById('route-progress');
const previousGate = document.getElementById('previous-gate');
const nextGate = document.getElementById('next-gate');
const directory = document.getElementById('world-directory');
const directoryGrid = document.getElementById('directory-grid');
const directoryButton = document.getElementById('open-directory');
const directoryClose = document.getElementById('directory-close');
const directoryBackdrop = document.getElementById('index-backdrop');
const readout = document.getElementById('world-readout');
const worldIndexNode = document.getElementById('world-index');
const worldTitleNode = document.getElementById('world-title');
const worldIpNode = document.getElementById('world-ip');
const worldSummaryNode = document.getElementById('world-summary');
const worldEntryNode = document.getElementById('world-entry');
const worldGhostNode = document.getElementById('world-ghost');
const routeCoordinate = document.getElementById('route-coordinate');
const routeState = document.getElementById('route-state');
const scanRouteButton = document.getElementById('scan-route');
const headerWorldCode = document.getElementById('header-world-code');
const plateCode = document.getElementById('plate-code');
const railNumber = document.getElementById('rail-number');
const railTotal = document.getElementById('rail-total');
const railScale = document.getElementById('rail-scale');
const railCaption = document.getElementById('rail-caption');
const compactMedia = matchMedia('(max-width: 760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const initialId = params.get('world');
const morphDuration = reducedMotion ? 220 : 1100;

let committedIndex = Math.max(0, WORLDS.findIndex((world) => world.id === initialId));
let requestedIndex = committedIndex;
let queuedIndex = null;
let queuedHistoryMode = 'replace';
let loadGeneration = 0;
let loadingIndex = null;
let loadingHistoryMode = 'none';
let morphActive = false;
let morphStartedAt = 0;
let morphProgress = 1;
let copySwapped = true;
let directoryOpen = false;
let wheelLockedUntil = 0;
let scanTimer = 0;
let deferredWorldTimer = 0;
let deferredWorldIndex = null;
let deferredHistoryMode = 'replace';
let pointerX = 0;
let pointerY = 0;
let targetPointerX = 0;
let targetPointerY = 0;
let pointerDown = false;
let pointerStartX = 0;
let pointerStartY = 0;
let pointerLastX = 0;
let pointerLastY = 0;
let dragged = false;
let visible = !document.hidden;
let destroyed = false;
let contextLost = false;
let runtimeMode = compactMedia.matches ? 'fallback' : 'initializing';
let rafId = 0;
let lastFrame = performance.now();
let lastTelemetryAt = 0;
let lastCoordinateText = '';
let suspendedAt = 0;

let cosmicStage = null;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapIndex(index) {
  return (index % WORLDS.length + WORLDS.length) % WORLDS.length;
}

function lerp(current, target, delta) {
  const amount = 1 - Math.pow(.002, delta);
  return current + (target - current) * amount;
}

function createStageRuntime() {
  return createCosmicStage({
    canvas,
    reducedMotion,
    pixelRatioCap: 1.3,
    quality: reducedMotion ? 'reduced' : 'desktop',
  });
}

function gateContent(index, relation) {
  const world = WORLDS[index];
  return `
    <b>${relation} / ${String(index + 1).padStart(2, '0')} · ${world.code}</b>
    <span>${world.name}</span>
    <small>${world.ip}</small>
  `;
}

function updateGates(focus = committedIndex) {
  const previousIndex = wrapIndex(focus - 1);
  const nextIndex = wrapIndex(focus + 1);
  previousGate.dataset.index = String(previousIndex);
  previousGate.style.setProperty('--gate-rgb', WORLDS[previousIndex].rgb);
  previousGate.innerHTML = gateContent(previousIndex, 'PREVIOUS SIGNAL');
  previousGate.setAttribute('aria-label', `前一世界：${WORLDS[previousIndex].name}`);
  nextGate.dataset.index = String(nextIndex);
  nextGate.style.setProperty('--gate-rgb', WORLDS[nextIndex].rgb);
  nextGate.innerHTML = gateContent(nextIndex, 'NEXT SIGNAL');
  nextGate.setAttribute('aria-label', `后一世界：${WORLDS[nextIndex].name}`);
}

function buildUi() {
  progress.style.setProperty('--world-count', String(WORLDS.length));
  progress.classList.toggle('is-dense', WORLDS.length > 6);
  directoryButton.textContent = `全部世界 ${WORLDS.length}`;
  railScale.replaceChildren();
  WORLDS.forEach((world, index) => {
    const scaleTick = document.createElement('i');
    const scalePosition = WORLDS.length <= 1 ? 0 : (index / (WORLDS.length - 1)) * 100;
    scaleTick.style.top = `${scalePosition}%`;
    railScale.appendChild(scaleTick);

    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'progress-node';
    node.dataset.index = String(index);
    node.style.setProperty('--node-rgb', world.rgb);
    node.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b><span>${world.code}</span>`;
    node.setAttribute('aria-label', `${String(index + 1).padStart(2, '0')} ${world.name}`);
    node.addEventListener('click', () => requestWorld(index, { historyMode: 'push' }));
    progress.appendChild(node);

    const item = document.createElement('article');
    item.className = 'directory-item';
    item.dataset.index = String(index);
    item.style.setProperty('--item-rgb', world.rgb);
    item.innerHTML = `
      <button class="directory-select" type="button" data-directory-select="${index}">
        <b>WORLD ${String(index + 1).padStart(2, '0')} / ${world.code}</b>
        <strong>${world.name}</strong>
        <span>${world.ip} · ${world.state}</span>
      </button>
      <a class="directory-enter" href="${world.href}">直接进入档案 ↗</a>
    `;
    item.querySelector('[data-directory-select]').addEventListener('click', () => {
      closeDirectory();
      requestWorld(index, { historyMode: 'push' });
    });
    directoryGrid.appendChild(item);
  });

  previousGate.addEventListener('click', () => {
    requestWorld(Number(previousGate.dataset.index), { historyMode: 'push' });
  });
  nextGate.addEventListener('click', () => {
    requestWorld(Number(nextGate.dataset.index), { historyMode: 'push' });
  });
  commitUi(committedIndex, { immediate: true });
}

function setTheme(index) {
  const world = WORLDS[index];
  document.body.dataset.world = world.id;
  document.documentElement.style.setProperty('--accent', world.accent);
  document.documentElement.style.setProperty('--accent-rgb', world.rgb);
  document.documentElement.style.setProperty('--secondary', world.secondary);
  document.documentElement.style.setProperty('--secondary-rgb', world.secondaryRgb);
}

function updateControlStates() {
  const focus = morphActive ? requestedIndex : committedIndex;
  [...progress.children].forEach((node, index) => {
    node.setAttribute('aria-current', index === focus ? 'true' : 'false');
  });
  [...directoryGrid.children].forEach((item, index) => {
    item.classList.toggle('is-current', index === focus);
  });
  previousGate.tabIndex = morphActive ? -1 : 0;
  nextGate.tabIndex = morphActive ? -1 : 0;
  previousGate.setAttribute('aria-hidden', morphActive ? 'true' : 'false');
  nextGate.setAttribute('aria-hidden', morphActive ? 'true' : 'false');
}

function commitUi(index, { immediate = false } = {}) {
  const world = WORLDS[index];
  worldIndexNode.textContent = `WORLD ${String(index + 1).padStart(2, '0')} / ${WORLDS.length} · ${world.code}`;
  worldTitleNode.textContent = world.name;
  worldIpNode.textContent = `${world.ip} / ${world.latin}`;
  worldSummaryNode.textContent = world.summary;
  worldEntryNode.href = world.href;
  worldGhostNode.textContent = world.ghost;
  headerWorldCode.textContent = `ATS / ${world.code}`;
  plateCode.textContent = `CELESTIAL OBSERVATORY / ${String(index + 1).padStart(2, '0')}`;
  railNumber.textContent = String(index + 1).padStart(2, '0');
  railTotal.innerHTML = `/ ${String(WORLDS.length).padStart(2, '0')}<br>OBSERVATION`;
  railCaption.innerHTML = `${world.caption}<br>WORLD ARCHIVE`;
  const scaleProgress = WORLDS.length <= 1 ? 0 : (index / (WORLDS.length - 1)) * 100;
  railScale.style.setProperty('--scale-progress', `${scaleProgress}%`);
  setTheme(index);
  updateGates(index);
  updateControlStates();
  if (immediate) readout.classList.remove('is-changing');
}

function updateUrl(index, mode = 'replace') {
  if (mode === 'none') return;
  const url = new URL(location.href);
  url.searchParams.set('world', WORLDS[index].id);
  const state = { world: WORLDS[index].id };
  if (mode === 'push') history.pushState(state, '', url);
  else history.replaceState(state, '', url);
}

function cancelDeferredWorld() {
  window.clearTimeout(deferredWorldTimer);
  deferredWorldTimer = 0;
  deferredWorldIndex = null;
  deferredHistoryMode = 'replace';
}

function scheduleDeferredWorld(index, historyMode) {
  cancelDeferredWorld();
  deferredWorldIndex = index;
  deferredHistoryMode = historyMode;
  deferredWorldTimer = window.setTimeout(() => {
    deferredWorldTimer = 0;
    deferredWorldIndex = null;
    deferredHistoryMode = 'replace';
    requestWorld(index, { historyMode });
  }, reducedMotion ? 0 : 70);
}

function commitStaticWorld(index, historyMode = 'replace') {
  const next = wrapIndex(index);
  loadGeneration += 1;
  loadingIndex = null;
  loadingHistoryMode = 'none';
  requestedIndex = next;
  committedIndex = next;
  queuedIndex = null;
  queuedHistoryMode = 'replace';
  morphActive = false;
  morphProgress = 1;
  copySwapped = true;
  root.classList.remove('is-travelling');
  readout.classList.remove('is-changing');
  commitUi(next, { immediate: true });
  updateUrl(next, historyMode);
  syncRouteState();
  writeRouteCoordinate(`ATS / ROUTE-${String(next + 1).padStart(2, '0')} / DEPTH 0.00`);
}

async function requestWorld(index, { historyMode = 'replace' } = {}) {
  cancelDeferredWorld();
  const next = wrapIndex(index);
  if (destroyed || runtimeMode === 'destroyed') return;

  if (runtimeMode === 'fallback') {
    if (next !== committedIndex) commitStaticWorld(next, historyMode);
    return;
  }

  if (runtimeMode === 'initializing') {
    queuedIndex = next === committedIndex ? null : next;
    queuedHistoryMode = historyMode;
    syncRouteState();
    return;
  }

  if (loadingIndex !== null) {
    if (next === committedIndex) {
      loadGeneration += 1;
      loadingIndex = null;
      loadingHistoryMode = 'none';
      queuedIndex = null;
      syncRouteState();
      return;
    }
    if (next === loadingIndex) {
      loadingHistoryMode = historyMode;
      return;
    }
  }

  if (next === committedIndex && !morphActive) return;
  if (morphActive) {
    queuedIndex = next === requestedIndex ? null : next;
    queuedHistoryMode = historyMode;
    syncRouteState();
    updateControlStates();
    return;
  }

  const generation = ++loadGeneration;
  loadingIndex = next;
  loadingHistoryMode = historyMode;
  syncRouteState();
  const stageRuntime = cosmicStage;
  if (!stageRuntime) {
    enterFallbackMode();
    return;
  }
  try {
    await stageRuntime.prepare(WORLDS[next]);
    if (destroyed || runtimeMode !== 'webgl' || generation !== loadGeneration || stageRuntime !== cosmicStage) return;
    await stageRuntime.beginTransition(WORLDS[next], {
      direction: wrapIndex(next - committedIndex) <= WORLDS.length / 2 ? 1 : -1,
      duration: morphDuration,
    });
  } catch (error) {
    if (destroyed || generation !== loadGeneration) return;
    loadingIndex = null;
    loadingHistoryMode = 'none';
    console.error('[B4 prototype] Cosmic scene failed to prepare.', error);
    routeState.textContent = 'SIGNAL UNAVAILABLE / CURRENT WORLD HELD';
    return;
  }
  if (destroyed || runtimeMode !== 'webgl' || generation !== loadGeneration || stageRuntime !== cosmicStage) return;

  const resolvedHistoryMode = loadingHistoryMode;
  loadingIndex = null;
  loadingHistoryMode = 'none';
  requestedIndex = next;
  queuedIndex = null;
  queuedHistoryMode = 'replace';
  morphActive = true;
  morphStartedAt = performance.now();
  morphProgress = 0;
  copySwapped = false;
  const forwardDistance = wrapIndex(next - committedIndex);
  const direction = forwardDistance <= WORLDS.length / 2 ? 1 : -1;
  root.dataset.direction = direction > 0 ? 'forward' : 'backward';
  root.classList.add('is-travelling');
  readout.classList.add('is-changing');
  syncRouteState();
  updateUrl(next, resolvedHistoryMode);
  updateControlStates();
}

function finishMorph() {
  cosmicStage?.setProgress(1);
  cosmicStage?.commit();
  committedIndex = requestedIndex;
  loadingIndex = null;
  morphActive = false;
  morphProgress = 1;
  root.classList.remove('is-travelling');
  readout.classList.remove('is-changing');
  writeRouteCoordinate(`ATS / ROUTE-${String(committedIndex + 1).padStart(2, '0')} / DEPTH 0.00`);
  updateGates(committedIndex);
  updateControlStates();

  const nextQueued = queuedIndex;
  const nextHistoryMode = queuedHistoryMode;
  queuedIndex = null;
  queuedHistoryMode = 'replace';
  if (nextQueued !== null && nextQueued !== committedIndex) {
    scheduleDeferredWorld(nextQueued, nextHistoryMode);
  }
  prefetchNeighbours();
  syncRouteState();
}

function updateMorph(now) {
  if (!morphActive) return;
  morphProgress = clamp((now - morphStartedAt) / morphDuration, 0, 1);
  cosmicStage?.setProgress(morphProgress);
  if (!copySwapped && morphProgress >= .46) {
    copySwapped = true;
    commitUi(requestedIndex);
  }
  if (copySwapped && morphProgress >= .76) readout.classList.remove('is-changing');
  if (morphProgress >= 1) finishMorph();
}

function cycleWorld(delta) {
  const base = morphActive
    ? (queuedIndex ?? requestedIndex)
    : (
      runtimeMode === 'initializing'
        ? (queuedIndex ?? deferredWorldIndex ?? committedIndex)
        : (deferredWorldIndex ?? loadingIndex ?? queuedIndex ?? committedIndex)
    );
  requestWorld(wrapIndex(base + delta), { historyMode: 'replace' });
}

function deriveRouteState() {
  if (directoryOpen) return 'COMPLETE DIRECTORY OPEN';
  if (document.body.classList.contains('scanning')) {
    return 'ACTIVE SCAN / CELESTIAL FIELD VERIFIED';
  }
  if (runtimeMode === 'initializing') {
    if (queuedIndex !== null) return `QUEUED / ${WORLDS[queuedIndex].code}`;
    return `ACQUIRING WORLD / ${WORLDS[loadingIndex ?? committedIndex].code}`;
  }
  if (loadingIndex !== null) return `ACQUIRING WORLD / ${WORLDS[loadingIndex].code}`;
  if (morphActive) {
    return queuedIndex === null
      ? `TRAVERSING / ${WORLDS[requestedIndex].code}`
      : `QUEUED / ${WORLDS[queuedIndex].code}`;
  }
  if (deferredWorldIndex !== null) return `QUEUED / ${WORLDS[deferredWorldIndex].code}`;
  return 'FREE DISCOVERY ENABLED';
}

function syncRouteState() {
  routeState.textContent = deriveRouteState();
}

function openDirectory() {
  directoryOpen = true;
  document.body.classList.add('directory-open');
  directory.setAttribute('aria-hidden', 'false');
  directoryClose.focus();
  routeState.textContent = 'COMPLETE DIRECTORY OPEN';
}

function closeDirectory() {
  if (!directoryOpen) return;
  directoryOpen = false;
  document.body.classList.remove('directory-open');
  directory.setAttribute('aria-hidden', 'true');
  directoryButton.focus();
  syncRouteState();
}

function scanRoute() {
  window.clearTimeout(scanTimer);
  cosmicStage?.pulseScan(1);
  document.body.classList.add('scanning');
  routeState.textContent = 'ACTIVE SCAN / CELESTIAL FIELD VERIFIED';
  scanTimer = window.setTimeout(() => {
    scanTimer = 0;
    document.body.classList.remove('scanning');
    syncRouteState();
  }, 1600);
}

function resize() {
  if (!cosmicStage) return;
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  const pixelRatio = Math.min(devicePixelRatio || 1, compactMedia.matches ? 1 : 1.3);
  cosmicStage.resize(width, height, pixelRatio);
}

function writeRouteCoordinate(value) {
  if (value === lastCoordinateText) return;
  lastCoordinateText = value;
  routeCoordinate.textContent = value;
}

function animate(now) {
  if (destroyed || runtimeMode !== 'webgl' || contextLost || !visible) {
    rafId = 0;
    return;
  }
  const delta = Math.min(.05, (now - lastFrame) / 1000);
  lastFrame = now;
  updateMorph(now);

  pointerX = lerp(pointerX, targetPointerX, delta);
  pointerY = lerp(pointerY, targetPointerY, delta);
  cosmicStage?.frame({
    now,
    delta,
    pointerX,
    pointerY: -pointerY,
  });
  if (!morphActive || now - lastTelemetryAt >= 80) {
    lastTelemetryAt = now;
    writeRouteCoordinate(`ATS / ROUTE-${String(committedIndex + 1).padStart(2, '0')} / DEPTH ${(morphActive ? morphProgress * 100 : 0).toFixed(2)}`);
  }
  rafId = requestAnimationFrame(animate);
}

function onPointerMove(event) {
  const rect = stage.getBoundingClientRect();
  targetPointerX = clamp((event.clientX - rect.left) / Math.max(rect.width, 1) - .5, -.5, .5);
  targetPointerY = clamp((event.clientY - rect.top) / Math.max(rect.height, 1) - .5, -.5, .5);
  if (pointerDown) {
    const deltaX = event.clientX - pointerLastX;
    const deltaY = event.clientY - pointerLastY;
    pointerLastX = event.clientX;
    pointerLastY = event.clientY;
    cosmicStage?.dragBy(deltaX, deltaY);
    if (Math.abs(event.clientX - pointerStartX) > 5 || Math.abs(event.clientY - pointerStartY) > 5) {
      dragged = true;
    }
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - canvasRect.left) / Math.max(canvasRect.width, 1)) * 2 - 1;
  const ndcY = -(((event.clientY - canvasRect.top) / Math.max(canvasRect.height, 1)) * 2 - 1);
  canvas.classList.toggle('is-targeting', Boolean(cosmicStage?.pick(ndcX, ndcY)));
}

function onPointerDown(event) {
  if (compactMedia.matches) return;
  pointerDown = true;
  dragged = false;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  pointerLastX = event.clientX;
  pointerLastY = event.clientY;
  canvas.classList.add('is-dragging');
  canvas.setPointerCapture?.(event.pointerId);
}

function onPointerUp(event) {
  if (!pointerDown) return;
  pointerDown = false;
  canvas.classList.remove('is-dragging');
  canvas.releasePointerCapture?.(event.pointerId);
  if (dragged) return;
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
  const hit = cosmicStage?.pick(ndcX, ndcY);
  if (hit) cosmicStage?.focus(hit.anchorId);
}

function onWheel(event) {
  if (directoryOpen || compactMedia.matches || event.target.closest('.world-directory')) return;
  if (!root.contains(event.target) || Math.abs(event.deltaY) < 12) return;
  event.preventDefault();
  const now = performance.now();
  if (now < wheelLockedUntil) return;
  wheelLockedUntil = now + 180;
  cosmicStage?.zoomBy(event.deltaY);
}

function onKeydown(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  if (event.key === '/' && !directoryOpen) {
    event.preventDefault();
    openDirectory();
  } else if (event.key === 'Escape' && directoryOpen) {
    event.preventDefault();
    closeDirectory();
  } else if (!directoryOpen && event.key === 'ArrowRight') {
    event.preventDefault();
    cycleWorld(1);
  } else if (!directoryOpen && event.key === 'ArrowLeft') {
    event.preventDefault();
    cycleWorld(-1);
  } else if (!directoryOpen && event.key === 'ArrowDown') {
    event.preventDefault();
    cosmicStage?.zoomBy(1);
  } else if (!directoryOpen && event.key === 'ArrowUp') {
    event.preventDefault();
    cosmicStage?.zoomBy(-1);
  } else if (!directoryOpen && event.key === 'Escape') {
    event.preventDefault();
    cosmicStage?.resetFocus();
  } else if (!directoryOpen && event.key === 'Home') {
    event.preventDefault();
    requestWorld(0, { historyMode: 'replace' });
  } else if (!directoryOpen && event.key === 'End') {
    event.preventDefault();
    requestWorld(WORLDS.length - 1, { historyMode: 'replace' });
  }
}

function onPopState() {
  const url = new URL(location.href);
  const index = WORLDS.findIndex((world) => world.id === url.searchParams.get('world'));
  requestWorld(index >= 0 ? index : 0, { historyMode: 'none' });
}

function pauseAnimationClock() {
  if (!suspendedAt) suspendedAt = performance.now();
}

function resumeAnimationClock() {
  if (!suspendedAt) return;
  if (morphActive) {
    const now = performance.now();
    morphStartedAt += now - Math.max(suspendedAt, morphStartedAt);
  }
  suspendedAt = 0;
}

function onVisibilityChange() {
  visible = !document.hidden;
  if (!visible) {
    pauseAnimationClock();
    cosmicStage?.suspend(true);
    cancelAnimationFrame(rafId);
    rafId = 0;
  } else {
    resumeAnimationClock();
    cosmicStage?.suspend(false);
    if (!rafId && runtimeMode === 'webgl' && cosmicStage && !contextLost) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(animate);
    }
  }
}

function enterFallbackMode() {
  const wasMorphing = morphActive;
  const acquiringIndex = loadingIndex;
  const pendingDeferredIndex = deferredWorldIndex;
  const desiredIndex = queuedIndex
    ?? pendingDeferredIndex
    ?? acquiringIndex
    ?? (wasMorphing ? requestedIndex : committedIndex);
  const desiredHistoryMode = queuedIndex !== null
    ? queuedHistoryMode
    : (
      pendingDeferredIndex !== null
        ? deferredHistoryMode
        : (
          acquiringIndex !== null
            ? loadingHistoryMode
            : (wasMorphing ? 'none' : 'replace')
        )
    );

  cancelDeferredWorld();
  runtimeMode = 'fallback';
  loadGeneration += 1;
  loadingIndex = null;
  loadingHistoryMode = 'none';
  cancelAnimationFrame(rafId);
  rafId = 0;
  cosmicStage?.suspend(true);
  root.classList.add('is-fallback');
  loading.hidden = true;

  if (desiredIndex !== committedIndex || wasMorphing) {
    commitStaticWorld(desiredIndex, desiredHistoryMode);
  } else {
    morphActive = false;
    queuedIndex = null;
    queuedHistoryMode = 'replace';
    root.classList.remove('is-travelling');
    readout.classList.remove('is-changing');
    syncRouteState();
    updateControlStates();
  }
}

async function startWebglRuntime() {
  if (destroyed || compactMedia.matches || contextLost) return;

  runtimeMode = 'initializing';
  const baseIndex = committedIndex;
  const generation = ++loadGeneration;
  loadingIndex = baseIndex;
  loadingHistoryMode = 'none';
  syncRouteState();

  try {
    if (!cosmicStage) cosmicStage = createStageRuntime();
    const stageRuntime = cosmicStage;
    await stageRuntime.prepare(WORLDS[baseIndex]);
    if (
      destroyed
      || compactMedia.matches
      || contextLost
      || generation !== loadGeneration
      || stageRuntime !== cosmicStage
    ) return;
    await stageRuntime.mountInitial(WORLDS[baseIndex]);
    if (
      destroyed
      || compactMedia.matches
      || contextLost
      || generation !== loadGeneration
      || stageRuntime !== cosmicStage
    ) return;

    loadingIndex = null;
    loadingHistoryMode = 'none';
    requestedIndex = baseIndex;
    morphActive = false;
    runtimeMode = 'webgl';
    stageRuntime.suspend(!visible);
    root.classList.remove('is-fallback', 'is-travelling');
    readout.classList.remove('is-changing');
    loading.hidden = true;
    writeRouteCoordinate(`ATS / ROUTE-${String(baseIndex + 1).padStart(2, '0')} / DEPTH 0.00`);
    resize();

    if (visible && !rafId) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(animate);
    }
    prefetchNeighbours();

    const nextQueued = queuedIndex;
    const nextHistoryMode = queuedHistoryMode;
    queuedIndex = null;
    queuedHistoryMode = 'replace';
    if (nextQueued !== null && nextQueued !== committedIndex) {
      scheduleDeferredWorld(nextQueued, nextHistoryMode);
    }
    syncRouteState();
  } catch (error) {
    if (destroyed || generation !== loadGeneration) return;
    loadingIndex = null;
    loadingHistoryMode = 'none';
    console.error('[B4 prototype] Scene initialization failed.', error);
    enterFallbackMode();
  }
}

function onContextLost(event) {
  event.preventDefault();
  contextLost = true;
  enterFallbackMode();
}

function onContextRestored() {
  contextLost = false;
  const staleStage = cosmicStage;
  cosmicStage = null;
  staleStage?.destroy();
  if (!compactMedia.matches) window.setTimeout(startWebglRuntime, 0);
}

function onCompactChange(event) {
  if (event.matches) {
    enterFallbackMode();
    cosmicStage?.destroy();
    cosmicStage = null;
  } else if (!contextLost) startWebglRuntime();
}

function onPageHide(event) {
  visible = false;
  pauseAnimationClock();
  cosmicStage?.suspend(true);
  cancelAnimationFrame(rafId);
  rafId = 0;
  if (!event.persisted) destroy();
}

function onPageShow(event) {
  if (!event.persisted || destroyed) return;
  visible = !document.hidden;
  if (visible) {
    resumeAnimationClock();
    cosmicStage?.suspend(false);
  }
  if (runtimeMode === 'webgl' && visible && !contextLost && !rafId) {
    resize();
    lastFrame = performance.now();
    rafId = requestAnimationFrame(animate);
  }
}

function bindInteractions() {
  directoryButton.addEventListener('click', openDirectory);
  directoryClose.addEventListener('click', closeDirectory);
  directoryBackdrop.addEventListener('click', closeDirectory);
  scanRouteButton.addEventListener('click', scanRoute);
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  addEventListener('wheel', onWheel, { passive: false });
  addEventListener('keydown', onKeydown);
  addEventListener('resize', resize, { passive: true });
  addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', onVisibilityChange);
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);
  compactMedia.addEventListener('change', onCompactChange);
  addEventListener('pagehide', onPageHide);
  addEventListener('pageshow', onPageShow);
}

function destroy() {
  if (destroyed) return;
  destroyed = true;
  runtimeMode = 'destroyed';
  loadGeneration += 1;
  loadingIndex = null;
  loadingHistoryMode = 'none';
  cancelDeferredWorld();
  window.clearTimeout(scanTimer);
  scanTimer = 0;
  cancelAnimationFrame(rafId);
  rafId = 0;
  removeEventListener('wheel', onWheel);
  removeEventListener('keydown', onKeydown);
  removeEventListener('resize', resize);
  removeEventListener('popstate', onPopState);
  removeEventListener('pagehide', onPageHide);
  removeEventListener('pageshow', onPageShow);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  compactMedia.removeEventListener('change', onCompactChange);
  canvas.removeEventListener('webglcontextlost', onContextLost);
  canvas.removeEventListener('webglcontextrestored', onContextRestored);
  canvas.removeEventListener('pointermove', onPointerMove);
  canvas.removeEventListener('pointerdown', onPointerDown);
  canvas.removeEventListener('pointerup', onPointerUp);
  canvas.removeEventListener('pointercancel', onPointerUp);
  cosmicStage?.destroy();
  cosmicStage = null;
}

function prefetchNeighbours() {
  const order = [
    wrapIndex(committedIndex + 1),
    wrapIndex(committedIndex - 1),
  ];
  const preload = () => {
    if (destroyed || runtimeMode === 'destroyed') return;
    const next = order.shift();
    if (next === undefined) return;
    cosmicStage?.prepare(WORLDS[next]).catch(() => {});
    window.setTimeout(preload, 120);
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(preload, { timeout: 900 });
  } else {
    window.setTimeout(preload, 180);
  }
}

async function init() {
  buildUi();
  bindInteractions();
  updateUrl(committedIndex, 'replace');
  writeRouteCoordinate(`ATS / ROUTE-${String(committedIndex + 1).padStart(2, '0')} / DEPTH 0.00`);
  if (compactMedia.matches) {
    runtimeMode = 'fallback';
    root.classList.add('is-fallback');
    loading.hidden = true;
    return;
  }
  startWebglRuntime();
}

init();
