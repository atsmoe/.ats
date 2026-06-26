/* ═══════════════════════════════════════════════════════════
   transform-wh40k.js
   ───────────────────────────────────────────────────────────
   读取 docs/wh40k_timeline.json（英文原始抓取），把 31 个 section
   分组映射为若干 era，每个 section 的事件转为站点 schema 的英文
   草稿，输出 docs/wh40k_timeline.zh.json（翻译源）。

   设计：
   - id 从 wh-017 续号（wh-001~016 为既有手工事件，保留不动）。
   - title 取事件正文首句（截断到 12 词以内）；description 取全文。
   - dateDisplay 取事件的 date 字段（内联日期或节标题日期区间）。
   - tags 从节标题派生千年标签 + 主题词。
   - 保留英文，由模型后续分批翻译为中文。
   ═══════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const START_ID = 17; // 续号起点（wh-001~016 已存在）

// ── section → era 映射 ────────────────────────────────────────
// 将 31 个 Fandom section 归入若干宏观 era。era title 用中文（最终展示）。
// 每个 section 附中文标题（用于该事件的语义分组与后续翻译参考）。
const ERA_MAP = [
  {
    era: '远古与天堂之战',
    sections: [
      'Pre-Human History', // L2 导言
      'Birth of the Star Gods',
      'Old Ones',
      'The Necrontyr and the Wars of Secession',
      'The War in Heaven',
      'Biotransference and the Rise of the Necrons',
      'Necrons Ascendant',
      'The Tide Turns',
      'Enslaver Plague',
      "Silent King's Betrayal",
      'Great Sleep',
    ],
  },
  {
    era: '人类崛起',
    sections: [
      'Rise of Humanity', // L2 导言
      'Age of Terra and the Stellar Exodus (M1-M15)',
      'Age of Technology (M15-M25)',
      'Age of Strife ("Old Night") (M25-M30)',
    ],
  },
  {
    era: '灵族陨落',
    sections: ['Fall of the Aeldari (M25-M30)'],
  },
  {
    era: '大远征',
    sections: ['Great Crusade (ca. 798.M30-005.M31)'],
  },
  {
    era: '荷鲁斯之乱',
    sections: ['Horus Heresy (ca. 005-014.M31)'],
  },
  {
    era: '大清洗与二次建军',
    sections: [
      'Great Scouring (ca. 014-Unknown Date.M31)',
      'Second Founding (ca. 021.M31)',
    ],
  },
  {
    era: '重生与锻造时代',
    sections: [
      'Time of Rebirth (ca. M31 - ca. M32)',
      'The Forging (ca. M32 - ca. M35)',
    ],
  },
  {
    era: '新泰拉与叛教时代',
    sections: [
      'Nova Terra Interregnum (ca. Mid M34 - Late M35)',
      'Age of Apostasy (M36)',
      'Age of Redemption (ca. M37)',
    ],
  },
  {
    era: '钛族崛起与衰颓',
    sections: [
      "Emergence of the T'au Empire (M37-M41)",
      'The Waning (ca. M38 - ca. 750.M41)',
    ],
  },
  {
    era: '大觉醒',
    sections: ['Great Awakening (M41)'],
  },
  {
    era: '终结之时',
    sections: [
      'Time of Ending (ca. 744.M41 - ca. 999.M41)',
      'The Tyrannic Wars (745.M41 - 999.M41)',
    ],
  },
  {
    era: '第13次黑色十字军',
    sections: ['13th Black Crusade (995.999.M41)'],
  },
  {
    era: '不屈时代',
    sections: [
      'Age of the Imperium (M31 - Present)', // L2 导言
      'War in the Eastern Fringe (ca. 999.M41)',
      'Guilliman Awakens (ca. 999.M41)',
      'Era Indomitus (ca. 999.M41 - Present)',
    ],
  },
];

// ── 主题词标签 ───────────────────────────────────────────────
// 按 section 标题关键词派生主题标签（中文）。
function deriveTags(sectionTitle, dateDisplay) {
  const tags = [];
  const t = sectionTitle.toLowerCase();
  if (/war in heaven|necron|ctan|c'tan|necrontyr|silent king|tomb world/.test(t)) tags.push('死灵');
  if (/star gods|ctan/.test(t)) tags.push('星神');
  if (/old ones|aeldari|eldar/.test(t)) tags.push('灵族');
  if (/enslaver/.test(t)) tags.push('奴役者');
  if (/crusade|great crusade|imperium/.test(t)) tags.push('帝国');
  if (/horus heresy|primarch|traitor|loyalist/.test(t)) tags.push('荷鲁斯之乱');
  if (/chaos|warp|demon|heretic/.test(t)) tags.push('混沌');
  if (/tyrannic|tyranid|hive fleet/.test(t)) tags.push('泰伦虫族');
  if (/t'au|tau/.test(t)) tags.push('钛族');
  if (/black crusade|cadia|abaddon/.test(t)) tags.push('黑色十字军');
  if (/guilliman|indomitus|primaris/.test(t)) tags.push('不屈时代');
  if (/apostasy|goge vandire|ecclesiarchy/.test(t)) tags.push('叛教');
  // 千年标签
  const m = dateDisplay.match(/M(\d{2})/);
  if (m) tags.push('M' + m[1]);
  return tags.slice(0, 4);
}

// ── 从正文生成 title（首句，截断）────────────────────────────
function makeTitle(text) {
  // 取第一个完整句（到 . ; ! ? 或 —），限 12 词
  let first = text.split(/(?<=[.!?\u2014])\s/)[0] || text;
  const words = first.split(/\s+/);
  if (words.length > 12) first = words.slice(0, 12).join(' ') + '…';
  return first.trim();
}

// ── 主流程 ───────────────────────────────────────────────────
function main() {
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'wh40k_timeline.json'), 'utf8'));

  // section 标题 → section 对象（便于查表）
  const byTitle = new Map();
  for (const s of src.sections) byTitle.set(s.title, s);

  // 校验映射覆盖：所有 section 必须被某个 era 收纳
  const allSectionTitles = src.sections.map(s => s.title);
  const mappedTitles = ERA_MAP.flatMap(e => e.sections);
  const unmapped = allSectionTitles.filter(t => !mappedTitles.includes(t));
  const mappedMissing = mappedTitles.filter(t => !allSectionTitles.includes(t));
  if (unmapped.length) console.warn('⚠ 未归入 era 的 section:', unmapped);
  if (mappedMissing.length) console.warn('⚠ 映射中不存在的 section:', mappedMissing);

  const eras = [];
  let counter = START_ID;
  let totalEvents = 0;

  for (const eraDef of ERA_MAP) {
    const eraEvents = [];
    for (const secTitle of eraDef.sections) {
      const sec = byTitle.get(secTitle);
      if (!sec) continue;
      for (const ev of sec.events) {
        const id = 'wh-' + String(counter).padStart(3, '0');
        counter++;
        totalEvents++;
        eraEvents.push({
          id,
          dateDisplay: ev.date || secTitle,
          title: makeTitle(ev.text),
          description: ev.text,
          tags: deriveTags(secTitle, ev.date || secTitle),
          _sourceSection: secTitle, // 翻译/审校参考，最终入仓前删除
          _links: (ev.links || []).slice(0, 5), // 保留前5个 wiki 链接供查证
        });
      }
    }
    if (eraEvents.length > 0) {
      eras.push({ title: eraDef.era, events: eraEvents });
    }
  }

  const out = {
    _meta: {
      purpose: '英文翻译源草稿。id 从 wh-017 续；title/description 为英文，待分批翻译为中文后并入 src/_data/wh40k.json。',
      generatedFrom: 'docs/wh40k_timeline.json',
      generatedAt: new Date().toISOString(),
      startId: 'wh-' + String(START_ID).padStart(3, '0'),
      endId: 'wh-' + String(counter - 1).padStart(3, '0'),
      totalEvents,
    },
    eras,
  };

  const outPath = path.join(__dirname, '..', 'docs', 'wh40k_timeline.zh.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('✓ Wrote ' + outPath);
  console.log('  eras:', out.eras.length, '| events:', totalEvents,
    '| id range:', out._meta.startId, '→', out._meta.endId,
    '| size:', (fs.statSync(outPath).size / 1024).toFixed(1), 'KB');
  console.log('  --- per era ---');
  out.eras.forEach(e => console.log('    [' + String(e.events.length).padStart(3) + '] ' + e.title));
  if (unmapped.length || mappedMissing.length) {
    console.log('  ⚠ 映射覆盖问题，见上方警告');
  }
}

main();
