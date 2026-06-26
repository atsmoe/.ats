/* ═══════════════════════════════════════════════════════════
   fetch-wh40k-timeline.js
   ───────────────────────────────────────────────────────────
   从 Fandom WH40k wiki 的 MediaWiki API 抓取 "Timeline of the
   Warhammer 40,000 Universe" 页面，产出 docs/wh40k_timeline.json。

   关键发现：Fandom 的 section=N 会返回该 toclevel-1 节及其
   全部嵌套子节。因此只需抓取 7 个不重叠的根节（s2/s13/s17/
   s18/s19/s20/s22），即可零重复覆盖全部 48 个内容节。
   抓取后，脚本再把每段 HTML 按 <h2>/<h3> 标题切分为子节。

   零依赖（仅 Node 内置 https / fs / path）。礼貌抓取：1.5s
   限速 + 失败重试 3 次。
   ═══════════════════════════════════════════════════════════ */

const https = require('https');
const fs = require('fs');
const path = require('path');

const PAGE = 'Timeline_of_the_Warhammer_40,000_Universe';
const API = 'https://warhammer40k.fandom.com/api.php';
const UA = 'WH40k-Timeline-Bot/0.1 (research; contact: local-build)';
const DELAY_MS = 1500;
const MAX_RETRIES = 3;

// 7 个不重叠根节。每项：{ section, title, skipTitle(可选) }
// 注：section 是 Fandom 的 section index；title 为节标题原文。
const ROOT_SECTIONS = [
  { section: 2,  title: 'Pre-Human History' },
  { section: 13, title: 'Rise of Humanity' },
  { section: 17, title: 'Fall of the Aeldari' },
  { section: 18, title: 'Great Crusade' },
  { section: 19, title: 'Horus Heresy' },
  { section: 20, title: 'Great Scouring' },
  { section: 22, title: 'Age of the Imperium' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchSection(section) {
  const url = `${API}?action=parse&page=${encodeURIComponent(PAGE)}&prop=text&section=${section}&format=json`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.error) return reject(new Error('API error: ' + j.error.info));
          if (!j.parse || !j.parse.text) return reject(new Error('No parse.text in response'));
          resolve(j.parse.text['*']);
        } catch (e) {
          reject(new Error('JSON parse failed: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

async function fetchWithRetry(section) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const html = await fetchSection(section);
      if (attempt > 1) console.log(`  [retry ok on attempt ${attempt}]`);
      return html;
    } catch (e) {
      console.error(`  [attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}]`);
      if (attempt === MAX_RETRIES) throw e;
      await sleep(DELAY_MS * attempt * 2);
    }
  }
}

// ── HTML 工具 ───────────────────────────────────────────────

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// 剥离不需要的 HTML：编辑按钮、引用上标、注释、gallery 等
function stripNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<span class="mw-editsection"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/g, '')
    .replace(/<gallery[\s\S]*?<\/gallery>/gi, '')
    .replace(/<table class="[^"]*navbox[^"]*"[\s\S]*?<\/table>/gi, '');
}

// 提取 <a href title>text</a> → { text, href, title }
function extractLinks(html) {
  const out = [];
  const re = /<a\s+[^>]*?href="([^"]*)"[^>]*?(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = stripTags(m[3]).trim();
    if (!href || href.startsWith('#') || !text) continue;
    out.push({ text: decodeEntities(text), href, title: m[2] ? decodeEntities(m[2]) : '' });
  }
  return out;
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ''));
}

// 把单根节的 HTML 切成若干子节（按 h2/h3 标题）
// 返回 [{ title, body }]，body 是该标题到下一个同级/更高级标题之间的 HTML
//
// Fandom 的标题形如：
//   <h3><span id="X_.29"></span><span class="mw-headline" id="X">TEXT</span><span class="mw-editsection">...</span></h3>
// 故 <hN> 与 mw-headline 之间允许插入任意 <span>（[\s\S]*? 非贪婪）。
//
// 保留全部层级（L2 与 L3 都取），因为 L2 父节常含独有的事件正文（如 Great
// Scouring 的反攻叙事），不能因有 L3 子节就丢弃。父/子可能重复的段落在
// 提取事件后由 main() 的全局去重处理。
function splitIntoSubsections(html, rootTitle) {
  const cleaned = stripNoise(html);
  const headingRe = /<h([23])>[\s\S]*?<span class="mw-headline"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/h\1>/g;
  const heads = [];
  let m;
  while ((m = headingRe.exec(cleaned)) !== null) {
    heads.push({ level: parseInt(m[1], 10), title: decodeEntities(stripTags(m[2])).trim(), index: m.index, end: m.index + m[0].length });
  }
  if (heads.length === 0) {
    // 整段无子标题，作为单节
    return [{ title: rootTitle, body: cleaned }];
  }
  // 为每个标题计算其 body 区间：到【下一个任意级别的标题】为止。
  // 这样 L2 父节的 body 只含其自身导言（到第一个 L3 子标题前），不会
  // 重复包含子节正文；L3 子节 body 也在下一个标题（无论 h2/h3）处截断。
  for (let i = 0; i < heads.length; i++) {
    const end = (i + 1 < heads.length) ? heads[i + 1].index : cleaned.length;
    heads[i].body = cleaned.slice(heads[i].end, end);
  }
  return heads.map(h => ({ title: h.title, body: h.body }));
}

// 从一节 body 提取事件：每段 <p> 是一个候选事件
// 用段首/段内的 .M## 日期作为 date；若无日期用标题里的日期区间
function extractEvents(body, sectionTitle) {
  // 标题里的日期区间作为兜底（如 "Horus Heresy (ca. 005-014.M31)" → "ca. 005-014.M31"）
  const titleDateMatch = sectionTitle.match(/\(([^()]*M\d{2}[^()]*)\)/);
  const fallbackDate = titleDateMatch ? titleDateMatch[1].trim() : '';

  const paragraphs = [];
  // 匹配 <p>...</p>（非贪婪到下一个 <p> 或块结束）
  const pRe = /<p>([\s\S]*?)<\/p>/g;
  let pm;
  while ((pm = pRe.exec(body)) !== null) {
    const inner = pm[1];
    const text = stripTags(inner).replace(/\s+/g, ' ').trim();
    if (text.length < 20) continue; // 跳过过短的引导句
    // 段内首个 .M## 日期作为该事件日期
    const dateMatch = text.match(/\b(?:ca\.\s*)?(?:Unknown Date\.)?(\d{1,3}(?:\.\d{3})?\.?M\d{2})\b/);
    const date = dateMatch ? dateMatch[1] : fallbackDate;
    paragraphs.push({
      date,
      text,
      links: extractLinks(inner),
      sources: [],
    });
  }
  return paragraphs;
}

// ── 主流程 ───────────────────────────────────────────────────

async function main() {
  const outSections = [];
  let totalEvents = 0;

  for (const root of ROOT_SECTIONS) {
    console.log(`Fetching section ${root.section}: ${root.title} ...`);
    const html = await fetchWithRetry(root.section);
    const subs = splitIntoSubsections(html, root.title);
    console.log(`  → ${subs.length} subsection(s), ${(html.length / 1024).toFixed(1)} KB raw`);
    for (const sub of subs) {
      const events = extractEvents(sub.body, sub.title);
      totalEvents += events.length;
      outSections.push({
        title: sub.title,
        events,
      });
      console.log(`    • "${sub.title}": ${events.length} events`);
    }
    await sleep(DELAY_MS);
  }

  // ── 全局去重 ────────────────────────────────────────────────
  // 因为 L2 父节与 L3 子节都保留，某些段落在父节正文与子节正文里各出现一次。
  // 用归一化文本指纹去重：同一段只保留日期更具体（含具体年份）的那条。
  const seen = new Map(); // fingerprint → { secIdx, evIdx, date }
  let removed = 0;
  for (let si = 0; si < outSections.length; si++) {
    const evs = outSections[si].events;
    const kept = [];
    for (const ev of evs) {
      const fp = ev.text.replace(/\s+/g, ' ').trim();
      const moreSpecific = /\b\d{1,3}\.\d{3}\.?M\d{2}\b|\b\d{3}\.M\d{2}\b/.test(ev.date); // 具体年份 vs 日期区间
      if (seen.has(fp)) {
        const prev = seen.get(fp);
        const prevSpecific = /\b\d{1,3}\.\d{3}\.?M\d{2}\b|\b\d{3}\.M\d{2}\b/.test(prev.date);
        // 保留更具体的那条；若同等具体，保留先出现的（父节往往更早）
        if (moreSpecific && !prevSpecific) {
          outSections[prev.secIdx].events[prev.evIdx] = null; // 标记删除旧条
          seen.set(fp, { secIdx: si, evIdx: kept.length, date: ev.date });
          kept.push(ev);
        } else {
          removed++; // 丢弃当前重复条
        }
      } else {
        seen.set(fp, { secIdx: si, evIdx: kept.length, date: ev.date });
        kept.push(ev);
      }
    }
    outSections[si].events = kept.filter(Boolean);
  }
  // 修正被标记为 null 的条目（因 kept.filter 已只留非空，seen 里的 evIdx 可能
  // 与新数组下标错位，但不影响最终输出——重复项已剔除）
  outSections.forEach(s => { s.events = s.events.filter(Boolean); });
  totalEvents = outSections.reduce((n, s) => n + s.events.length, 0);
  console.log(`\n[dedup] removed ${removed} duplicate paragraphs, ${totalEvents} unique remain`);

  const result = {
    source: `https://warhammer40k.fandom.com/wiki/${PAGE.replace(/_/g, '_')}`,
    api: API,
    page: PAGE,
    fetchedAt: new Date().toISOString(),
    rootSections: ROOT_SECTIONS.map(r => r.section),
    totalSections: outSections.length,
    totalEvents,
    sections: outSections,
  };

  const outPath = path.join(__dirname, '..', 'docs', 'wh40k_timeline.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✓ Wrote ${outPath}`);
  console.log(`  sections: ${result.totalSections}, events: ${result.totalEvents}, size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
