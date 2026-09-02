'use strict';

const FILE_NAMESPACE = /^(?:File|文件)\s*:\s*(.+)$/iu;
const DISPLAY_OPTION = /^(?:thumb(?:nail)?|left|right|center|none|frame(?:less)?|border)$/iu;
const SIZE_OPTION = /^\d*(?:x\d+)?px$/iu;
const KEYED_OPTION = /^(?:alt|link|class|lang|page|start|end|thumbtime|upright)\s*=/iu;

function splitTopLevelPipes(value) {
  const parts = [];
  let start = 0;
  let linkDepth = 0;
  let templateDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const pair = value.slice(index, index + 2);
    if (pair === '[[') {
      linkDepth += 1;
      index += 1;
    } else if (pair === ']]' && linkDepth > 0) {
      linkDepth -= 1;
      index += 1;
    } else if (pair === '{{') {
      templateDepth += 1;
      index += 1;
    } else if (pair === '}}' && templateDepth > 0) {
      templateDepth -= 1;
      index += 1;
    } else if (value[index] === '|' && linkDepth === 0 && templateDepth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

function isDisplayOption(value) {
  const option = value.trim();
  return DISPLAY_OPTION.test(option) || SIZE_OPTION.test(option) || KEYED_OPTION.test(option);
}

function parseFileParts(parts, rawTag, position) {
  const namespaceMatch = parts[0].trim().match(FILE_NAMESPACE);
  if (!namespaceMatch) return null;

  const fileTitle = namespaceMatch[1].trim();
  if (!fileTitle) return null;

  const captions = parts.slice(1)
    .map((part) => part.trim())
    .filter((part) => part && !isDisplayOption(part));

  return {
    position,
    fileTitle,
    caption: captions.at(-1) || null,
    rawTag,
  };
}

function mergeRanges(ranges) {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];

  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }

  return merged;
}

function isInsideRanges(position, ranges) {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (position < range.start) {
      high = middle - 1;
    } else if (position >= range.end) {
      low = middle + 1;
    } else {
      return true;
    }
  }

  return false;
}

function findLiteralRanges(wikitext) {
  const ranges = [];
  const pattern = /<!--[\s\S]*?(?:-->|$)|<(nowiki|pre|source|syntaxhighlight|code)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
  let match;

  while ((match = pattern.exec(wikitext)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return mergeRanges(ranges);
}

function findTemplateRanges(wikitext, literalRanges) {
  const ranges = [];
  let depth = 0;
  let start = -1;
  let literalIndex = 0;

  for (let index = 0; index < wikitext.length - 1; index += 1) {
    while (literalIndex < literalRanges.length && index >= literalRanges[literalIndex].end) {
      literalIndex += 1;
    }
    const literalRange = literalRanges[literalIndex];
    if (literalRange && index >= literalRange.start) {
      index = literalRange.end - 1;
      continue;
    }

    const pair = wikitext.slice(index, index + 2);
    if (pair === '{{') {
      if (depth === 0) start = index;
      depth += 1;
      index += 1;
    } else if (pair === '}}' && depth > 0) {
      depth -= 1;
      if (depth === 0) ranges.push({ start, end: index + 2 });
      index += 1;
    }
  }

  if (depth > 0) ranges.push({ start, end: wikitext.length });
  return ranges;
}

function findFileLinks(wikitext, ignoredRanges) {
  const media = [];
  const starts = [];

  for (let index = 0; index < wikitext.length - 1; index += 1) {
    const pair = wikitext.slice(index, index + 2);
    if (pair === '[[') {
      starts.push(index);
      index += 1;
    } else if (pair === ']]' && starts.length > 0) {
      const start = starts.pop();
      const end = index + 2;
      if (isInsideRanges(start, ignoredRanges)) {
        index += 1;
        continue;
      }
      const rawTag = wikitext.slice(start, end);
      const parsed = parseFileParts(
        splitTopLevelPipes(rawTag.slice(2, -2)),
        rawTag,
        start,
      );
      if (parsed) media.push(parsed);
      index += 1;
    }
  }

  return media;
}

function findGalleryEntries(wikitext, ignoredRanges) {
  const media = [];
  const ranges = [];
  const pattern = /<gallery\b[^>]*>([\s\S]*?)<\/gallery\s*>/giu;
  let match;

  while ((match = pattern.exec(wikitext)) !== null) {
    if (isInsideRanges(match.index, ignoredRanges)) continue;

    ranges.push({ start: match.index, end: match.index + match[0].length });
    const openingTagEnd = match[0].indexOf('>') + 1;
    const content = match[1];
    const contentPosition = match.index + openingTagEnd;
    let lineStart = 0;

    while (lineStart <= content.length) {
      const nextNewline = content.indexOf('\n', lineStart);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const sourceLine = content.slice(lineStart, lineEnd).replace(/\r$/u, '');
      const rawTag = sourceLine.trim();

      if (rawTag && !isInsideRanges(contentPosition + lineStart, ignoredRanges)) {
        const leadingWhitespace = sourceLine.indexOf(rawTag);
        const parsed = parseFileParts(
          splitTopLevelPipes(rawTag),
          rawTag,
          contentPosition + lineStart + leadingWhitespace,
        );
        if (parsed) media.push(parsed);
      }

      if (nextNewline === -1) break;
      lineStart = nextNewline + 1;
    }
  }

  return { media, ranges };
}

function findHeadings(wikitext, ignoredRanges) {
  const headings = [];
  const pattern = /^(={2,6})[ \t]*([^\r\n]*?)[ \t]*\1[ \t]*\r?$/gmu;
  let match;

  while ((match = pattern.exec(wikitext)) !== null) {
    if (isInsideRanges(match.index, ignoredRanges)) continue;
    headings.push({
      position: match.index,
      level: match[1].length,
      title: match[2].trim(),
    });
  }

  return headings;
}

function parseWikitextMedia(wikitext) {
  if (typeof wikitext !== 'string') {
    throw new TypeError('parseWikitextMedia requires a wikitext string.');
  }

  const literalRanges = findLiteralRanges(wikitext);
  const templateRanges = findTemplateRanges(wikitext, literalRanges);
  const gallery = findGalleryEntries(wikitext, literalRanges);
  const mediaIgnoredRanges = mergeRanges([...literalRanges, ...gallery.ranges]);
  const headingIgnoredRanges = mergeRanges([
    ...literalRanges,
    ...templateRanges,
    ...gallery.ranges,
  ]);
  const events = [
    ...findHeadings(wikitext, headingIgnoredRanges).map((heading) => ({ type: 'heading', ...heading })),
    ...findFileLinks(wikitext, mediaIgnoredRanges).map((item) => ({ type: 'media', ...item })),
    ...gallery.media.map((item) => ({ type: 'media', ...item })),
  ].sort((left, right) => left.position - right.position || (left.type === 'heading' ? -1 : 1));
  const activeHeadings = new Map();
  const result = [];

  for (const event of events) {
    if (event.type === 'heading') {
      for (const level of activeHeadings.keys()) {
        if (level >= event.level) activeHeadings.delete(level);
      }
      activeHeadings.set(event.level, {
        title: event.title,
        level: event.level,
        position: event.position,
      });
      continue;
    }

    const sectionTrail = [...activeHeadings.values()]
      .sort((left, right) => left.level - right.level)
      .map((heading) => ({ ...heading }));
    result.push({
      sectionPath: sectionTrail.map((heading) => heading.title),
      sectionTrail,
      position: event.position,
      fileTitle: event.fileTitle,
      caption: event.caption,
      ordinal: result.length + 1,
      rawTag: event.rawTag,
    });
  }

  return result;
}

module.exports = {
  parseWikitextMedia,
};
