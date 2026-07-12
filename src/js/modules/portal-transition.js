/* ═══════════════════════════════════════════════════════════
   portal-transition.js — Portal outgoing + incoming animations
   ═══════════════════════════════════════════════════════════ */

let _data = null;

export function setData(data) {
  _data = data;
}

/**
 * Search _data.branches for an event and return its location.
 * @param {string} eventId
 * @returns {{ branchId: string, branchName: string, eventIndex: number } | null}
 */
function findBranch(branches, predicate) {
  for (const branch of (branches || [])) {
    if (predicate(branch)) return branch;
    const nested = findBranch(branch.subBranches, predicate);
    if (nested) return nested;
  }
  return null;
}

export function findEventLocation(eventId) {
  if (!_data) return null;
  const branch = findBranch(_data.branches, candidate =>
    (candidate.events || []).some(event => event.id === eventId));
  if (!branch) return null;

  return {
    branchId: branch.id,
    branchName: branch.name,
    eventIndex: branch.events.findIndex(event => event.id === eventId),
  };
}

/**
 * Build era groups for a given branch, matching the structure
 * expected by VirtualTimeline.load() and timeline-ui.js:getEraGroups().
 * @param {string} branchId
 * @returns {Array<{type: string, eraTitle: string, events: Array}>}
 */
export function buildBranchEraGroups(branchId) {
  if (!_data) return [];
  const branch = findBranch(_data.branches, candidate => candidate.id === branchId);
  if (!branch) return [];

  const groups = [];
  if (branch.description) {
    groups.push({
      type: 'notice',
      data: {
        type: 'branch-notice',
        title: branch.name,
        description: branch.description,
        isBranchNotice: true,
      },
    });
  }

  groups.push(...(branch.eras || []).map(era => ({
      type: 'era',
      eraTitle: era.title,
      events: era.events || [],
    })));

  if (branch.endings && branch.endings.length > 0) {
    groups.push({
      type: 'if-endings',
      eraTitle: '结局分支（' + branch.endings.length + '个）',
      events: branch.endings.map(ending => ({
        ...ending,
        id: ending.id || branch.id + '-ending-' + ending.endingNumber,
        dateDisplay: ending.dateDisplay || '结局 ' + ending.endingNumber,
        tags: ending.tags || [branch.type || 'IF', '结局'],
        isEnding: true,
      })),
    });
  }

  return groups;
}

/**
 * Portal arrival handler — replaces the old "disable virtual scroll → full DOM render"
 * with a direct VirtualTimeline.load() + estimated scroll positioning.
 * Only renders ~15 viewport-adjacent DOM nodes regardless of event count.
 */
export function initPortalArrival() {
  const hash = window.location.hash;
  if (!hash) {
    dismissPortal();
    return;
  }

  const eventId = hash.replace('#', '');
  const portalDiv = document.getElementById('portal-arrival');
  if (!portalDiv) {
    dismissPortal();
    return;
  }

  if (!_data) {
    console.warn('portal-arrival: no data loaded');
    dismissPortal();
    return;
  }

  // 1. Locate the target event within branch data
  const loc = findEventLocation(eventId);
  if (!loc) {
    dismissPortal();
    return;
  }

  // 2. Build era groups and hand off to VirtualTimeline
  const eraGroups = buildBranchEraGroups(loc.branchId);
  if (eraGroups.length === 0) {
    dismissPortal();
    return;
  }

  if (typeof VirtualTimeline !== 'undefined') {
    VirtualTimeline.clear();
    VirtualTimeline.container = document.getElementById('tl-container');
    VirtualTimeline.load(eraGroups);
    // Rebuild era nav from the newly loaded items
    if (typeof buildEraNav === 'function') buildEraNav();
  }

  // 3. Scroll to target — if close to top, let natural viewport cover it;
  //    otherwise use estimated offset to jump near the target.
  if (typeof VirtualTimeline !== 'undefined') {
    if (loc.eventIndex <= 20) {
      window.scrollTo(0, 0);
    } else {
      const targetTop = VirtualTimeline.estimateScrollTopByEventId(eventId);
      if (targetTop > 0) {
        window.scrollTo(0, targetTop - window.innerHeight * 0.3);
      }
    }

    // 4. Trigger first render + remeasure cycle
    VirtualTimeline.update();
    if (typeof updateEraNavHighlight === 'function') updateEraNavHighlight();

    const eraNav = document.getElementById('era-nav');
    if (eraNav && eraGroups.length > 0) {
      eraNav.classList.add('active');
    }
  }

  // 5. Double rAF — wait for layout + paint, then play arrival animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      playArrivalAnimation(portalDiv, eventId);
    });
  });
}

function playArrivalAnimation(portalDiv, eventId) {
  const targetEl = document.getElementById(eventId);
  if (!targetEl) {
    dismissPortal();
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const W = window.innerWidth;
  const H = window.innerHeight;

  // Use canvas particle overlay for reverse wormhole
  const wormholeCanvas = document.getElementById('wormhole');
  const whCtx = wormholeCanvas.getContext('2d');
  let progress = 0;

  function step() {
    progress += 0.02;
    if (progress >= 1) {
      whCtx.clearRect(0, 0, W, H);
      wormholeCanvas.classList.remove('active');
      dismissPortal();
      // VirtualTimeline already loaded with correct branch — no need to reload
      return;
    }

    whCtx.clearRect(0, 0, W, H);
    const t = 1 - progress; // Reverse: start large, shrink to target

    // Wormhole radius shrinking
    const maxRadius = Math.max(W, H);
    const targetRadius = 40;
    const radius = targetRadius + maxRadius * t * t;

    const cx = centerX;
    const cy = centerY;
    const gradient = whCtx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
    gradient.addColorStop(0, `rgba(240,216,120,${t * 0.9})`);
    gradient.addColorStop(0.3, `rgba(201,160,80,${t * 0.6})`);
    gradient.addColorStop(0.6, `rgba(160,120,60,${t * 0.3})`);
    gradient.addColorStop(0.85, 'rgba(8,8,16,0.1)');
    gradient.addColorStop(1, 'rgba(8,8,16,0)');
    whCtx.fillStyle = gradient;
    whCtx.fillRect(0, 0, W, H);

    // Spiral particles converging
    const numParticles = 60;
    const spinAngle = t * Math.PI * 8;
    for (let i = 0; i < numParticles; i++) {
      const angle = (i / numParticles) * Math.PI * 2 + spinAngle;
      const dist = radius * 0.8;
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist * 0.3;
      const alpha = t;
      whCtx.beginPath();
      whCtx.arc(px, py, 1.5, 0, Math.PI * 2);
      whCtx.fillStyle = `rgba(240,216,120,${alpha})`;
      whCtx.fill();
    }

    // Also fade overlay div
    portalDiv.style.opacity = Math.max(0, t * 2 - 0.5);

    requestAnimationFrame(step);
  }

  wormholeCanvas.classList.add('active');
  step();
}

function dismissPortal() {
  const portalDiv = document.getElementById('portal-arrival');
  if (portalDiv) {
    portalDiv.classList.add('fade-out');
    setTimeout(() => {
      if (portalDiv.parentNode) portalDiv.parentNode.removeChild(portalDiv);
    }, 500);
  }
}

/**
 * Outgoing portal effect — triggered on cross-world link click
 * @param {Event} e - click event
 * @param {string} targetUrl - destination URL
 */
export function playPortalOutgoing(e, targetUrl) {
  e.preventDefault();
  const clickX = e.clientX;
  const clickY = e.clientY;

  const wormholeCanvas = document.getElementById('wormhole');
  const whCtx = wormholeCanvas.getContext('2d');
  const W = wormholeCanvas.width = window.innerWidth;
  const H = wormholeCanvas.height = window.innerHeight;
  let progress = 0;

  function step() {
    progress += 0.025;
    if (progress >= 1) {
      whCtx.clearRect(0, 0, W, H);
      window.location.href = targetUrl;
      return;
    }

    whCtx.clearRect(0, 0, W, H);

    // Wormhole expanding from click point
    const radius = progress * progress * Math.max(W, H);

    const gradient = whCtx.createRadialGradient(clickX, clickY, radius * 0.1, clickX, clickY, radius);
    gradient.addColorStop(0, `rgba(240,216,120,${progress * 0.9})`);
    gradient.addColorStop(0.3, `rgba(201,160,80,${progress * 0.7})`);
    gradient.addColorStop(0.7, `rgba(8,8,16,${progress * 0.5})`);
    gradient.addColorStop(1, 'rgba(8,8,16,0)');
    whCtx.fillStyle = gradient;
    whCtx.fillRect(0, 0, W, H);

    // Spiral particles expanding out
    const numParticles = 80;
    const spinAngle = progress * Math.PI * 6;
    for (let i = 0; i < numParticles; i++) {
      const angle = (i / numParticles) * Math.PI * 2 + spinAngle;
      const dist = radius * (0.3 + progress * 0.7);
      const px = clickX + Math.cos(angle) * dist;
      const py = clickY + Math.sin(angle) * dist * 0.3;
      const alpha = progress;
      whCtx.beginPath();
      whCtx.arc(px, py, 1 + progress * 2, 0, Math.PI * 2);
      whCtx.fillStyle = `rgba(240,216,120,${alpha})`;
      whCtx.fill();
    }

    requestAnimationFrame(step);
  }

  wormholeCanvas.classList.add('active');
  step();
}
