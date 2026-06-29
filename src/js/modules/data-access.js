/* ═══════════════════════════════════════════════════════════
   data-access.js — Query layer (UI uses this, never raw data)
   ═══════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} World
 * @property {string} id
 * @property {string} name
 * @property {string} [calendarSystem]
 * @property {string} [themeColor]
 * @property {string} [coverImage]
 */

/**
 * @typedef {Object} ImageData
 * @property {string} src
 * @property {string} alt
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} CrossRef
 * @property {string} worldId
 * @property {string} eventId
 * @property {string} [targetWorldName]
 */

/**
 * @typedef {Object} Event
 * @property {string} id
 * @property {string} title
 * @property {string} [dateDisplay]
 * @property {string} [dateRaw]
 * @property {string} [description]
 * @property {string} [location]
 * @property {string[]} [characters]
 * @property {string[]} [tags]
 * @property {string} [conditions]
 * @property {ImageData[]} [images]
 * @property {CrossRef[]} [crossRefs]
 * @property {boolean} [isKeyEvent]
 * @property {boolean} [isLargeEvent]
 * @property {boolean} [isConcurrent]
 * @property {boolean} [isDivergePoint]
 * @property {boolean} [isEnding]
 * @property {string} [divergeDescription]
 */

/**
 * @typedef {Object} Branch
 * @property {string} id
 * @property {string} name
 * @property {boolean} [isDefault]
 * @property {string} [description]
 * @property {import('./data-loader.js').Era[]} [eras]
 * @property {Branch[]} [subBranches]
 * @property {Event[]} [endings]
 * @property {Event[]} [events]
 */

import { loadWorldData, loadEventIndex } from './data-loader.js';

const ready = {};

/**
 * Ensure world data is loaded (lazy init — caches the promise).
 * @param {string} worldId
 * @returns {Promise<Object>}
 */
async function ensureWorld(worldId) {
  if (!ready[worldId]) {
    ready[worldId] = loadWorldData(worldId);
  }
  return ready[worldId];
}

/**
 * Get world metadata (id, name, calendarSystem, etc.).
 * @param {string} worldId
 * @returns {Promise<World>}
 */
export async function getWorldMeta(worldId) {
  const data = await ensureWorld(worldId);
  return data.world;
}

/**
 * Get all branches for a world (including sub-branches).
 * @param {string} worldId
 * @returns {Promise<Branch[]>}
 */
export async function getBranches(worldId) {
  const data = await ensureWorld(worldId);
  return data.branches;
}

/**
 * Get the flat event array for a specific branch.
 * @param {string} worldId
 * @param {string} branchId
 * @returns {Promise<Event[]>}
 */
export async function getBranchEvents(worldId, branchId) {
  const data = await ensureWorld(worldId);
  const branch = data.branches.find(b => b.id === branchId);
  return branch ? branch.events : [];
}

/**
 * Look up an event by its globally unique ID via event-index.
 * O(1) index lookup → O(1) array access.
 * @param {string} eventId
 * @returns {Promise<Event|null>}
 */
export async function findEventById(eventId) {
  const idx = await loadEventIndex();
  const loc = idx[eventId];
  if (!loc) return null;
  const data = await ensureWorld(loc.worldId);
  const branch = data.branches.find(b => b.id === loc.branchId);
  if (!branch) return null;
  return branch.events[loc.eventIndex] || null;
}