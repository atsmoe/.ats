export const INTEGRATED_STRATEGY_THEMES = Object.freeze({
  'if-ceobe': {
    slug: 'ceobe',
    code: 'IS-01',
    kicker: 'FUNGIMIST / UNSTABLE MEMORY',
    accent: '#e6a54b',
    accentAlt: '#9aba75',
    topologyLabel: '梦境层叠',
    topologyNote: '三份记录像记忆残片互相覆盖；它们改变对旅途的解释，而不是排列为一条直线。',
    entities: { ceobe: '刻俄柏', 'rhodes-island': '罗德岛', fungimist: '灰蕈迷境' },
  },
  'if-phantom': {
    slug: 'phantom',
    code: 'IS-02',
    kicker: 'CRIMSON SOLITAIRE / STAGE FILE',
    accent: '#d54848',
    accentAlt: '#d7b081',
    topologyLabel: '剧目分幕',
    topologyNote: '每条路线都把观众带向更深的后台：从舞台终场，到喉舌与剧作家的书写层。',
    entities: { phantom: '傀影', 'miss-christine': '克莉丝汀小姐', 'crimson-troupe': '猩红剧团', playwright: '剧作家' },
  },
  'if-mizuki': {
    slug: 'mizuki',
    code: 'IS-03',
    kicker: 'CAERULA ARBOR / DEEP-SEA OBSERVATION',
    accent: '#55d8dc',
    accentAlt: '#779dff',
    topologyLabel: '并行观测',
    topologyNote: '四份记录共享海洋危机背景，但互不兼容；这里并列展示，不指定其中任何一份为唯一正史。',
    entities: { mizuki: '水月', seaborn: '海嗣', 'ishar-mla': '伊莎玛拉', 'caerula-arbor': '深蓝之树' },
  },
  'if-sami': {
    slug: 'sami',
    code: 'IS-04',
    kicker: 'SAMI EXPEDITION / POLAR SURVEY',
    accent: '#a8dbe6',
    accentAlt: '#d9f3ef',
    topologyLabel: '远征测绘',
    topologyNote: '四份报告沿探索深度展开；地图信息增加的同时，现实本身也越来越不可靠。',
    entities: { sami: '萨米', magallan: '麦哲伦', collapse: '坍缩', 'star-gate': '星门' },
  },
  'if-sarkaz-endless': {
    slug: 'sarkaz',
    code: 'IS-05',
    kicker: 'FURNACE FABLES / OVERWRITTEN HISTORY',
    accent: '#c990ff',
    accentAlt: '#ee755f',
    topologyLabel: '历史覆写',
    topologyNote: '五份结果都是魂灵熔炉中的反事实编纂；层叠文本保留冲突，而不是假装它们同时发生。',
    entities: { sarkaz: '萨卡兹', 'soul-furnace': '魂灵熔炉', amiya: '阿米娅', theresa: '特蕾西娅' },
  },
  'if-sui-realm': {
    slug: 'sui',
    code: 'IS-06',
    kicker: 'GARDEN OF GROTESQUERIES / BOUNDARY SCROLL',
    accent: '#d9b66c',
    accentAlt: '#b14f3b',
    topologyLabel: '界园双层',
    topologyNote: '界园与残识空间互为表里，结局记录像卷轴中的落款与棋局中的落子。',
    entities: { sui: '岁', jiegarden: '界园', baizao: '百灶城', 'sui-remnant': '岁兽残识' },
  },
  'if-blackflow': {
    slug: 'blackflow',
    code: 'IS-07',
    kicker: 'BLACKFLOW / RECURSIVE FIELD DATABASE',
    accent: '#9fe353',
    accentAlt: '#53bfa8',
    topologyLabel: '递归树海',
    topologyNote: '当前三份首发结果像系统函数一样重启、重构与调和探索状态；后续更新可以继续追加节点。',
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
