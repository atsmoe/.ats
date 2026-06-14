/* ═══════════════════════════════════════════════════════════
   data-loader.js — Unified fetch + cache
   ═══════════════════════════════════════════════════════════ */

const worldCache = new Map();
const indexCache = new Map();

function checkStatus(resp, label) {
  if (!resp.ok) {
    throw new Error(`[data-loader] Failed to load ${label}: ${resp.status} ${resp.statusText}`);
  }
  return resp;
}

export async function loadWorldData(worldId) {
  if (worldCache.has(worldId)) return worldCache.get(worldId);
  const resp = checkStatus(await fetch(`./data/${worldId}.json`), worldId);
  const data = await resp.json();
  worldCache.set(worldId, data);
  return data;
}

export async function loadEventIndex() {
  if (indexCache.has('__idx')) return indexCache.get('__idx');
  const resp = checkStatus(await fetch('./data/event-index.json'), 'event-index');
  const idx = await resp.json();
  indexCache.set('__idx', idx);
  return idx;
}

export async function getWorldMeta(worldId) {
  const data = await loadWorldData(worldId);
  return data.world;
}

export async function getBranches(worldId) {
  const data = await loadWorldData(worldId);
  return data.branches || [];
}

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

export async function findEventById(eventId) {
  const index = await loadEventIndex();
  const loc = index[eventId];
  if (!loc) return null;
  const data = await loadWorldData(loc.worldId);
  const events = await getBranchEvents(loc.worldId, loc.branchId);
  return events[loc.eventIndex] || null;
}

/** Parse date string to sortable numeric value */
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

/** Format era title with brackets */
export function eraLabel(era) {
  const raw = era || '';
  if (raw.startsWith('【')) return raw;
  const clean = raw.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  return '【' + clean + '】';
}