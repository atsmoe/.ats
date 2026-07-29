const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BASE = 'https://archive.test/';

function htmlPages() {
  return fs.readdirSync(DIST).filter(file => file.endsWith('.html'));
}

function anchors(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>/gsi)]
    .map(match => ({ tag: match[0], href: match[2].replaceAll('&amp;', '&') }));
}

function hasStaticTarget(html, fragment) {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)(?:id|name)=(["'])${escaped}\\1`, 'm').test(html);
}

function collectRecords(branches, records = new Map()) {
  for (const branch of branches || []) {
    for (const era of branch.eras || []) {
      for (const record of era.events || []) records.set(record.id, record);
    }
    for (const record of branch.endings || []) records.set(record.id, record);
    collectRecords(branch.subBranches, records);
  }
  return records;
}

function decodeHtmlText(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|#39);/gi, (entity, key) => {
    if (Object.prototype.hasOwnProperty.call(named, key)) return named[key];
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
  });
}

test('every generated internal link resolves to a page and a real static or canonical target', () => {
  const eventIndex = JSON.parse(
    fs.readFileSync(path.join(DIST, 'data', 'event-index.json'), 'utf8'),
  );

  for (const page of htmlPages()) {
    const html = fs.readFileSync(path.join(DIST, page), 'utf8');
    for (const { href } of anchors(html)) {
      if (/^(?:https?:|mailto:|tel:)/i.test(href)) continue;

      const resolved = new URL(href, new URL(page, BASE));
      let targetPath = decodeURIComponent(resolved.pathname.replace(/^\/+/, ''));
      if (!targetPath) targetPath = 'index.html';
      if (targetPath.endsWith('/')) targetPath += 'index.html';

      assert.ok(
        fs.existsSync(path.join(DIST, targetPath)),
        `${page} links to missing ${targetPath}`,
      );

      const fragment = decodeURIComponent(resolved.hash.slice(1));
      if (!fragment) continue;
      const targetHtml = fs.readFileSync(path.join(DIST, targetPath), 'utf8');
      const isCanonicalRecord = Boolean(eventIndex[fragment]);
      assert.ok(
        hasStaticTarget(targetHtml, fragment) || isCanonicalRecord,
        `${page} links to unresolved ${targetPath}#${fragment}`,
      );
    }
  }
});

test('external content links open safely without replacing the archive', () => {
  for (const page of htmlPages()) {
    const html = fs.readFileSync(path.join(DIST, page), 'utf8');
    for (const { tag, href } of anchors(html)) {
      if (!/^https?:/i.test(href)) continue;
      assert.match(tag, /\btarget=(["'])_blank\1/i, `${page}: ${href} needs target=_blank`);
      assert.match(tag, /\brel=(["'])[^"']*\bnoopener\b[^"']*\bnoreferrer\b[^"']*\1/i,
        `${page}: ${href} needs rel="noopener noreferrer"`);
    }
  }
});

test('FFXIV lens controls and panels have a one-to-one accessible mapping', () => {
  for (const [page, controlName, panelName] of [
    ['ff14-reflections.html', 'reflection-id', 'reflection-panel'],
    ['ff14-journeys.html', 'journey-id', 'journey-panel'],
  ]) {
    const html = fs.readFileSync(path.join(DIST, page), 'utf8');
    const controls = [...html.matchAll(new RegExp(`data-${controlName}="([^"]+)"`, 'g'))]
      .map(match => match[1]);
    const panels = [...html.matchAll(new RegExp(`data-${panelName}="([^"]+)"`, 'g'))]
      .map(match => match[1]);

    assert.deepEqual(controls, panels, `${page} controls and panels must match in order`);
    assert.equal(new Set(controls).size, controls.length, `${page} control IDs must be unique`);
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
    for (const id of controls) {
      assert.match(html, new RegExp(`aria-controls="${id}"`));
      assert.match(
        html,
        new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*\\bdata-${panelName}="${id}"`),
      );
    }
  }
});

test('FFXIV no-script chronicle owns every canonical fragment and complete record body', () => {
  const html = fs.readFileSync(path.join(DIST, 'ff14-chronicle.html'), 'utf8');
  const eventIndex = JSON.parse(
    fs.readFileSync(path.join(DIST, 'data', 'event-index.json'), 'utf8'),
  );
  const ff14 = JSON.parse(fs.readFileSync(path.join(DIST, 'data', 'ff14.json'), 'utf8'));
  const records = collectRecords(ff14.branches);
  const expected = Object.entries(eventIndex)
    .filter(([, location]) => location.worldId === 'ff14')
    .map(([recordId]) => recordId)
    .sort();
  const bodies = new Map(
    [...html.matchAll(/<article\b[^>]*\bdata-ff14-record="([^"]+)"[^>]*>[\s\S]*?<p\b[^>]*\bdata-ff14-description\b[^>]*>([\s\S]*?)<\/p>/g)]
      .map(match => [match[1], decodeHtmlText(match[2])]),
  );
  const actual = [...bodies.keys()].sort();

  assert.deepEqual(actual, expected);
  for (const recordId of expected) {
    assert.equal(
      bodies.get(recordId),
      records.get(recordId)?.description,
      `${recordId} no-script body must not be truncated or rewritten`,
    );
  }
});

test('Arknights no-script chronicle owns every mainline fragment and complete record body', () => {
  const html = fs.readFileSync(path.join(DIST, 'arknights-chronicle.html'), 'utf8');
  const eventIndex = JSON.parse(
    fs.readFileSync(path.join(DIST, 'data', 'event-index.json'), 'utf8'),
  );
  const arknights = JSON.parse(
    fs.readFileSync(path.join(DIST, 'data', 'arknights.json'), 'utf8'),
  );
  const records = collectRecords(arknights.branches);
  const expected = Object.entries(eventIndex)
    .filter(([, location]) => (
      location.worldId === 'arknights' && location.branchId === 'mainline'
    ))
    .map(([recordId]) => recordId)
    .sort();
  const bodies = new Map(
    [...html.matchAll(/<article\b[^>]*\bdata-arknights-record="([^"]+)"[^>]*>[\s\S]*?<p\b[^>]*\bdata-arknights-description\b[^>]*>([\s\S]*?)<\/p>/g)]
      .map(match => [match[1], decodeHtmlText(match[2])]),
  );

  assert.deepEqual([...bodies.keys()].sort(), expected);
  for (const recordId of expected) {
    assert.equal(
      bodies.get(recordId),
      records.get(recordId)?.description,
      `${recordId} no-script body must not be truncated or rewritten`,
    );
  }
});
