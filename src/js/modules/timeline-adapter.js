/* ============================================================
   timeline-adapter.js — ObservationSnapshot → legacy timeline UI
   ============================================================ */

export function projectChronicleTimeline(snapshot) {
  if (!snapshot || snapshot.lens !== 'chronicle') {
    throw new Error('Timeline adapter requires a chronicle ObservationSnapshot');
  }

  const contextsById = new Map(snapshot.contexts.map(context => [context.id, context]));
  const sectionsById = new Map(snapshot.sections.map(section => [section.id, section]));

  function projectContext(contextId) {
    const context = contextsById.get(contextId);
    if (!context) throw new Error(`Timeline context "${contextId}" was not found`);

    const eras = [];
    const endings = [];
    const events = [];

    for (const sectionId of context.sectionIds) {
      const section = sectionsById.get(sectionId);
      if (!section) throw new Error(`Timeline section "${sectionId}" was not found`);
      const records = section.recordIds.map(recordId => snapshot.recordsById[recordId]);
      events.push(...records);
      if (section.kind === 'era') {
        eras.push({ title: section.title, events: records });
      } else if (section.kind === 'endings') {
        endings.push(...records);
      }
    }

    return {
      id: context.id,
      name: context.name,
      description: context.description,
      status: context.status,
      type: context.type,
      isDefault: context.isDefault,
      parentBranchId: context.parentId,
      divergeAtEventId: context.divergeAtEventId,
      eras,
      endings,
      events,
      subBranches: context.childIds.map(projectContext),
    };
  }

  return {
    world: snapshot.world,
    branches: snapshot.rootContextIds.map(projectContext),
  };
}
