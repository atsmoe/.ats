/* ============================================================
   world-archive.js — Canonical world records behind one Interface
   ============================================================ */

function addRecord(model, record, fallbackId) {
  const id = record.id || fallbackId;
  if (!id) throw new Error('Archive record is missing an ID');
  if (Object.prototype.hasOwnProperty.call(model.recordsById, id)) {
    throw new Error(`Duplicate record ID "${id}"`);
  }
  model.recordsById[id] = record.id ? record : { ...record, id };
  return id;
}

function compileContexts(branches, parentId, model) {
  const contextIds = [];

  for (const branch of branches || []) {
    if (!branch.id) throw new Error('Archive context is missing an ID');
    if (model.contextIds.has(branch.id)) {
      throw new Error(`Duplicate context ID "${branch.id}"`);
    }
    model.contextIds.add(branch.id);
    const sectionIds = [];

    for (let index = 0; index < (branch.eras || []).length; index++) {
      const era = branch.eras[index];
      const sectionId = `${branch.id}:era:${index}`;
      const recordIds = [];
      for (const record of era.events || []) {
        recordIds.push(addRecord(model, record));
      }
      model.sections.push({
        id: sectionId,
        sourceId: era.id || null,
        contextId: branch.id,
        kind: 'era',
        title: era.title || '',
        order: era.order,
        chronologyRank: era.chronologyRank,
        recordIds,
      });
      sectionIds.push(sectionId);
    }

    if ((branch.endings || []).length > 0) {
      const sectionId = `${branch.id}:endings`;
      const recordIds = [];
      for (const ending of branch.endings) {
        if (!ending.id && (ending.endingNumber === undefined || ending.endingNumber === null)) {
          throw new Error(`Ending in context "${branch.id}" needs an id or endingNumber`);
        }
        recordIds.push(addRecord(
          model,
          ending,
          `${branch.id}-ending-${ending.endingNumber}`,
        ));
      }
      model.sections.push({
        id: sectionId,
        contextId: branch.id,
        kind: 'endings',
        title: `结局分支（${recordIds.length}个）`,
        recordIds,
      });
      sectionIds.push(sectionId);
    }

    const childIds = compileContexts(branch.subBranches, branch.id, model);
    model.contexts.push({
      id: branch.id,
      name: branch.name || branch.id,
      description: branch.description || '',
      synopsis: branch.synopsis || branch.description || '',
      order: branch.order,
      status: branch.status,
      type: branch.type,
      sharedPremise: branch.sharedPremise || '',
      topologyMode: branch.topologyMode || 'parallel',
      entityIds: [...(branch.entityIds || [])],
      sources: [...(branch.sources || [])],
      lastReviewedAt: branch.lastReviewedAt || null,
      isDefault: Boolean(branch.isDefault),
      parentId: parentId || branch.parentBranchId || null,
      divergeAtEventId: branch.divergeAtEventId,
      sectionIds,
      childIds,
    });
    contextIds.push(branch.id);
  }

  return contextIds;
}

export function createWorldArchive(data) {
  const model = {
    recordsById: Object.create(null),
    contexts: [],
    sections: [],
    rootContextIds: [],
    contextIds: new Set(),
  };
  model.rootContextIds = compileContexts(data.branches, null, model);
  const contextsById = new Map(model.contexts.map(context => [context.id, context]));
  const sectionsById = new Map(model.sections.map(section => [section.id, section]));
  const archiveMeta = data.archive || {};

  function snapshotBase(lens) {
    return {
      schemaVersion: archiveMeta.schemaVersion || 1,
      sourceVersion: archiveMeta.sourceVersion || null,
      lens,
      world: data.world,
      coverage: archiveMeta.coverage || null,
    };
  }

  return Object.freeze({
    explore(request = {}) {
      const lens = request.lens || 'chronicle';
      if (lens === 'context') {
        const context = contextsById.get(request.contextId);
        if (!context) {
          throw new Error(`Archive context "${request.contextId || ''}" was not found`);
        }
        const sections = context.sectionIds.map(sectionId => sectionsById.get(sectionId));
        const recordsById = Object.create(null);
        for (const section of sections) {
          for (const recordId of section.recordIds) {
            recordsById[recordId] = model.recordsById[recordId];
          }
        }
        return {
          ...snapshotBase('context'),
          context,
          recordsById,
          sections,
          relations: [],
        };
      }

      if (lens === 'collection') {
        const context = contextsById.get(request.contextId);
        if (!context) {
          throw new Error(`Archive context "${request.contextId || ''}" was not found`);
        }
        const contexts = context.childIds
          .map(contextId => contextsById.get(contextId))
          .map(child => ({
            ...child,
            recordCount: child.sectionIds.reduce((count, sectionId) => (
              count + (sectionsById.get(sectionId)?.recordIds.length || 0)
            ), 0),
          }))
          .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER)
            - (right.order ?? Number.MAX_SAFE_INTEGER));
        return {
          ...snapshotBase('collection'),
          context,
          contexts,
          relations: [],
        };
      }

      if (lens === 'dossier') {
        const dossier = (data.archive?.dossiers || [])
          .find(item => item.id === request.dossierId);
        if (!dossier) {
          throw new Error(`Dossier "${request.dossierId || ''}" was not found`);
        }
        const dossierRecords = Object.create(null);
        for (const recordId of dossier.recordIds || []) {
          if (!model.recordsById[recordId]) {
            throw new Error(`Dossier "${dossier.id}" references unknown record "${recordId}"`);
          }
          dossierRecords[recordId] = model.recordsById[recordId];
        }
        const focusId = request.focusId || dossier.defaultRecordId || dossier.recordIds?.[0] || null;
        if (focusId && !dossierRecords[focusId]) {
          throw new Error(`Dossier "${dossier.id}" cannot focus unknown record "${focusId}"`);
        }
        const context = dossier.contextId ? contextsById.get(dossier.contextId) : null;
        if (dossier.contextId && !context) {
          throw new Error(`Dossier "${dossier.id}" references unknown context "${dossier.contextId}"`);
        }
        const relation = dossier.relation
          ? [{ type: dossier.relation, recordIds: [...dossier.recordIds] }]
          : [];

        return {
          ...snapshotBase('dossier'),
          observation: dossier,
          context,
          focusId,
          recordsById: dossierRecords,
          sections: [{
            id: `dossier:${dossier.id}`,
            contextId: dossier.contextId || null,
            kind: 'dossier',
            title: dossier.title || '',
            recordIds: [...(dossier.recordIds || [])],
          }],
          relations: relation,
        };
      }

      if (lens !== 'chronicle') {
        throw new Error(`Unsupported archive lens "${lens}"`);
      }

      return {
        ...snapshotBase('chronicle'),
        recordsById: model.recordsById,
        contexts: model.contexts,
        sections: model.sections,
        rootContextIds: model.rootContextIds,
        relations: [],
      };
    },
  });
}
