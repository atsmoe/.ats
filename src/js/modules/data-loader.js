/* ═══════════════════════════════════════════════════════════
   data-loader.js — Unified fetch + cache
   ═══════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} Era
 * @property {string} title
 * @property {import('./data-access.js').Event[]} events
 */

const worldCache = new Map();
const indexCache = new Map();

/**
 * Error thrown when world data or index cannot be loaded after retries.
 * Carries the worldId so UI can render a contextual error card.
 */
export class DataLoadError extends Error {
  constructor(message, worldId) {
    super(message);
    this.name = 'DataLoadError';
    this.worldId = worldId;
  }
}

function checkStatus(resp, label) {
  if (!resp.ok) {
    throw new Error(`[data-loader] Failed to load ${label}: ${resp.status} ${resp.statusText}`);
  }
  return resp;
}

/**
 * Fetch with 1 automatic retry (1s delay) on network failure.
 * Keeps Data layer pure — only throws, never touches DOM.
 * @param {string} url
 * @param {string} label - human-readable label for error messages
 * @param {number} [retries=1]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, label, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url);
      return checkStatus(resp, label);
    } catch (err) {
      if (attempt < retries) {
        console.warn(`[data-loader] Retrying ${label} (attempt ${attempt + 1}/${retries})…`);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw new DataLoadError(
          `[data-loader] Failed to load ${label} after ${retries + 1} attempts: ${err.message}`,
          label
        );
      }
    }
  }
}

/**
 * Cache-busting query parameter derived from <body data-version>.
 * Read once at module init — never touches DOM again (Data layer constraint).
 */
const _version = (typeof document !== 'undefined'
  && document.body
  && document.body.dataset.version) || '';
const _v = _version ? `?v=${_version}` : '';

/**
 * Load world data JSON, cached in memory after first fetch.
 * @param {string} worldId
 * @returns {Promise<Object>}
 */
/**
 * Rebuild flat events array from eras for O(1) eventIndex access.
 * The JSON only stores eras (events nested) to avoid doubling payload.
 * @param {Object} branch
 */
function rebuildBranchEvents(branch) {
  const events = [];
  for (const era of (branch.eras || [])) {
    for (const evt of (era.events || [])) {
      events.push(evt);
    }
  }
  // Preserve endings from sub-branches (not in eras)
  if (branch.subBranches) {
    for (const sub of branch.subBranches) {
      rebuildBranchEvents(sub);
      if (sub.endings) {
        for (const e of sub.endings) events.push(e);
      }
    }
  }
  branch.events = events;
}

export async function loadWorldData(worldId) {
  if (worldCache.has(worldId)) return worldCache.get(worldId);
  const resp = await fetchWithRetry(`./data/${worldId}.json${_v}`, worldId);
  const data = await resp.json();
  // Rebuild flat events arrays from eras (removed from JSON to save ~50% payload)
  for (const branch of (data.branches || [])) {
    rebuildBranchEvents(branch);
  }
  worldCache.set(worldId, data);
  return data;
}

/**
 * Load the global event index (eventId → {worldId, branchId, eventIndex}).
 * @returns {Promise<Object<string, {worldId: string, branchId: string, eventIndex: number}>>}
 */
export async function loadEventIndex() {
  if (indexCache.has('__idx')) return indexCache.get('__idx');
  const resp = await fetchWithRetry(`./data/event-index.json${_v}`, 'event-index');
  const idx = await resp.json();
  indexCache.set('__idx', idx);
  return idx;
}

/**
 * @param {string} worldId
 * @returns {Promise<import('./data-access.js').World>}
 */
export async function getWorldMeta(worldId) {
  const data = await loadWorldData(worldId);
  return data.world;
}

/**
 * @param {string} worldId
 * @returns {Promise<import('./data-access.js').Branch[]>}
 */
export async function getBranches(worldId) {
  const data = await loadWorldData(worldId);
  return data.branches || [];
}

/**
 * @param {string} worldId
 * @param {string} branchId
 * @returns {Promise<import('./data-access.js').Event[]>}
 */
export async function getBranchEvents(worldId, branchId) {
  const data = await loadWorldData(worldId);
  for (const branch of (data.branches || [])) {
    if (branch.id === branchId) return branch.events || [];
    if (branch.subBranches) {
      const sub = branch.subBranches.find(sb => sb.id === branchId);
      if (sub) return sub.events || [];
    }
  }
  return [];
}

/**
 * @param {string} eventId
 * @returns {Promise<import('./data-access.js').Event|null>}
 */
export async function findEventById(eventId) {
  const index = await loadEventIndex();
  const loc = index[eventId];
  if (!loc) return null;
  const data = await loadWorldData(loc.worldId);
  const events = await getBranchEvents(loc.worldId, loc.branchId);
  return events[loc.eventIndex] || null;
}

/**
 * Parse date string to sortable numeric value.
 * Handles diverse formats: "1096.12.23", "约纪元前12200", "-35", "???-1096", "~+200".
 * Pure function — no side effects.
 * @param {string} dateRaw
 * @returns {number}
 */
export function dateSortVal(dateRaw) {
  const d = String(dateRaw || '');
  // Recursive unknown prefix
  if (d.startsWith('???')) {
    const rest = d.replace('???-', '');
    return dateSortVal(rest);
  }
  // Far future
  if (d.startsWith('~+')) return 100000 + parseInt(d.replace('~+', ''), 10);
  // Pre-civilization (no specific year)
  if (d === '纪元前' || d.startsWith('TT ')) return -99999;
  // BC / negative years: "-35", "-9000"
  if (d.startsWith('-')) return parseInt(d, 10) || 0;
  // "纪元前" with digits: "约纪元前12200"
  if (d.includes('纪元前')) {
    const num = parseInt(d.replace(/[^0-9]/g, ''), 10) || 0;
    if (d.startsWith('约')) return -(num + 10000);
    return -num;
  }
  // Approximate
  if (d.startsWith('约')) {
    const num = parseInt(d.replace(/[^0-9]/g, ''), 10) || 0;
    return num - 0.1;
  }
  // Dot-separated: "1096.12.23"
  const dotParts = d.split('.');
  if (dotParts.length >= 2) {
    const year = parseInt(dotParts[0], 10) || 0;
    const month = parseInt(dotParts[1], 10) || 0;
    return year + month / 100;
  }
  // Plain year: "1096"
  return parseInt(d, 10) || 0;
}

/**
 * Format an era title with 【】 brackets if not already present.
 * Pure function — no side effects.
 * @param {string} era
 * @returns {string}
 */
export function eraLabel(era) {
  const raw = era || '';
  if (raw.startsWith('【')) return raw;
  const clean = raw.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  return '【' + clean + '】';
}