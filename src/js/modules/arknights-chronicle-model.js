const DEFAULT_MIN_CHAPTER_SIZE = 18;
const DEFAULT_MAX_CHAPTER_SIZE = 30;
const MAX_CONCURRENT_GROUP_SIZE = 6;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function eventSources(event) {
  if (Array.isArray(event.sources) && event.sources.length > 0) return event.sources;
  return Array.isArray(event.prtsSources) ? event.prtsSources : [];
}

function sourceKeys(event) {
  return eventSources(event)
    .map(source => clean(source?.title || source?.text || source?.name))
    .filter(Boolean);
}

function metadataKeys(event) {
  return new Set([
    ...(event.characters || []).map(name => `person:${clean(name)}`),
    ...(event.tags || []).map(tag => `tag:${clean(tag)}`),
    clean(event.location) ? `place:${clean(event.location)}` : '',
    ...sourceKeys(event).map(source => `source:${source}`),
  ].filter(Boolean));
}

function hasSharedMetadata(left, right) {
  const leftKeys = metadataKeys(left);
  return [...metadataKeys(right)].some(key => leftKeys.has(key));
}

export function isMajorArknightsEvent(event = {}) {
  return Boolean(
    event.isLargeEvent
    || event.isKeyEvent
    || event.isDivergePoint
    || (event.images && event.images.length > 0)
    || (event.crossRefs && event.crossRefs.length > 0)
  );
}

export function arknightsDateBucket(event = {}) {
  const raw = clean(event.dateRaw);
  if (raw) return raw.replace(/\s+/g, '').toLowerCase();
  return clean(event.dateDisplay).replace(/\s+/g, '').toLowerCase() || 'date-unknown';
}

function boundaryScore(events, index) {
  const previous = events[index - 1];
  const next = events[index];
  let score = 0;
  if (isMajorArknightsEvent(next)) score += 6;
  if (arknightsDateBucket(previous) !== arknightsDateBucket(next)) score += 3;
  if (!hasSharedMetadata(previous, next)) score += 2;
  return score;
}

function partitionEra(events, minSize, maxSize) {
  const partitions = [];
  let start = 0;
  while (start < events.length) {
    const remaining = events.length - start;
    if (remaining <= maxSize) {
      partitions.push(events.slice(start));
      break;
    }

    const earliest = start + minSize;
    const latest = Math.min(start + maxSize, events.length - minSize);
    let boundary = earliest;
    let bestScore = -1;
    for (let index = earliest; index <= latest; index += 1) {
      const score = boundaryScore(events, index);
      if (score > bestScore) {
        boundary = index;
        bestScore = score;
      }
    }
    partitions.push(events.slice(start, boundary));
    start = boundary;
  }
  return partitions;
}

function chapterTitle(eraTitle, records, chapterIndex, chapterCount) {
  if (chapterCount === 1) return eraTitle;
  const start = clean(records[0]?.dateDisplay) || '时间待确认';
  const end = clean(records[records.length - 1]?.dateDisplay) || start;
  const range = start === end ? start : `${start}—${end}`;
  return `${eraTitle} · ${chapterIndex + 1} / ${chapterCount} · ${range}`;
}

function representativeEvent(records) {
  return records.find(isMajorArknightsEvent) || records[0] || null;
}

function chapterIntro(records) {
  const first = clean(records[0]?.dateDisplay) || '时间待确认';
  const last = clean(records[records.length - 1]?.dateDisplay) || first;
  const people = [];
  const seen = new Set();
  for (const record of records) {
    for (const name of record.characters || []) {
      const value = clean(name);
      if (value && !seen.has(value)) {
        seen.add(value);
        people.push(value);
      }
      if (people.length === 3) break;
    }
    if (people.length === 3) break;
  }
  const range = first === last ? first : `${first}至${last}`;
  const focus = people.length > 0 ? `，涉及${people.join('、')}` : '';
  return `${range}的${records.length}条档案${focus}。`;
}

function canCollapseRecord(record) {
  return !isMajorArknightsEvent(record)
    && clean(record.description).length <= 160
    && !(record.location)
    && !(record.tags && record.tags.length > 0);
}

export function groupArknightsChapterRecords(records = []) {
  const entries = [];
  let index = 0;
  while (index < records.length) {
    const first = records[index];
    if (!canCollapseRecord(first)) {
      entries.push({ type: 'event', records: [first] });
      index += 1;
      continue;
    }

    const bucket = arknightsDateBucket(first);
    const group = [first];
    let cursor = index + 1;
    while (
      cursor < records.length
      && group.length < MAX_CONCURRENT_GROUP_SIZE
      && canCollapseRecord(records[cursor])
      && arknightsDateBucket(records[cursor]) === bucket
    ) {
      group.push(records[cursor]);
      cursor += 1;
    }

    if (group.length >= 2) {
      entries.push({
        type: 'concurrent',
        dateDisplay: clean(first.dateDisplay) || '时间待确认',
        records: group,
      });
      index = cursor;
    } else {
      entries.push({ type: 'event', records: [first] });
      index += 1;
    }
  }
  return entries;
}

export function buildArknightsChapters(eras = [], options = {}) {
  const minSize = options.minChapterSize || DEFAULT_MIN_CHAPTER_SIZE;
  const maxSize = options.maxChapterSize || DEFAULT_MAX_CHAPTER_SIZE;
  const chapters = [];
  const recordsById = new Map();

  eras.forEach((era, eraIndex) => {
    const records = Array.isArray(era.events) ? era.events.filter(Boolean) : [];
    const partitions = partitionEra(records, minSize, maxSize);
    partitions.forEach((partition, chapterIndex) => {
      const id = `ark-chapter-${eraIndex + 1}-${chapterIndex + 1}`;
      const chapter = {
        id,
        eraTitle: clean(era.title) || `时代 ${eraIndex + 1}`,
        title: chapterTitle(clean(era.title) || `时代 ${eraIndex + 1}`, partition, chapterIndex, partitions.length),
        intro: chapterIntro(partition),
        records: partition,
        entries: groupArknightsChapterRecords(partition),
        keyEventCount: partition.filter(isMajorArknightsEvent).length,
        representative: representativeEvent(partition),
      };
      const chapterPosition = chapters.length;
      partition.forEach((record, recordIndex) => {
        if (record.id) recordsById.set(record.id, { chapterPosition, recordIndex, record });
      });
      chapters.push(chapter);
    });
  });

  return { chapters, recordsById };
}

export function arknightsReaderTarget(hash = '') {
  let value = String(hash).replace(/^#/, '');
  try { value = decodeURIComponent(value); } catch (_error) { /* keep raw hash */ }
  if (/^evt-\d+$/.test(value)) return { type: 'event', id: value };
  if (/^ark-chapter-\d+-\d+$/.test(value)) return { type: 'chapter', id: value };
  return null;
}

export function arknightsReaderProgress(index, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round(((Math.max(0, Math.min(index, total - 1)) + 1) / total) * 100);
}
