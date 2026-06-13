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
