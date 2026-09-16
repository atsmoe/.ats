const ark = require('./arknights.json');
const wh = require('./wh40k.json');
const ff = require('./ff14.json');

module.exports = {
  arknights: {
    heading: '想从哪里了解泰拉？',
    paths: [
      { label: '初次了解', title: '从一段故事读起', text: '一场越狱、临光姐妹的赛事、汐斯塔的迁城，选一条线了解前因与后续。', href: './arknights-stories.html' },
      { label: '主要历史', title: '按泰拉历查阅', text: '从前文明到罗德岛，按时代和时间段阅读。', href: './arknights-chronicle.html' },
      { label: '人物与地点', title: '带着名字找线索', text: '输入人物、组织、地点或结局条件。', href: './search.html?world=arknights' },
    ],
    scope: ark.archive.coverage.scope,
    checked: ark.archive.coverage.updatedAt,
    gaps: ark.archive.coverage.knownGaps,
    highlights: [{ text: '三段故事 · 串联前因与后续', href: './arknights-stories.html' }, { text: '七个集成战略主题 · 路线与结局', href: './arknights-integrated-strategies.html' }],
  },
  wh40k: {
    heading: '从哪一份银河档案开始？',
    paths: [
      { label: '初次了解', title: '先认识主要势力', text: '从九个主要势力了解银河中的阵营与冲突。', href: './wh40k-factions.html' },
      { label: '主要历史', title: '沿银河纪元阅读', text: '按章节查阅重大事件，争议年代保留提示。', href: './wh40k-chronicle.html' },
      { label: '人物与地点', title: '查找相关记录', text: '从人物、军团或战区名称进入事件。', href: './search.html?world=wh40k' },
    ],
    scope: wh.archive.coverage.scope,
    checked: wh.archive.coverage.asOf,
    gaps: ['战区动态以各条目标注日期为准。', '争议记录仍在复核；可在正文与搜索结果中查看来源状态。'],
    highlights: [{ text: '六个战区 · 战况与相关事件', href: './wh40k-war-zones.html' }, { text: '银河纪元 · 章节阅读与来源', href: './wh40k-chronicle.html' }],
  },
  ff14: {
    heading: '选择旅途的起点',
    paths: [
      { label: '初次了解', title: '先选一段旅途', text: '按冒险阶段认识地点与主题，留意剧情范围。', href: './ff14-journeys.html' },
      { label: '主要历史', title: '展开星海编年', text: '查阅古代世界、灵灾星历与主线长卷。', href: './ff14-chronicle.html' },
      { label: '人物与地点', title: '寻找熟悉的名字', text: '输入人物或地域名称，打开对应的记录。', href: './search.html?world=ff14' },
    ],
    scope: ff.archive.coverage.scope,
    checked: ff.archive.coverage.asOf,
    gaps: ['部分镜像世界的公开材料不足，尚无法确认其文明、地域与状态。', '历史汇编的逐条引文仍在校正。'],
    highlights: [{ text: '镜界棱镜 · 十四个世界的已知记录', href: './ff14-reflections.html' }, { text: '旅途星座 · 按冒险阶段回看', href: './ff14-journeys.html' }],
  },
};
