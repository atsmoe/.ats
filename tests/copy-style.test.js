const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DATA = path.join(SRC, '_data');

function collectFiles(directory, predicate, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_data' || entry.name === 'prototypes') continue;
      collectFiles(fullPath, predicate, files);
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

const copySurfaces = collectFiles(
  SRC,
  filePath => {
    const relative = path.relative(SRC, filePath).replaceAll('\\', '/');
    if (relative.includes('prototype')) return false;
    if (relative.endsWith('.njk')) return true;
    return relative.startsWith('js/modules/') && relative.endsWith('.js');
  },
);

const rhetoricalPatterns = [
  /(?:不是|并非|并不是|不再是)[^。！？\n]{0,80}(?:而是|而在于|只是)/,
  /与其[^。！？\n]{0,80}不如/,
  /(?:不仅|不只是)[^。！？\n]{0,80}(?:还|更|也)/,
];

const visitorFacingMetaPhrases = [
  '规范记录',
  '规范事件',
  'URL 语义',
  '数据结构',
  '信息架构',
  '模型边界',
  '页面级设定参考',
  '主题观测接口',
  '结局记录拓扑',
  '更新可分享地址',
  '叙事拓扑',
  '系统函数',
  '追加节点',
  '页面同步分享链接',
  '交互连线',
  'SITE READING PATH',
  '不伪装成确定正史',
];

const abstractClichePatterns = [
  /不可磨灭的?(?:印记|痕迹)/,
  /每(?:一|个)[^。！？\n]{0,30}(?:抉择|选择)[^。！？\n]{0,30}(?:留下|刻下)/,
  /历史[^。！？\n]{0,40}(?:反复)?(?:改写|重写)/,
];

const recordMaintenancePatterns = [
  /(?:归档时|独立(?:可能|假说)归档|闭环观测保存)/,
  /(?:首轮资料范围|后续(?:探索)?需要(?:分别)?记录|新的坐标体系中重新建立)/,
  /本站(?:把|按|将|不把)/,
  /(?:页面|界面)(?:代码|收录)/,
];

const editorialFieldNames = new Set([
  'description',
  'synopsis',
  'sharedPremise',
  'topologyNote',
  'tone',
  'summary',
  'sourceNote',
  'notice',
  'scope',
  'legacyNotice',
]);

const frozenDataSegments = new Set([
  'events',
  'endings',
  'sources',
  'prtsSources',
  'characters',
  'crossRefs',
  '_links',
]);

function collectEditorialData(value, currentPath = [], entries = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectEditorialData(item, [...currentPath, String(index)], entries));
    return entries;
  }
  if (!value || typeof value !== 'object') return entries;

  for (const [key, item] of Object.entries(value)) {
    if (frozenDataSegments.has(key)) continue;
    const itemPath = [...currentPath, key];
    if (editorialFieldNames.has(key) && typeof item === 'string') {
      entries.push({ path: itemPath.join('.'), text: item });
      continue;
    }
    collectEditorialData(item, itemPath, entries);
  }
  return entries;
}

function publishedEditorialData() {
  return ['arknights.json', 'wh40k.json', 'ff14.json'].flatMap((fileName) => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA, fileName), 'utf8'));
    return collectEditorialData(data).map(entry => ({ ...entry, fileName }));
  });
}

const selfAuthoredRecordPatterns = [
  /^if-(?:ceobe|phantom|mizuki|sami|sarkaz|sui|blackflow)[a-z0-9-]*-ending-\d+$/,
  /^ff14-(?:335|336)$/,
];

function collectSelfAuthoredRecords(value, fileName, entries = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectSelfAuthoredRecords(item, fileName, entries));
    return entries;
  }
  if (!value || typeof value !== 'object') return entries;

  if (
    typeof value.id === 'string'
    && selfAuthoredRecordPatterns.some(pattern => pattern.test(value.id))
  ) {
    for (const field of ['description', 'conditions', 'aftermath']) {
      if (typeof value[field] === 'string') {
        entries.push({ fileName, path: `${value.id}.${field}`, text: value[field] });
      }
    }
  }

  Object.values(value).forEach(item => collectSelfAuthoredRecords(item, fileName, entries));
  return entries;
}

function publishedSelfAuthoredRecords() {
  return ['arknights.json', 'ff14.json'].flatMap((fileName) => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA, fileName), 'utf8'));
    return collectSelfAuthoredRecords(data, fileName);
  });
}

function assertPublicCopyRules(entry) {
  for (const pattern of [...rhetoricalPatterns, ...abstractClichePatterns]) {
    assert.doesNotMatch(
      entry.text,
      pattern,
      `${entry.fileName}:${entry.path} contains template-like copy`,
    );
  }
  for (const phrase of visitorFacingMetaPhrases) {
    assert.equal(
      entry.text.includes(phrase),
      false,
      `${entry.fileName}:${entry.path} exposes internal phrase: ${phrase}`,
    );
  }
}

test('published copy avoids template-like negation turns', () => {
  for (const filePath of copySurfaces) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const pattern of rhetoricalPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.relative(ROOT, filePath)} contains a template-like negation turn`,
      );
    }
  }
});

test('published copy does not explain internal implementation contracts', () => {
  for (const filePath of copySurfaces) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const phrase of visitorFacingMetaPhrases) {
      assert.equal(
        source.includes(phrase),
        false,
        `${path.relative(ROOT, filePath)} exposes internal phrase: ${phrase}`,
      );
    }
  }
});

test('high-level archive summaries follow the same public copy rules', () => {
  for (const entry of publishedEditorialData()) {
    assertPublicCopyRules(entry);
  }
});

test('known site-authored record summaries do not hide maintenance language', () => {
  const entries = publishedSelfAuthoredRecords();
  assert.ok(entries.length >= 80, `expected site-authored record fields, found ${entries.length}`);
  for (const entry of entries) {
    assertPublicCopyRules(entry);
    for (const pattern of recordMaintenancePatterns) {
      assert.doesNotMatch(
        entry.text,
        pattern,
        `${entry.fileName}:${entry.path} contains maintenance language`,
      );
    }
  }
});
