function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeHttpUrl(value) {
  const url = cleanText(value);
  if (!url) return '';

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

export function normalizeEventSources(event = {}) {
  const genericSources = Array.isArray(event.sources) ? event.sources : [];
  const legacySources = Array.isArray(event.prtsSources) ? event.prtsSources : [];
  const sourceList = genericSources.length > 0 ? genericSources : legacySources;

  return sourceList.flatMap(source => {
    if (!source || typeof source !== 'object') return [];

    const title = cleanText(source.title);
    const suppliedText = cleanText(source.text || source.name);
    const label = cleanText(source.label || source.kind || (suppliedText ? title : ''));
    const text = suppliedText || title;
    if (!label && !text) return [];

    return [{
      label,
      text,
      url: safeHttpUrl(source.url),
    }];
  });
}
