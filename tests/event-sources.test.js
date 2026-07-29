const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

function loadModule() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src/js/modules/event-sources.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} };
  const execute = new Function('module', 'exports', 'require', result.outputFiles[0].text);
  execute(module, module.exports, require);
  return module.exports;
}

const { normalizeEventSources } = loadModule();

test('generic event sources take precedence and expose a safe link label', () => {
  const sources = normalizeEventSources({
    sources: [{
      title: 'Warhammer Community：帝皇行动',
      url: 'https://www.warhammer-community.com/en-gb/articles/example/',
    }],
    prtsSources: [{
      title: 'legacy',
      text: 'must not leak into a generic source list',
      url: 'https://prts.wiki/',
    }],
  });

  assert.deepEqual(sources, [{
    label: '',
    text: 'Warhammer Community：帝皇行动',
    url: 'https://www.warhammer-community.com/en-gb/articles/example/',
  }]);
});

test('legacy PRTS sources remain visible but unsafe URLs are never linkable', () => {
  const sources = normalizeEventSources({
    prtsSources: [{
      title: '  PRTS 条目  ',
      text: '  剧情记录  ',
      url: 'javascript:alert(document.domain)',
    }],
  });

  assert.deepEqual(sources, [{
    label: 'PRTS 条目',
    text: '剧情记录',
    url: '',
  }]);
});
