// This runs at build time — reads JSON data and makes it available
// with valid JS variable names for Nunjucks templates.
const fs = require('fs');
const path = require('path');

function readJSON(filename) {
  const p = path.join(__dirname, filename);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return null; }
}

module.exports = function () {
  return {
    title: '群星之间 · 世界档案',
    description: '面向游戏、影视与动漫虚构宇宙的非官方世界档案，汇集明日方舟、战锤 40,000 与最终幻想 XIV 的编年、专题和观测入口。',
    canonicalBase: 'https://atsmoe.github.io/.ats',
    worlds: {
      arknights: readJSON('arknights.json'),
      wh40k: readJSON('wh40k.json'),
      ff14: readJSON('ff14.json'),
    },
    worldList: [
      { id: 'arknights', name: '明日方舟', page: 'arknights.html' },
      { id: 'wh40k', name: '战锤40K', page: 'wh40k.html' },
      { id: 'ff14', name: '最终幻想XIV', page: 'ff14.html' },
    ],
  };
};
