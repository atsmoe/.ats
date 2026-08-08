export const INTEGRATED_STRATEGY_THEMES = Object.freeze({
  'if-ceobe': {
    slug: 'ceobe',
    code: 'IS-01',
    kicker: 'FUNGIMIST / UNSTABLE MEMORY',
    accent: '#e6a54b',
    accentAlt: '#9aba75',
    topologyLabel: '梦境层叠',
    topologyNote: '刻俄柏误食灰蕈后陷入幻梦，醒来、迷失与沉入大地对应三种结局。',
    entities: { ceobe: '刻俄柏', 'rhodes-island': '罗德岛', fungimist: '灰蕈迷境' },
  },
  'if-phantom': {
    slug: 'phantom',
    code: 'IS-02',
    kicker: 'CRIMSON SOLITAIRE / STAGE FILE',
    accent: '#d54848',
    accentAlt: '#d7b081',
    topologyLabel: '剧目分幕',
    topologyNote: '罗德岛循线寻找傀影，猩红剧团、克莉丝汀小姐与剧作家把演出推向不同终场。',
    entities: { phantom: '傀影', 'miss-christine': '克莉丝汀小姐', 'crimson-troupe': '猩红剧团', playwright: '剧作家' },
  },
  'if-mizuki': {
    slug: 'mizuki',
    code: 'IS-03',
    kicker: 'CAERULA ARBOR / DEEP-SEA OBSERVATION',
    accent: '#55d8dc',
    accentAlt: '#779dff',
    topologyLabel: '并行观测',
    topologyNote: '深海危机牵动人、海嗣与水月，四种结局分别把未来推向不同方向。',
    entities: { mizuki: '水月', seaborn: '海嗣', 'ishar-mla': '伊莎玛拉', 'caerula-arbor': '深蓝之树' },
  },
  'if-sami': {
    slug: 'sami',
    code: 'IS-04',
    kicker: 'SAMI EXPEDITION / POLAR SURVEY',
    accent: '#a8dbe6',
    accentAlt: '#d9f3ef',
    topologyLabel: '远征测绘',
    topologyNote: '四份报告记录科考队深入因非冰原的远征，从山脉一路走向时间尽头。',
    entities: { sami: '萨米', magallan: '麦哲伦', collapse: '坍缩', 'star-gate': '星门' },
  },
  'if-sarkaz-endless': {
    slug: 'sarkaz',
    code: 'IS-05',
    kicker: 'FURNACE FABLES / OVERWRITTEN HISTORY',
    accent: '#c990ff',
    accentAlt: '#ee755f',
    topologyLabel: '五种可能',
    topologyNote: '魂灵熔炉把萨卡兹的历史、亡魂与愿望编成五种可能。',
    entities: { sarkaz: '萨卡兹', 'soul-furnace': '魂灵熔炉', amiya: '阿米娅', theresa: '特蕾西娅' },
  },
  'if-sui-realm': {
    slug: 'sui',
    code: 'IS-06',
    kicker: 'GARDEN OF GROTESQUERIES / BOUNDARY SCROLL',
    accent: '#d9b66c',
    accentAlt: '#b14f3b',
    topologyLabel: '界园双层',
    topologyNote: '镇抚行动深入界园，现实、棋局与岁兽残识交错成五种结局。',
    entities: { sui: '岁', jiegarden: '界园', baizao: '百灶城', 'sui-remnant': '岁兽残识' },
  },
  'if-blackflow': {
    slug: 'blackflow',
    code: 'IS-07',
    kicker: 'BLACKFLOW / RECURSIVE FIELD DATABASE',
    accent: '#9fe353',
    accentAlt: '#53bfa8',
    topologyLabel: '递归树海',
    topologyNote: '三份当前结局分别以重启、重构与调和收束；树海仍留下尚未展开的分岔。',
    entities: { blackflow: '黑流树海', 'columbian-expedition': '哥伦比亚探索队', parts: '零件', 'ideal-domain': '理想域' },
  },
});

export function getIntegratedStrategyTheme(contextId) {
  return INTEGRATED_STRATEGY_THEMES[contextId] || null;
}

export function getIntegratedStrategyHref(contextId) {
  const theme = getIntegratedStrategyTheme(contextId);
  return theme ? `./arknights-is-${theme.slug}.html` : null;
}
