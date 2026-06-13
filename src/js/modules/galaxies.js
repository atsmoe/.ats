/* ═══════════════════════════════════════════════════════════
   galaxies.js — Galaxy configuration data
   ═══════════════════════════════════════════════════════════ */

export const GALAXIES = {
  arknights: {
    id: 'arknights',
    name: '泰拉大陆',
    subtitle: 'Arknights · 源石纪元',
    description: '一片源石技艺与天灾肆虐的大地。从矿石病的发现到罗德岛的崛起，从整合运动的烽火到维多利亚的硝烟，泰拉大陆的每一个抉择都在源石晶簇中刻下不可磨灭的印记。',
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
    name: '神圣泰拉',
    subtitle: 'Sancta Terra · 帝国历 M41',
    description: '在银河的第41个千年，人类帝国是百万世界之上唯一的庇护。帝皇的金座照耀虚空，星界军的脚步踏遍星辰。然而混沌从不沉睡，异形虎视眈眈，人类本身亦在信仰与背叛之间摇摆。',
    calendar: '帝 国 历',
    worldId: 'wh40k',
    cx: 0.67, cy: 0.48,
    coreRadius: 16, coreColor: [168, 48, 48],
    armCount: 0, armStars: 200, armSpiral: 1.5, armMaxR: 110, armWidth: 40, warmBias: 0.3,
    glowSize: 240, glowAlpha: 0.065,
    floatAmp: 10, floatPeriod: 28, floatPhase: 2.1,
    hoverScale: 1.18, hitRadius: 65, detailScale: 2.5,
    warpRift: true,
  }
};

export const galaxyAnim = {};
for (const gid of Object.keys(GALAXIES)) {
  galaxyAnim[gid] = { currentScale: 0, targetScale: 0, currentOpacity: 0, targetOpacity: 0 };
}
