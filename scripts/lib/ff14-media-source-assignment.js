'use strict';

const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/iu;

function stableMedia(media) {
  return media
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftOrdinal = Number.isFinite(left.item.ordinal) ? left.item.ordinal : Number.MAX_SAFE_INTEGER;
      const rightOrdinal = Number.isFinite(right.item.ordinal) ? right.item.ordinal : Number.MAX_SAFE_INTEGER;
      return leftOrdinal - rightOrdinal || left.index - right.index;
    })
    .map(({ item }) => item);
}

function mediaAuditFields(item) {
  const sectionTrail = Array.isArray(item.sectionTrail)
    ? item.sectionTrail.map((heading) => ({
      title: typeof heading?.title === 'string' ? heading.title : null,
      level: Number.isSafeInteger(heading?.level) ? heading.level : null,
      position: Number.isSafeInteger(heading?.position) && heading.position >= 0
        ? heading.position
        : null,
    }))
    : [];
  return {
    fileTitle: typeof item.fileTitle === 'string' ? item.fileTitle : null,
    ordinal: Number.isSafeInteger(item.ordinal) ? item.ordinal : null,
    sectionPath: Array.isArray(item.sectionPath) ? [...item.sectionPath] : [],
    sectionTrail,
    position: Number.isSafeInteger(item.position) && item.position >= 0 ? item.position : null,
    caption: typeof item.caption === 'string' ? item.caption : null,
    rawTag: typeof item.rawTag === 'string' ? item.rawTag : null,
    mime: typeof item.mime === 'string' ? item.mime : null,
    role: typeof item.role === 'string' ? item.role : null,
    isDecorative: typeof item.isDecorative === 'boolean' ? item.isDecorative : null,
  };
}

function normalizeSectionTitle(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/[\s\u00a0]+/gu, ' ')
    .trim();
}

function normalizeFileTitle(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/_/gu, ' ')
    .replace(/[\s\u00a0]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function mediaExclusionReason(item) {
  if (item?.isDecorative === true || /^(?:decoration|decorative)$/iu.test(item?.role || '')) {
    return 'decorative-media';
  }
  if (typeof item?.mime === 'string') {
    return item.mime.toLowerCase().startsWith('image/') ? null : 'non-image-media';
  }
  return IMAGE_FILE_EXTENSION.test(item?.fileTitle || '') ? null : 'non-image-media';
}

function validateSourceHeadings(headings) {
  if (headings.length === 0) {
    throw new TypeError('assignSourceMediaToEvents requires at least one source heading.');
  }

  const eventIds = new Set();
  for (const heading of headings) {
    const eventId = typeof heading?.eventId === 'string' ? heading.eventId.trim() : '';
    if (!eventId) {
      throw new TypeError('Every source heading requires a non-empty eventId.');
    }
    if (eventIds.has(eventId)) {
      throw new TypeError(`Source heading eventId must be unique: ${eventId}`);
    }
    eventIds.add(eventId);
  }
}

function validateMediaOrdinals(media) {
  const ordinals = new Set();
  for (const item of media) {
    if (!Number.isSafeInteger(item?.ordinal) || item.ordinal < 1) {
      throw new TypeError('Every media marker requires a unique positive safe-integer ordinal.');
    }
    if (ordinals.has(item.ordinal)) {
      throw new TypeError(`Media marker ordinal must be unique: ${item.ordinal}`);
    }
    ordinals.add(item.ordinal);
  }
}

function sectionMatchKey(level, title) {
  if (!Number.isSafeInteger(level)) return '';
  const normalizedTitle = normalizeSectionTitle(title);
  return normalizedTitle ? `${level}\u0000${normalizedTitle}` : '';
}

function usableSectionTrail(item) {
  if (!Array.isArray(item?.sectionTrail)) return [];
  return item.sectionTrail.filter((heading) => (
    typeof heading?.title === 'string'
    && Number.isSafeInteger(heading.level)
    && Number.isSafeInteger(heading.position)
    && heading.position >= 0
  ));
}

function rejectionFor(item, context) {
  return {
    eventId: context.eventId ?? null,
    sourcePage: context.sourcePage,
    sourceTxt: context.sourceTxt ?? null,
    headingTitle: context.headingTitle ?? null,
    ...mediaAuditFields(item),
    leafSectionTitle: context.leafSectionTitle ?? null,
    normalizedSectionTitle: context.normalizedSectionTitle ?? null,
    matchedSectionTitle: context.matchedSectionTitle ?? null,
    matchedSectionLevel: context.matchedSectionLevel ?? null,
    matchedSectionPosition: context.matchedSectionPosition ?? null,
    candidateEventIds: [...(context.candidateEventIds || [])],
    expectedImageMarkerCount: context.expectedImageMarkerCount ?? null,
    actualSectionMediaCount: context.actualSectionMediaCount ?? null,
    reasonCode: context.reasonCode,
  };
}

function assignSourceMediaToEvents({ source, sourcePage, media }) {
  if (!source || !Array.isArray(source.headings)) {
    throw new TypeError('assignSourceMediaToEvents requires a source with headings.');
  }
  if (typeof sourcePage !== 'string' || !sourcePage.trim()) {
    throw new TypeError('assignSourceMediaToEvents requires a sourcePage string.');
  }
  if (!Array.isArray(media)) {
    throw new TypeError('assignSourceMediaToEvents requires a media array.');
  }

  validateSourceHeadings(source.headings);
  validateMediaOrdinals(media);

  const orderedMedia = stableMedia(media);
  const assignments = [];
  const rejections = [];
  const headingAudits = [];

  if (source.headings.length === 1) {
    const heading = source.headings[0];
    const expected = Number.isInteger(source.imageMarkerCount) && source.imageMarkerCount >= 0
      ? source.imageMarkerCount
      : null;
    const decisions = orderedMedia.map((item) => ({ item, reasonCode: mediaExclusionReason(item) }));
    const seenFileTitles = new Set();
    const eligibleDecisions = [];
    for (const decision of decisions) {
      if (decision.reasonCode) continue;
      const fileKey = normalizeFileTitle(decision.item.fileTitle);
      if (seenFileTitles.has(fileKey)) {
        decision.reasonCode = 'duplicate-media-marker';
      } else {
        seenFileTitles.add(fileKey);
        eligibleDecisions.push(decision);
      }
    }
    const actual = eligibleDecisions.length;
    const countMatches = expected !== null && expected === actual;
    const reasonCode = expected === null
      ? 'invalid-page-image-marker-count'
      : (countMatches ? null : 'page-count-mismatch');
    if (reasonCode) {
      for (const decision of eligibleDecisions) decision.reasonCode = reasonCode;
    }
    for (const decision of decisions) {
      const { item } = decision;
      if (decision.reasonCode) {
        const sectionPath = Array.isArray(item.sectionPath) ? item.sectionPath : [];
        const leafSectionTitle = sectionPath.at(-1) ?? null;
        rejections.push(rejectionFor(item, {
          eventId: heading.eventId,
          sourcePage,
          sourceTxt: source.sourceTxt,
          headingTitle: heading.title ?? heading.publishedTitle,
          leafSectionTitle,
          normalizedSectionTitle: normalizeSectionTitle(leafSectionTitle),
          candidateEventIds: [heading.eventId ?? null],
          expectedImageMarkerCount: expected,
          actualSectionMediaCount: actual,
          reasonCode: decision.reasonCode,
        }));
      } else {
        assignments.push({
          eventId: heading.eventId ?? null,
          sourcePage,
          sourceTxt: source.sourceTxt ?? null,
          headingTitle: heading.title ?? heading.publishedTitle ?? null,
          ...mediaAuditFields(item),
          assignmentMethod: 'single-event-source',
        });
      }
    }
    headingAudits.push({
      eventId: heading.eventId ?? null,
      sourcePage,
      sourceTxt: source.sourceTxt ?? null,
      headingTitle: heading.title ?? heading.publishedTitle ?? null,
      expectedImageMarkerCount: expected,
      actualSectionMediaCount: actual,
      countEnforced: true,
      status: reasonCode ? 'rejected' : 'accepted',
      reasonCode,
    });
  } else if (source.headings.length > 1) {
    const sectionIndex = new Map();
    const groups = source.headings.map(() => []);
    const decisions = orderedMedia.map((item) => ({
      item,
      headingIndex: null,
      matchedSection: null,
      assignmentMethod: null,
      rejection: null,
    }));

    source.headings.forEach((heading, headingIndex) => {
      const titles = new Set([
        normalizeSectionTitle(heading.title),
        normalizeSectionTitle(heading.publishedTitle),
      ].filter(Boolean));
      for (const title of titles) {
        const key = sectionMatchKey(heading.level, title);
        if (!key) continue;
        if (!sectionIndex.has(key)) sectionIndex.set(key, new Set());
        sectionIndex.get(key).add(headingIndex);
      }
    });

    decisions.forEach((decision, mediaIndex) => {
      const trail = usableSectionTrail(decision.item);
      const sectionPath = Array.isArray(decision.item.sectionPath) ? decision.item.sectionPath : [];
      const leafSectionTitle = trail.at(-1)?.title ?? sectionPath.at(-1) ?? null;

      if (trail.length === 0) {
        decision.rejection = rejectionFor(decision.item, {
          sourcePage,
          sourceTxt: source.sourceTxt,
          leafSectionTitle,
          normalizedSectionTitle: normalizeSectionTitle(leafSectionTitle),
          candidateEventIds: [],
          reasonCode: 'missing-section-title',
        });
        return;
      }

      for (let trailIndex = trail.length - 1; trailIndex >= 0; trailIndex -= 1) {
        const section = trail[trailIndex];
        const normalizedTitle = normalizeSectionTitle(section.title);
        const key = sectionMatchKey(section.level, normalizedTitle);
        const candidateIndexes = key ? [...(sectionIndex.get(key) || [])] : [];
        if (candidateIndexes.length === 0) continue;

        const candidateEventIds = candidateIndexes.map((index) => source.headings[index].eventId);
        if (candidateIndexes.length > 1) {
          decision.rejection = rejectionFor(decision.item, {
            sourcePage,
            sourceTxt: source.sourceTxt,
            leafSectionTitle,
            normalizedSectionTitle: normalizedTitle,
            matchedSectionTitle: section.title,
            matchedSectionLevel: section.level,
            matchedSectionPosition: section.position,
            candidateEventIds,
            reasonCode: 'ambiguous-section-title',
          });
          return;
        }

        decision.headingIndex = candidateIndexes[0];
        decision.matchedSection = section;
        decision.assignmentMethod = trailIndex === trail.length - 1
          ? 'unique-section-title'
          : 'nearest-section-ancestor';
        groups[decision.headingIndex].push(mediaIndex);
        return;
      }

      if (!decision.rejection && decision.headingIndex === null) {
        decision.rejection = rejectionFor(decision.item, {
          sourcePage,
          sourceTxt: source.sourceTxt,
          leafSectionTitle,
          normalizedSectionTitle: normalizeSectionTitle(leafSectionTitle),
          candidateEventIds: [],
          reasonCode: 'unknown-section-title',
        });
      }
    });

    source.headings.forEach((heading, headingIndex) => {
      const mediaIndexes = groups[headingIndex];
      const seenFileTitles = new Set();
      const eligibleMediaIndexes = [];
      const excludedMedia = [];
      for (const mediaIndex of mediaIndexes) {
        const decision = decisions[mediaIndex];
        const exclusionReason = mediaExclusionReason(decision.item);
        if (exclusionReason) {
          excludedMedia.push({ mediaIndex, reasonCode: exclusionReason });
          continue;
        }
        const fileKey = normalizeFileTitle(decision.item.fileTitle);
        if (seenFileTitles.has(fileKey)) {
          excludedMedia.push({ mediaIndex, reasonCode: 'duplicate-media-marker' });
        } else {
          seenFileTitles.add(fileKey);
          eligibleMediaIndexes.push(mediaIndex);
        }
      }
      const expected = Number.isInteger(heading.imageMarkerCount) && heading.imageMarkerCount >= 0
        ? heading.imageMarkerCount
        : null;
      const actual = eligibleMediaIndexes.length;
      const countMatches = expected !== null && expected === actual;
      const reasonCode = expected === null
        ? 'invalid-image-marker-count'
        : (countMatches ? null : 'section-count-mismatch');

      headingAudits.push({
        eventId: heading.eventId ?? null,
        sourcePage,
        sourceTxt: source.sourceTxt ?? null,
        headingTitle: heading.title ?? heading.publishedTitle ?? null,
        publishedTitle: heading.publishedTitle ?? null,
        level: Number.isSafeInteger(heading.level) ? heading.level : null,
        normalizedTitles: [...new Set([
          normalizeSectionTitle(heading.title),
          normalizeSectionTitle(heading.publishedTitle),
        ].filter(Boolean))],
        expectedImageMarkerCount: expected,
        actualSectionMediaCount: actual,
        countEnforced: true,
        status: reasonCode ? 'rejected' : 'accepted',
        reasonCode,
      });

      for (const { mediaIndex, reasonCode: exclusionReason } of excludedMedia) {
        const decision = decisions[mediaIndex];
        const sectionPath = Array.isArray(decision.item.sectionPath)
          ? decision.item.sectionPath
          : [];
        const leafSectionTitle = sectionPath.at(-1) ?? null;
        decision.rejection = rejectionFor(decision.item, {
          eventId: heading.eventId,
          sourcePage,
          sourceTxt: source.sourceTxt,
          headingTitle: heading.title ?? heading.publishedTitle,
          leafSectionTitle,
          normalizedSectionTitle: normalizeSectionTitle(decision.matchedSection?.title ?? leafSectionTitle),
          matchedSectionTitle: decision.matchedSection?.title,
          matchedSectionLevel: decision.matchedSection?.level,
          matchedSectionPosition: decision.matchedSection?.position,
          candidateEventIds: [heading.eventId ?? null],
          expectedImageMarkerCount: expected,
          actualSectionMediaCount: actual,
          reasonCode: exclusionReason,
        });
      }

      for (const mediaIndex of eligibleMediaIndexes) {
        const decision = decisions[mediaIndex];
        if (reasonCode) {
          const sectionPath = Array.isArray(decision.item.sectionPath)
            ? decision.item.sectionPath
            : [];
          const leafSectionTitle = sectionPath.at(-1) ?? null;
          decision.rejection = rejectionFor(decision.item, {
            eventId: heading.eventId,
            sourcePage,
            sourceTxt: source.sourceTxt,
            headingTitle: heading.title ?? heading.publishedTitle,
            leafSectionTitle,
            normalizedSectionTitle: normalizeSectionTitle(decision.matchedSection?.title ?? leafSectionTitle),
            matchedSectionTitle: decision.matchedSection?.title,
            matchedSectionLevel: decision.matchedSection?.level,
            matchedSectionPosition: decision.matchedSection?.position,
            candidateEventIds: [heading.eventId ?? null],
            expectedImageMarkerCount: expected,
            actualSectionMediaCount: actual,
            reasonCode,
          });
        }
      }
    });

    for (const decision of decisions) {
      if (decision.rejection) {
        rejections.push(decision.rejection);
        continue;
      }
      const heading = source.headings[decision.headingIndex];
      assignments.push({
        eventId: heading.eventId ?? null,
        sourcePage,
        sourceTxt: source.sourceTxt ?? null,
        headingTitle: heading.title ?? heading.publishedTitle ?? null,
        ...mediaAuditFields(decision.item),
        assignmentMethod: decision.assignmentMethod,
      });
    }
  }

  return {
    assignments,
    rejections,
    headingAudits,
    summary: {
      sourcePage,
      sourceEventCount: source.headings.length,
      sourceMediaCount: orderedMedia.length,
      assignedMediaCount: assignments.length,
      rejectedMediaCount: rejections.length,
      rejectedHeadingCount: headingAudits.filter((audit) => audit.status === 'rejected').length,
    },
  };
}

module.exports = {
  assignSourceMediaToEvents,
};
