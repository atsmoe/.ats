/* ============================================================
   arknights-archive.js — Arknights dossier Adapter
   ============================================================ */

import { ANIM } from './anim-tokens.js';

const DEFAULT_DOSSIER_ID = 'deep-blue-observation';
const SPOILER_STORAGE_KEY = 'ats:spoiler:arknights:v1';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function readSpoilerConsent() {
  try {
    return localStorage.getItem(SPOILER_STORAGE_KEY) === 'accepted';
  } catch (_error) {
    return false;
  }
}

function saveSpoilerConsent() {
  try {
    localStorage.setItem(SPOILER_STORAGE_KEY, 'accepted');
  } catch (_error) {
    // Consent still applies to the current page when storage is unavailable.
  }
}

function setSpoilerLocked(root, gate, locked) {
  const shell = root.querySelector('.ark-archive-shell');
  root.dataset.spoilerLocked = String(locked);
  if (gate) gate.hidden = !locked;
  gate?.setAttribute('aria-hidden', String(!locked));
  if (gate) gate.inert = !locked;
  if (shell) {
    shell.inert = locked;
    shell.setAttribute('aria-hidden', String(locked));
  }
  document.body.classList.toggle('ark-spoiler-locked', locked);
  if (locked) {
    requestAnimationFrame(() => gate?.querySelector('[data-spoiler-accept]')?.focus());
  }
}

function formatRecordIndex(index) {
  return String(index + 1).padStart(2, '0');
}

function appendRecordMeta(container, record) {
  const values = [];
  if (record.location) values.push(`坐标 / ${record.location}`);
  if (record.characters?.length) values.push(`相关 / ${record.characters.join('、')}`);
  if (record.dateDisplay) values.push(`时间 / ${record.dateDisplay}`);
  if (values.length === 0) values.push('时间坐标 / 未记录');

  for (const value of values) container.appendChild(element('span', '', value));
}

function createBrief(snapshot) {
  const dossier = snapshot.observation;
  const brief = element('section', 'ark-dossier-brief');
  brief.dataset.recordCount = String(dossier.recordIds.length).padStart(2, '0');
  brief.appendChild(element('div', 'ark-dossier-code', dossier.code || `DOSSIER / ${dossier.id}`));
  brief.appendChild(element('h2', '', dossier.title));
  brief.appendChild(element('p', 'ark-dossier-question', dossier.question || dossier.title));
  if (dossier.description) {
    brief.appendChild(element('p', 'ark-dossier-description', dossier.description));
  }

  if (snapshot.context) {
    const context = element('div', 'ark-context');
    context.appendChild(element('span', 'ark-context-label', 'COMMON PREMISE / 共同背景'));
    context.appendChild(element('strong', '', snapshot.context.name));
    context.appendChild(element('p', '', snapshot.context.description || '该观测语境暂无补充说明。'));
    brief.appendChild(context);
  }

  if (dossier.exception) {
    brief.appendChild(element('span', 'ark-exception', dossier.exception));
  }
  return brief;
}

function createOutcomeRail(snapshot) {
  const rail = element('div', 'ark-outcome-rail');
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', '可能结果记录');

  snapshot.sections[0].recordIds.forEach((recordId, index) => {
    const record = snapshot.recordsById[recordId];
    const button = element('button', 'ark-outcome-button');
    button.type = 'button';
    button.dataset.archiveRecord = recordId;
    button.id = `ark-outcome-tab-${recordId}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'ark-outcome-detail');
    button.setAttribute('aria-selected', String(recordId === snapshot.focusId));
    button.tabIndex = recordId === snapshot.focusId ? 0 : -1;
    button.appendChild(element('span', '', `POSSIBILITY / ${formatRecordIndex(index)}`));
    button.appendChild(element('strong', '', record.title));
    rail.appendChild(button);
  });

  return rail;
}

function createOutcomeDetail(snapshot, onOpenRecord) {
  const dossier = snapshot.observation;
  const recordIds = snapshot.sections[0].recordIds;
  const recordIndex = recordIds.indexOf(snapshot.focusId);
  const record = snapshot.recordsById[snapshot.focusId];
  const detail = element('article', 'ark-outcome-detail');
  detail.id = 'ark-outcome-detail';
  detail.setAttribute('role', 'tabpanel');
  detail.setAttribute('aria-labelledby', `ark-outcome-tab-${record.id}`);

  const heading = element('header', 'ark-record-heading');
  const headingCopy = element('div');
  headingCopy.appendChild(element('span', 'ark-record-label', 'OBSERVED OUTCOME / 可能记录'));
  headingCopy.appendChild(element('h3', '', record.title));
  heading.appendChild(headingCopy);
  heading.appendChild(element('span', 'ark-record-index', formatRecordIndex(recordIndex)));
  detail.appendChild(heading);

  const meta = element('div', 'ark-record-meta');
  appendRecordMeta(meta, record);
  detail.appendChild(meta);
  detail.appendChild(element('p', 'ark-record-body', record.description || '该记录暂无正文。'));

  if (record.conditions) {
    detail.appendChild(element('p', 'ark-record-conditions', `观测条件 / ${record.conditions}`));
  }

  const actions = element('div', 'ark-record-actions');
  const open = element('button', 'ark-record-open', '打开完整记录');
  open.type = 'button';
  open.dataset.openArchiveRecord = record.id;
  if (typeof onOpenRecord !== 'function') open.disabled = true;
  actions.appendChild(open);

  const sourceCount = record.prtsSources?.length || 0;
  const sourceLabel = sourceCount > 0
    ? `${sourceCount} 条具体来源随完整记录展示`
    : (record.sourceStatus || snapshot.coverage?.sourceNote || dossier.exception || '来源仍待补充');
  actions.appendChild(element('span', 'ark-record-source-note', sourceLabel));
  detail.appendChild(actions);

  return detail;
}

function createGaps(coverage) {
  if (!coverage?.knownGaps?.length) return null;
  const gaps = element('div', 'ark-dossier-gaps');
  gaps.appendChild(element('strong', '', 'KNOWN GAPS /'));
  gaps.appendChild(element('span', '', coverage.knownGaps.join(' · ')));
  return gaps;
}

function renderDossier(container, snapshot, onOpenRecord) {
  const layout = element('div', 'ark-dossier-layout');
  layout.appendChild(createBrief(snapshot));

  const consolePanel = element('section', 'ark-outcome-console');
  consolePanel.appendChild(createOutcomeRail(snapshot));
  consolePanel.appendChild(createOutcomeDetail(snapshot, onOpenRecord));
  layout.appendChild(consolePanel);

  const gaps = createGaps(snapshot.coverage);
  if (gaps) layout.appendChild(gaps);
  container.replaceChildren(layout);
  container.setAttribute('aria-busy', 'false');
  const status = document.getElementById('ark-dossier-status');
  const focusedRecord = snapshot.recordsById[snapshot.focusId];
  if (status && focusedRecord) status.textContent = `已切换到可能记录：${focusedRecord.title}`;
}

function renderArchiveError(container) {
  const error = element('div', 'ark-dossier-loading');
  error.appendChild(element('span'));
  error.appendChild(element('p', '', '档案信号无法解译，请使用下方完整编年索引。'));
  container.replaceChildren(error);
  container.setAttribute('aria-busy', 'false');
}

function updateCoverage(root, snapshot) {
  const coverage = snapshot.coverage || {};
  const sourceVersion = root.querySelector('[data-archive-source-version]');
  const status = root.querySelector('[data-archive-status]');
  const updated = root.querySelector('[data-archive-updated]');
  const scope = root.querySelector('[data-archive-scope]');
  if (sourceVersion) sourceVersion.textContent = snapshot.sourceVersion || 'SOURCE VERSION / UNKNOWN';
  if (status) status.textContent = coverage.status || '未标记';
  if (updated) updated.textContent = coverage.updatedAt || '未记录';
  if (scope) scope.textContent = coverage.scope || '覆盖范围未声明';
}

function readLocationState() {
  const params = new URLSearchParams(location.search);
  return {
    dossierId: params.get('dossier') || DEFAULT_DOSSIER_ID,
    focusId: params.get('record') || null,
  };
}

function writeLocationState(dossierId, focusId) {
  const url = new URL(location.href);
  url.searchParams.set('dossier', dossierId);
  url.searchParams.set('record', focusId);
  history.replaceState(history.state, '', url);
}

export function initArknightsArchive({ archive, onOpenRecord } = {}) {
  const root = document.getElementById('ark-archive');
  const container = document.getElementById('ark-dossier');
  const gate = document.getElementById('ark-spoiler-gate');
  if (!root || !container) return null;
  const supportsBackdrop = typeof CSS !== 'undefined'
    && (CSS.supports('backdrop-filter', 'blur(1px)')
      || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
  root.classList.toggle('ark-no-backdrop', !supportsBackdrop);
  root.style.setProperty(
    '--archive-motion-signal',
    `${ANIM.duration.ambient}ms ${ANIM.easing.inOut}`,
  );
  root.style.setProperty(
    '--archive-motion-loading',
    `${ANIM.duration.loading}ms ${ANIM.easing.inOut}`,
  );
  root.style.setProperty(
    '--archive-motion-scan',
    `${ANIM.duration.scan}ms ${ANIM.easing.out}`,
  );
  if (!archive) {
    renderArchiveError(container);
    setSpoilerLocked(root, gate, false);
    return null;
  }

  const state = readLocationState();
  let snapshot;

  function selectRecord(recordId, { updateUrl = true, focusTab = false } = {}) {
    snapshot = archive.explore({
      lens: 'dossier',
      dossierId: state.dossierId,
      focusId: recordId,
    });
    state.focusId = snapshot.focusId;
    renderDossier(container, snapshot, onOpenRecord);
    if (updateUrl) writeLocationState(state.dossierId, snapshot.focusId);
    if (focusTab) {
      container.querySelector(`[data-archive-record="${snapshot.focusId}"]`)?.focus();
    }
  }

  try {
    snapshot = archive.explore({
      lens: 'dossier',
      dossierId: state.dossierId,
      focusId: state.focusId || undefined,
    });
  } catch (_error) {
    try {
      state.dossierId = DEFAULT_DOSSIER_ID;
      snapshot = archive.explore({ lens: 'dossier', dossierId: state.dossierId });
    } catch (_fallbackError) {
      renderArchiveError(container);
      setSpoilerLocked(root, gate, false);
      return null;
    }
  }

  state.focusId = snapshot.focusId;
  updateCoverage(root, snapshot);
  renderDossier(container, snapshot, onOpenRecord);
  setSpoilerLocked(root, gate, !readSpoilerConsent());

  function onClick(event) {
    const accept = event.target.closest('[data-spoiler-accept]');
    if (accept) {
      saveSpoilerConsent();
      setSpoilerLocked(root, gate, false);
      root.querySelector('[data-archive-record][aria-selected="true"]')?.focus();
      return;
    }

    const recordTab = event.target.closest('[data-archive-record]');
    if (recordTab) {
      selectRecord(recordTab.dataset.archiveRecord, { focusTab: true });
      return;
    }

    const open = event.target.closest('[data-open-archive-record]');
    if (open && typeof onOpenRecord === 'function') {
      onOpenRecord(snapshot.recordsById[open.dataset.openArchiveRecord]);
    }
  }

  function onKeyDown(event) {
    if (root.dataset.spoilerLocked === 'true' && event.key === 'Tab') {
      const focusable = [...(gate?.querySelectorAll('button:not([disabled]), a[href]') || [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    const current = event.target.closest('[data-archive-record]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const ids = snapshot.sections[0].recordIds;
    const currentIndex = ids.indexOf(current.dataset.archiveRecord);
    let nextId;
    if (event.key === 'Home') nextId = ids[0];
    else if (event.key === 'End') nextId = ids[ids.length - 1];
    else {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      nextId = ids[(currentIndex + direction + ids.length) % ids.length];
    }
    selectRecord(nextId, { focusTab: true });
  }

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);

  return {
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('ark-spoiler-locked');
    },
  };
}
