/* ═══════════════════════════════════════════════════════════
   bg-presets.js — Background presets configuration
   ═══════════════════════════════════════════════════════════ */

export const BG_PRESETS = {
  'star-map': {
    type: 'particles',
    description: 'DSP-style cold galaxy — indigo/cyan/purple',
    stars: 800,
    nebulaCount: 7,
    starColorMix: { cool: 0.82, neutral: 0.13, warm: 0.05 },
    nebulaPalette: [
      [30, 40, 100], [50, 30, 120], [20, 80, 140],
      [80, 20, 100], [100, 30, 130], [10, 60, 110], [60, 50, 140],
    ],
    coreGlow: { r: 60, g: 40, b: 150, alpha: 0.05, sizeRatio: 0.6 },
    baseBackground: '#060a14',
  },
  'arknights': {
    type: 'particles',
    description: 'Arknights amber — warm gold/amber/brown nebulas on deep space',
    stars: 500,
    nebulaCount: 5,
    starColorMix: { cool: 0.35, neutral: 0.35, warm: 0.30 },
    nebulaPalette: [
      [180, 130, 70], [160, 110, 50], [200, 160, 90],
      [140, 100, 60], [120, 90, 80], [170, 140, 100],
    ],
    coreGlow: { r: 212, g: 146, b: 58, alpha: 0.04, sizeRatio: 0.5 },
    baseBackground: '#080810',
  },
  'wh40k': {
    type: 'particles',
    description: 'Warhammer 40K — gothic crimson/bone/gold on abyssal void',
    stars: 600,
    nebulaCount: 6,
    starColorMix: { cool: 0.20, neutral: 0.30, warm: 0.50 },
    nebulaPalette: [
      [140, 30, 30], [180, 50, 40], [200, 160, 90],
      [100, 20, 20], [60, 40, 50], [160, 130, 80],
    ],
    coreGlow: { r: 200, g: 160, b: 80, alpha: 0.03, sizeRatio: 0.4 },
    baseBackground: '#060608',
  },
  'ff14': {
    type: 'particles',
    description: 'FFXIV — ethereal aether blue/silver on deep indigo',
    stars: 550,
    nebulaCount: 6,
    starColorMix: { cool: 0.60, neutral: 0.25, warm: 0.15 },
    nebulaPalette: [
      [140, 160, 210], [100, 140, 195], [180, 200, 225],
      [80, 120, 185], [160, 185, 215], [120, 155, 205],
    ],
    coreGlow: { r: 184, g: 196, b: 216, alpha: 0.04, sizeRatio: 0.45 },
    baseBackground: '#070810',
  },
};
