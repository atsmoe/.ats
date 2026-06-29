const fs = require('fs');
const path = require('path');

const MD_PATH = path.join(__dirname, 'docs', '更新日志.md');
const JSON_PATH = path.join(__dirname, 'src', '_data', 'changelog.json');

const md = fs.readFileSync(MD_PATH, 'utf-8');
const lines = md.split('\n');

const entries = [];
let current = null;

for (const line of lines) {
  const trimmed = line.trim();

  const headerMatch = trimmed.match(/^##\s+(V[\d.]+)\s*\/\s*(?:([\d-]+)\s*\/\s*)?(#[0-9a-fA-F]{3,8})\s*$/);
  if (headerMatch) {
    if (current) entries.push(current);
    current = {
      version: headerMatch[1],
      date: headerMatch[2] || '',
      color: headerMatch[3],
      subtitle: '',
      items: [],
    };
    continue;
  }

  if (!current) continue;

  if (trimmed.startsWith('- ')) {
    const text = trimmed.substring(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    current.items.push(text);
    continue;
  }

  if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('>')) {
    if (current.items.length === 0 && current.subtitle === '') {
      current.subtitle = trimmed;
    }
  }
}

if (current) entries.push(current);

const json = JSON.stringify(entries, null, 2) + '\n';
fs.writeFileSync(JSON_PATH, json, 'utf-8');

console.log('[changelog] Converted 更新日志.md → src/_data/changelog.json (' + entries.length + ' entries)');