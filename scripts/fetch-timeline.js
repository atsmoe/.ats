const https = require('https');
const fs = require('fs');
const path = require('path');

// ========== CONFIG ==========
const PAGE = '泰拉年表';
const API_BASE = 'https://prts.wiki/api.php';
const OUTPUT = path.join(__dirname, '..', 'docs', 'prts_timeline.json');
const PROGRESS = path.join(__dirname, '..', 'docs', '.timeline_progress.json');
const DELAY_MS = 1500;
const UA = 'PRTS-MCP-Bot/0.1';

// ========== HELPERS ==========
function apiUrl(params) {
  const qs = new URLSearchParams({ format: 'json', ...params });
  return `${API_BASE}?${qs.toString()}`;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': UA },
    };
    https.get(opts, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error: ${body.substring(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanHTML(html) {
  return html
    .normalize('NFKC')
    .replace(/<!--[\s\S]*?-->/g, '') // remove comments
    .replace(/<span[^>]*mw-editsection[\s\S]*?<\/span>/g, ''); // remove edit links
}

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function extractLinks(html) {
  const links = [];
  const re = /<a\s[^>]*href="([^"]*)"[^>]*title="([^"]*)"[^>]*>([^<]*)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    links.push({ href: m[1], title: decodeEntities(m[2]), text: decodeEntities(m[3]) });
  }
  return links;
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '').trim());
}

// Parse a single section's HTML content into events
function parseSectionHTML(html, sectionTitle) {
  const events = [];
  const cleaned = cleanHTML(html);

  // Try table-based format first (used for year sections)
  const tableMatch = cleaned.match(/<table[^>]*class="wikitable"[\s\S]*?<\/table>/i);
  if (tableMatch) {
    const tableHTML = tableMatch[0];
    const rows = tableHTML.match(/<tr[\s\S]*?<\/tr>/gi);
    if (!rows) return events;

    let currentYear = sectionTitle;

    for (const row of rows) {
      try {
        // Check for header cell (th) — may be in its own row or same row as td
        const thMatch = row.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
        if (thMatch) {
          currentYear = stripTags(thMatch[1]);
        }

        // Extract all td content from the row
        const tdMatches = row.match(/<td[\s\S]*?>([\s\S]*?)<\/td>/gi);
        if (!tdMatches || tdMatches.length === 0) {
          // Pure header row — skip
          if (thMatch) continue;
          continue;
        }

        // Use the last td (event content), ignore any first td that's just a spacer
        const cellHTML = tdMatches[tdMatches.length - 1].replace(/^<td[^>]*>/, '').replace(/<\/td>$/, '');

        // Extract event text from <p> tags
        const pMatches = cellHTML.match(/<p>([\s\S]*?)<\/p>/gi);
        if (!pMatches) continue;

        let eventText = '';
        for (const p of pMatches) {
          eventText += (eventText ? ' ' : '') + stripTags(p);
        }

        if (!eventText.trim()) continue;

        // Check for inline bold date (e.g. <b>1月26日</b>)
        let eventDate = currentYear;
        const bMatch = cellHTML.match(/<b>([^<]*)<\/b>/);
        if (bMatch) {
          eventDate = stripTags(bMatch[0]);
        }

        // Extract source links from collapsible content
        const collapsibleMatch = cellHTML.match(/<div[^>]*class="mw-collapsible-content"[\s\S]*?<\/div>/i);
        let sources = [];
        if (collapsibleMatch) {
          const sourceLinks = extractLinks(collapsibleMatch[0]);
          sources = sourceLinks.map(l => ({ text: l.text, href: l.href.replace(/^\/w\//, ''), title: l.title }));
        }

        // Extract links from the event text area
        const eventLinks = extractLinks(cellHTML).map(l => ({
          text: l.text,
          href: l.href.replace(/^\/w\//, ''),
          title: l.title,
        }));

        events.push({
          date: eventDate,
          text: eventText.trim(),
          links: eventLinks,
          sources: sources,
        });
      } catch (e) {
        console.error(`  [skip] Parse error in row: ${e.message}`);
      }
    }
    return events;
  }

  // Fallback: list/paragraph-based format (used for pre-crystal era sections)
  const listItems = cleaned.match(/<li>([\s\S]*?)<\/li>/gi);
  if (listItems) {
    for (const li of listItems) {
      const text = stripTags(li);
      const links = extractLinks(li);
      if (text.trim()) {
        events.push({
          date: sectionTitle,
          text,
          links: links.map(l => ({ text: l.text, href: l.href.replace(/^\/w\//, ''), title: l.title })),
          sources: [],
        });
      }
    }
    return events;
  }

  // Last resort: split by <br> or paragraphs
  const paras = cleaned.match(/<p>([\s\S]*?)<\/p>/gi);
  if (paras) {
    for (const p of paras) {
      const text = stripTags(p);
      const links = extractLinks(p);
      if (text.trim() && text.trim().length > 5) {
        events.push({
          date: sectionTitle,
          text,
          links: links.map(l => ({ text: l.text, href: l.href.replace(/^\/w\//, ''), title: l.title })),
          sources: [],
        });
      }
    }
  }

  return events;
}

// ========== MAIN ==========
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   PRTS 泰拉年表 Fetcher              ║');
  console.log('╚══════════════════════════════════════╝\n');

  // ---- Step 1: Get sections ----
  console.log('[1/4] Fetching section list...');
  const sectionsData = await fetchJSON(apiUrl({ action: 'parse', page: PAGE, prop: 'sections' }));
  const allSections = sectionsData.parse.sections;
  console.log(`  Found ${allSections.length} sections\n`);

  // ---- Step 2: Filter out parent sections (whose number is a prefix of another section's number) ----
  const numberSet = new Set(allSections.map(s => s.number));
  const isParent = (num) => {
    for (const n of numberSet) {
      if (n !== num && n.startsWith(num + '.')) return true;
    }
    return false;
  };

  const fetchSections = allSections.filter(s => !isParent(s.number));
  const skippedParents = allSections.length - fetchSections.length;
  if (skippedParents > 0) {
    console.log(`  (skipping ${skippedParents} parent sections to avoid duplicates)\n`);
  }

  // ---- Step 3: Load progress ----
  let progress = { completedIndices: [], lastUpdate: null };
  if (fs.existsSync(PROGRESS)) {
    try { progress = JSON.parse(fs.readFileSync(PROGRESS, 'utf-8')); }
    catch (e) { console.log('  [warn] Could not parse progress file, starting fresh'); }
  }
  console.log(`[3/4] Resume: ${progress.completedIndices.length}/${fetchSections.length} sections already done\n`);

  // ---- Step 4: Fetch each section ----
  const results = [];

  for (let i = 0; i < fetchSections.length; i++) {
    const sec = fetchSections[i];
    const label = stripTags(sec.line || sec.anchor || `section-${sec.index}`);

    // Skip completed
    if (progress.completedIndices.includes(sec.index)) {
      console.log(`  [${i + 1}/${allSections.length}] ${label} — SKIP (cached)`);
      // Load previously saved result
      const existing = results.find(r => r.index === sec.index);
      if (!existing) {
        results.push({ title: label, index: sec.index, number: sec.number, events: [], _cached: true });
      }
      continue;
    }

    await sleep(DELAY_MS);

    try {
      console.log(`  [${i + 1}/${fetchSections.length}] ${label} — fetching...`);
      const data = await fetchJSON(apiUrl({ action: 'parse', page: PAGE, prop: 'text', section: sec.index }));
      const html = data.parse.text['*'];
      const events = parseSectionHTML(html, label);

      const entry = {
        title: label,
        index: sec.index,
        number: sec.number,
        events: events,
      };
      results.push(entry);

      // Save progress
      progress.completedIndices.push(sec.index);
      progress.lastUpdate = new Date().toISOString();
      fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 2), 'utf-8');

      console.log(`    → ${events.length} events extracted`);
    } catch (e) {
      console.error(`    → ERROR: ${e.message}`);
      // Save partial progress anyway
      progress.lastUpdate = new Date().toISOString();
      fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 2), 'utf-8');
      results.push({
        title: label, index: sec.index, number: sec.number,
        events: [], _error: e.message,
      });
    }
  }

  // ---- Step 4: Write final output ----
  const totalEvents = results.reduce((sum, s) => sum + s.events?.length || 0, 0);
  const output = {
    source: `https://prts.wiki/w/${encodeURIComponent(PAGE)}`,
    fetchedAt: new Date().toISOString(),
    totalSections: results.length,
    totalEvents,
    sections: results,
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');

  // Cleanup progress file on full success
  if (progress.completedIndices.length >= fetchSections.length) {
    fs.unlinkSync(PROGRESS);
    console.log('\n  [cleanup] Progress file removed (all sections done)');
  }

  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  Done! ${results.length} sections, ${totalEvents} events      ║`);
  console.log(`║  Output: ${OUTPUT}                    ║`);
  console.log(`╚══════════════════════════════════════╝`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
