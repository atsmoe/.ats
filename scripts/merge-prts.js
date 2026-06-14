const fs = require('fs');
const path = require('path');

// ========== CONFIG ==========
const ARKNIGHTS_PATH = path.join(__dirname, '..', 'src', '_data', 'arknights.json');
const PRTS_PATH = path.join(__dirname, '..', 'docs', 'prts_timeline.json');
const OVERRIDES_PATH = path.join(__dirname, '..', 'docs', 'prts_overrides.json');
const PRTS_BASE = 'https://prts.wiki/w/';

// Hardcoded seed character names (major Arknights characters)
const SEED_CHARACTERS = new Set([
  '阿米娅', '凯尔希', '博士', '陈', '塔露拉', '魏彦吾', '文月',
  '霜星', '爱国者', '梅菲斯特', '浮士德', '碎骨', 'W', '伊内丝', '赫德雷',
  '特蕾西娅', '特雷西斯', '摄政王', '推进之王', '维娜', '因陀罗', '摩根',
  '银灰', '初雪', '崖心', '角峰', '讯使', '灵知',
  '斯卡蒂', '幽灵鲨', '安哲拉', '歌蕾蒂娅', '乌尔比安', '水月', '海沫',
  '玛恩纳', '玛莉娅', '临光', '佐菲娅', '砾',
  '能天使', '德克萨斯', '拉普兰德', '空', '可颂',
  '傀影', '暮落', '剧作家', '酒神',
  '刻俄柏', '火神', '稀音',
  '年', '夕', '令', '重岳', '黍', '左乐',
  '艾雅法拉', '塞雷娅', '赫默', '伊芙利特', '多萝西', '缪尔赛思',
  '阿尔图罗', '送葬人', '安洁莉娜',
  '澄闪', '泥岩', '大鲍勃',
  '弑君者', '君君',
  'Logos', 'Ascalon', 'Kal\'tsit',
  'Mon3tr', '普瑞赛斯', '预言家', '弗里斯顿',
  '远逐者', '奎隆', '戈渎', '霸迩萨',
  '变形者', '爱布拉娜', '苇草', '深池',
  '哈洛德', '威灵顿',
  '黑骑士', '锏',
  '薇薇安娜', '伺夜',
  '阿斯卡纶', '斥罪',
  '克里斯滕', '塞雷娅',
  '巫王', '赫尔昏佐伦',
  '总辖', '克里斯滕',
]);

// Patterns that indicate a link title is NOT a character name
const NON_CHARACTER_RE = /^\d|行动|档案|模组|集成战略|干员|家具|材料|技能|关卡|悖论|模拟/i;

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ========== DATE PARSING ==========

/** Extract base year from section title */
function sectionBaseYear(sectionTitle, sectionNumber) {
  const t = sectionTitle.trim();
  // Direct year match: "1096 年"
  const yearMatch = t.match(/^(\d{3,4})\s*年/);
  if (yearMatch) return parseInt(yearMatch[1], 10);
  // Range: "1080 - 1095 年"
  const rangeMatch = t.match(/^(\d{3,4})\s*[-~]\s*(\d{3,4})/);
  if (rangeMatch) return parseInt(rangeMatch[1], 10);
  // "00 年代 - 70 年代" → 1000
  if (t.includes('00 年代')) return 1000;
  // "11 世纪前" → 800
  if (t.includes('11 世纪前') || t.includes('11世纪前')) return 800;
  // "12世纪" → 1100
  if (t.includes('12 世纪') || t.includes('12世纪')) return 1100;
  // Pre-civilization
  if (t.includes('结晶纪元') || t.includes('前文明')) return null;
  return null;
}

/** Parse Chinese natural-language date into structured fields */
function parsePrtsDate(dateStr, sectionContext) {
  let d = dateStr.trim().normalize('NFKC');
  // Collapse whitespace and newlines
  d = d.replace(/\s+/g, ' ').trim();
  // Remove "(时间未知)" suffix
  const isTimeUnknown = d.includes('时间未知');
  d = d.replace(/[（(]时间未知[）)]/g, '').trim();

  let precision = isTimeUnknown ? 'unknown' : 'exact';
  let dateRaw = '';
  let dateDisplay = '';

  // ---- Pre-civilization special formats ----
  if (d.startsWith('TT ')) {
    return { dateRaw: '纪元前', dateDisplay: '前文明 · ' + d, datePrecision: 'unknown' };
  }
  if (d === '前文明时期' || d === '泰拉纪元前未知年份') {
    return { dateRaw: '纪元前', dateDisplay: d, datePrecision: 'unknown' };
  }
  if (d === '泰拉历元年') {
    return { dateRaw: '1', dateDisplay: '泰拉历元年', datePrecision: 'exact' };
  }

  // ---- Approximate prefix ----
  let isApprox = false;
  if (d.startsWith('约')) {
    isApprox = true;
    d = d.substring(1).trim();
  }

  // ---- Year range: "1029 年 ~ 1031 年" or "1077年 ~ 1085年" ----
  const rangeMatch = d.match(/^(\d+)\s*年?\s*[~～\-]\s*(\d+)\s*年?/);
  if (rangeMatch) {
    precision = 'approximate';
    const yr = parseInt(rangeMatch[1], 10);
    dateRaw = String(yr);
    dateDisplay = '约泰拉历 ' + rangeMatch[1] + '年–' + rangeMatch[2] + '年';
    return { dateRaw, dateDisplay, datePrecision: precision };
  }

  // ---- BC dates: "前 35 年" or "约前 9000 年" ----
  const bcMatch = d.match(/^前\s*(\d+)\s*年?/);
  if (bcMatch) {
    const yr = parseInt(bcMatch[1], 10);
    dateRaw = String(-yr);
    dateDisplay = '泰拉纪元前' + bcMatch[1] + '年';
    if (isApprox) {
      dateDisplay = '约' + dateDisplay;
      precision = 'approximate';
    }
    return { dateRaw, dateDisplay, datePrecision: precision };
  }

  // ---- Year-only: "1096 年" or "11 年" ----
  const yearMatch = d.match(/^(\d{1,4})\s*年$/);
  if (yearMatch) {
    const yr = parseInt(yearMatch[1], 10);
    dateRaw = String(yr);
    dateDisplay = '泰拉历 ' + yearMatch[1] + '年';
    if (isApprox) { dateDisplay = '约' + dateDisplay; precision = 'approximate'; }
    return { dateRaw, dateDisplay, datePrecision: precision };
  }

  // ---- Century: "9 世纪" ----
  const centuryMatch = d.match(/^(\d{1,2})\s*世纪$/);
  if (centuryMatch) {
    const c = parseInt(centuryMatch[1], 10);
    const yr = (c - 1) * 100 + 50; // mid-century
    dateRaw = String(yr);
    dateDisplay = '约泰拉历 ' + c + '世纪';
    return { dateRaw, dateDisplay, datePrecision: 'approximate' };
  }

  // ---- Decade: "11 世纪 70 年代" ----
  const decadeMatch = d.match(/(\d{1,2})\s*世纪\s*(\d{1,2})\s*年代/);
  if (decadeMatch) {
    const c = parseInt(decadeMatch[1], 10);
    const dec = parseInt(decadeMatch[2], 10);
    const yr = (c - 1) * 100 + dec;
    dateRaw = String(yr);
    dateDisplay = '约泰拉历 ' + c + '世纪' + dec + '年代';
    return { dateRaw, dateDisplay, datePrecision: 'approximate' };
  }

  // ---- Month-Day: "1 月 26 日" (year from context) ----
  const mdMatch = d.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (mdMatch) {
    const month = parseInt(mdMatch[1], 10);
    const day = parseInt(mdMatch[2], 10);
    const year = sectionContext.currentYear || 0;
    dateRaw = year + '.' + month + '.' + day;
    dateDisplay = '泰拉历 ' + year + '年' + month + '月' + day + '日';
    return { dateRaw, dateDisplay, datePrecision: precision };
  }

  // ---- Month-only: "11 月" ----
  const monthMatch = d.match(/^(\d{1,2})\s*月$/);
  if (monthMatch) {
    const month = parseInt(monthMatch[1], 10);
    const year = sectionContext.currentYear || 0;
    dateRaw = year + '.' + month;
    dateDisplay = '泰拉历 ' + year + '年' + month + '月';
    return { dateRaw, dateDisplay, datePrecision: 'approximate' };
  }

  // ---- Season: "春季", "夏季", "秋季", "冬季" ----
  const seasonMap = { '春季': 3, '夏季': 6, '秋季': 9, '冬季': 12, '春': 3, '夏': 6, '秋': 9, '冬': 12 };
  const seasonMatch = d.match(/^(春季|夏季|秋季|冬季|春|夏|秋|冬)$/);
  if (seasonMatch) {
    const year = sectionContext.currentYear || 0;
    const month = seasonMap[seasonMatch[1]];
    dateRaw = year + '.' + month;
    dateDisplay = '泰拉历 ' + year + '年' + seasonMatch[1];
    return { dateRaw, dateDisplay, datePrecision: 'approximate' };
  }

  // ---- Year + "年前后": "800 年前后" ----
  const approxYearMatch = d.match(/^(\d+)\s*年前后$/);
  if (approxYearMatch) {
    dateRaw = String(parseInt(approxYearMatch[1], 10));
    dateDisplay = '约泰拉历 ' + approxYearMatch[1] + '年前后';
    return { dateRaw, dateDisplay, datePrecision: 'approximate' };
  }

  // ---- Vague time markers: "年初", "年末", "新春" ----
  if (d === '年初' || d === '年末' || d === '新春' || d === '早期') {
    const year = sectionContext.currentYear || 0;
    dateRaw = String(year);
    dateDisplay = '泰拉历 ' + year + '年' + d;
    return { dateRaw, dateDisplay, datePrecision: 'approximate' };
  }

  // ---- Month ranges: "2 ~ 4 月" ----
  const monthRangeMatch = d.match(/^(\d{1,2})\s*[~～]\s*(\d{1,2})\s*月$/);
  if (monthRangeMatch) {
    const year = sectionContext.currentYear || 0;
    dateRaw = year + '.' + monthRangeMatch[1];
    dateDisplay = '泰拉历 ' + year + '年' + monthRangeMatch[1] + '月–' + monthRangeMatch[2] + '月';
    return { dateRaw, dateDisplay, datePrecision: 'approximate' };
  }

  // ---- Fallback: just use as-is ----
  dateRaw = d.replace(/\s+/g, '');
  dateDisplay = '泰拉历 ' + d;
  return { dateRaw, dateDisplay, datePrecision: 'unknown' };
}

// ========== TITLE GENERATION ==========

function generateTitle(text) {
  const cleaned = text.trim();
  if (cleaned.length <= 25) return cleaned;
  return cleaned.substring(0, 25);
}

// ========== ERA MAPPING ==========

const ERA_MAP = {
  '1': '结晶纪元之前',
  '2.1': '800-994',
  '2.2.1': '1000-1079',
  '2.2.2': '1080-1095',
  '2.2.3': '1096',
  '2.2.4': '1097',
  '2.2.5': '1098',
  '2.2.6': '1099',
  '2.3.1': '1100+',
  '2.3.2': '1100',
  '2.3.3': '1101',
  '2.3.4': '1102',
  '2.3.5': '1103+',
  '3': '时间待确认',
  '4': null, // skip (注释与链接 - empty)
};

function eraForSection(sectionNumber, sectionTitle) {
  if (sectionNumber in ERA_MAP) {
    return ERA_MAP[sectionNumber]; // may be null for skipped sections
  }
  return sectionTitle;
}

// ========== CHARACTER EXTRACTION ==========

function buildCharacterList(prtsData, existingData) {
  // Collect seed from PRTS link titles
  const linkTitles = new Set();
  for (const section of prtsData.sections) {
    for (const evt of section.events) {
      for (const link of (evt.links || [])) {
        if (link.title && !NON_CHARACTER_RE.test(link.title)) {
          linkTitles.add(link.title);
        }
      }
    }
  }

  // Merge seeds
  const seeds = new Set([...SEED_CHARACTERS, ...linkTitles]);

  // Scan all PRTS event texts for seed names, count occurrences
  const counts = new Map();
  const allTexts = [];
  for (const section of prtsData.sections) {
    for (const evt of section.events) {
      allTexts.push(evt.text);
    }
  }
  const combinedText = allTexts.join(' ');

  for (const name of seeds) {
    if (name.length < 2) continue; // skip single chars
    // Count occurrences in the combined text
    let count = 0;
    let idx = 0;
    while ((idx = combinedText.indexOf(name, idx)) !== -1) {
      count++;
      idx += name.length;
    }
    if (count >= 3) {
      counts.set(name, count);
    }
  }

  // Sort by frequency (most frequent first)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function extractCharacters(text, charList) {
  const found = [];
  for (const name of charList) {
    if (text.includes(name)) {
      found.push(name);
    }
  }
  return found;
}

// ========== SOURCE URL CONVERSION ==========

function prtsHrefToUrl(href) {
  if (!href) return '';
  // href is already URL-encoded in PRTS data (or has raw Chinese)
  return PRTS_BASE + href;
}

function buildPrtsSources(event) {
  // Use sources array (same as links in PRTS data)
  const sources = event.sources || event.links || [];
  return sources.map(s => ({
    text: s.text || '',
    url: prtsHrefToUrl(s.href || ''),
    title: s.title || '',
  }));
}

// ========== IF DIVERGE REMAPPING ==========

const DIVERGE_KEYWORDS = {
  '刻俄柏': ['刻俄柏', '灰蕈', '迷境'],
  '傀影': ['傀影', '猩红', '孤钻', '剧团'],
  '水月': ['水月', '深蓝之树', '海嗣'],
  '银凇止境': ['萨米', '银凇', '止境', '因非冰原', '科考队'],
};

function findDivergeEventId(newEvents, keywords) {
  for (const evt of newEvents) {
    // Search title, description, and prtsSources text/title
    let searchText = (evt.title || '') + (evt.description || '');
    if (evt.prtsSources) {
      for (const s of evt.prtsSources) {
        searchText += (s.text || '') + (s.title || '');
      }
    }
    const matchCount = keywords.filter(kw => searchText.includes(kw)).length;
    if (matchCount >= 2) return evt.id; // need 2+ keyword matches for confidence
  }
  return null;
}

function remapDivergeIds(data, newMainlineEvents) {
  const integratedBranch = data.subEntities[0].timeline.branches
    .find(b => b.id === 'if-integrated');
  if (!integratedBranch) return;

  const remap = {};

  for (const sub of (integratedBranch.subBranches || [])) {
    if (sub.status === 'pending') continue;
    const oldId = sub.divergeAtEventId;
    if (!oldId) continue;

    // Determine which keywords to use based on sub-branch ID
    let keywords = null;
    if (sub.id === 'if-ceobe') keywords = DIVERGE_KEYWORDS['刻俄柏'];
    else if (sub.id === 'if-phantom') keywords = DIVERGE_KEYWORDS['傀影'];
    else if (sub.id === 'if-mizuki') keywords = DIVERGE_KEYWORDS['水月'];
    else if (sub.id === 'if-sami') keywords = DIVERGE_KEYWORDS['银凇止境'];

    if (keywords) {
      const newId = findDivergeEventId(newMainlineEvents, keywords);
      if (newId && newId !== oldId) {
        remap[oldId] = newId;
        sub.divergeAtEventId = newId;
        console.log('  [remap] ' + sub.id + ': ' + oldId + ' → ' + newId);
      } else {
        console.log('  [warn] ' + sub.id + ': could not find new diverge event for keywords: ' + keywords.join(', '));
      }
    }
  }

  return remap;
}

// ========== MAIN ==========

function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   PRTS → Arknights 数据合并          ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Load data
  console.log('[1/5] Loading data...');
  const arknights = loadJSON(ARKNIGHTS_PATH);
  const prts = loadJSON(PRTS_PATH);
  let overrides = {};
  if (fs.existsSync(OVERRIDES_PATH)) {
    overrides = loadJSON(OVERRIDES_PATH);
  }

  // Build character list
  console.log('[2/5] Building character list...');
  const charList = buildCharacterList(prts, arknights);
  console.log('  Found ' + charList.length + ' characters (≥3 occurrences)');

  // Process all PRTS events
  console.log('[3/5] Processing ' + prts.totalEvents + ' events...');
  const newEras = [];
  const eraMap = new Map(); // eraTitle → { title, events[] }
  let eventCounter = 0;
  const allNewEvents = [];

  for (const section of prts.sections) {
    const eraTitle = eraForSection(section.number, section.title);
    if (eraTitle === null) continue; // skip empty sections

    if (!eraMap.has(eraTitle)) {
      const era = { title: eraTitle, events: [] };
      eraMap.set(eraTitle, era);
      newEras.push(era);
    }
    const era = eraMap.get(eraTitle);

    // Parse base year for this section
    const baseYear = sectionBaseYear(section.title, section.number);
    let currentYear = baseYear;

    for (const evt of section.events) {
      eventCounter++;

      // Parse date with year context
      const ctx = { currentYear, baseYear, sectionTitle: section.title };
      const parsed = parsePrtsDate(evt.date, ctx);

      // Update year context for month-day inheriting
      const yearMatch = evt.date.trim().match(/^(\d{3,4})\s*年/);
      if (yearMatch) {
        currentYear = parseInt(yearMatch[1], 10);
      }

      // Generate title
      const title = generateTitle(evt.text);

      // Extract characters
      const chars = extractCharacters(evt.text, charList);

      // Build event object
      const eventId = 'evt-' + String(eventCounter).padStart(3, '0');
      const newEvent = {
        id: eventId,
        dateRaw: parsed.dateRaw,
        dateDisplay: parsed.dateDisplay,
        datePrecision: parsed.datePrecision,
        title: title,
        description: evt.text.trim(),
        characters: chars,
        isLargeEvent: chars.length >= 3,
        isConcurrent: false,
        isKeyEvent: false,
        isDivergePoint: false,
        crossRefs: [],
        divergesTo: [],
        prtsSources: buildPrtsSources(evt),
      };

      // Apply overrides
      if (overrides[eventId]) {
        Object.assign(newEvent, overrides[eventId]);
      }

      era.events.push(newEvent);
      allNewEvents.push(newEvent);
    }
  }

  console.log('  Processed ' + eventCounter + ' events across ' + newEras.length + ' eras');

  // Append preserved 终末地 event in "遥远的未来" era
  eventCounter++;
  const zhongmodiEvent = {
    id: 'evt-' + String(eventCounter).padStart(3, '0'),
    dateRaw: '~+500',
    dateDisplay: '约500年后',
    datePrecision: 'approximate',
    title: '明日方舟：终末地',
    location: '塔卫二',
    characters: ['终末地工业'],
    description: '罗德岛精神延续至塔卫二，终末地工业对抗更古老的"源石"威胁。',
    tags: ['罗德岛', '源石'],
    isLargeEvent: false,
    isConcurrent: false,
    isKeyEvent: false,
    isDivergePoint: false,
    crossRefs: [],
    divergesTo: [],
    prtsSources: [],
  };
  newEras.push({ title: '遥远的未来', events: [zhongmodiEvent] });
  allNewEvents.push(zhongmodiEvent);
  console.log('  [keep] 终末地 event in "遥远的未来" era');

  // ---- Remap IF diverge IDs ----
  console.log('[4/5] Remapping IF diverge references...');
  const remap = remapDivergeIds(arknights, allNewEvents);

  // ---- Write output ----
  console.log('[5/5] Setting mainline eras and writing output...');
  const mainlineBranch = arknights.subEntities[0].timeline.branches[0];
  mainlineBranch.eras = newEras;

  fs.writeFileSync(ARKNIGHTS_PATH, JSON.stringify(arknights, null, 2) + '\n', 'utf-8');

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  Done! ' + String(eventCounter).padStart(4) + ' events in ' + String(newEras.length) + ' eras         ║');
  console.log('║  Output: src/_data/arknights.json    ║');
  console.log('╚══════════════════════════════════════╝');
}

try { main(); } catch(e) { console.error('FATAL:', e.message); process.exit(1); }
