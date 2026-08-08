/* ═══════════════════════════════════════════════════════════
   galaxies.js — Galaxy configuration data
   ═══════════════════════════════════════════════════════════ */

export const GALAXIES = {
  arknights: {
    id: 'arknights',
    name: '泰拉大陆',
    subtitle: 'Arknights · 源石纪元',
    description: '天灾迫使城市迁徙，源石推动工业发展，也带来矿石病；各国、组织与个人共同塑造今天的泰拉。',
    calendar: '泰 拉 历',
    worldId: 'arknights',
    cx: 0.33, cy: 0.45,
    coreRadius: 22, coreColor: [201, 160, 80],
    armCount: 2, armStars: 280, armSpiral: 3.2, armMaxR: 140, armWidth: 45, warmBias: 0.55,
    glowSize: 300, glowAlpha: 0.09,
    floatAmp: 14, floatPeriod: 22, floatPhase: 0,
    hoverScale: 1.18, hitRadius: 80, detailScale: 2.8,
  },
  wh40k: {
    id: 'wh40k',
    name: '破碎银河',
    subtitle: 'Warhammer 40,000 · 大裂隙之后',
    description: '大裂隙将银河撕成帝国圣域与帝国暗面。人类帝国、混沌诸军与多个异形文明争夺航路、世界与未来；可按纪元、势力或战区进入。',
    calendar: '银 河 纪 元',
    worldId: 'wh40k',
    cx: 0.67, cy: 0.48,
    coreRadius: 16, coreColor: [168, 48, 48],
    armCount: 0, armStars: 200, armSpiral: 1.5, armMaxR: 110, armWidth: 40, warmBias: 0.3,
    glowSize: 240, glowAlpha: 0.065,
    floatAmp: 10, floatPeriod: 28, floatPhase: 2.1,
    hoverScale: 1.18, hitRadius: 65, detailScale: 2.5,
    warpRift: true,
  },
  ff14: {
    id: 'ff14',
    name: '艾欧泽亚',
    subtitle: 'Final Fantasy XIV · 第七星历',
    description: '十四个世界同归一源。从世界分裂到光暗的终末之战，《最终幻想XIV》的故事横跨原初世界与镜像世界，水晶的回声贯穿其中。',
    calendar: '伊 修 加 德 历',
    worldId: 'ff14',
    cx: 0.50, cy: 0.30,
    coreRadius: 18, coreColor: [184, 196, 216],
    armCount: 4, armStars: 320, armSpiral: 2.8, armMaxR: 130, armWidth: 35, warmBias: 0.45,
    glowSize: 260, glowAlpha: 0.07,
    floatAmp: 12, floatPeriod: 25, floatPhase: 1.0,
    hoverScale: 1.18, hitRadius: 75, detailScale: 2.6,
  }
};

export const galaxyAnim = {};
for (const gid of Object.keys(GALAXIES)) {
  galaxyAnim[gid] = { currentScale: 0, targetScale: 0, currentOpacity: 0, targetOpacity: 0 };
}
