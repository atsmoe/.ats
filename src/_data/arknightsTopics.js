const fs = require('fs');
const path = require('path');

const SLUGS = {
  'if-ceobe': 'ceobe',
  'if-phantom': 'phantom',
  'if-mizuki': 'mizuki',
  'if-sami': 'sami',
  'if-sarkaz-endless': 'sarkaz',
  'if-sui-realm': 'sui',
  'if-blackflow': 'blackflow',
};

const ENTITY_NAMES = {
  ceobe: '刻俄柏',
  'rhodes-island': '罗德岛',
  fungimist: '灰蕈迷境',
  phantom: '傀影',
  'miss-christine': '克莉丝汀小姐',
  'crimson-troupe': '猩红剧团',
  playwright: '剧作家',
  mizuki: '水月',
  seaborn: '海嗣',
  'ishar-mla': '伊莎玛拉',
  'caerula-arbor': '深蓝之树',
  sami: '萨米',
  magallan: '麦哲伦',
  collapse: '坍缩',
  'star-gate': '星门',
  sarkaz: '萨卡兹',
  'soul-furnace': '魂灵熔炉',
  amiya: '阿米娅',
  theresa: '特蕾西娅',
  sui: '岁',
  jiegarden: '界园',
  baizao: '百灶城',
  'sui-remnant': '岁兽残识',
  blackflow: '黑流树海',
  'columbian-expedition': '哥伦比亚探索队',
  parts: '零件',
  'ideal-domain': '理想域',
};

module.exports = function () {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'arknights.json'), 'utf8'));
  const branches = source.subEntities
    .flatMap(entity => entity.timeline?.branches || []);
  const integrated = branches.find(branch => branch.id === 'if-integrated');

  return (integrated?.subBranches || [])
    .filter(context => SLUGS[context.id])
    .sort((left, right) => left.order - right.order)
    .map(context => ({
      id: context.id,
      name: context.name,
      order: context.order,
      slug: SLUGS[context.id],
      status: context.status,
      synopsis: context.synopsis || context.description,
      description: context.description,
      sharedPremise: context.sharedPremise,
      topologyMode: context.topologyMode,
      lastReviewedAt: context.lastReviewedAt,
      sources: context.sources || [],
      endings: context.endings || [],
      entities: (context.entityIds || []).map(id => {
        const label = ENTITY_NAMES[id] || id;
        return {
          id,
          label,
          url: `https://prts.wiki/index.php?search=${encodeURIComponent(label)}`,
        };
      }),
    }));
};
