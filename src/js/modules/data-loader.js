/* ═══════════════════════════════════════════════════════════
   data-loader.js — Load timeline data from JSON or inline
   ═══════════════════════════════════════════════════════════ */

export let timelineData = null;
export let currentWorldId = null;

/**
 * Load timeline data for a world.
 * Prefers inline window.__WORLD_DATA__ (production/build mode),
 * falls back to fetch (development mode).
 */
export async function loadTimelineData(worldId) {
  // Prefer inline data (production/build)
  if (window.__WORLD_DATA__ && window.__WORLD_DATA__.world && window.__WORLD_DATA__.world.id === worldId) {
    timelineData = window.__WORLD_DATA__;
    currentWorldId = worldId;
    return timelineData;
  }

  // Fallback to fetch (development)
  try {
    const resp = await fetch('./data/' + worldId + '.json');
    if (resp.ok) {
      timelineData = await resp.json();
      currentWorldId = worldId;
      return timelineData;
    }
  } catch (e) {
    console.warn('fetch failed for', worldId, e);
  }

  throw new Error('无法加载世界数据: ' + worldId);
}

/** Find an event by ID across all eras */
export function findEventById(id) {
  if (!timelineData) return null;
  // Check branch-level eras first, fall back to root-level eras
  const branchEras = timelineData.subEntities?.[0]?.timeline?.branches?.find(b => b.id === 'mainline')?.eras;
  const eras = (branchEras && branchEras.length > 0) ? branchEras : timelineData.eras;
  if (!eras) return null;
  for (const era of eras) {
    for (const evt of era.events) {
      if (evt.id === id) return evt;
    }
  }
  return null;
}

/** Parse date string to sortable numeric value */
export function dateSortVal(dateRaw) {
  const d = String(dateRaw || '');
  // Unknown prefix: '???-纪元前XXXX'
  if (d.startsWith('???')) {
    const rest = d.replace('???-', '');
    return dateSortVal(rest);
  }
  // Future: ~+XXXX
  if (d.startsWith('~+')) return 100000 + parseInt(d.replace('~+', ''), 10);
  // Before era: 约纪元前XXXX or 纪元前XXXX
  if (d.includes('纪元前')) {
    const num = parseInt(d.replace(/[^0-9]/g, ''), 10) || 0;
    if (d.startsWith('约')) return -(num + 10000); // "约" puts it earlier
    return -num;
  }
  // Approximate: 约XXXX
  if (d.startsWith('约')) {
    const num = parseInt(d.replace(/[^0-9]/g, ''), 10) || 0;
    return num - 0.1;
  }
  // Dot-separated: XXXX.XX.XX
  const dotParts = d.split('.');
  if (dotParts.length >= 2) {
    const year = parseInt(dotParts[0], 10) || 0;
    const month = parseInt(dotParts[1], 10) || 0;
    return year + month / 100;
  }
  // Plain year number
  return parseInt(d, 10) || 0;
}

/** Format era title with brackets */
export function eraLabel(era) {
  const raw = era || '';
  if (raw.startsWith('【')) return raw;
  // Remove parenthetical annotation for label
  const clean = raw.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  return '【' + clean + '】';
}
