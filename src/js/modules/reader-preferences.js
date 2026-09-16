export const READER_DEFAULTS = Object.freeze({ size: 'normal', leading: 'normal', width: 'comfortable', spoilers: 'full' });
const OPTIONS = { size: ['normal', 'large', 'larger'], leading: ['normal', 'relaxed'], width: ['comfortable', 'wide'], spoilers: ['full', 'titles'] };

export function normalizePreferences(value) {
  return Object.fromEntries(Object.entries(READER_DEFAULTS).map(([key, fallback]) => [key,
    OPTIONS[key].includes(value?.[key]) ? value[key] : fallback,
  ]));
}

export function createReadingStore(storage, worldId) {
  const preferenceKey = 'ats.reader.preferences.v1';
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
  const saved = read(bookmarkKey);
  let bookmarks = Array.isArray(saved) ? [...new Set(saved.filter(id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)))].slice(0, 30) : [];
  return {
    get available() { return available; },
    preferences: () => ({ ...preferences }),
    savePreferences(value) { preferences = normalizePreferences(value); return write(preferenceKey, preferences); },
    bookmarks: () => [...bookmarks],
    pruneBookmarks(isValid) {
      const valid = bookmarks.filter(isValid);
      if (valid.length !== bookmarks.length) { bookmarks = valid; write(bookmarkKey, bookmarks); }
    },
    toggleBookmark(id) {
      if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) return false;
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
