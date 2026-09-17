const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DATA_PATH = path.join(__dirname, '..', 'src', '_data', 'arknights.json');
const TOPIC_SCRIPT_PATH = path.join(
  __dirname,
  '..',
  'src',
  'js',
  'modules',
  'arknights-integrated-strategies.js',
);
const TOPIC_TEMPLATE_PATH = path.join(__dirname, '..', 'src', 'arknights-is.njk');
const buildTopics = require('../src/_data/arknightsTopics.js');

const EXPECTED_PRIORITY_ORDER = {
  'if-ceobe': [3, 2, 1],
  'if-phantom': [4, 3, 2, 1],
  'if-mizuki': [4, 3, 2, 1],
  'if-sami': [4, 3, 2, 1],
  'if-sarkaz-endless': [5, 4, 3, 2, 1],
  'if-sui-realm': [5, 4, 3, 2, 1],
  'if-blackflow': [3, 2, 1],
};

function loadIntegratedStrategyContexts() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const integrated = data.subEntities
    .flatMap(entity => entity.timeline?.branches || [])
    .find(branch => branch.id === 'if-integrated');
  return integrated?.subBranches || [];
}

test('integrated-strategy archive publishes seven detailed topics and 28 endings', () => {
  const contexts = loadIntegratedStrategyContexts();

  assert.equal(contexts.length, 7);
  assert.equal(contexts.reduce((count, context) => count + context.endings.length, 0), 28);

  for (const context of contexts) {
    assert.ok(context.description.length >= 60, `${context.id} needs a detailed overview`);
    assert.ok(context.sharedPremise.length >= 40, `${context.id} needs a shared premise`);
    assert.ok(context.continuityNote.length >= 45, `${context.id} needs a continuity note`);
    assert.ok(context.storyBeats.length >= 4, `${context.id} needs a story sequence`);
    assert.equal(context.lastReviewedAt, '2026-08-23');
    assert.ok(context.endingPriority?.note, `${context.id} needs a priority explanation`);
    assert.equal(
      context.endingPriority.items.length,
      context.endings.length,
      `${context.id} priority list must cover every ending`,
    );
    assert.deepEqual(
      context.endingPriority.items.map(item => item.recordId),
      EXPECTED_PRIORITY_ORDER[context.id].map(number => `${context.id}-ending-${number}`),
      `${context.id} priority order is incorrect`,
    );
    assert.deepEqual(
      context.endingPriority.items.map(item => item.priority),
      context.endingPriority.items.map((_, index, items) => items.length - index - 1),
      `${context.id} priority values must descend without gaps`,
    );

    for (const beat of context.storyBeats) {
      assert.ok(beat.title.length >= 4, `${context.id} has an underspecified story beat`);
      assert.ok(beat.description.length >= 28, `${context.id}/${beat.title} needs more detail`);
    }

    for (const ending of context.endings) {
      assert.ok(ending.location, `${ending.id} needs a location`);
      assert.ok(ending.characters?.length > 0, `${ending.id} needs named participants`);
      assert.ok(ending.description.length >= 40, `${ending.id} needs a detailed outcome`);
      assert.ok(ending.conditions.length >= 18, `${ending.id} needs traceable route conditions`);
      assert.ok(ending.aftermath.length >= 28, `${ending.id} needs a substantive aftermath`);
      assert.ok(ending.sources?.some(source => /^https:\/\//.test(source.url)), `${ending.id} needs a source`);
      assert.ok(ending.routeGuide, `${ending.id} needs a route guide`);
      assert.ok(ending.routeGuide.prerequisites.length > 0, `${ending.id} needs prerequisite guidance`);
      assert.ok(ending.routeGuide.steps.length > 0, `${ending.id} needs route steps`);
      assert.ok(Array.isArray(ending.routeGuide.requiredState), `${ending.id} needs required-state guidance`);
      assert.ok(Array.isArray(ending.routeGuide.forbiddenState), `${ending.id} needs forbidden-state guidance`);
      assert.ok(Array.isArray(ending.routeGuide.optionalSteps), `${ending.id} needs optional-step guidance`);
      assert.ok(Array.isArray(ending.routeGuide.warnings), `${ending.id} needs warnings`);
      assert.ok(ending.routeGuide.finalBattle.operation, `${ending.id} needs a final operation`);
      const priority = context.endingPriority.items.find(item => item.recordId === ending.id);
      assert.ok(priority?.routeKey, `${ending.id} needs a priority route key`);
      assert.ok(priority?.condition, `${ending.id} needs a priority condition`);
      assert.match(priority?.outcome || '', new RegExp(ending.title));

      for (const step of [...ending.routeGuide.steps, ...ending.routeGuide.optionalSteps]) {
        for (const field of ['stage', 'node', 'event', 'trigger', 'choice', 'result']) {
          assert.ok(step[field], `${ending.id} route step needs ${field}`);
        }
      }
    }
  }
});

test('route interfaces show ending priorities instead of forbidden-state cards', () => {
  for (const filePath of [TOPIC_SCRIPT_PATH, TOPIC_TEMPLATE_PATH]) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /终局判定优先级/);
    assert.doesNotMatch(source, /终局必须避开/);
  }

  const script = fs.readFileSync(TOPIC_SCRIPT_PATH, 'utf8');
  assert.match(script, /is-topology-sigil/);
  assert.match(script, /is-topology-key/);

  const contexts = loadIntegratedStrategyContexts();
  const blackflow = contexts.find(context => context.id === 'if-blackflow');
  assert.equal(blackflow.endingPriority.items[1].triggerMode, 'event');
});

test('static topic data exposes complete priority lists to the no-script fallback', () => {
  const topics = buildTopics();
  assert.equal(topics.length, 7);
  for (const topic of topics) {
    assert.ok(topic.endingPriority?.note, `${topic.id} static topic needs a priority note`);
    assert.equal(
      topic.endingPriority.items.length,
      topic.endings.length,
      `${topic.id} static priority rows must cover every ending`,
    );
  }

  const template = fs.readFileSync(TOPIC_TEMPLATE_PATH, 'utf8');
  assert.match(template, /topic\.endingPriority\.items/);
  assert.match(template, /is-noscript-topology/);
});

test('route-guide clicks are excluded from the parent ending-card selection handler', () => {
  const script = fs.readFileSync(TOPIC_SCRIPT_PATH, 'utf8');
  assert.match(
    script,
    /event\.target\.closest\('a, button, \.record-share-feedback, \.is-route-guide'\)/,
    'clicking a route summary must leave the native details toggle in sole control',
  );
});

test('route guides preserve exact branching requirements for representative endings', () => {
  const contexts = loadIntegratedStrategyContexts();
  const endings = new Map(contexts.flatMap(context => context.endings).map(ending => [ending.id, ending]));

  const twinCrowns = JSON.stringify(endings.get('if-sarkaz-endless-ending-2').routeGuide);
  for (const expected of ['戴冠式', '纯白花瓣', '无字地契', '巴别塔誓言', '尾页', '朝谒']) {
    assert.match(twinCrowns, new RegExp(expected));
  }

  const mizukiFourth = endings.get('if-mizuki-ending-4');
  assert.match(mizukiFourth.conditions, /中的任意一件/);
  assert.doesNotMatch(mizukiFourth.conditions, /取得「决心」「观望」和「犹疑」/);

  const ceobeThird = JSON.stringify(endings.get('if-ceobe-ending-3').routeGuide);
  for (const expected of ['死斗之后', '沉重的铁皮箱', '漆黑的钥匙', '灾祸将至', '“手铳”']) {
    assert.match(ceobeThird, new RegExp(expected));
  }

  const suiFifth = JSON.stringify(endings.get('if-sui-realm-ending-5').routeGuide);
  for (const expected of ['追忆仪', '“小磨唧”', '来去处', '谋定', '定乾坤']) {
    assert.match(suiFifth, new RegExp(expected));
  }
});

test('integrated-strategy copy excludes corrected factual overclaims and placeholder summaries', () => {
  const contexts = loadIntegratedStrategyContexts();
  const copy = JSON.stringify(contexts);

  for (const rejected of [
    '法术浮士德',
    '未能清醒返回',
    '源石可能具有自我意识',
    '阿戈尔提前介入阻止灾难',
    '系统恢复运行',
    '旧地图和分类法',
    '具体节点与作战条件见来源页',
    '具体前置事件见来源页',
  ]) {
    assert.doesNotMatch(copy, new RegExp(rejected), `found rejected copy: ${rejected}`);
  }

  const blackflow = contexts.find(context => context.id === 'if-blackflow');
  assert.equal(blackflow.status, 'updating');
  assert.deepEqual(blackflow.endings.map(ending => ending.title), [
    '强制重启',
    '维度重构',
    '纠缠，调和',
  ]);
});
