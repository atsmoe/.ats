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

  function collectBranch(branch) {
    const events = [];

    for (const era of (branch.eras || [])) {
      for (const evt of (era.events || [])) {
        events.push(evt);
        allEventIds.push({ id: evt.id, branchId: branch.id, worldId });
      }
    }

    for (const ending of (branch.endings || [])) {
      if (!ending.id && (ending.endingNumber === undefined || ending.endingNumber === null)) {
        errors.push(`${worldId}/${branch.id}: ending needs an id or endingNumber`);
        continue;
      }
      ending.isEnding = true;
      ending.id = ending.id || `${branch.id}-ending-${ending.endingNumber}`;
      events.push(ending);
      allEventIds.push({ id: ending.id, branchId: branch.id, worldId });
    }

    branch._events = events;
    branchEvents.push({ branchId: branch.id, branchName: branch.name, events });

    for (const sub of (branch.subBranches || [])) {
      collectBranch(sub);
    }
  }

  const subEntities = data.subEntities || [];
  for (const entity of subEntities) {
    if (entity.timeline && entity.timeline.branches) {
      for (const branch of entity.timeline.branches) collectBranch(branch);
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
    // Progressive image schema: width/height are optional, but if present must be Number
    if (evt.images) {
      for (let i = 0; i < evt.images.length; i++) {
        const img = evt.images[i];
        if (!img.src) {
          warnings.push(`${worldId}/${evt.id}: images[${i}] missing "src"`);
        }
        if (img.hasOwnProperty('width') && typeof img.width !== 'number') {
          warnings.push(`${worldId}/${evt.id}: images[${i}].width should be a Number, got ${typeof img.width}`);
        }
        if (img.hasOwnProperty('height') && typeof img.height !== 'number') {
          warnings.push(`${worldId}/${evt.id}: images[${i}].height should be a Number, got ${typeof img.height}`);
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

function flattenBranchEvents(branch) {
  // Only return eras — the flat events array is rebuilt at runtime
  // by data-loader.js to avoid doubling the JSON payload.
  return { eras: branch.eras || [] };
}

function archiveValidationErrors(worldId, data) {
  const archiveErrors = [];
  if (!data.archive) return archiveErrors;

  const contextIds = new Set();
  const recordIds = new Set();
  const PLACEHOLDER_COPY = /待完工|待补充|稍后补充|\b(?:TODO|TBD)\b/i;

  function hasTraceableSource(sources) {
    return Array.isArray(sources) && sources.some(source => (
      source
      && typeof source.title === 'string'
      && source.title.trim().length > 0
      && typeof source.url === 'string'
      && /^https?:\/\//.test(source.url)
    ));
  }

  function visitBranch(branch) {
    if (!branch.id) {
      archiveErrors.push(`${worldId}: archive context is missing an id`);
    } else if (contextIds.has(branch.id)) {
      archiveErrors.push(`${worldId}: duplicate archive context "${branch.id}"`);
    } else {
      contextIds.add(branch.id);
    }

    for (const era of branch.eras || []) {
      for (const event of era.events || []) {
        if (event.id) recordIds.add(event.id);
      }
    }
    for (const ending of branch.endings || []) {
      if (ending.id) recordIds.add(ending.id);
      else if (branch.id && ending.endingNumber !== undefined && ending.endingNumber !== null) {
        recordIds.add(`${branch.id}-ending-${ending.endingNumber}`);
      }
    }

    if (branch.type === 'integrated-strategy') {
      const label = `${worldId}/${branch.id || '(missing context id)'}`;
      for (const field of [
        'order',
        'description',
        'sharedPremise',
        'continuityNote',
        'storyBeats',
        'topologyMode',
        'endingPriority',
        'lastReviewedAt',
      ]) {
        if (branch[field] === undefined || branch[field] === null || branch[field] === '') {
          archiveErrors.push(`${label}: missing required field "${field}"`);
        }
      }
      if (PLACEHOLDER_COPY.test(`${branch.name || ''} ${branch.description || ''}`)) {
        archiveErrors.push(`${label}: contains placeholder copy`);
      }
      if (!Array.isArray(branch.storyBeats) || branch.storyBeats.length < 3) {
        archiveErrors.push(`${label}: needs at least three story beats`);
      } else {
        for (const [index, beat] of branch.storyBeats.entries()) {
          if (
            typeof beat?.title !== 'string'
            || beat.title.trim().length === 0
            || typeof beat?.description !== 'string'
            || beat.description.trim().length < 12
            || PLACEHOLDER_COPY.test(`${beat.title} ${beat.description}`)
          ) {
            archiveErrors.push(`${label}: storyBeats[${index}] needs a title and substantive description`);
          }
        }
      }
      if (!hasTraceableSource(branch.sources)) {
        archiveErrors.push(`${label}: needs at least one traceable source`);
      }
      if (!Array.isArray(branch.endings) || branch.endings.length === 0) {
        archiveErrors.push(`${label}: needs at least one ending`);
      }
      const endingPriority = branch.endingPriority;
      if (!endingPriority || typeof endingPriority !== 'object' || Array.isArray(endingPriority)) {
        archiveErrors.push(`${label}: needs a structured endingPriority`);
      } else {
        if (typeof endingPriority.note !== 'string' || endingPriority.note.trim().length < 18) {
          archiveErrors.push(`${label}: endingPriority needs a substantive note`);
        }
        if (!Array.isArray(endingPriority.items)) {
          archiveErrors.push(`${label}: endingPriority.items must be an array`);
        } else {
          const endingIds = new Set((branch.endings || []).map(ending => ending.id));
          const priorityIds = new Set();
          const priorityValues = new Set();
          let previousPriority = Number.POSITIVE_INFINITY;
          for (const [index, item] of endingPriority.items.entries()) {
            const priorityLabel = `${label}/endingPriority.items[${index}]`;
            if (!endingIds.has(item?.recordId)) {
              archiveErrors.push(`${priorityLabel}: references an unknown ending`);
            } else if (priorityIds.has(item.recordId)) {
              archiveErrors.push(`${priorityLabel}: duplicates ending "${item.recordId}"`);
            }
            priorityIds.add(item?.recordId);
            if (!Number.isInteger(item?.priority) || item.priority < 0) {
              archiveErrors.push(`${priorityLabel}: priority must be a non-negative integer`);
            } else {
              if (priorityValues.has(item.priority)) {
                archiveErrors.push(`${priorityLabel}: duplicates priority P${item.priority}`);
              }
              if (item.priority >= previousPriority) {
                archiveErrors.push(`${priorityLabel}: items must be ordered from highest to lowest priority`);
              }
              priorityValues.add(item.priority);
              previousPriority = item.priority;
            }
            for (const field of ['routeKey', 'condition', 'outcome']) {
              if (typeof item?.[field] !== 'string' || item[field].trim().length < 4) {
                archiveErrors.push(`${priorityLabel}: needs "${field}"`);
              }
            }
            if (item?.triggerMode && item.triggerMode !== 'event') {
              archiveErrors.push(`${priorityLabel}: unknown triggerMode "${item.triggerMode}"`);
            }
          }
          if (priorityIds.size !== endingIds.size) {
            archiveErrors.push(`${label}: endingPriority must cover every ending exactly once`);
          }
        }
      }
      for (const ending of branch.endings || []) {
        const fallbackId = branch.id && ending.endingNumber !== undefined
          ? `${branch.id}-ending-${ending.endingNumber}`
          : '(unknown ending)';
        const endingLabel = `${label}/${ending.id || fallbackId}`;
        if (!ending.id) {
          archiveErrors.push(
            `${label}: ending ${ending.endingNumber ?? '?'} needs an explicit stable id`,
          );
        }
        if (PLACEHOLDER_COPY.test(`${ending.title || ''} ${ending.description || ''}`)) {
          archiveErrors.push(`${endingLabel}: contains placeholder copy`);
        }
        if (
          typeof ending.aftermath !== 'string'
          || ending.aftermath.trim().length < 12
          || PLACEHOLDER_COPY.test(ending.aftermath)
        ) {
          archiveErrors.push(
            `${endingLabel}: needs a substantive aftermath`,
          );
        }
        if (!hasTraceableSource(ending.sources)) {
          archiveErrors.push(
            `${endingLabel}: needs at least one traceable source`,
          );
        }

        const guide = ending.routeGuide;
        if (!guide || typeof guide !== 'object' || Array.isArray(guide)) {
          archiveErrors.push(`${endingLabel}: needs a structured routeGuide`);
          continue;
        }
        for (const field of [
          'prerequisites',
          'steps',
          'requiredState',
          'forbiddenState',
          'optionalSteps',
          'warnings',
        ]) {
          if (!Array.isArray(guide[field])) {
            archiveErrors.push(`${endingLabel}: routeGuide.${field} must be an array`);
          }
        }
        if (!Array.isArray(guide.prerequisites) || guide.prerequisites.length === 0) {
          archiveErrors.push(`${endingLabel}: routeGuide needs at least one prerequisite note`);
        }
        if (!Array.isArray(guide.steps) || guide.steps.length === 0) {
          archiveErrors.push(`${endingLabel}: routeGuide needs at least one route step`);
        }
        for (const [stepIndex, step] of [
          ...(guide.steps || []),
          ...(guide.optionalSteps || []),
        ].entries()) {
          for (const field of ['stage', 'node', 'event', 'trigger', 'choice', 'result']) {
            if (typeof step?.[field] !== 'string' || step[field].trim().length === 0) {
              archiveErrors.push(`${endingLabel}: route step ${stepIndex + 1} needs "${field}"`);
            }
          }
        }
        for (const field of ['stage', 'operation', 'entry']) {
          if (
            typeof guide.finalBattle?.[field] !== 'string'
            || guide.finalBattle[field].trim().length === 0
          ) {
            archiveErrors.push(`${endingLabel}: routeGuide.finalBattle needs "${field}"`);
          }
        }
      }
    }
    for (const child of branch.subBranches || []) visitBranch(child);
  }

  for (const entity of data.subEntities || []) {
    for (const branch of entity.timeline?.branches || []) visitBranch(branch);
  }

  const dossierIds = new Set();
  for (const dossier of data.archive.dossiers || []) {
    const dossierLabel = dossier.id || '(missing id)';
    if (!dossier.id) {
      archiveErrors.push(`${worldId}: archive dossier is missing an id`);
    } else if (dossierIds.has(dossier.id)) {
      archiveErrors.push(`${worldId}: duplicate archive dossier "${dossier.id}"`);
    }
    dossierIds.add(dossier.id);

    if (dossier.contextId && !contextIds.has(dossier.contextId)) {
      archiveErrors.push(`${worldId}/${dossierLabel}: unknown context "${dossier.contextId}"`);
    }
    if (!Array.isArray(dossier.recordIds) || dossier.recordIds.length === 0) {
      archiveErrors.push(`${worldId}/${dossierLabel}: recordIds must contain at least one record`);
      continue;
    }
    for (const recordId of dossier.recordIds) {
      if (!recordIds.has(recordId)) {
        archiveErrors.push(`${worldId}/${dossierLabel}: unknown record "${recordId}"`);
      }
    }
    if (dossier.defaultRecordId && !dossier.recordIds.includes(dossier.defaultRecordId)) {
      archiveErrors.push(
        `${worldId}/${dossierLabel}: defaultRecordId "${dossier.defaultRecordId}" is not in recordIds`,
      );
    }
  }

  return archiveErrors;
}

function flattenBranch(branch) {
  const flatBranch = {
    id: branch.id,
    name: branch.name,
    isDefault: branch.isDefault || false,
    type: branch.type,
    eras: flattenBranchEvents(branch).eras,
  };

  for (const key of [
    'description',
    'synopsis',
    'order',
    'status',
    'parentBranchId',
    'divergeAtEventId',
    'sharedPremise',
    'continuityNote',
    'storyBeats',
    'topologyMode',
    'endingPriority',
    'entityIds',
    'sources',
    'lastReviewedAt',
  ]) {
    if (branch[key] !== undefined) flatBranch[key] = branch[key];
  }
  if (branch.subBranches) {
    flatBranch.subBranches = branch.subBranches.map(flattenBranch);
  }
  if (branch.endings) {
    flatBranch.endings = branch.endings;
  }
  if (branch.divergesTo) {
    flatBranch.divergesTo = branch.divergesTo;
  }

  return flatBranch;
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
      flat.branches.push(flattenBranch(branch));
    }
  }

  if (data.archive) {
    flat.archive = data.archive;
  }

  return flat;
}

function buildEventIndex(allData) {
  const index = {};
  const duplicates = new Map();

  function addEvent(eventId, location) {
    if (!eventId) return;
    if (index[eventId]) {
      if (!duplicates.has(eventId)) duplicates.set(eventId, [index[eventId]]);
      duplicates.get(eventId).push(location);
      return;
    }
    index[eventId] = location;
  }

  function indexBranch(worldId, branch) {
    let eventIndex = 0;
    for (const era of (branch.eras || [])) {
      for (const evt of (era.events || [])) {
        addEvent(evt.id, { worldId, branchId: branch.id, eventIndex });
        eventIndex++;
      }
    }

    for (const ending of (branch.endings || [])) {
      addEvent(ending.id, { worldId, branchId: branch.id, eventIndex });
      eventIndex++;
    }

    for (const sub of (branch.subBranches || [])) {
      indexBranch(worldId, sub);
    }
  }

  for (const [worldId, data] of Object.entries(allData)) {
    const subEntities = data.subEntities || [];
    for (const entity of subEntities) {
      if (!entity.timeline || !entity.timeline.branches) continue;
      for (const branch of entity.timeline.branches) {
        indexBranch(worldId, branch);
      }
    }
  }

  // Event IDs are global navigation keys. Any duplicate makes deep links ambiguous.
  for (const [eventId, locs] of duplicates) {
    errors.push(`Duplicate eventId "${eventId}": ${locs.map(l => `${l.worldId}/${l.branchId}`).join(', ')}`);
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

      errors.push(...archiveValidationErrors(worldId, data));

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
      fs.writeFileSync(outPath, JSON.stringify(allFlatData[worldId]), 'utf-8');
      console.log(`[build] Written ${outPath}`);
    }
  }

  const indexPath = path.join(DIST_DATA, 'event-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(eventIndex), 'utf-8');
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

if (require.main === module) {
  main().catch(err => {
    console.error('[validate] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { archiveValidationErrors };
