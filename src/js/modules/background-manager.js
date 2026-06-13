/* ═══════════════════════════════════════════════════════════
   background-manager.js — Switch backgrounds with crossfade
   ═══════════════════════════════════════════════════════════ */

import { BG_PRESETS } from './bg-presets.js';
import { ParticleBackground } from './particle-background.js';

export const BackgroundManager = {
  canvas: null,
  videoEl: null,
  imageEl: null,
  _active: null,
  _currentName: null,

  init(canvasId, videoId, imageId) {
    this.canvas = document.getElementById(canvasId);
    this.videoEl = document.getElementById(videoId);
    this.imageEl = document.getElementById(imageId);
  },

  /** Switch to a named preset. Future: 'video:path' or 'image:path' */
  async switchTo(name) {
    if (name === this._currentName) return;
    this._currentName = name;

    const preset = BG_PRESETS[name];
    if (!preset) { console.warn('Unknown background preset:', name); return; }

    // Hide all
    if (this.videoEl) { this.videoEl.style.display = 'none'; this.videoEl.pause(); }
    if (this.imageEl) this.imageEl.style.display = 'none';
    if (this.canvas) this.canvas.style.display = 'block';

    if (preset.type === 'particles') {
      if (this._active instanceof ParticleBackground) {
        this._active.loadPreset(name);
      } else {
        if (this._active) this._active.destroy();
        this._active = new ParticleBackground(this.canvas, preset);
      }
    }
  },

  /** For world-specific tints: lerp between presets */
  async blendToward(presetAName, presetBName, factor) {
    await this.switchTo(factor > 0.5 ? presetBName : presetAName);
  },

  resize() {
    if (this._active && this._active._resize) this._active._resize();
  },

  destroy() {
    if (this._active) this._active.destroy();
    this._active = null;
  },
};
