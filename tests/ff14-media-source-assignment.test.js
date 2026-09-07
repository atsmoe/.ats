const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  assignSourceMediaToEvents,
} = require('../scripts/lib/ff14-media-source-assignment.js');
const {
  parseWikitextMedia,
} = require('../scripts/lib/ff14-wikitext-media.js');

const ROOT = path.join(__dirname, '..');

function media(
  fileTitle,
  ordinal,
  sectionPath = [],
  sectionTrail = sectionPath.map((title, index) => ({
    title,
    level: index + 2,
    position: index * 10,
  })),
) {
  return {
    sectionPath,
    sectionTrail,
    position: ordinal * 100,
    fileTitle,
    caption: null,
    ordinal,
    rawTag: `[[File:${fileTitle}]]`,
  };
}

function sourceWikitext(page) {
  return page?.revisions?.[0]?.slots?.main?.content;
}

function sourceKey(value) {
  return String(value || '')
    .replace(/^(?:file|文件)\s*:\s*/iu, '')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
}

function isThinDecorativeImage(info) {
  const width = Number(info?.width);
  const height = Number(info?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const shorter = Math.min(width, height);
  const longer = Math.max(width, height);
  return shorter <= 8 && longer / shorter >= 8;
}

function runCapturedSourceAssignments() {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/ff14-media-source-catalog.json'), 'utf8'));
  const sourceCapture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/ff14-wiki-source-capture.json'), 'utf8'));
  const imageInfoCapture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/ff14-wiki-image-info-capture.json'), 'utf8'));
  const pagesByTitle = new Map(sourceCapture.query.pages.map((page) => [page.title, page]));
  const imageInfoByTitle = new Map();

  for (const batch of imageInfoCapture.batches) {
    for (const page of batch.query.pages) {
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      const key = sourceKey(page.title);
      if (imageInfoByTitle.has(key)) throw new Error(`Duplicate image-info title in smoke fixture: ${page.title}`);
      imageInfoByTitle.set(key, info);
    }
  }

  const results = [];
  for (const source of catalog.sources) {
    const captured = source.wikiCandidates.filter((candidate) => pagesByTitle.has(candidate.title));
    if (captured.length === 0) continue;
    assert.equal(captured.length, 1, `source ${source.sourceTxt} must resolve to one captured page`);
    const sourcePage = captured[0].title;
    const page = pagesByTitle.get(sourcePage);
    const parsedMedia = parseWikitextMedia(sourceWikitext(page)).map((item) => {
      const info = imageInfoByTitle.get(sourceKey(item.fileTitle));
      const decorative = isThinDecorativeImage(info);
      return {
        ...item,
        mime: info?.mime || null,
        isDecorative: decorative,
        role: decorative ? 'decorative' : undefined,
      };
    });
    results.push({
      sourcePage,
      sourceTxt: source.sourceTxt,
      result: assignSourceMediaToEvents({ source, sourcePage, media: parsedMedia }),
    });
  }
  return results;
}

function missingCaptureNames(filePaths) {
  return filePaths.map((filePath) => path.basename(filePath)).join(', ');
}

test('single-event source pages assign every media marker to their sole event', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '角笛之争',
    source: {
      sourceTxt: '历史背影/角笛之争/角笛之争.txt',
      imageMarkerCount: 2,
      headings: [{
        eventId: 'ff14-l-025',
        title: '角笛之争',
        publishedTitle: '角笛之争',
        imageMarkerCount: 1,
      }],
    },
    media: [
      media('角笛封面.png', 2, ['消失的角笛与蛮神召唤']),
      media('仪式现场.jpg', 1),
    ],
  });

  assert.deepEqual(result.assignments.map((item) => ({
    eventId: item.eventId,
    sourcePage: item.sourcePage,
    fileTitle: item.fileTitle,
    ordinal: item.ordinal,
    sectionPath: item.sectionPath,
    assignmentMethod: item.assignmentMethod,
  })), [
    {
      eventId: 'ff14-l-025',
      sourcePage: '角笛之争',
      fileTitle: '仪式现场.jpg',
      ordinal: 1,
      sectionPath: [],
      assignmentMethod: 'single-event-source',
    },
    {
      eventId: 'ff14-l-025',
      sourcePage: '角笛之争',
      fileTitle: '角笛封面.png',
      ordinal: 2,
      sectionPath: ['消失的角笛与蛮神召唤'],
      assignmentMethod: 'single-event-source',
    },
  ]);
  assert.deepEqual(result.rejections, []);
  assert.equal(result.summary.assignedMediaCount, 2);
  assert.equal(result.summary.rejectedMediaCount, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('single-event sources reject the whole page when eligible image count differs', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '圣石',
    source: {
      sourceTxt: '重生之境/圣石/圣石.txt',
      imageMarkerCount: 1,
      headings: [{
        eventId: 'ff14-l-010',
        title: '圣石',
        publishedTitle: '圣石',
        imageMarkerCount: 1,
      }],
    },
    media: [
      media('黑蛇圣石.png', 1, ['黑蛇圣石']),
      media('多出的装饰图.jpg', 2, ['黑蛇圣石']),
    ],
  });

  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.rejections.map((item) => ({
    fileTitle: item.fileTitle,
    reasonCode: item.reasonCode,
    expected: item.expectedImageMarkerCount,
    actual: item.actualSectionMediaCount,
  })), [
    {
      fileTitle: '黑蛇圣石.png',
      reasonCode: 'page-count-mismatch',
      expected: 1,
      actual: 2,
    },
    {
      fileTitle: '多出的装饰图.jpg',
      reasonCode: 'page-count-mismatch',
      expected: 1,
      actual: 2,
    },
  ]);
  assert.equal(result.headingAudits[0].status, 'rejected');
  assert.equal(result.headingAudits[0].reasonCode, 'page-count-mismatch');
});

test('non-image and duplicate markers cannot satisfy a single-page count', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '水晶塔',
    source: {
      sourceTxt: '重生之境/水晶塔/水晶塔.txt',
      imageMarkerCount: 1,
      headings: [{
        eventId: 'ff14-l-015',
        title: '水晶塔',
        publishedTitle: '水晶塔',
        imageMarkerCount: 1,
      }],
    },
    media: [
      media('水晶塔.png', 1),
      media('水晶塔.png', 2),
      media('地图音乐.ogg', 3),
      { ...media('页面框线.png', 4), role: 'decorative' },
    ],
  });

  assert.deepEqual(result.assignments.map((item) => item.fileTitle), ['水晶塔.png']);
  assert.deepEqual(result.rejections.map((item) => ({
    fileTitle: item.fileTitle,
    reasonCode: item.reasonCode,
  })), [
    { fileTitle: '水晶塔.png', reasonCode: 'duplicate-media-marker' },
    { fileTitle: '地图音乐.ogg', reasonCode: 'non-image-media' },
    { fileTitle: '页面框线.png', reasonCode: 'decorative-media' },
  ]);
  assert.equal(result.headingAudits[0].actualSectionMediaCount, 1);
});

test('multi-event sources use one normalized section-title match and enforce its marker count', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '测试版本剧情',
    source: {
      sourceTxt: '第七星历/测试版本剧情.txt',
      headings: [
        {
          eventId: 'ff14-301',
          title: '旧标题',
          publishedTitle: '新标题',
          level: 3,
          imageMarkerCount: 2,
        },
        {
          eventId: 'ff14-302',
          title: '另一章',
          publishedTitle: '另一章',
          level: 3,
          imageMarkerCount: 0,
        },
      ],
    },
    media: [
      media('第二张.png', 2, ['测试版本剧情', '　新标题　']),
      media('第一张.jpg', 1, ['测试版本剧情', '新标题']),
    ],
  });

  assert.deepEqual(result.assignments.map((item) => ({
    eventId: item.eventId,
    fileTitle: item.fileTitle,
    ordinal: item.ordinal,
    assignmentMethod: item.assignmentMethod,
  })), [
    {
      eventId: 'ff14-301',
      fileTitle: '第一张.jpg',
      ordinal: 1,
      assignmentMethod: 'unique-section-title',
    },
    {
      eventId: 'ff14-301',
      fileTitle: '第二张.png',
      ordinal: 2,
      assignmentMethod: 'unique-section-title',
    },
  ]);
  assert.deepEqual(result.rejections, []);
  assert.deepEqual(result.headingAudits.map((audit) => ({
    eventId: audit.eventId,
    status: audit.status,
    expected: audit.expectedImageMarkerCount,
    actual: audit.actualSectionMediaCount,
  })), [
    { eventId: 'ff14-301', status: 'accepted', expected: 2, actual: 2 },
    { eventId: 'ff14-302', status: 'accepted', expected: 0, actual: 0 },
  ]);
});

test('multi-event sources assign nested media to the deepest title-and-level ancestor', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '末日的真相',
    source: {
      sourceTxt: '史前文明/末日的真相/末日的真相.txt',
      headings: [
        {
          eventId: 'ff14-024',
          title: '逃往星外的尝试',
          publishedTitle: '逃往星外的尝试',
          level: 2,
          imageMarkerCount: 2,
        },
        {
          eventId: 'ff14-099',
          title: '迷津计划',
          publishedTitle: '迷津计划',
          level: 2,
          imageMarkerCount: 0,
        },
      ],
    },
    media: [
      media('迷津.jpg', 1, ['逃往星外的尝试', '迷津计划']),
      media('惊愕所.png', 2, ['逃往星外的尝试', '迷津计划']),
    ],
  });

  assert.deepEqual(result.assignments.map((item) => ({
    eventId: item.eventId,
    fileTitle: item.fileTitle,
    assignmentMethod: item.assignmentMethod,
  })), [
    {
      eventId: 'ff14-024',
      fileTitle: '迷津.jpg',
      assignmentMethod: 'nearest-section-ancestor',
    },
    {
      eventId: 'ff14-024',
      fileTitle: '惊愕所.png',
      assignmentMethod: 'nearest-section-ancestor',
    },
  ]);
  assert.deepEqual(result.rejections, []);
  assert.equal(result.headingAudits[0].actualSectionMediaCount, 2);
});

test('multi-event sources reject an entire matched section when its count differs', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '苍穹之禁城',
    source: {
      sourceTxt: '第七星历/苍穹之禁城/苍穹之禁城.txt',
      headings: [
        {
          eventId: 'ff14-261',
          title: '壮丽的皇都',
          publishedTitle: '壮丽的皇都',
          level: 3,
          imageMarkerCount: 1,
        },
        {
          eventId: 'ff14-262',
          title: '永恒的光辉',
          publishedTitle: '永恒的光辉',
          level: 3,
          imageMarkerCount: 0,
        },
      ],
    },
    media: [
      media('皇都远景.jpg', 1, ['苍穹之禁城', '壮丽的皇都']),
      media('皇都内城.png', 2, ['苍穹之禁城', '壮丽的皇都']),
    ],
  });

  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.rejections.map((item) => item.reasonCode), [
    'section-count-mismatch',
    'section-count-mismatch',
  ]);
  assert.deepEqual(result.rejections.map((item) => item.eventId), [
    'ff14-261',
    'ff14-261',
  ]);
  assert.equal(result.headingAudits[0].reasonCode, 'section-count-mismatch');
});

test('multi-event section counts ignore non-images and repeated file markers', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '时空狭缝记录',
    source: {
      sourceTxt: '设定/时空狭缝记录.txt',
      headings: [
        {
          eventId: 'ff14-410',
          title: '时空狭缝',
          publishedTitle: '时空狭缝',
          level: 2,
          imageMarkerCount: 1,
        },
        {
          eventId: 'ff14-411',
          title: '返回原初世界',
          publishedTitle: '返回原初世界',
          level: 2,
          imageMarkerCount: 0,
        },
      ],
    },
    media: [
      media('时空狭缝.png', 1, ['时空狭缝']),
      media('时空狭缝.png', 2, ['时空狭缝']),
      media('地图音乐.ogg', 3, ['时空狭缝']),
    ],
  });

  assert.deepEqual(result.assignments.map((item) => item.fileTitle), ['时空狭缝.png']);
  assert.deepEqual(result.rejections.map((item) => item.reasonCode), [
    'duplicate-media-marker',
    'non-image-media',
  ]);
  assert.equal(result.headingAudits[0].actualSectionMediaCount, 1);
  assert.equal(result.headingAudits[0].status, 'accepted');
});

test('multi-event sources reject media whose leaf section title is unknown', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '曙光微明',
    source: {
      sourceTxt: '第七星历/曙光微明/曙光微明.txt',
      headings: [
        {
          eventId: 'ff14-311',
          title: '千里急报',
          publishedTitle: '千里急报',
          level: 2,
          imageMarkerCount: 0,
        },
        {
          eventId: 'ff14-312',
          title: '阴云缭绕',
          publishedTitle: '阴云缭绕',
          level: 2,
          imageMarkerCount: 0,
        },
      ],
    },
    media: [media('未知章节.png', 1, ['曙光微明'])],
  });

  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.rejections.map((item) => ({
    reasonCode: item.reasonCode,
    leafSectionTitle: item.leafSectionTitle,
    normalizedSectionTitle: item.normalizedSectionTitle,
    candidateEventIds: item.candidateEventIds,
  })), [{
    reasonCode: 'unknown-section-title',
    leafSectionTitle: '曙光微明',
    normalizedSectionTitle: '曙光微明',
    candidateEventIds: [],
  }]);
});

test('multi-event sources reject normalized title collisions instead of guessing', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '重名章节页',
    source: {
      sourceTxt: '测试/重名章节页.txt',
      headings: [
        {
          eventId: 'ff14-420',
          title: '共同标题',
          publishedTitle: '旧章一',
          level: 2,
          imageMarkerCount: 0,
        },
        {
          eventId: 'ff14-421',
          title: '旧章二',
          publishedTitle: '共同标题',
          level: 2,
          imageMarkerCount: 0,
        },
      ],
    },
    media: [media('冲突图.png', 1, ['共同标题'])],
  });

  assert.deepEqual(result.assignments, []);
  assert.equal(result.rejections[0].reasonCode, 'ambiguous-section-title');
  assert.deepEqual(result.rejections[0].candidateEventIds, ['ff14-420', 'ff14-421']);
});

test('section matching normalizes spacing without collapsing compatibility characters', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '严格标题页',
    source: {
      sourceTxt: '测试/严格标题页.txt',
      headings: [
        {
          eventId: 'ff14-430',
          title: '章节 IV',
          publishedTitle: '章节 IV',
          level: 2,
          imageMarkerCount: 0,
        },
        {
          eventId: 'ff14-431',
          title: '另一章',
          publishedTitle: '另一章',
          level: 2,
          imageMarkerCount: 0,
        },
      ],
    },
    media: [media('不应归属.png', 1, ['章节_Ⅳ'])],
  });

  assert.deepEqual(result.assignments, []);
  assert.equal(result.rejections[0].reasonCode, 'unknown-section-title');
  assert.equal(result.rejections[0].normalizedSectionTitle, '章节_Ⅳ');
});

test('same section title at another heading level does not steal outer-section media', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '红莲之狂潮',
    source: {
      sourceTxt: '第七星历/红莲之狂潮/红莲之狂潮.txt',
      headings: [
        {
          eventId: 'ff14-292',
          title: '跨越长城',
          publishedTitle: '跨越长城',
          level: 3,
          imageMarkerCount: 1,
        },
        {
          eventId: 'ff14-311',
          title: '红莲之狂潮',
          publishedTitle: '红莲之狂潮',
          level: 3,
          imageMarkerCount: 0,
        },
      ],
    },
    media: [
      media('章节封面.png', 1, ['红莲之狂潮'], [
        { title: '红莲之狂潮', level: 2, position: 0 },
      ]),
      media('跨越长城.png', 2, ['红莲之狂潮', '跨越长城'], [
        { title: '红莲之狂潮', level: 2, position: 0 },
        { title: '跨越长城', level: 3, position: 100 },
      ]),
    ],
  });

  assert.deepEqual(result.assignments.map((item) => ({
    eventId: item.eventId,
    fileTitle: item.fileTitle,
  })), [{ eventId: 'ff14-292', fileTitle: '跨越长城.png' }]);
  assert.deepEqual(result.rejections.map((item) => ({
    eventId: item.eventId,
    fileTitle: item.fileTitle,
    reasonCode: item.reasonCode,
  })), [{ eventId: null, fileTitle: '章节封面.png', reasonCode: 'unknown-section-title' }]);
  assert.equal(result.headingAudits.find((item) => item.eventId === 'ff14-311').actualSectionMediaCount, 0);
});

test('source headings and media ordinals fail closed when identity is unsafe', () => {
  const base = {
    sourcePage: '验证页',
    source: {
      sourceTxt: '测试/验证页.txt',
      headings: [{ eventId: 'ff14-001', title: '验证页', imageMarkerCount: 1 }],
    },
    media: [media('验证.png', 1)],
  };

  assert.throws(
    () => assignSourceMediaToEvents({ ...base, source: { ...base.source, headings: [] } }),
    /at least one source heading/iu,
  );
  assert.throws(
    () => assignSourceMediaToEvents({
      ...base,
      source: { ...base.source, headings: [{ ...base.source.headings[0], eventId: '   ' }] },
    }),
    /non-empty eventId/iu,
  );
  assert.throws(
    () => assignSourceMediaToEvents({
      ...base,
      source: {
        ...base.source,
        headings: [base.source.headings[0], { ...base.source.headings[0] }],
      },
    }),
    /eventId must be unique/iu,
  );
  for (const ordinal of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => assignSourceMediaToEvents({ ...base, media: [media('验证.png', ordinal)] }),
      /positive safe-integer ordinal/iu,
    );
  }
  assert.throws(
    () => assignSourceMediaToEvents({
      ...base,
      media: [media('验证.png', 1), media('重复序号.png', 1)],
    }),
    /ordinal must be unique/iu,
  );
});

test('explicit upstream decorative metadata remains visible in assignment audit', () => {
  const result = assignSourceMediaToEvents({
    sourcePage: '装饰审计',
    source: {
      sourceTxt: '测试/装饰审计.txt',
      imageMarkerCount: 0,
      headings: [{ eventId: 'ff14-500', title: '装饰审计', imageMarkerCount: 0 }],
    },
    media: [{
      ...media('Sline.png', 1),
      mime: 'image/png',
      role: 'decorative',
      isDecorative: true,
    }],
  });

  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.rejections.map((item) => ({
    fileTitle: item.fileTitle,
    mime: item.mime,
    role: item.role,
    isDecorative: item.isDecorative,
    reasonCode: item.reasonCode,
  })), [{
    fileTitle: 'Sline.png',
    mime: 'image/png',
    role: 'decorative',
    isDecorative: true,
    reasonCode: 'decorative-media',
  }]);
});

test('missing capture labels remain valid under strict path APIs', () => {
  assert.equal(missingCaptureNames([
    path.join(ROOT, 'tmp/ff14-media-source-catalog.json'),
    path.join(ROOT, 'tmp/ff14-wiki-source-capture.json'),
  ]), 'ff14-media-source-catalog.json, ff14-wiki-source-capture.json');
});

test('real 40-page capture keeps deterministic ancestry-safe assignment totals', (t) => {
  const capturePaths = [
    path.join(ROOT, 'tmp/ff14-media-source-catalog.json'),
    path.join(ROOT, 'tmp/ff14-wiki-source-capture.json'),
    path.join(ROOT, 'tmp/ff14-wiki-image-info-capture.json'),
  ];
  const missingCaptures = capturePaths.filter((filePath) => !fs.existsSync(filePath));
  if (missingCaptures.length > 0) {
    t.skip(`local 40-page audit captures unavailable: ${missingCaptureNames(missingCaptures)}`);
    return;
  }

  const results = runCapturedSourceAssignments();
  const summary = results.reduce((totals, item) => ({
    sourceCount: totals.sourceCount + 1,
    mediaCount: totals.mediaCount + item.result.summary.sourceMediaCount,
    assignedCount: totals.assignedCount + item.result.summary.assignedMediaCount,
    rejectedCount: totals.rejectedCount + item.result.summary.rejectedMediaCount,
    rejectedHeadingCount: totals.rejectedHeadingCount + item.result.summary.rejectedHeadingCount,
  }), {
    sourceCount: 0,
    mediaCount: 0,
    assignedCount: 0,
    rejectedCount: 0,
    rejectedHeadingCount: 0,
  });

  assert.deepEqual(summary, {
    sourceCount: 40,
    mediaCount: 181,
    assignedCount: 134,
    rejectedCount: 47,
    rejectedHeadingCount: 19,
  });

  const assignments = results.flatMap((item) => item.result.assignments);
  const filesFor = (eventId) => assignments
    .filter((item) => item.eventId === eventId)
    .map((item) => item.fileTitle)
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(filesFor('ff14-018'), [
    'Meteion_from_Final_Fantasy_XIV_render.png',
    '共享意识.png',
    '梅蒂恩鸟.png',
  ].sort((left, right) => left.localeCompare(right)));
  assert.deepEqual(filesFor('ff14-024'), [
    '所思大书院.png',
    '惊愕所.png',
    '迷津.jpg',
  ].sort((left, right) => left.localeCompare(right)));

  const stormblood = results.find((item) => item.sourcePage === '红莲之狂潮');
  assert.ok(stormblood, '红莲之狂潮 must be part of the captured smoke fixture');
  assert.equal(stormblood.result.assignments.some((item) => item.eventId === 'ff14-311'), false);
  assert.equal(
    stormblood.result.headingAudits.find((item) => item.eventId === 'ff14-311').actualSectionMediaCount,
    0,
  );

  const digest = crypto.createHash('sha256').update(JSON.stringify(results)).digest('hex');
  assert.equal(digest, 'ce57537f9981304b0051aeee8324e967bdc5729b425f08527e788d1b1991198f');
  assert.deepEqual(runCapturedSourceAssignments(), results);
});
