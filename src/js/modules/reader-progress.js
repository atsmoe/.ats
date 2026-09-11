// Reading positions are optional; unavailable or damaged storage must never
// prevent a canonical record from opening.
export function createReaderProgressStore(storage, key) {
  function readAll() {
    try {
      const value = JSON.parse(storage?.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_error) {
      return {};
    }
  }

  function valid(progress) {
    return progress && typeof progress === 'object' && !Array.isArray(progress)
      && typeof progress.eventId === 'string' && progress.eventId.length > 0;
  }

  return {
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
  };
}
