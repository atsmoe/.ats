/* ═══════════════════════════════════════════════════════════
   star-map-3d.js — Three.js 3D galaxy star map
   OrbitControls + auto-rotation + parallax + cluster markers
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GALAXIES } from './galaxies.js';
import { ANIM } from './anim-tokens.js';

const CLUSTERS = {
  arknights: { center: new THREE.Vector3(-12, 2, -8), radius: 6, color: [212, 146, 58], particleCount: 5000 },
  wh40k:     { center: new THREE.Vector3(14, -1, 6),  radius: 5.5, color: [200, 80, 80],  particleCount: 4000 },
  ff14:      { center: new THREE.Vector3(0, 6, 12),   radius: 5, color: [184, 196, 216], particleCount: 4500 },
};

const isMobile = window.innerWidth < 768;
// Performance tier: low = reduce particles & pixel ratio
const perfTier = (() => {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const lowMem = navigator.deviceMemory && navigator.deviceMemory < 4;
  const lowCores = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
  if (lowMem || (mobile && lowCores)) return 'low';
  if (mobile || isMobile) return 'standard';
  return 'high';
})();

const BG_COUNT = perfTier === 'low' ? 15000 : (isMobile ? 30000 : 150000);
const CORE_COUNT = perfTier === 'low' ? 5000 : (isMobile ? 10000 : 50000);
const DISK_COUNT = perfTier === 'low' ? 3500 : (isMobile ? 7000 : 33000);
const RING_PARTICLES = perfTier === 'low' ? 1500 : (isMobile ? 3000 : 15000);
const SHELL_RADIUS = 35;
const SHELL_THICKNESS = 3;
const CLUSTER_SCALE = isMobile ? 0.4 : 1;

let scene, camera, renderer, controls;
let bgPoints, clock;
let ringPoints = [];
let startTime = 0;
let destroyed = false;

const clusterScreenPos = {};

function gaussRand(mean, stdev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function createShaderMaterial() {
  const mat = new THREE.PointsMaterial({
    size: 0.125,
    transparent: true,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    onBeforeCompile: (shader) => {
      shader.uniforms.time = { value: 0 };
      mat.userData.uniforms = shader.uniforms;

      shader.vertexShader = `
        uniform float time;
        attribute float sizes;
        attribute vec4 shift;
        varying vec3 vColor;
        ${shader.vertexShader}
      `.replace(
        'gl_PointSize = size;',
        'gl_PointSize = size * sizes;'
      ).replace(
        '#include <color_vertex>',
        `#include <color_vertex>
          float d = length(abs(position) / vec3(40., 10., 40));
          d = clamp(d, 0., 1.);
          vec3 coreGold = vec3(227., 155., 0.) / 255.;
          vec3 edgePurple = vec3(30., 40., 100.) / 255.;
          vColor = mix(coreGold, edgePurple, d);
        `
      ).replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
          float t = time;
          float moveT = mod(shift.x + shift.z * t, 6.28318530718);
          float moveS = mod(shift.y + shift.z * t, 6.28318530718);
          transformed += vec3(cos(moveS) * sin(moveT), cos(moveT), sin(moveS) * sin(moveT)) * shift.w;
        `
      );

      shader.fragmentShader = `
        varying vec3 vColor;
        ${shader.fragmentShader}
      `.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
          float d = length(gl_PointCoord.xy - 0.5);
        `
      ).replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( vColor, smoothstep(0.5, 0.1, d) );'
      );
    },
  });
  return mat;
}

function createClusterMaterial(clusterId) {
  const c = CLUSTERS[clusterId];
  const color = new THREE.Color(c.color[0] / 255, c.color[1] / 255, c.color[2] / 255);

  const material = new THREE.PointsMaterial({
    size: 0.2,
    transparent: true,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    color: color,
    onBeforeCompile: (shader) => {
      shader.uniforms.time = { value: 0 };
      shader.uniforms.clusterColor = { value: color };
      material.userData.uniforms = shader.uniforms;

      shader.vertexShader = `
        uniform float time;
        attribute float sizes;
        attribute vec4 shift;
        varying vec3 vColor;
        varying float vAlpha;
        ${shader.vertexShader}
      `.replace(
        'gl_PointSize = size;',
        'gl_PointSize = size * sizes;'
      ).replace(
        '#include <color_vertex>',
        `#include <color_vertex>
          vColor = vec3(${c.color[0] / 255}, ${c.color[1] / 255}, ${c.color[2] / 255});
          float dist = length(position - vec3(${CLUSTERS[clusterId].center.x.toFixed(1)}, ${CLUSTERS[clusterId].center.y.toFixed(1)}, ${CLUSTERS[clusterId].center.z.toFixed(1)}));
          vAlpha = smoothstep(${(c.radius + 2).toFixed(1)}, 0., dist) * 0.8 + 0.2;
        `
      ).replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
          float t = time;
          float moveT = mod(shift.x + shift.z * t, 6.28318530718);
          float moveS = mod(shift.y + shift.z * t, 6.28318530718);
          transformed += vec3(cos(moveS) * sin(moveT), cos(moveT), sin(moveS) * sin(moveT)) * shift.w * 0.5;
        `
      );

      shader.fragmentShader = `
        varying vec3 vColor;
        varying float vAlpha;
        ${shader.fragmentShader}
      `.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
          float d = length(gl_PointCoord.xy - 0.5);
        `
      ).replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( vColor, smoothstep(0.5, 0.1, d) * vAlpha );'
      );
    },
  });

  return material;
}

function generateBackground() {
  const positions = [];
  const sizes = [];
  const shifts = [];

  function pushShift() {
    shifts.push(
      Math.random() * Math.PI,
      Math.random() * Math.PI * 2,
      (Math.random() * 0.9 + 0.1) * Math.PI * 0.1,
      Math.random() * 0.9 + 0.1
    );
  }

  // Core sphere
  for (let i = 0; i < CORE_COUNT; i++) {
    positions.push(...new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * 0.5 + 9.5).toArray());
    sizes.push(Math.random() * 1.5 + 0.5);
    pushShift();
  }

  // Disk (reduced to 1/3)
  for (let i = 0; i < DISK_COUNT; i++) {
    const r = 10, R = 40;
    const rand = Math.pow(Math.random(), 1.5);
    const radius = Math.sqrt(R * R * rand + (1 - rand) * r * r);
    positions.push(...new THREE.Vector3().setFromCylindricalCoords(radius, Math.random() * 2 * Math.PI, (Math.random() - 0.5) * 3).toArray());
    sizes.push(Math.random() * 1.2 + 0.3);
    pushShift();
  }

  // Outer shell sphere (3x core count, at farthest particle reach)
  for (let i = 0; i < CORE_COUNT * 3; i++) {
    const r = SHELL_RADIUS + (Math.random() - 0.5) * SHELL_THICKNESS * 2;
    positions.push(...new THREE.Vector3().randomDirection().multiplyScalar(r).toArray());
    sizes.push(Math.random() * 0.8 + 0.3);
    pushShift();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('sizes', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('shift', new THREE.Float32BufferAttribute(shifts, 4));

  return geometry;
}

function generateRings() {
  const ringDefs = [
    { r: 12, width: 12.5, ySpread: 5.0, gauss: true },
    { r: 22, width: 15.0, ySpread: 6.0, gauss: true },
    { r: 35, width: 17.5, ySpread: 7.0, gauss: false },
  ];

  // Core sphere color endpoints
  const coreGold = [227, 155, 0];
  const edgePurple = [30, 40, 100];

  const result = [];
  for (const ring of ringDefs) {
    const tiltX = Math.random() * Math.PI * 2;
    const tiltZ = Math.random() * Math.PI * 2;
    const positions = [];
    const sizes = [];
    const colors = [];
    // Interpolation factor from ring radius (maps to core sphere gradient position)
    const tRing = (ring.r - 10) / 30;

    // Angular density: uneven clumps via multi-sine weighting
    const densityFn = (a) => {
      return 0.5 + 0.25 * Math.sin(a * 3 + tiltX) + 0.15 * Math.sin(a * 7 + tiltZ) + 0.1 * Math.sin(a * 13);
    };
    const maxDensity = 1.0;

    for (let i = 0; i < RING_PARTICLES; i++) {
      // Rejection sampling for angular density variation
      let angle, density;
      do {
        angle = Math.random() * Math.PI * 2;
        density = densityFn(angle);
      } while (Math.random() * maxDensity > density);

      // Radial distribution: gaussian (center-thick) or uniform
      let rJitter;
      if (ring.gauss) {
        rJitter = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * ring.width * 2;
      } else {
        rJitter = (Math.random() - 0.5) * ring.width * 2;
      }
      const outlier = Math.random() < 0.12;
      const radius = ring.r + rJitter * (outlier ? (2 + Math.random() * 2) : 1);
      const x0 = Math.cos(angle) * radius;
      const z0 = Math.sin(angle) * radius;
      const y0 = (Math.random() - 0.5) * ring.ySpread * (outlier ? 2 : 1);
      const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);
      const y1 = y0 * cosX - z0 * sinX;
      const z1 = y0 * sinX + z0 * cosX;
      const cosZ = Math.cos(tiltZ), sinZ = Math.sin(tiltZ);
      const x2 = x0 * cosZ - y1 * sinZ;
      const y2 = x0 * sinZ + y1 * cosZ;
      positions.push(x2, y2, z1);
      sizes.push(Math.random() * 1.2 + 0.5);

      // Color from core sphere gradient + per-particle noise
      const noise = (Math.random() - 0.5) * 0.15;
      const t = Math.max(0, Math.min(1, tRing + noise));
      const cr = Math.round(coreGold[0] + (edgePurple[0] - coreGold[0]) * t);
      const cg = Math.round(coreGold[1] + (edgePurple[1] - coreGold[1]) * t);
      const cb = Math.round(coreGold[2] + (edgePurple[2] - coreGold[2]) * t);
      colors.push(cr / 255, cg / 255, cb / 255);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('sizes', new THREE.Float32BufferAttribute(sizes, 1));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      onBeforeCompile: (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
            float d = length(gl_PointCoord.xy - 0.5);
          `
        ).replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( diffuse, smoothstep(0.5, 0.05, d) * opacity );'
        );
      },
    });

    const points = new THREE.Points(geom, mat);
    result.push(points);
  }
  return result;
}

function generateCluster(clusterId) {
  const c = CLUSTERS[clusterId];
  const count = Math.round(c.particleCount * CLUSTER_SCALE);
  const positions = [];
  const sizes = [];
  const shifts = [];

  function pushShift() {
    shifts.push(
      Math.random() * Math.PI,
      Math.random() * Math.PI * 2,
      (Math.random() * 0.9 + 0.1) * Math.PI * 0.1,
      Math.random() * 0.9 + 0.1
    );
  }

  for (let i = 0; i < count; i++) {
    const dx = gaussRand(0, c.radius * 0.4);
    const dy = gaussRand(0, c.radius * 0.3);
    const dz = gaussRand(0, c.radius * 0.4);
    positions.push(c.center.x + dx, c.center.y + dy, c.center.z + dz);
    sizes.push(Math.random() * 1.8 + 0.6);
    pushShift();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('sizes', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('shift', new THREE.Float32BufferAttribute(shifts, 4));

  return geometry;
}

function updateClusterMarkers() {
  for (const [gid, cluster] of Object.entries(CLUSTERS)) {
    const el = document.getElementById(`marker-${gid}`);
    if (!el) continue;

    const pos = cluster.center.clone();
    const projected = pos.project(camera);

    if (projected.z > 1) {
      el.style.display = 'none';
      continue;
    }

    const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    el.style.display = '';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
}

function animate() {
  if (destroyed) return;

  const t = clock.getElapsedTime() * 0.5;
  const timeVal = t * Math.PI;

  // Auto-rotation (bgPoints + rings)
  bgPoints.rotation.y = t * 0.05;
  for (const rp of ringPoints) {
    rp.rotation.copy(bgPoints.rotation);
  }

  // Update uniforms
  if (bgPoints.material.userData.uniforms) {
    bgPoints.material.userData.uniforms.time.value = timeVal;
  }

  for (const gid of Object.keys(CLUSTERS)) {
    const cluster = bgPoints.userData.clusters[gid];
    if (cluster && cluster.material.userData.uniforms) {
      cluster.material.userData.uniforms.time.value = timeVal;
    }
  }

  controls.update();

  // Update HTML cluster markers
  updateClusterMarkers();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

export function init(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error('[star-map-3d] Canvas element not found:', canvasId);
    return;
  }

  canvas.classList.add('interactive');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080810);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
  camera.position.set(0, 4, 21);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  const maxPixelRatio = perfTier === 'low' ? 1 : (isMobile ? 1.5 : 2);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = !isMobile;
  controls.enableZoom = true;
  controls.minDistance = isMobile ? 12 : 8;
  controls.maxDistance = 39;
  controls.autoRotate = !isMobile;
  controls.autoRotateSpeed = 0.3;
  controls.dampingFactor = 0.05;
  controls.enableRotate = true;

  clock = new THREE.Clock();
  startTime = performance.now();

  // Background galaxy
  const bgGeom = generateBackground();
  const bgMat = createShaderMaterial();
  bgPoints = new THREE.Points(bgGeom, bgMat);
  bgPoints.rotation.order = 'ZYX';
  bgPoints.rotation.z = 0.2;
  scene.add(bgPoints);

  // Colorful rings
  ringPoints = generateRings();
  for (const rp of ringPoints) {
    rp.rotation.copy(bgPoints.rotation);
    scene.add(rp);
  }

  // Cluster galaxies
  bgPoints.userData.clusters = {};
  for (const [gid, cluster] of Object.entries(CLUSTERS)) {
    const geom = generateCluster(gid);
    const mat = createClusterMaterial(gid);
    const points = new THREE.Points(geom, mat);
    scene.add(points);
    bgPoints.userData.clusters[gid] = points;
  }

  // Resize
  window.addEventListener('resize', () => {
    if (destroyed) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Show markers with staggered entrance
  const markerIds = Object.keys(CLUSTERS);
  markerIds.forEach((gid, i) => {
    const el = document.getElementById(`marker-${gid}`);
    if (el) {
      setTimeout(() => {
        el.classList.add('visible');
      }, ANIM.galaxy.enterDelay * (i + 1));
    }
  });

  // Start animation
  animate();
}

export function destroy() {
  destroyed = true;
  if (renderer) {
    renderer.dispose();
  }
  if (bgPoints) {
    bgPoints.geometry.dispose();
    bgPoints.material.dispose();
    for (const cluster of Object.values(bgPoints.userData.clusters || {})) {
      cluster.geometry.dispose();
      cluster.material.dispose();
    }
  }
  for (const rp of ringPoints) {
    rp.geometry.dispose();
    rp.material.dispose();
  }
  ringPoints = [];
  window.removeEventListener('resize', () => {});
}
