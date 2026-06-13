/* ═══════════════════════════════════════════════════════════
   validate-data.js — Build-time JSON validation + flattening + indexing
   ═══════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const SRC_DATA = path.join(__dirname, '..', '_data');
const DIST_DATA = path.join(__dirname, '..', '..', 'dist', 'data');

const WORLDS = ['arknights', 'wh40k', 'ff14'];

const WORLD_REQUIRED = ['id', 'name', 'calendarSystem', 'themeColor'];
const EVENT_REQUIRED = ['id', 'title'];
const EVENT_WITH_DATE_REQUIRED = ['id', 'title', 'dateDisplay'];

let errors = [];
let warnings = [];

function validateWorld(worldId, data) {
  const world = data.world;
  if (!world) {
    errors.push(`${worldId}: missing "world" object`);
    return;
  }
  for (const key of WORLD_REQUIRED) {
    if (world[key] === undefined || world[key] === null || world[key] === '') {
      errors.push(`${worldId}: world.${key} is required but missing or empty`);
    }
  }
  if (world.id !== worldId) {
    errors.push(`${worldId}: world.id "${world.id}" does not match filename "${worldId}"`);
  }
}

function collectEvents(worldId, data) {
  const branchEvents = [];
  const allEventIds = [];

  function walkBranches(branches) {
    for (const branch of (branches || [])) {
      const events = [];

      function walkEras(eras) {
        for (const era of (eras || [])) {
          for (const evt of (era.events || [])) {
            events.push(evt);
            allEventIds.push({ id: evt.id, branchId: branch.id, worldId });
          }
        }
      }

      if (branch.eras && branch.eras.length > 0) {
        walkEras(branch.eras);
      }

      if (branch.subBranches) {
        for (const sub of branch.subBranches) {
          if (sub.endings) {
            for (const ending of sub.endings) {
              ending.isEnding = true;
              ending.id = ending.id || `${branch.id}-${ending.endingNumber}`;
              events.push(ending);
              allEventIds.push({ id: ending.id, branchId: branch.id, worldId });
            }
          }
        }
      }

      branch._events = events;
      branchEvents.push({ branchId: branch.id, branchName: branch.name, events });
    }
  }

  const subEntities = data.subEntities || [];
  for (const entity of subEntities) {
    if (entity.timeline && entity.timeline.branches) {
      walkBranches(entity.timeline.branches);
    }
  }

  if (data.eras && (!subEntities.length || !subEntities[0].timeline || !subEntities[0].timeline.branches || !subEntities[0].timeline.branches[0].eras || subEntities[0].timeline.branches[0].eras.length === 0)) {
    const mainlineEvents = [];
    for (const era of data.eras) {
      for (const evt of (era.events || [])) {
        mainlineEvents.push(evt);
        allEventIds.push({ id: evt.id, branchId: 'mainline', worldId });
      }
    }
    if (mainlineEvents.length > 0 && branchEvents.length > 0 && branchEvents[0].events.length === 0) {
      branchEvents[0].events = mainlineEvents;
    }
  }

  return { branchEvents, allEventIds };
}

function validateEvents(worldId, events) {
  for (const evt of events) {
    const required = evt.isEnding ? EVENT_REQUIRED : EVENT_WITH_DATE_REQUIRED;
    for (const key of required) {
      if (evt[key] === undefined || evt[key] === null || evt[key] === '') {
        errors.push(`${worldId}: event "${evt.id || '(unknown)'}" missing required field "${key}"`);
      }
    }
    if (evt.crossRefs) {
      for (const ref of evt.crossRefs) {
        if (!ref.worldId) {
          errors.push(`${worldId}/${evt.id}: crossRef missing worldId`);
        }
        if (!ref.eventId) {
          errors.push(`${worldId}/${evt.id}: crossRef missing eventId`);
        }
      }
    }
  }
}

function validateCrossRefs(globalEventIds) {
  for (const [worldId, refs] of Object.entries(globalEventIds._refs || {})) {
    for (const ref of refs) {
      if (!globalEventIds._worlds.has(ref.targetWorld)) {
        errors.push(`${worldId}/${ref.sourceEvent}: crossRef target world "${ref.targetWorld}" not found`);
      } else if (!globalEventIds.all.has(ref.targetEvent)) {
        warnings.push(`${worldId}/${ref.sourceEvent}: crossRef target "${ref.targetEvent}" in world "${ref.targetWorld}" not found (may be in unindexed branch)`);
      }
    }
  }
}

function flattenBranchEvents(branch, data) {
  const eras = (branch.eras && branch.eras.length > 0) ? branch.eras : (data.eras || []);
  const events = [];
  for (const era of eras) {
    for (const evt of (era.events || [])) {
      events.push(evt);
    }
  }
  return { eras, events };
}

function flattenWorld(data) {
  const flat = {
    world: { ...data.world },
    branches: [],
  };

  const subEntities = data.subEntities || [];
  for (const entity of subEntities) {
    if (!entity.timeline || !entity.timeline.branches) continue;
    for (const branch of entity.timeline.branches) {
      const { eras, events } = flattenBranchEvents(branch, data);
      const flatBranch = {
        id: branch.id,
        name: branch.name,
        isDefault: branch.isDefault || false,
        type: branch.type,
        eras,
        events,
      };

      if (branch.subBranches) {
        const flatSubBranches = [];
        for (const sub of branch.subBranches) {
          const subFlat = flattenBranchEvents(sub, data);
          const flatSub = {
            id: sub.id,
            name: sub.name,
            type: sub.type,
            divergeAtEventId: sub.divergeAtEventId,
            eras: subFlat.eras,
            events: subFlat.events,
          };
          if (sub.endings) {
            flatSub.endings = sub.endings;
          }
          flatSubBranches.push(flatSub);
        }
        flatBranch.subBranches = flatSubBranches;
      }
      if (branch.divergesTo) {
        flatBranch.divergesTo = branch.divergesTo;
      }

      flat.branches.push(flatBranch);
    }
  }

  return flat;
}

function buildEventIndex(allData) {
  const index = {};
  const duplicates = new Map();

  for (const [worldId, data] of Object.entries(allData)) {
    const subEntities = data.subEntities || [];
    for (const entity of subEntities) {
      if (!entity.timeline || !entity.timeline.branches) continue;
      for (const branch of entity.timeline.branches) {
        const branches = [branch];
        if (branch.subBranches) {
          branches.push(...branch.subBranches);
        }
        for (const b of branches) {
          const eras = b.eras || (data.eras && (!b.eras || b.eras.length === 0) ? data.eras : []);
          if (!eras) continue;
          let evIndex = 0;
          for (const era of eras) {
            for (const evt of (era.events || [])) {
              if (evt.id) {
                if (index[evt.id]) {
                  if (!duplicates.has(evt.id)) {
                    duplicates.set(evt.id, [index[evt.id]]);
                  }
                  duplicates.get(evt.id).push({ worldId, branchId: b.id, eventIndex: evIndex });
                }
                index[evt.id] = { worldId, branchId: b.id, eventIndex: evIndex };
              }
              evIndex++;
            }
          }
          if (b.subBranches) {
            for (const sub of b.subBranches) {
              if (sub.endings) {
                for (const ending of sub.endings) {
                  if (ending.id) {
                    if (index[ending.id]) {
                      if (!duplicates.has(ending.id)) {
                        duplicates.set(ending.id, [index[ending.id]]);
                      }
                      duplicates.get(ending.id).push({ worldId, branchId: b.id });
                    }
                    index[ending.id] = { worldId, branchId: b.id, eventIndex: evIndex };
                  }
                  evIndex++;
                }
              }
            }
          }
        }
      }
    }
  }

  // Report duplicates as warnings (IF branches intentionally share event IDs from diverge points)
  for (const [eventId, locs] of duplicates) {
    const worldIds = [...new Set(locs.map(l => l.worldId))];
    if (worldIds.length > 1) {
      // Cross-world duplicate — this is a true error
      errors.push(`Duplicate eventId "${eventId}" across worlds: ${locs.map(l => `${l.worldId}/${l.branchId}`).join(', ')}`);
    } else {
      // Same-world duplicate — likely IF branch sharing, warn only
      warnings.push(`Duplicate eventId "${eventId}" in ${locs[0].worldId}: shared across branches ${locs.map(l => l.branchId).join(', ')}`);
    }
  }

  return index;
}

async function main() {
  const validateOnly = process.argv.includes('--validate-only');

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   群星之间 · Data Validator & Builder    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  errors = [];
  warnings = [];

  const allRawData = {};
  const allFlatData = {};
  const allEventRefs = { all: new Set(), _worlds: new Set(), _refs: {} };

  for (const worldId of WORLDS) {
    const filePath = path.join(SRC_DATA, `${worldId}.json`);
    console.log(`[validate] Reading ${worldId}.json...`);

    if (!fs.existsSync(filePath)) {
      errors.push(`${worldId}.json not found at ${filePath}`);
      continue;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      allRawData[worldId] = data;
      allEventRefs._worlds.add(worldId);

      validateWorld(worldId, data);

      const { branchEvents, allEventIds } = collectEvents(worldId, data);
      for (const eid of allEventIds) {
        allEventRefs.all.add(eid.id);
      }

      const allFlat = [];
      for (const be of branchEvents) {
        allFlat.push(...be.events);
      }
      validateEvents(worldId, allFlat);

      allEventRefs._refs[worldId] = allFlat
        .filter(e => e.crossRefs)
        .flatMap(e => e.crossRefs.map(r => ({
          sourceEvent: e.id,
          targetWorld: r.worldId,
          targetEvent: r.eventId,
        })));

      allFlatData[worldId] = flattenWorld(data);
    } catch (err) {
      errors.push(`${worldId}.json: parse error — ${err.message}`);
    }
  }

  validateCrossRefs(allEventRefs);

  const eventIndex = buildEventIndex(allRawData);

  if (errors.length > 0) {
    console.log('\n──────────────────────────────────────');
    console.log(`\n❌ ${errors.length} error(s):`);
    for (const e of errors) {
      console.log(`   ${e}`);
    }
    console.log('\nBuild aborted.\n');
    process.exit(1);
  }

  if (validateOnly) {
    console.log('\n✅ Validation passed (no files written).');
    if (warnings.length > 0) {
      console.log(`   ⚠ ${warnings.length} warnings.`);
    }
    return;
  }

  // Write outputs (after 11ty so it doesn't overwrite them)
  fs.mkdirSync(DIST_DATA, { recursive: true });

  for (const worldId of WORLDS) {
    if (allFlatData[worldId]) {
      const outPath = path.join(DIST_DATA, `${worldId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(allFlatData[worldId], null, 2), 'utf-8');
      console.log(`[build] Written ${outPath}`);
    }
  }

  const indexPath = path.join(DIST_DATA, 'event-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(eventIndex, null, 2), 'utf-8');
  console.log(`[build] Written ${indexPath} (${Object.keys(eventIndex).length} events indexed)`);

  // Report
  console.log('\n──────────────────────────────────────');
  if (warnings.length > 0) {
    console.log(`\n⚠ ${warnings.length} warning(s):`);
    // Deduplicate warnings for readability
    const seen = new Set();
    for (const w of warnings) {
      const key = w.substring(0, 80);
      if (!seen.has(key)) {
        console.log(`   ${w}`);
        seen.add(key);
      } else if (seen.size < 5) {
        console.log(`   ... (more similar warnings)`);
      }
    }
    if (warnings.length > 5) {
      console.log(`   ... and ${warnings.length - 5} more`);
    }
  }

  console.log('\n✅ All data validated successfully.');
  console.log(`   ${Object.keys(eventIndex).length} events indexed across ${WORLDS.length} worlds.`);
  if (warnings.length > 0) {
    console.log(`   ⚠ ${warnings.length} warnings (see above).`);
  }
  console.log('');
}

main().catch(err => {
  console.error('[validate] Fatal error:', err);
  process.exit(1);
});