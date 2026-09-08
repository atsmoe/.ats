// Index and query Han characters with the same boundaries. Proper names need
// contiguous matches, independently of the build and browser dictionaries.
export function segmentSearchText(text) {
  return text.replace(/\p{Script=Han}/gu, character => ` ${character} `).replace(/\s+/g, ' ').trim();
}

export function searchTerms(query) {
  return [...new Set(query.replace(/"/g, '').split(/\s+/).filter(Boolean))]
    .map(term => `"${segmentSearchText(term)}"`);
}

export function compactSearchExcerpt(html) {
  return html.replace(/([\p{Script=Han}，。！？；：、（）「」『』《》“”])((?:<\/?mark>)*)\s+(?=(?:<\/?mark>)*[\p{Script=Han}，。！？；：、（）「」『』《》“”])/gu, '$1$2');
}
