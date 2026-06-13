/* ═══════════════════════════════════════════════════════════
   data-access.js — Query layer (UI uses this, never raw data)
   ═══════════════════════════════════════════════════════════ */

import { loadWorldData, loadEventIndex } from './data-loader.js';

const ready = {};

async function ensureWorld(worldId) {
  if (!ready[worldId]) {
    ready[worldId] = loadWorldData(worldId);
  }
  return ready[worldId];
}

export async function getWorldMeta(worldId) {
  const data = await ensureWorld(worldId);
  return data.world;
}

export async function getBranches(worldId) {
  const data = await ensureWorld(worldId);
  return data.branches;
}

export async function getBranchEvents(worldId, branchId) {
  const data = await ensureWorld(worldId);
  const branch = data.branches.find(b => b.id === branchId);
  return branch ? branch.events : [];
}

export async function findEventById(eventId) {
  const idx = await loadEventIndex();
  const loc = idx[eventId];
  if (!loc) return null;
  const data = await ensureWorld(loc.worldId);
  const branch = data.branches.find(b => b.id === loc.branchId);
  if (!branch) return null;
  return branch.events[loc.eventIndex] || null;
}