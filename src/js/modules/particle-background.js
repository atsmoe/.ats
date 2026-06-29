/* ═══════════════════════════════════════════════════════════
   particle-background.js — Canvas-based star field engine
   ═══════════════════════════════════════════════════════════ */

import { BG_PRESETS } from './bg-presets.js';
import { GALAXIES, galaxyAnim } from './galaxies.js';

/* ── Performance tier detection ── */
export function getPerformanceTier() {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isLowMemory = navigator.deviceMemory && navigator.deviceMemory < 4;
  const isLowCores = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;

  if (isLowMemory || (isMobile && isLowCores)) return 'low';
  if (isMobile) return 'standard';
  return 'high';
}

const PERF_TIER = getPerformanceTier();
const PREFERS_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Utility ── */
function gaussRand(mean, stdev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function starColor(colorTemp, alpha) {
  const r = Math.round(140 + colorTemp * 100);
  const g = Math.round(160 + colorTemp * 40);
  const b = Math.round(210 - colorTemp * 100);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ═══════════════════════════════════════════════════════════
   ParticleBackground
   ═══════════════════════════════════════════════════════════ */
export class ParticleBackground {
  constructor(canvas, preset) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stars = [];
    this.nebulae = [];
    this.time = 0;
    this.mouse = { x: -1000, y: -1000, tx: -1000, ty: -1000 };
    this.animId = null;

    this._onMouse = (e) => { this.mouse.tx = e.clientX; this.mouse.ty = e.clientY; };
    this._onResize = () => this._resize();
    window.addEventListener('mousemove', this._onMouse);
    window.addEventListener('resize', this._onResize);

    this.loadPreset(preset);
    this._resize();
    this._start();

    // Initialize galaxy stars
    this.galaxyStars = {};
    for (const [gid, g] of Object.entries(GALAXIES)) {
      const stars = [];
      const rng = (() => { let s = gid === 'arknights' ? 42 : 137; return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; }; })();
      if (g.armCount > 0) {
        for (let arm = 0; arm < g.armCount; arm++) {
          const baseAngle = (arm / g.armCount) * Math.PI * 2;
          for (let i = 0; i < g.armStars / g.armCount; i++) {
            const dist = (rng() * 0.9 + 0.1) * g.armMaxR;
            const angle = baseAngle + (dist / g.armMaxR) * g.armSpiral * Math.PI * 2 + (rng() - 0.5) * 0.8;
            const scatter = (rng() - 0.5) * g.armWidth * 2;
            stars.push({ r: dist, theta: angle, scatter, brightness: rng(),
              colorTemp: rng() < g.warmBias ? 0.4 + rng() * 0.6 : rng() * 0.4,
              size: 0.3 + rng() * 1.8, twinklePhase: rng() * Math.PI * 2, twinkleSpeed: 0.2 + rng() * 2 });
          }
        }
      } else {
        const clumpCount = 5;
        for (let c = 0; c < clumpCount; c++) {
          const clumpR = rng() * g.armMaxR;
          const clumpAngle = rng() * Math.PI * 2;
          for (let i = 0; i < g.armStars / clumpCount; i++) {
            stars.push({ r: clumpR + (rng() - 0.5) * g.armWidth * 1.5,
              theta: clumpAngle + (rng() - 0.5) * 0.8,
              scatter: 0, brightness: rng(),
              colorTemp: rng() < 0.3 ? 0.6 + rng() * 0.4 : rng() * 0.5,
              size: 0.3 + rng() * 1.5, twinklePhase: rng() * Math.PI * 2, twinkleSpeed: 0.2 + rng() * 2,
              clumpExtra: true, clumpExtraR: (rng() - 0.5) * g.armWidth * 1.5, clumpExtraA: (rng() - 0.5) * 0.8 });
          }
        }
      }
      this.galaxyStars[gid] = stars;
    }
  }

  _resize() {
    this.W = this.canvas.width = window.innerWidth;
    this.H = this.canvas.height = window.innerHeight;
    this._rebuildNebulae();
    this._rebuildStars();
  }

  /* ── Nebula textures ── */
  _createNebulaTexture(size, palette) {
    const oc = document.createElement('canvas');
    oc.width = oc.height = size;
    const octx = oc.getContext('2d');
    const blobCount = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < blobCount; i++) {
      const cx = size * (0.15 + Math.random() * 0.7);
      const cy = size * (0.15 + Math.random() * 0.7);
      const r = size * (0.12 + Math.random() * 0.4);
      const c = palette[Math.floor(Math.random() * palette.length)];
      const alpha = 0.025 + Math.random() * 0.065;
      const g = octx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
      g.addColorStop(0.4, `rgba(${c[0]},${c[1]},${c[2]},${alpha * 0.6})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = g;
      octx.fillRect(0, 0, size, size);
    }
    return oc;
  }

  _rebuildNebulae() {
    this.nebulae.length = 0;
    let count = this.preset.nebulaCount;
    if (PERF_TIER === 'low') count = Math.min(count, 3);
    for (let i = 0; i < count; i++) {
      const size = Math.max(this.W, this.H) * (0.8 + Math.random() * 1.2);
      this.nebulae.push({
        texture: this._createNebulaTexture(Math.ceil(size), this.preset.nebulaPalette),
        x: -size * 0.2 + Math.random() * (this.W + size * 0.4),
        y: -size * 0.2 + Math.random() * (this.H + size * 0.4),
        vx: (Math.random() - 0.5) * 0.04,
        vy: (Math.random() - 0.5) * 0.03,
        size,
        alpha: 0.4 + Math.random() * 0.6,
      });
    }
  }

  /* ── Stars ── */
  _edgeFade(x, y) {
    const m = 0.12;
    const fx = Math.min(1, x / (this.W * m), (this.W - x) / (this.W * m));
    const fy = Math.min(1, y / (this.H * m), (this.H - y) / (this.H * m));
    return Math.min(1, fx * fy);
  }

  _rebuildStars() {
    this.stars.length = 0;
    const mix = this.preset.starColorMix;
    const coreX = this.W * 0.48;
    const coreY = this.H * 0.44;

    const starMultiplier = PERF_TIER === 'low' ? 0.5 : 1;
    const effectiveStars = Math.round(this.preset.stars * starMultiplier);

    for (let i = 0; i < effectiveStars; i++) {
      let x, y;
      const type = Math.random();

      if (type < 0.25) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.abs(gaussRand(0, Math.min(this.W, this.H) * 0.12));
        x = coreX + Math.cos(angle) * dist;
        y = coreY + Math.sin(angle) * dist * 0.7;
      } else if (type < 0.65) {
        const armIndex = Math.floor(Math.random() * 3);
        const baseAngle = (armIndex / 3) * Math.PI * 2 - 0.5;
        const maxDist = Math.max(this.W, this.H) * 0.75;
        const distFromCore = Math.random() * maxDist;
        const spiralAngle = baseAngle + (distFromCore / maxDist) * 5.5;
        const scatter = gaussRand(0, 80 + distFromCore * 0.6);
        const armAngle = spiralAngle + (scatter / (distFromCore + 10)) * 0.4;
        x = coreX + Math.cos(armAngle) * distFromCore;
        y = coreY + Math.sin(armAngle) * distFromCore * 0.55;
        x += (Math.random() - 0.5) * 120;
        y += (Math.random() - 0.5) * 80;
      } else {
        x = -this.W * 0.15 + Math.random() * this.W * 1.3;
        y = -this.H * 0.15 + Math.random() * this.H * 1.3;
      }

      x = Math.max(-60, Math.min(this.W + 60, x));
      y = Math.max(-60, Math.min(this.H + 60, y));

      const brightness = Math.pow(Math.random(), 3.5);
      const cr = Math.random();
      const colorTemp = cr < mix.cool
        ? Math.random() * 0.3
        : cr < mix.cool + mix.neutral
          ? 0.3 + Math.random() * 0.35
          : 0.65 + Math.random() * 0.35;

      this.stars.push({
        x, y,
        radius: 0.25 + brightness * 2.5,
        brightness,
        colorTemp,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.15 + Math.random() * 3.5,
        twinkleAmp: 0.05 + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 0.02,
        vy: (Math.random() - 0.5) * 0.02,
      });
    }
    this.stars.sort((a, b) => a.brightness - b.brightness);
  }

  /* ── Rendering ── */
  _drawStarGlow(sx, sy, radius, brightness, colorTemp) {
    const ctx = this.ctx;
    for (let i = 3; i >= 0; i--) {
      const r = radius * (1 + i * 2.8);
      const a = brightness * 0.10 * (1 - i * 0.23);
      if (a < 0.005) continue;
      const g = ctx.createRadialGradient(sx, sy, radius * 0.4, sx, sy, r);
      g.addColorStop(0, starColor(colorTemp, a));
      g.addColorStop(0.6, starColor(colorTemp, a * 0.3));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
  }

  _drawDiffractionSpike(sx, sy, length, brightness, colorTemp) {
    const ctx = this.ctx;
    const a = brightness * 0.18;
    [[0, 1], [1, 0]].forEach(([dx, dy]) => {
      const x1 = sx - length * dx, y1 = sy - length * dy;
      const x2 = sx + length * dx, y2 = sy + length * dy;
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.44, starColor(colorTemp, a * 0.2));
      grad.addColorStop(0.5, starColor(colorTemp, a));
      grad.addColorStop(0.56, starColor(colorTemp, a * 0.2));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(
        sx - length * dx - 0.35 * dy, sy - length * dy - 0.35 * dx,
        length * 2 * dx + 0.7 * dy, length * 2 * dy + 0.7 * dx
      );
    });
  }

  _drawCoreGlow() {
    const ctx = this.ctx;
    const c = this.preset.coreGlow;
    const cx = this.W * 0.48;
    const cy = this.H * 0.44;
    const size = Math.max(this.W, this.H) * c.sizeRatio;
    const g = ctx.createRadialGradient(cx, cy, size * 0.25, cx, cy, size);
    g.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${c.alpha})`);
    g.addColorStop(0.35, `rgba(${c.r},${c.g},${c.b},${c.alpha * 0.5})`);
    g.addColorStop(0.7, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  }

  _frame() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const mouseInfluence = 140;
    this.time += 0.016;

    this.mouse.x += (this.mouse.tx - this.mouse.x) * 0.04;
    this.mouse.y += (this.mouse.ty - this.mouse.y) * 0.04;

    ctx.clearRect(0, 0, W, H);
    this._drawCoreGlow();

    // Nebulae
    this.nebulae.forEach(n => {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < -n.size) n.x = W + n.size;
      if (n.x > W + n.size) n.x = -n.size;
      if (n.y < -n.size) n.y = H + n.size;
      if (n.y > H + n.size) n.y = -n.size;
      ctx.globalAlpha = n.alpha;
      ctx.drawImage(n.texture, n.x - n.size / 2, n.y - n.size / 2, n.size, n.size);
      ctx.globalAlpha = 1;
    });

    // Stars
    this.stars.forEach(s => {
      s.x += s.vx;
      s.y += s.vy;
      if (s.x < -30) s.x = W + 30;
      if (s.x > W + 30) s.x = -30;
      if (s.y < -30) s.y = H + 30;
      if (s.y > H + 30) s.y = -30;

      const twinkle = 1 + Math.sin(this.time * s.twinkleSpeed + s.twinklePhase) * s.twinkleAmp;
      const b = s.brightness * twinkle;
      const dx = s.x - this.mouse.x;
      const dy = s.y - this.mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let mouseBoost = 1;
      if (dist < mouseInfluence) mouseBoost = 1 + (1 - dist / mouseInfluence) * 0.5;

      const ef = this._edgeFade(s.x, s.y);
      const eBrightness = Math.min(1, b * mouseBoost) * ef;
      if (eBrightness < 0.02) return;

      const alpha = 0.12 + eBrightness * 0.88;
      if (s.brightness > 0.50 && ef > 0.15) {
        this._drawStarGlow(s.x, s.y, s.radius * 2, eBrightness, s.colorTemp);
      }
      if (s.brightness > 0.75 && ef > 0.25 && PERF_TIER !== 'low') {
        this._drawDiffractionSpike(s.x, s.y, s.radius * 8 + eBrightness * 18, eBrightness, s.colorTemp);
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius * (0.5 + twinkle * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = starColor(s.colorTemp, alpha);
      ctx.fill();
    });

    // Animate and draw galaxies
    for (const gid of Object.keys(GALAXIES)) {
      const a = galaxyAnim[gid];
      a.currentScale += (a.targetScale - a.currentScale) * 0.03;
      a.currentOpacity += (a.targetOpacity - a.currentOpacity) * 0.03;
      this._drawGalaxy(gid);
    }

    // Mouse halo
    if (this.mouse.x > 0 && this.mouse.y > 0) {
      const g = ctx.createRadialGradient(this.mouse.x, this.mouse.y, 0, this.mouse.x, this.mouse.y, mouseInfluence);
      g.addColorStop(0, 'rgba(180,200,230,0.025)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(this.mouse.x - mouseInfluence, this.mouse.y - mouseInfluence, mouseInfluence * 2, mouseInfluence * 2);
    }
  }

  /* ── Galaxy drawing ── */
  _drawGalaxy(gid) {
    const g = GALAXIES[gid];
    const a = galaxyAnim[gid];
    if (a.currentOpacity < 0.01) return;
    const cx = g.cx * this.W + Math.sin(this.time * 2 * Math.PI / g.floatPeriod + g.floatPhase) * g.floatAmp;
    const cy = g.cy * this.H + Math.cos(this.time * 1.7 * 2 * Math.PI / g.floatPeriod + g.floatPhase) * g.floatAmp;
    const scale = a.currentScale;
    const ctx = this.ctx;
    ctx.save();
    // detailGalaxy and hoveredGalaxy are accessed via the globals set by star-map.js
    const detailGalaxy = window.__detailGalaxy || null;
    const hoveredGalaxy = window.__hoveredGalaxy || null;
    ctx.globalAlpha = a.currentOpacity * (detailGalaxy && detailGalaxy !== gid ? 0.15 : 1);
    const isHovered = hoveredGalaxy === gid && !detailGalaxy;
    const hScale = isHovered ? g.hoverScale : 1;
    const finalScale = scale * hScale;

    // Core glow layers
    for (let i = 3; i >= 0; i--) {
      const r = g.coreRadius * finalScale * (2 + i * 6);
      const alphas = [0.25, 0.1, 0.04, 0.015];
      const grad = ctx.createRadialGradient(cx, cy, g.coreRadius * finalScale * 0.5, cx, cy, r);
      grad.addColorStop(0, `rgba(${g.coreColor[0]},${g.coreColor[1]},${g.coreColor[2]},${alphas[i]})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    // Core bright point
    ctx.beginPath();
    ctx.arc(cx, cy, g.coreRadius * finalScale * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${Math.min(255,g.coreColor[0]+60)},${Math.min(255,g.coreColor[1]+40)},${Math.min(255,g.coreColor[2]+20)},0.7)`;
    ctx.fill();

    // Galaxy stars
    const stars = this.galaxyStars[gid];
    if (stars) {
      for (const s of stars) {
        const dist = (s.r + (s.clumpExtra ? s.clumpExtraR || 0 : 0)) * finalScale;
        const theta = s.theta + (s.clumpExtra ? s.clumpExtraA || 0 : 0) + this.time * 0.008;
        const sx = cx + Math.cos(theta) * dist + (s.scatter || 0) * finalScale * Math.cos(theta + 1.5);
        const sy = cy + Math.sin(theta) * dist * 0.5 + (s.scatter || 0) * finalScale * 0.3 * Math.sin(theta + 1.5);
        const twinkle = 1 + Math.sin(this.time * s.twinkleSpeed + s.twinklePhase) * 0.3;
        const b = s.brightness * twinkle;
        const alpha = 0.2 + b * 0.6;
        const radius = s.size * finalScale * (0.6 + twinkle * 0.4);

        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.3, radius), 0, Math.PI * 2);
        ctx.fillStyle = starColor(s.colorTemp, alpha);
        ctx.fill();

        if (b > 0.7 && radius > 1.2) {
          const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 3);
          gr.addColorStop(0, starColor(s.colorTemp, alpha * 0.3));
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gr;
          ctx.fillRect(sx - radius * 3, sy - radius * 3, radius * 6, radius * 6);
        }
      }
    }

    // Warp rift + Astronomican pulse for WH40K
    if (g.warpRift && finalScale > 0.3) {
      ctx.save();
      ctx.translate(cx + 25 * finalScale, cy - 15 * finalScale);
      ctx.rotate(0.3);
      ctx.globalAlpha *= 0.12;
      const riftGrad = ctx.createLinearGradient(-50 * finalScale, 0, 50 * finalScale, 0);
      riftGrad.addColorStop(0, 'rgba(0,0,0,0)');
      riftGrad.addColorStop(0.3, 'rgba(120,30,180,0.5)');
      riftGrad.addColorStop(0.5, 'rgba(160,50,200,0.7)');
      riftGrad.addColorStop(0.7, 'rgba(120,30,180,0.5)');
      riftGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = riftGrad;
      ctx.fillRect(-50 * finalScale, -3 * finalScale, 100 * finalScale, 6 * finalScale);
      ctx.restore();

      const pulseAlpha = 0.4 + 0.3 * Math.sin(this.time * 2);
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * finalScale, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(240,216,120,${pulseAlpha})`;
      ctx.fill();
      const aglow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 15 * finalScale);
      aglow.addColorStop(0, `rgba(240,216,120,${pulseAlpha * 0.5})`);
      aglow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = aglow;
      ctx.fillRect(cx - 15 * finalScale, cy - 15 * finalScale, 30 * finalScale, 30 * finalScale);
    }

    ctx.restore();
  }

  _start() {
    if (PREFERS_REDUCED_MOTION) {
      // Render a single static frame, then stop
      this._frame();
      return;
    }

    const frameInterval = PERF_TIER === 'low' ? 33 : 16; // ~30fps vs ~60fps
    let lastFrame = 0;

    const loop = (timestamp) => {
      if (timestamp - lastFrame >= frameInterval) {
        this._frame();
        lastFrame = timestamp;
      }
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  loadPreset(nameOrPreset) {
    this.preset = (typeof nameOrPreset === 'string')
      ? (BG_PRESETS[nameOrPreset] || BG_PRESETS['star-map'])
      : nameOrPreset;
    document.body.style.background = this.preset.baseBackground;
    if (this.W > 0) {
      this._rebuildNebulae();
      this._rebuildStars();
    }
  }

  destroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
    window.removeEventListener('mousemove', this._onMouse);
    window.removeEventListener('resize', this._onResize);
    this.ctx.clearRect(0, 0, this.W, this.H);
  }
}
