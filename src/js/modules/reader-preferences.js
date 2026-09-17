export const READER_DEFAULTS = Object.freeze({ size: 'normal', leading: 'normal', width: 'comfortable', spoilers: 'full' });
export const READER_PREFERENCE_KEY = 'ats.reader.preferences.v1';
const OPTIONS = { size: ['normal', 'large', 'larger'], leading: ['normal', 'relaxed'], width: ['comfortable', 'wide'], spoilers: ['full', 'titles'] };

export function normalizePreferences(value) {
  return Object.fromEntries(Object.entries(READER_DEFAULTS).map(([key, fallback]) => [key,
    OPTIONS[key].includes(value?.[key]) ? value[key] : fallback,
  ]));
}

export function createReadingStore(storage, worldId) {
  const preferenceKey = READER_PREFERENCE_KEY;
  const bookmarkKey = `ats.${worldId}.reader.bookmarks.v1`;
  let available = Boolean(storage);
  function read(key) {
    let value;
    try { value = storage?.getItem(key); }
    catch { available = false; return null; }
    try { return JSON.parse(value || 'null'); } catch { return null; }
  }
  function write(key, value) {
    try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; }
    catch { available = false; return false; }
  }
  let preferences = normalizePreferences(read(preferenceKey));
  function reloadPreferences() {
    if (!available) return;
    const saved = read(preferenceKey);
    // Keep this document's temporary choices if storage access has failed.
    if (available) preferences = normalizePreferences(saved);
  }
  function normalizeBookmarks(saved) {
    return Array.isArray(saved) ? [...new Set(saved.filter(id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)))].slice(0, 30) : [];
  }
  let bookmarks = normalizeBookmarks(read(bookmarkKey));
  function reloadBookmarks() {
    if (!available) return;
    const saved = read(bookmarkKey);
    // Once saving fails, retain this document's in-memory edits.
    if (available) bookmarks = normalizeBookmarks(saved);
  }
  return {
    get available() { return available; },
    preferences: () => ({ ...preferences }),
    reloadPreferences,
    savePreferences(value) {
      reloadPreferences();
      preferences = normalizePreferences({ ...preferences, ...value });
      return write(preferenceKey, preferences);
    },
    bookmarks: () => [...bookmarks],
    reloadBookmarks,
    pruneBookmarks(isValid) {
      reloadBookmarks();
      const valid = bookmarks.filter(isValid);
      if (valid.length !== bookmarks.length) { bookmarks = valid; write(bookmarkKey, bookmarks); }
    },
    toggleBookmark(id) {
      if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) return false;
      reloadBookmarks();
      if (bookmarks.includes(id)) bookmarks = bookmarks.filter(item => item !== id);
      else {
        if (bookmarks.length >= 30) return false;
        bookmarks.push(id);
      }
      write(bookmarkKey, bookmarks);
      return true;
    },
  };
}
