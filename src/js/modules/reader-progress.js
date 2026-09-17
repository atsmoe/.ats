// Reading positions are optional; unavailable or damaged storage must never
// prevent a canonical record from opening.
export function createReaderProgressStore(storage, key) {
  function readAll(strict = false) {
    try {
      const value = JSON.parse(storage?.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_error) {
      if (strict) throw _error;
      return {};
    }
  }

  function valid(progress) {
    return progress && typeof progress === 'object' && !Array.isArray(progress)
      && typeof progress.eventId === 'string' && progress.eventId.length > 0;
  }

  return {
    entries() {
      return Object.entries(readAll()).filter(([, progress]) => valid(progress));
    },
    read(contextId) {
      const state = readAll();
      return Object.hasOwn(state, contextId) && valid(state[contextId]) ? state[contextId] : null;
    },
    write(contextId, progress) {
      if (!storage || !contextId || !valid(progress)) return;
      try {
        storage.setItem(key, JSON.stringify({ ...readAll(), [contextId]: progress }));
      } catch (_error) { /* storage can be denied or full */ }
    },
    remove(contextId, expectedEventId) {
      if (!storage || typeof contextId !== 'string' || !contextId || typeof expectedEventId !== 'string' || !expectedEventId) return 'unavailable';
      try {
        const state = readAll(true);
        if (!Object.hasOwn(state, contextId)) return 'missing';
        // A stale home row must not clear a newly saved record in this branch.
        if (!valid(state[contextId]) || state[contextId].eventId !== expectedEventId) return 'changed';
        delete state[contextId];
        storage.setItem(key, JSON.stringify(state));
        return 'removed';
      } catch (_error) {
        return 'unavailable';
      }
    },
  };
}
