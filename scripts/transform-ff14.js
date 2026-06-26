/* ═══════════════════════════════════════════════════════════
   transform-ff14.js
   ───────────────────────────────────────────────────────────
   读取 FFXIV背景知识/历史/ 下的源 TXT 文件，转换为站点 schema
   的 ff14.json。Step 1+2：主线(mainline) + 碎片世界(shard-1/shard-13)
   + 秘话合集(anecdotes) + 设定百科(lore)。

   解析器：
   1. 年表解析器 — 第六星历年表，正则提取逐年条目
   2. 章节解析器 — 版本剧情(###) + 第七灵灾(##)，每章=1事件
   3. 百科解析器 — 灵灾/星历(##) + 史前文明(##/###)，每节=1事件
   4. shard解析器 — 诺弗兰特百年史(##)，每章=1事件
   5. 秘话解析器 — 光之回忆录61篇，每文件=1事件，按版本分组
   6. 设定解析器 — 概念设定23篇 + 历史背影4篇，每文件=1事件

   设计：
   - id 从 ff14-001 起续编，shard 用 ff14-s1-001 / ff14-s13-001
   - 无顶层冗余 eras（按 wh40k 先例删除）
   - 保留 crossRef 语义：ff14-s1-001 / ff14-s13-001
   ═══════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'FFXIV背景知识', 'FFXIV背景知识', '历史');
const OUT = path.resolve(__dirname, '..', 'src', '_data', 'ff14.json');

// ── 工具函数 ──────────────────────────────────────────────────

function readTxt(relPath) {
  const full = path.join(SRC_ROOT, relPath);
  return fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// 清理文本：移除图片标记、表格标记、目录行、多余空白
function cleanText(text) {
  return text
    .replace(/\[图片[：:][^\]]*\]/g, '')
    .replace(/\[图片\]/g, '')
    .replace(/\[表格\]/g, '')
    .replace(/^目录[\d.]+.*$/gm, '')
    .replace(/^={3,}.*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 截取描述的前 N 个字符作为 title 候选
function makeTitle(text, maxLen = 22) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  // 尝试在标点处截断
  const cut = clean.substring(0, maxLen);
  const punct = cut.search(/[。，；！？、·…]/);
  if (punct > 8) return cut.substring(0, punct);
  return cut + '…';
}

// 提取章节正文（标题行之后到下一个同级或更高级标题之前）
function splitByHeading(text, level) {
  const prefix = '#'.repeat(level);
  const nextPrefix = '#'.repeat(level); // 同级即可截断
  const lines = text.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(new RegExp(`^(${prefix}+)\\s+(.+)`));
    if (m) {
      // 只匹配恰好 level 级的标题（不匹配更高级）
      if (m[1].length === level) {
        if (current) sections.push(current);
        current = { title: m[2].trim(), body: [] };
        continue;
      }
    }
    if (current) current.body.push(line);
  }
  if (current) sections.push(current);

  return sections.map(s => {
    const rawBody = s.body.join('\n');
    const imgCount = (rawBody.match(/\[图片[^\]]*\]/g) || []).length;
    return {
      title: s.title,
      body: cleanText(rawBody),
      imgCount,
    };
  }).filter(s => s.body.length > 20); // 过滤掉太短的（如"参考资料"）
}

// 读取源文件对应的 _图片 文件夹中的图片文件列表（按文件名排序）
const imgDirCache = {};
function getImages(relPath) {
  if (imgDirCache[relPath]) return imgDirCache[relPath];
  // 源文件路径 → 对应的 _图片 文件夹路径
  // 例: "第七星历\苍穹之禁城\苍穹之禁城.txt" → "第七星历\苍穹之禁城\苍穹之禁城_图片"
  const dir = path.dirname(relPath);
  const baseName = path.basename(relPath, '.txt');
  const imgDirName = `${baseName}_图片`;
  const imgDir = path.join(SRC_ROOT, dir, imgDirName);
  let imgs = [];
  if (fs.existsSync(imgDir)) {
    imgs = fs.readdirSync(imgDir)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .sort()
      .map(f => `./assets/images/ff14/${f}`);
  }
  imgDirCache[relPath] = imgs;
  return imgs;
}

// 从图片列表中按索引取 N 张图片，返回 { images, consumed } 
function takeImages(imgList, startIdx, count) {
  const images = [];
  for (let i = 0; i < count && startIdx + i < imgList.length; i++) {
    images.push({ src: imgList[startIdx + i], alt: '' });
  }
  return images;
}

// ── ID 计数器 ─────────────────────────────────────────────────
let mainCounter = 0;
let shard1Counter = 0;

function nextId() { mainCounter++; return `ff14-${String(mainCounter).padStart(3, '0')}`; }
function nextShard1Id() { shard1Counter++; return `ff14-s1-${String(shard1Counter).padStart(3, '0')}`; }

// ── 1. 年表解析器：第六星历年表 ────────────────────────────────
function parseChronicle() {
  const raw = readTxt('第六星历\\第六星历年表\\第六星历年表.txt');
  const events = [];

  // 年表正文在 [表格] 之后，## 参考资料 之前
  let body = raw;
  const tableIdx = body.indexOf('[表格]');
  if (tableIdx >= 0) body = body.substring(tableIdx + 4);
  const refIdx = body.indexOf('## 参考资料');
  if (refIdx >= 0) body = body.substring(0, refIdx);

  body = body.replace(/\r?\n/g, '');

  // 移除 "纪年国家主要事件" 分隔标记（出现多次）
  body = body.replace(/纪年国家主要事件/g, '\n');

  // 正则匹配年份开头的事件条目
  // 格式："元年..." / "10年前后..." / "201年..." / "350年前后..." / "1565年..."
  const yearRegex = /(?:^|(?<=。))((?:元年|\d+年(?:前后)?))([^年])/g;
  // 更稳健：用 split 方式
  const pieces = body.split(/(?=(?:元年|\d+年(?:前后)?))/);

  for (const piece of pieces) {
    const m = piece.match(/^(元年|\d+年(?:前后)?)(.*)$/);
    if (!m) continue;
    const yearStr = m[1];
    let content = m[2].trim();
    if (content.length < 5) continue;

    // 生成 dateDisplay
    const dateDisplay = yearStr === '元年' ? '第六星历元年' : `第六星历${yearStr}`;

    // title：取内容的前 22 字
    const title = makeTitle(content, 22);
    const description = cleanText(content);

    if (description.length < 10) continue;

    events.push({
      id: nextId(),
      dateDisplay,
      title,
      description,
      tags: ['第六星历'],
    });
  }

  return events;
}

// ── 2. 章节解析器：版本剧情(###) + 第七灵灾(##) ───────────────
function parsePatchStory(relPath, level, dateDisplay, tags) {
  const raw = readTxt(relPath);
  const sections = splitByHeading(raw, level);
  const imgList = getImages(relPath);
  let imgIdx = 0;
  const events = [];

  for (const s of sections) {
    // 跳过"参考资料""相关阅读""画廊""目录"等非正文
    if (/参考资料|相关阅读|画廊|目录|随身见闻录/.test(s.title)) continue;

    const images = takeImages(imgList, imgIdx, s.imgCount);
    imgIdx += s.imgCount;

    const evt = {
      id: nextId(),
      dateDisplay,
      title: s.title,
      description: s.body,
      tags: [...tags],
    };
    if (images.length > 0) evt.images = images;
    events.push(evt);
  }

  return events;
}

// ── 3. 百科解析器：灵灾/星历/史前文明 ─────────────────────────
function parseEncyclopedia(relPath, level, dateDisplay, tags) {
  const raw = readTxt(relPath);
  const sections = splitByHeading(raw, level);
  const imgList = getImages(relPath);
  let imgIdx = 0;
  const events = [];

  for (const s of sections) {
    if (/参考资料|相关阅读|画廊|目录|随身见闻录/.test(s.title)) continue;

    const images = takeImages(imgList, imgIdx, s.imgCount);
    imgIdx += s.imgCount;

    const evt = {
      id: nextId(),
      dateDisplay,
      title: s.title,
      description: s.body,
      tags: [...tags],
    };
    if (images.length > 0) evt.images = images;
    events.push(evt);
  }

  // 如果没有任何章节标题，用整篇作为 1 个事件
  if (events.length === 0) {
    const clean = cleanText(raw.split('## 参考资料')[0] || raw);
    if (clean.length > 30) {
      // 从文件名取标题
      const fname = path.basename(relPath, '.txt');
      const allImgs = imgList.map(src => ({ src, alt: '' }));
      const evt = {
        id: nextId(),
        dateDisplay,
        title: fname,
        description: clean,
        tags: [...tags],
      };
      if (allImgs.length > 0) evt.images = allImgs;
      events.push(evt);
    }
  }

  return events;
}

// ── 4. shard 解析器：诺弗兰特百年史 ───────────────────────────
function parseShard1() {
  const raw = readTxt('第一世界的历史\\诺弗兰特百年史\\诺弗兰特百年史.txt');
  const sections = splitByHeading(raw, 2); // ## 级标题
  const endings = [];

  for (const s of sections) {
    if (/参考资料|相关阅读|画廊|目录|随身见闻录/.test(s.title)) continue;

    endings.push({
      endingNumber: endings.length + 1,
      title: s.title,
      description: s.body,
      location: '第一世界·诺弗兰特',
      characters: [],
      conditions: '诺弗兰特百年史',
    });
  }

  // 如果没有 ## 标题，用"光之战士的故事" + "诺弗兰特的历史" 补充
  if (endings.length === 0) {
    for (const extra of ['"光之战士"的故事\\"光之战士"的故事.txt', '诺弗兰特的历史\\诺弗兰特的历史.txt']) {
      try {
        const er = readTxt('第一世界的历史\\' + extra);
        const ec = cleanText(er.split('## 参考资料')[0] || er);
        if (ec.length > 30) {
          endings.push({
            endingNumber: endings.length + 1,
            title: path.basename(extra, '.txt'),
            description: ec,
            location: '第一世界·诺弗兰特',
            characters: [],
            conditions: '第一世界历史',
          });
        }
      } catch (e) { /* skip */ }
    }
  }

  return endings;
}

// ── 5. 秘话解析器：光之回忆录（秘话系列）─────────────────────
// 每个文件 = 1 篇秘话，按版本分组为 eras

const ANECDOTE_GROUPS = [
  { era: '第七灵灾回忆录', date: '第七灵灾', tags: ['秘话', '第七灵灾'],
    files: ['荣耀的胜利号', '女王陛下与七个拉拉菲尔', '逝者为友，来者亦友', '她的十五年', '两次起航'] },
  { era: '苍穹秘话', date: '第七星历·苍穹之禁城', tags: ['秘话', '苍穹之禁城'],
    files: ['友人与巨龙', '冰雪女神', '银剑奥尔什方', '女王陛下的二次宣誓', '最后的苍穹骑士', '花语', '走过荒野的少女', '旅途之始'] },
  { era: '红莲秘话', date: '第七星历·红莲之狂潮', tags: ['秘话', '红莲之狂潮'],
    files: ['红衣友人', '某个午后的茶话会', '小小赌局的胜利者', '枕月而眠之前', '一夜昙华', '舍弃苍天的龙骑士', '罪人的战斗', '少年们的魔导展'] },
  { era: '光之回忆录I', date: '第七星历·暗影之逆焰', tags: ['秘话', '暗影之逆焰'],
    files: ['直至血染双手', '狩猎的开始', '黄金港游戏', '思慕', '最后的归宿'] },
  { era: '暗影秘话', date: '第七星历·暗影之逆焰', tags: ['秘话', '暗影之逆焰'],
    files: ['心愿倾注其名', '黑历史的欺瞒', '第八灵灾叙事录', '不存于记忆的短篇', '荣光的落日', '云村的午睡', '献上最后一幕', '为新序幕讴歌'] },
  { era: '黎明秘话', date: '第七星历·黎明之途', tags: ['秘话', '黎明之途'],
    files: ['知晓其伤之人', '梅尔维布之罪', '花散落霞之中', '敞开真挚之心', '皇者离席之座'] },
  { era: '晓月秘话', date: '第七星历·晓月之终途', tags: ['秘话', '晓月之终途'],
    files: ['某些朋友的记录', '始于无路', '所谓活着', '所谓死去', '生命终将循环'] },
  { era: '朔月秘话', date: '第七星历·晓月之终途', tags: ['秘话', '晓月之终途'],
    files: ['苍天在梦中消融', '苍天之蓝已然褪色', '影之记录', '闪亮的邂逅', '朔月的约定', '来自深渊的呼唤', '某位旅行者的足迹', '虚心的憧憬', '在某次狩猎大会上'] },
  { era: '光之回忆录II', date: '第七星历·晓月之终途', tags: ['秘话', '晓月之终途'],
    files: ['往昔追忆，由此开始', '最强爱情', '私人记录：严禁阅览', '爷爷的赠礼'] },
  { era: '金曦秘话', date: '第七星历·黄金港', tags: ['秘话', '黄金港'],
    files: ['云间寻星', '派对永不落幕', '无声的誓言', '与群星的约定'] },
];

let anecdoteCounter = 0;
function nextAnecdoteId() { anecdoteCounter++; return `ff14-a-${String(anecdoteCounter).padStart(3, '0')}`; }

function parseAnecdotes() {
  const eras = [];
  for (const group of ANECDOTE_GROUPS) {
    const events = [];
    for (const fname of group.files) {
      try {
        const relPath = `光之回忆录（秘话系列）\\${fname}\\${fname}.txt`;
        const raw = readTxt(relPath);
        // 去掉头部 === 分隔线和标题，去掉尾部 ## 参考资料
        let body = raw;
        const refIdx = body.indexOf('## 参考资料');
        if (refIdx >= 0) body = body.substring(0, refIdx);
        body = cleanText(body);
        if (body.length < 30) continue;

        const imgList = getImages(relPath);
        const allImgs = imgList.map(src => ({ src, alt: '' }));

        const evt = {
          id: nextAnecdoteId(),
          dateDisplay: group.date,
          title: fname,
          description: body,
          tags: [...group.tags],
        };
        if (allImgs.length > 0) evt.images = allImgs;
        events.push(evt);
      } catch (e) {
        console.warn(`  [warn] 秘话文件未找到: ${fname}`);
      }
    }
    if (events.length > 0) {
      eras.push({ title: group.era, events });
    }
  }
  return eras;
}

// ── 6. 设定解析器：概念设定 + 历史背影 ────────────────────────
// 重生之境/ 23 篇概念设定 + 历史背影/ 4 篇 = 27 篇，每篇 = 1 事件

let loreCounter = 0;
function nextLoreId() { loreCounter++; return `ff14-l-${String(loreCounter).padStart(3, '0')}`; }

function parseLore() {
  const conceptEra = { title: '概念设定', events: [] };
  const historyEra = { title: '历史背影', events: [] };

  // 概念设定：重生之境/ 下的 23 个子目录
  const conceptDir = path.join(SRC_ROOT, '重生之境');
  const conceptNames = [];
  if (fs.existsSync(conceptDir)) {
    for (const entry of fs.readdirSync(conceptDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const txtPath = path.join(conceptDir, entry.name, `${entry.name}.txt`);
        if (fs.existsSync(txtPath)) conceptNames.push(entry.name);
      }
    }
  }

  for (const name of conceptNames) {
    try {
      const relPath = `重生之境\\${name}\\${name}.txt`;
      const raw = readTxt(relPath);
      let body = raw;
      const refIdx = body.indexOf('## 参考资料');
      if (refIdx >= 0) body = body.substring(0, refIdx);
      body = cleanText(body);
      if (body.length < 30) continue;

      const imgList = getImages(relPath);
      const allImgs = imgList.map(src => ({ src, alt: '' }));

      const evt = {
        id: nextLoreId(),
        dateDisplay: '设定·百科',
        title: name,
        description: body,
        tags: ['设定', '百科'],
      };
      if (allImgs.length > 0) evt.images = allImgs;
      conceptEra.events.push(evt);
    } catch (e) {
      console.warn(`  [warn] 设定文件未找到: ${name}`);
    }
  }

  // 历史背影：4 篇
  const historyFiles = [
    '加雷马帝国东洲远征记',
    '角笛之争',
    '历史人物传：萨萨莫·乌尔·萨莫',
    '欧米茄报告',
  ];

  for (const name of historyFiles) {
    try {
      const relPath = `历史背影\\${name}\\${name}.txt`;
      const raw = readTxt(relPath);
      let body = raw;
      const refIdx = body.indexOf('## 参考资料');
      if (refIdx >= 0) body = body.substring(0, refIdx);
      body = cleanText(body);
      if (body.length < 30) continue;

      const imgList = getImages(relPath);
      const allImgs = imgList.map(src => ({ src, alt: '' }));

      const evt = {
        id: nextLoreId(),
        dateDisplay: '历史·背影',
        title: name,
        description: body,
        tags: ['历史背影'],
      };
      if (allImgs.length > 0) evt.images = allImgs;
      historyEra.events.push(evt);
    } catch (e) {
      console.warn(`  [warn] 历史背影文件未找到: ${name}`);
    }
  }

  const eras = [];
  if (conceptEra.events.length > 0) eras.push(conceptEra);
  if (historyEra.events.length > 0) eras.push(historyEra);
  return eras;
}

// ── 主流程 ────────────────────────────────────────────────────
function build() {
  const eras = [];

  // === 时代 1: 万古前·古代世界 ===
  {
    const events = [];
    // 史前文明：古代世界与史前文明 (## 级)
    events.push(...parseEncyclopedia('史前文明\\古代世界与史前文明\\古代世界与史前文明.txt', 2, '万古前', ['起源', '古代人']));
    // 重生之境/古代人 (### 级)
    events.push(...parseEncyclopedia('重生之境\\古代人\\古代人.txt', 3, '万古前', ['古代人', '创造魔法']));
    // 重生之境/无影 (### 级)
    events.push(...parseEncyclopedia('重生之境\\无影\\无影.txt', 3, '万古前', ['无影', '佐迪亚克']));
    // 末日的真相 (## 级)
    events.push(...parseEncyclopedia('史前文明\\末日的真相\\末日的真相.txt', 2, '万古前', ['终末', '梅蒂恩']));

    if (events.length > 0) {
      // 第一条加 crossRef 指向 shard
      events[0].crossRefs = [
        { worldId: 'ff14', eventId: 'ff14-s1-001', label: '→ 第一世界·光之泛滥' },
        { worldId: 'ff14', eventId: 'ff14-s13-001', label: '→ 第十三世界·暗之泛滥' },
      ];
      events[0].isKeyEvent = true;
    }
    eras.push({ title: '万古前·古代世界', events });
  }

  // === 时代 2: 第一灵灾·第一星历 ===
  {
    const events = [];
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第一灵灾\\第一灵灾.txt', 2, '第一灵灾', ['灵灾', '风']));
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第一星历\\第一星历.txt', 2, '第一星历', ['第一星历', '石器']));
    eras.push({ title: '第一灵灾·第一星历', events });
  }

  // === 时代 3: 第二灵灾·第二星历 ===
  {
    const events = [];
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第二灵灾\\第二灵灾.txt', 2, '第二灵灾', ['灵灾', '雷']));
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第二星历\\第二星历.txt', 2, '第二星历', ['第二星历', '宗教']));
    eras.push({ title: '第二灵灾·第二星历', events });
  }

  // === 时代 4: 第三灵灾·第三星历 ===
  {
    const events = [];
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第三灵灾\\第三灵灾.txt', 2, '第三灵灾', ['灵灾', '火']));
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第三星历\\第三星历.txt', 2, '第三星历', ['第三星历']));
    eras.push({ title: '第三灵灾·第三星历', events });
  }

  // === 时代 5: 第四灵灾·第四星历 ===
  {
    const events = [];
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第四灵灾\\第四灵灾.txt', 2, '第四灵灾', ['灵灾', '土']));
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第四星历\\第四星历.txt', 2, '第四星历', ['第四星历']));
    eras.push({ title: '第四灵灾·第四星历', events });
  }

  // === 时代 6: 第五灵灾·第五星历 ===
  {
    const events = [];
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第五灵灾\\第五灵灾.txt', 2, '第五灵灾', ['灵灾', '冰']));
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第五星历\\第五星历.txt', 2, '第五星历', ['第五星历', '魔法文明']));
    eras.push({ title: '第五灵灾·第五星历', events });
  }

  // === 时代 7: 第六灵灾 ===
  {
    const events = [];
    events.push(...parseEncyclopedia('第一灵灾 ~ 第六灵灾\\第六灵灾\\第六灵灾.txt', 2, '第六灵灾', ['灵灾', '水']));
    eras.push({ title: '第六灵灾', events });
  }

  // === 时代 8: 第六星历（年表逐年）===
  {
    const events = parseChronicle();
    eras.push({ title: '第六星历·编年', events });
  }

  // === 时代 9: 第七灵灾 ===
  {
    const events = parsePatchStory('第七灵灾\\第七灵灾\\第七灵灾.txt', 2, '第七灵灾', ['第七灵灾', '巴哈姆特']);
    // 标记关键事件
    for (const e of events) {
      if (/加尔提诺|巴哈姆特/.test(e.title)) e.isKeyEvent = true;
    }
    eras.push({ title: '第七灵灾', events });
  }

  // === 时代 10-16: 第七星历各版本 ===
  // 版本顺序与 patch 映射
  const patches = [
    { rel: '第七星历\\重生之境\\重生之境.txt', level: 3, date: '第七星历·2.0 重生之境', tags: ['重生之境', '2.0'], era: '第七星历·重生之境(2.0)' },
    { rel: '第七星历\\觉醒之境\\觉醒之境.txt', level: 3, date: '第七星历·2.1 觉醒之境', tags: ['觉醒之境', '2.1'] },
    { rel: '第七星历\\混沌的漩涡\\混沌的漩涡.txt', level: 3, date: '第七星历·2.2 混沌的漩涡', tags: ['混沌的漩涡', '2.2'] },
    { rel: '第七星历\\艾欧泽亚的守护者\\艾欧泽亚的守护者.txt', level: 3, date: '第七星历·2.3 艾欧泽亚的守护者', tags: ['艾欧泽亚的守护者', '2.3'] },
    { rel: '第七星历\\寒冰的幻想\\寒冰的幻想.txt', level: 3, date: '第七星历·2.4 寒冰的幻想', tags: ['寒冰的幻想', '2.4'] },
    { rel: '第七星历\\希望的灯火\\希望的灯火.txt', level: 3, date: '第七星历·2.5 希望的灯火', tags: ['希望的灯火', '2.5'] },
  ];

  // 2.x 时代
  {
    const events = [];
    for (const p of patches) {
      events.push(...parsePatchStory(p.rel, p.level, p.date, p.tags));
    }
    eras.push({ title: '第七星历·重生之境(2.0~2.5)', events });
  }

  // 3.x 时代
  {
    const events = [];
    events.push(...parsePatchStory('第七星历\\苍穹之禁城\\苍穹之禁城.txt', 3, '第七星历·3.0 苍穹之禁城', ['苍穹之禁城', '3.0', '龙诗战争']));
    events.push(...parsePatchStory('第七星历\\光与暗的分界\\光与暗的分界.txt', 3, '第七星历·3.1 光与暗的分界', ['光与暗的分界', '3.1']));
    events.push(...parsePatchStory('第七星历\\命运的齿轮\\命运的齿轮.txt', 3, '第七星历·3.2 命运的齿轮', ['命运的齿轮', '3.2']));
    events.push(...parsePatchStory('第七星历\\绝命怒嚎\\绝命怒嚎.txt', 3, '第七星历·3.3 绝命怒嚎', ['绝命怒嚎', '3.3']));
    events.push(...parsePatchStory('第七星历\\灵魂继承者\\灵魂继承者.txt', 3, '第七星历·3.4 灵魂继承者', ['灵魂继承者', '3.4']));
    events.push(...parsePatchStory('第七星历\\命运的止境\\命运的止境.txt', 3, '第七星历·3.5 命运的止境', ['命运的止境', '3.5']));
    // 标记龙诗战争终结
    for (const e of events) {
      if (/龙诗.*终结|圆桌骑士/.test(e.title)) e.isKeyEvent = true;
    }
    eras.push({ title: '第七星历·苍穹之禁城(3.0~3.5)', events });
  }

  // 4.x 时代
  {
    const events = [];
    events.push(...parsePatchStory('第七星历\\红莲之狂潮\\红莲之狂潮.txt', 3, '第七星历·4.0 红莲之狂潮', ['红莲之狂潮', '4.0', '解放战争']));
    events.push(...parsePatchStory('第七星历\\英雄归来\\英雄归来.txt', 3, '第七星历·4.1 英雄归来', ['英雄归来', '4.1']));
    events.push(...parsePatchStory('第七星历\\曙光微明\\曙光微明.txt', 3, '第七星历·4.2 曙光微明', ['曙光微明', '4.2']));
    events.push(...parsePatchStory('第七星历\\月下芳华\\月下芳华.txt', 3, '第七星历·4.3 月下芳华', ['月下芳华', '4.3']));
    for (const e of events) {
      if (/自由或是死亡|红莲之狂潮$/.test(e.title)) e.isKeyEvent = true;
    }
    eras.push({ title: '第七星历·红莲之狂潮(4.0~4.3)', events });
  }

  // 5.0 暗影之逆焰（源缺版本剧情，用设定文章重构）
  {
    const events = [];
    events.push(...parseEncyclopedia('重生之境\\光之泛滥\\光之泛滥.txt', 2, '第七星历·5.0 暗影之逆焰', ['暗影之逆焰', '5.0', '光之泛滥']));
    // 加 crossRef
    for (const e of events) {
      if (/光之泛滥|伊甸/.test(e.title)) {
        e.crossRefs = [{ worldId: 'ff14', eventId: 'ff14-s1-001', label: '→ 第一世界·光之泛滥始末' }];
        e.isKeyEvent = true;
      }
    }
    eras.push({ title: '第七星历·暗影之逆焰(5.0)', events });
  }

  // 6.0 晓月之终途（末日的真相已在万古前收录，这里补充概念）
  {
    const events = [];
    events.push(...parseEncyclopedia('重生之境\\灵灾\\灵灾.txt', 3, '第七星历·6.0 晓月之终途', ['晓月之终途', '6.0', '终末']));
    // 用"虚无界"补充终末后设定
    events.push(...parseEncyclopedia('重生之境\\虚无界\\虚无界.txt', 3, '第七星历·6.0 晓月之终途', ['晓月之终途', '6.0', '虚无界']));
    for (const e of events) {
      if (/终末|末日|暗之泛滥/.test(e.title)) e.isKeyEvent = true;
    }
    eras.push({ title: '第七星历·晓月之终途(6.0)', events });
  }

  // === 构建 mainline branch ===
  const mainline = {
    id: 'mainline',
    name: '原初世界·主线',
    isDefault: true,
    eras,
  };

  // === 构建 shards branch ===
  const shard1Endings = parseShard1();
  const shards = {
    id: 'shards',
    name: '碎片世界',
    type: 'shard-group',
    description: '终末之战分裂出十三个反射碎片，每一个都走出了不同的命运。此分组收录设有独立编年史的碎片世界。',
    subBranches: [
      {
        id: 'shard-1',
        name: '第一世界·诺弗兰特',
        description: '被光之泛滥吞噬的第一碎片——永恒的白昼之下，一切生命都在光的侵蚀中缓慢崩解。',
        endings: shard1Endings,
      },
      {
        id: 'shard-13',
        name: '第十三世界·虚空',
        description: '暗之泛滥吞噬了第十三碎片，使其沦为虚无——一个只有暗影生物游荡的废世界。',
        endings: [
          {
            endingNumber: 1,
            title: '暗之泛滥',
            description: '第十三世界的暗之灾将一切物质与光吞噬殆尽。生者被转化为虚无的暗影生物，世界本身坍缩为虚空的领域。据传，零号是唯一保留了自我的第十三世界居民。',
            location: '第十三世界·虚空',
            characters: ['零号', '暗影使者'],
            conditions: '第十三世界的暗与光完全失衡',
          },
        ],
      },
    ],
  };

  // === 构建 anecdotes branch（Step 2）===
  const anecdoteEras = parseAnecdotes();
  let anecdoteEventCount = 0;
  for (const era of anecdoteEras) anecdoteEventCount += era.events.length;
  const anecdotes = {
    id: 'anecdotes',
    name: '秘话合集',
    description: '光之回忆录（秘话系列）——角色视角的短篇故事，按版本分组。',
    eras: anecdoteEras,
  };

  // === 构建 lore branch（Step 2）===
  const loreEras = parseLore();
  let loreEventCount = 0;
  for (const era of loreEras) loreEventCount += era.events.length;
  const lore = {
    id: 'lore',
    name: '设定百科',
    description: '世界观概念设定与历史背影——魔法、种族、组织、技术的百科词条。',
    eras: loreEras,
  };

  // === 组装最终 JSON ===
  const output = {
    world: {
      id: 'ff14',
      name: '最终幻想XIV',
      nameCN: '最终幻想XIV',
      category: 'game',
      description: '十四个世界同归一源。从万物的分裂到光暗的终末之战，水晶的意志指引着冒险者穿越星海、横跨折射——在原初世界与碎片世界之间，艾欧泽亚的编年史铭刻着每一个灵魂的足迹。',
      calendarSystem: '伊修加德历',
      themeColor: '#b8c4d8',
      bgPreset: 'ff14',
    },
    subEntities: [
      {
        id: 'main',
        name: '原初世界·编年史',
        description: '从星之海的起源到终末之战——原初世界的完整编年。',
        timeline: {
          branches: [mainline, shards, anecdotes, lore],
        },
      },
    ],
  };

  // 写入
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf8');

  // 统计
  let totalEvents = 0;
  for (const era of eras) totalEvents += era.events.length;
  console.log('═══════════════════════════════════════════');
  console.log('  transform-ff14.js — 转换完成');
  console.log('═══════════════════════════════════════════');
  console.log(`  主线时代数: ${eras.length}`);
  console.log(`  主线事件数: ${totalEvents}`);
  console.log(`  shard-1 结局数: ${shard1Endings.length}`);
  console.log(`  shard-13 结局数: 1`);
  console.log(`  秘话事件数: ${anecdoteEventCount} (10 个分组)`);
  console.log(`  设定事件数: ${loreEventCount} (概念设定+历史背影)`);
  console.log(`  总计: ${totalEvents + shard1Endings.length + 1 + anecdoteEventCount + loreEventCount} 条`);
  console.log('');
  console.log('  主线各时代事件数:');
  for (const era of eras) {
    console.log(`    ${era.title}: ${era.events.length}`);
  }
  console.log('');
  console.log('  秘话各分组事件数:');
  for (const era of anecdoteEras) {
    console.log(`    ${era.title}: ${era.events.length}`);
  }
  console.log('');
  console.log('  设定各分组事件数:');
  for (const era of loreEras) {
    console.log(`    ${era.title}: ${era.events.length}`);
  }
  console.log('');
  // 统计带图片的事件数
  let imgEventCount = 0;
  let totalImgs = 0;
  for (const era of eras) for (const e of era.events) { if (e.images) { imgEventCount++; totalImgs += e.images.length; } }
  for (const era of anecdoteEras) for (const e of era.events) { if (e.images) { imgEventCount++; totalImgs += e.images.length; } }
  for (const era of loreEras) for (const e of era.events) { if (e.images) { imgEventCount++; totalImgs += e.images.length; } }
  console.log(`  带图片事件数: ${imgEventCount} / ${totalEvents + anecdoteEventCount + loreEventCount} (共 ${totalImgs} 张图片)`);
  console.log('');
  console.log(`  输出: ${OUT}`);
}

build();
