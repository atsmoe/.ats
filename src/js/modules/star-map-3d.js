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
const BG_COUNT = isMobile ? 30000 : 150000;
const CORE_COUNT = isMobile ? 10000 : 50000;
const DISK_COUNT = isMobile ? 20000 : 100000;
const CLUSTER_SCALE = isMobile ? 0.4 : 1;

let scene, camera, renderer, controls;
let bgPoints, clock;
let startTime = 0;
let destroyed = false;

const mouseTarget = { x: 0, y: 0 };
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

  // Disk
  for (let i = 0; i < DISK_COUNT; i++) {
    const r = 10, R = 40;
    const rand = Math.pow(Math.random(), 1.5);
    const radius = Math.sqrt(R * R * rand + (1 - rand) * r * r);
    positions.push(...new THREE.Vector3().setFromCylindricalCoords(radius, Math.random() * 2 * Math.PI, (Math.random() - 0.5) * 2).toArray());
    sizes.push(Math.random() * 1.5 + 0.5);
    pushShift();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('sizes', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('shift', new THREE.Float32BufferAttribute(shifts, 4));

  return geometry;
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

  // Auto-rotation
  bgPoints.rotation.y = t * 0.05;

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

  // Camera parallax
  camera.position.x += (mouseTarget.x * 2 - camera.position.x) * 0.02;
  camera.position.y += (4 + mouseTarget.y * 1.5 - camera.position.y) * 0.02;
  camera.lookAt(0, 0, 0);

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 8;
  controls.maxDistance = 50;
  controls.autoRotate = true;
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

  // Cluster galaxies
  bgPoints.userData.clusters = {};
  for (const [gid, cluster] of Object.entries(CLUSTERS)) {
    const geom = generateCluster(gid);
    const mat = createClusterMaterial(gid);
    const points = new THREE.Points(geom, mat);
    scene.add(points);
    bgPoints.userData.clusters[gid] = points;
  }

  // Mouse parallax
  window.addEventListener('mousemove', (e) => {
    mouseTarget.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseTarget.y = (e.clientY / window.innerHeight - 0.5) * 2;
  });

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
  window.removeEventListener('resize', () => {});
  window.removeEventListener('mousemove', () => {});
}