/* ═══════════════════════════════════════════════════════════
   VirtualTimeline — only renders events in viewport
   Handles 10k+ events with constant DOM node count (~15)
   ═══════════════════════════════════════════════════════════ */

const VirtualTimeline = {
  container: null,
  items: [],           // flattened list of { type, data, height }
  renderedRange: { start: 0, end: 0 },
  visibleSet: new Set(),
  nodePool: new Map(), // type → reusable DOM nodes
  observer: null,
  scrollTicking: false,
  estimatedTotalHeight: 0,

  /**
   * Estimate height based on content.
   * Card content width ≈ 384px (440px card - 56px padding).
   * Chinese char ≈ 14px wide at 14px font → ~27 chars per line.
   * Line height ≈ 24px (14px * 1.7).
   * Margin between event cards: 80px.
   */
  _estimateHeight(item) {
    const CHARS_PER_LINE = 26;
    const LINE_HEIGHT = 24;
    const MARGIN = 24;           // ~1 line spacing between consecutive cards

    switch (item.type) {
      case 'era-header': return 140; // 80px clearance + 24px text + 36px gap
      case 'notice': {
        const desc = item.data.description || '';
        const lines = Math.ceil(desc.length / (CHARS_PER_LINE + 4)); // wider text area for notice
        return 56 + lines * 22 + 40;
      }
      case 'event': {
        const evt = item.data;
        // Card internal padding: 24px top + 24px bottom = 48px
        // Date line: 14px + 8px gap = 22px
        // Title: 20px + 10px gap = 30px
        let h = 48 + 22 + 30;

        // Meta line (location | characters): 14px + 10px gap
        if (evt.location || (evt.characters && evt.characters.length > 0)) h += 24;

        // Detail content (description/image/sources) only in modal, not on card

        // Conditions block
        if (evt.conditions) {
          const condLines = Math.ceil(evt.conditions.length / (CHARS_PER_LINE + 2));
          h += condLines * 18 + 28;
        }

        // Tags row
        if (evt.tags && evt.tags.length > 0) h += 32;

        // Cross-world ref link
        if (evt.crossRefs && evt.crossRefs.length > 0) h += 28;

        // Diverge badge
        if (evt.isDivergePoint) h += 30;

        // Add margin between cards
        return h + MARGIN;
      }
      default: return 180;
    }
  },

  /** Flatten era groups into a single item list */
  load(items) {
    this.items = [];
    let total = 0;
    // Wrap in a container div so we can set its total height
    this.container.style.position = 'relative';
    this.container.style.minHeight = '100vh';

    // Calculate total height from all items
    for (const group of items) {
      // era header
      const hH = this._estimateHeight({ type: 'era-header' });
      this.items.push({ type: 'era-header', data: group.eraTitle, top: total, height: hH });
      total += hH;

      for (const evt of group.events) {
        if (evt.isBranchNotice) {
          const hN = this._estimateHeight({ type: 'notice' });
          this.items.push({ type: 'notice', data: evt, top: total, height: hN });
          total += hN;
        } else {
          const hE = this._estimateHeight({ type: 'event', data: evt });
          this.items.push({ type: 'event', data: evt, top: total, height: hE, idx: this.items.length });
          total += hE;
        }
      }
    }

    this.estimatedTotalHeight = Math.max(total, window.innerHeight);
    this.renderedRange = { start: 0, end: 0 };
    this.nodePool.clear();
  },

  /**
   * Estimate the scrollTop needed to bring a specific event into view.
   * Pure function — reads this.items (set by load()), no side effects.
   * @param {string} eventId
   * @returns {number} scroll offset in px, or 0 if not found
   */
  estimateScrollTopByEventId(eventId) {
    if (!this.items || this.items.length === 0) return 0;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.type === 'event' && item.data && item.data.id === eventId) {
        return item.top;
      }
    }
    return 0;
  },

  /** Get visible range based on scroll position */
  _getVisibleRange() {
    const viewTop = window.scrollY - window.innerHeight * 0.5;
    const viewBottom = window.scrollY + window.innerHeight * 1.5;

    let start = 0, end = this.items.length;
    // Binary search for first visible
    let lo = 0, hi = this.items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid].top + this.items[mid].height < viewTop) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    start = Math.max(0, lo - 2); // 2-item buffer above

    lo = start; hi = this.items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid].top > viewBottom) {
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    end = Math.min(this.items.length, lo + 2); // 2-item buffer below

    return { start, end };
  },

  /** Create a DOM node for an item (reuse from pool if possible) */
  _buildNode(item, globalIdx) {
    if (item.type === 'era-header') {
      const el = document.createElement('div');
      el.className = 'tl-era-header visible';
      el.style.paddingTop = '80px';  // clearance from previous card
      el.style.zIndex = '2';         // render above event cards
      el.innerHTML = '<span class="era-line"></span><span class="era-title">' + item.data + '</span><span class="era-line"></span>';
      return el;
    }

    if (item.type === 'notice') {
      const el = document.createElement('div');
      el.className = 'diverge-inline visible';
      el.innerHTML = '<div class="diamond"></div> ' + item.data.title + '<br><span>' + (item.data.description || '') + '</span>';
      return el;
    }

    // Regular event
    const evt = item.data;
    const side = globalIdx % 2 === 0 ? 'left' : 'right';
    const classes = ['tl-event', side];
    if (evt.isConcurrent) classes.push('concurrent');
    if (evt.isKeyEvent) classes.push('key-event');
    if (evt.isLargeEvent) classes.push('large-event');
    if (evt.isEnding) classes.push('if-ending');
    classes.push('visible'); // always visible when rendered

    const wrapper = document.createElement('div');
    wrapper.className = classes.join(' ');
    wrapper.id = evt.id || '';

    const card = document.createElement('div');
    card.className = 'event-card';

    // Date
    const dateEl = document.createElement('div');
    dateEl.className = 'event-date';
    dateEl.innerHTML = '<span class="dot"></span>' + (evt.dateDisplay || '');
    card.appendChild(dateEl);

    // Title
    const titleEl = document.createElement('div');
    titleEl.className = 'event-title';
    titleEl.textContent = evt.title;
    card.appendChild(titleEl);

    // Location + characters
    if (evt.location || (evt.characters && evt.characters.length > 0)) {
      const metaEl = document.createElement('div');
      metaEl.className = 'event-meta';
      const parts = [];
      if (evt.location) parts.push(evt.location);
      if (evt.characters && evt.characters.length > 0) {
        parts.push(evt.characters.slice(0, 4).join(' · '));
      }
      metaEl.textContent = parts.join('  |  ');
      card.appendChild(metaEl);
    }

    // Tags
    if (evt.tags && evt.tags.length > 0) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'event-tags';
      evt.tags.slice(0, 4).forEach(tag => {
        const t = document.createElement('span');
        t.className = 'event-tag';
        t.textContent = tag;
        tagsEl.appendChild(t);
      });
      card.appendChild(tagsEl);
    }

    // Cross-world refs
    if (evt.crossRefs && evt.crossRefs.length > 0) {
      const refEl = document.createElement('span');
      refEl.className = 'event-ref';
      refEl.textContent = '引用：' + (evt.crossRefs[0].targetWorldName || '跨世界事件');
      refEl.addEventListener('click', function(e) {
        e.stopPropagation();
        if (typeof openRefPanel === 'function') openRefPanel(evt.id);
      });
      card.appendChild(refEl);
    }

    // Diverge badge
    if (evt.isDivergePoint) {
      const divEl = document.createElement('div');
      divEl.className = 'event-diverge-badge';
      divEl.innerHTML = '<span class="diamond-small"></span> ' + (evt.divergeDescription || 'IF分支点').substring(0, 50);
      card.appendChild(divEl);
    }

    wrapper.appendChild(card);
    return wrapper;
  },

  /** Render visible items */
  _renderRange(range) {
    const fragment = document.createDocumentFragment();
    let eventIdx = 0;

    // Count event-type items before start to get correct alternating side
    for (let i = 0; i < range.start; i++) {
      if (this.items[i].type === 'event') eventIdx++;
    }

    for (let i = range.start; i < range.end; i++) {
      const item = this.items[i];
      const el = this._buildNode(item, eventIdx);
      if (item.type === 'event') eventIdx++;
      // Position absolutely at item.top
      el.style.position = 'absolute';
      el.style.top = item.top + 'px';
      el.style.left = '0';
      el.style.right = '0';
      fragment.appendChild(el);
    }

    // Replace only the item nodes, keep spacers
    // Clear existing rendered nodes
    const existing = this.container.querySelectorAll('.tl-event, .tl-era-header, .diverge-inline');
    existing.forEach(el => el.remove());

    this.container.appendChild(fragment);
    this.renderedRange = range;
  },

  /** Main update — call on scroll */
  update() {
    if (this.items.length === 0) return;
    const range = this._getVisibleRange();
    if (range.start === this.renderedRange.start && range.end === this.renderedRange.end) return;

    // Set container height
    this.container.style.height = this.estimatedTotalHeight + 'px';

    this._renderRange(range);

    // After first paint, remeasure actual heights and force re-render
    if (!this._remeasured) {
      this._remeasured = true;
      requestAnimationFrame(() => {
        this.remeasure();
        // Reset rendered range to force unconditional re-render
        this.renderedRange = { start: -1, end: -1 };
        this.container.style.height = this.estimatedTotalHeight + 'px';
        const newRange = this._getVisibleRange();
        this._renderRange(newRange);
      });
    }
  },

  /** Clear everything */
  clear() {
    this.items = [];
    this.container.innerHTML = '';
    this.container.style.height = '';
    this.nodePool.clear();
    this.renderedRange = { start: 0, end: 0 };
    this._remeasured = false;
  },

  /** Measure actual rendered heights and recalculate all positions */
  remeasure() {
    const nodes = this.container.querySelectorAll('.tl-event, .tl-era-header, .diverge-inline');
    if (nodes.length === 0) return;

    nodes.forEach(el => {
      // For absolutely positioned items, use bounding height directly
      const actual = el.getBoundingClientRect().height + 8; // small extra gap
      const top = parseFloat(el.style.top);
      if (isNaN(top)) return;

      // Find matching item and update its height
      for (const item of this.items) {
        if (Math.abs(item.top - top) < 5) {
          item.height = Math.max(item.height, actual); // never shrink
          break;
        }
      }
    });

    // Recalculate all item tops sequentially
    let runningTop = 0;
    for (const item of this.items) {
      item.top = runningTop;
      runningTop += item.height;
    }
    this.estimatedTotalHeight = Math.max(runningTop, window.innerHeight);
    this.container.style.height = this.estimatedTotalHeight + 'px';
  },
};

/* ── Resize handler ──
   Scroll handling is done by timeline-ui.js (RAF-throttled) to avoid
   duplicate update() / updateEraNavHighlight() calls per frame. */
window.addEventListener('resize', () => {
  if (VirtualTimeline.items.length > 0) {
    VirtualTimeline.update();
  }
}, { passive: true });

/* ═══════════════════════════════════════════════════════════
   Era sidebar navigation
   ═══════════════════════════════════════════════════════════ */
const eraNav = document.getElementById('era-nav');

function eraYearLabel(eraTitle) {
  // Strip 【】 and extract year info
  const clean = eraTitle.replace(/[【】]/g, '');
  const m = clean.match(/泰拉历 (\d{4})年/);
  if (m) return m[1] + '年';
  const mImperial = clean.match(/帝国历 (M\d+)/);
  if (mImperial) return mImperial[1];
  if (clean.includes('纪元前')) return '纪元前';
  if (clean.includes('遥远') || clean.includes('未来')) return '未来';
  if (clean.includes('黑暗千年')) return '黑暗千年';
  if (clean.includes('早期')) return '早期';
  if (clean.includes('近期')) return '1077+';
  return clean.substring(0, 8);
}

function buildEraNav() {
  if (!VirtualTimeline.items.length) return;
  eraNav.innerHTML = '';

  const eraItems = VirtualTimeline.items.filter(item => item.type === 'era-header');
  eraItems.forEach(item => {
    const yearLabel = eraYearLabel(item.data);
    const dot = document.createElement('a');
    dot.className = 'era-nav-dot';
    dot.title = item.data; // full title on hover tooltip
    dot.innerHTML = '<span class="dot"></span><span class="label">' + yearLabel + '</span>';
    dot.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: item.top + 100, behavior: 'smooth' });
    });
    eraNav.appendChild(dot);
  });
}

function updateEraNavHighlight() {
  const dots = eraNav.querySelectorAll('.era-nav-dot');
  if (!dots.length) return;

  const scrollMid = window.scrollY + window.innerHeight * 0.3;
  let currentIdx = -1;

  // Find the last era header above current scroll position
  const eraItems = VirtualTimeline.items.filter(item => item.type === 'era-header');
  for (let i = eraItems.length - 1; i >= 0; i--) {
    if (eraItems[i].top <= scrollMid) {
      currentIdx = i;
      break;
    }
  }

  dots.forEach((dot, i) => {
    dot.classList.toggle('current', i === currentIdx);
  });
}

/* ═══════════════════════════════════════════════════════════
   Back to top button
   ═══════════════════════════════════════════════════════════ */
const backToTopBtn = document.getElementById('back-to-top');

if (backToTopBtn) {
  backToTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function updateBackToTop() {
  if (backToTopBtn) backToTopBtn.classList.toggle('visible', window.scrollY > 400);
}

/* ═══════════════════════════════════════════════════════════
   Direct DOM renderer — kept inside VirtualTimeline for future
   use with very short branches that don't benefit from virtual scroll.
   Currently invoked by timeline-ui.js renderEvents() for IF branches.
   ═══════════════════════════════════════════════════════════ */
VirtualTimeline._renderEventsDirect = function(eraGroups) {
  const container = document.getElementById('tl-container');
  container.innerHTML = '';
  container.style.position = '';
  container.style.height = '';
  container.style.opacity = '1';
  window.scrollTo(0, 0);

  let idx = 0;
  eraGroups.forEach(group => {
    const hdr = document.createElement('div');
    hdr.className = 'tl-era-header visible';
    hdr.style.paddingTop = '80px';
    hdr.innerHTML = '<span class="era-line"></span><span class="era-title">' + group.eraTitle + '</span><span class="era-line"></span>';
    container.appendChild(hdr);

    group.events.forEach(evt => {
      if (evt.isBranchNotice) {
        const n = document.createElement('div');
        n.className = 'diverge-inline visible';
        n.innerHTML = '<div class="diamond"></div> ' + evt.title + '<br><span>' + (evt.description || '') + '</span>';
        container.appendChild(n);
        return;
      }

      const side = idx % 2 === 0 ? 'left' : 'right';
      const w = document.createElement('div');
      w.className = 'tl-event ' + side + (evt.isEnding ? ' if-ending' : '') + ' visible';
      w.id = evt.id || '';
      w.style.opacity = '1';
      w.style.transform = 'translateY(0)';

      const card = document.createElement('div');
      card.className = 'event-card';

      let html = '<div class="event-date"><span class="dot"></span>' + (evt.dateDisplay || '') + '</div>';
      html += '<div class="event-title">' + evt.title + '</div>';
      if (evt.location || (evt.characters && evt.characters.length)) {
        const parts = [];
        if (evt.location) parts.push(evt.location);
        if (evt.characters && evt.characters.length) parts.push(evt.characters.slice(0, 4).join(' · '));
        html += '<div class="event-meta">' + parts.join('  |  ') + '</div>';
      }
      if (evt.conditions) {
        html += '<div class="event-conditions"><span class="cond-icon">◆</span> ' + evt.conditions + '</div>';
      }
      if (evt.tags && evt.tags.length) {
        html += '<div class="event-tags">' + evt.tags.slice(0, 4).map(t => '<span class="event-tag">' + t + '</span>').join('') + '</div>';
      }
      card.innerHTML = html;
      w.appendChild(card);
      container.appendChild(w);
      idx++;
    });
  });
};

/* ═══════════════════════════════════════════════════════════
   Star-map nav link — hide era nav when navigating away
   ═══════════════════════════════════════════════════════════ */
const navLink = document.querySelector('.nav-links a');
if (navLink) {
  navLink.addEventListener('click', () => {
    setTimeout(() => {
      const timeline = document.getElementById('timeline');
      if (timeline && !timeline.classList.contains('active')) {
        eraNav.classList.remove('active');
        if (backToTopBtn) backToTopBtn.classList.remove('visible');
      }
    }, 100);
  });
}
