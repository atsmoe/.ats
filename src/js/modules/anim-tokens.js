/* ═══════════════════════════════════════════════════════════
   anim-tokens.js — Unified animation parameters
   ═══════════════════════════════════════════════════════════ */

export const ANIM = {
  duration: {
    fast: 150,
    normal: 300,
    slow: 500,
    portal: 700,
  },

  easing: {
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    in: 'cubic-bezier(0.7, 0, 0.6, 1)',
    bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },

  portal: {
    outgoing: { expand: 300, hold: 400, total: 700 },
    incoming: { wait: 100, converge: 400, dismiss: 200, total: 700 },
  },

  galaxy: {
    enterDelay: 400,
    hoverScale: 1.18,
  },

  stars: {
    twinkleAmp: { min: 0.05, max: 0.4 },
    twinkleSpeed: { min: 0.15, max: 3.5 },
    mouseInfluence: 140,
    mouseBoost: 0.5,
  },

  background: {
    mouseSmoothing: 0.04,
    nebulaSpeed: { minX: -0.04, maxX: 0.04, minY: -0.03, maxY: 0.03 },
  },
};