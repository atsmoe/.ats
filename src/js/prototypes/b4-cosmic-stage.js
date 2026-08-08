import * as THREE from 'three';

// B4 throwaway prototype renderer. The owning page controls routing, events and RAF.

const WORLD_ALIASES = new Map([
  ['arknights', 'arknights'],
  ['terra', 'arknights'],
  ['ark', 'arknights'],
  ['wh40k', 'wh40k'],
  ['warhammer40k', 'wh40k'],
  ['warhammer-40k', 'wh40k'],
  ['ff14', 'ff14'],
  ['ffxiv', 'ff14'],
  ['final-fantasy-xiv', 'ff14'],
]);
const WORLD_ORDER = ['arknights', 'wh40k', 'ff14'];

const DEFAULT_PIXEL_RATIO_CAP = 1.3;
const DEFAULT_TRAVEL_DURATION = 1100;
const TAU = Math.PI * 2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothStep(minimum, maximum, value) {
  const amount = clamp((value - minimum) / Math.max(.00001, maximum - minimum), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function easeInOutCubic(value) {
  const amount = clamp(value, 0, 1);
  return amount < .5
    ? 4 * amount * amount * amount
    : 1 - Math.pow(-2 * amount + 2, 3) * .5;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seedValue) {
  let seed = Number.isInteger(seedValue)
    ? seedValue >>> 0
    : hashString(String(seedValue));
  seed ||= 1;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveWorldId(worldLike) {
  if (Number.isInteger(worldLike) && WORLD_ORDER[worldLike]) return WORLD_ORDER[worldLike];
  const candidate = typeof worldLike === 'string' ? worldLike : worldLike?.id;
  const normalized = String(candidate ?? '').trim().toLowerCase();
  const resolved = WORLD_ALIASES.get(normalized);
  if (!resolved) throw new Error(`[B4 cosmic stage] Unknown world: ${candidate ?? '<empty>'}`);
  return resolved;
}

function createAnchor(id, label, camera, target, fov = 38) {
  return Object.freeze({
    id,
    label,
    camera: new THREE.Vector3().fromArray(camera),
    target: new THREE.Vector3().fromArray(target),
    fov,
  });
}

function disposeObjectTree(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter(Boolean).forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value?.isTexture) textures.add(value);
      });
      if (material.uniforms) {
        Object.values(material.uniforms).forEach((uniform) => {
          if (uniform?.value?.isTexture) textures.add(uniform.value);
        });
      }
    });
  });
  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function makeLineLoop(radius, segments, color, opacity) {
  const points = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * TAU;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const loop = new THREE.LineLoop(geometry, material);
  loop.userData.baseOpacity = opacity;
  return loop;
}

const STAR_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aTone;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uOpacity;
  uniform float uWarp;
  uniform vec2 uPointer;
  varying float vTone;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float depth = clamp((length(p) - 8.0) / 34.0, 0.0, 1.0);
    p.xy += uPointer * mix(.08, .52, 1.0 - depth);
    p.z += uWarp * sin(aPhase * 6.2831853) * 1.6;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float perspective = 8.0 / max(2.0, -mvPosition.z);
    gl_PointSize = clamp(aSize * uPixelRatio * perspective, .75, 2.6);
    vTone = aTone;
    vAlpha = uOpacity * (.82 + .18 * sin(uTime * .45 + aPhase * 12.0));
  }
`;

const STAR_FRAGMENT_SHADER = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying float vTone;
  varying float vAlpha;

  void main() {
    vec2 point = gl_PointCoord - vec2(.5);
    float shape = 1.0 - smoothstep(.16, .5, length(point));
    if (shape < .02) discard;
    vec3 color = mix(uColorA, uColorB, vTone);
    gl_FragColor = vec4(color, shape * vAlpha);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
  }
`;

function createProceduralStarSea({
  seed,
  count,
  minimumRadius,
  maximumRadius,
  colorA,
  colorB,
  opacity,
  sizeRange = [1, 2],
}) {
  const random = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tones = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const z = random() * 2 - 1;
    const angle = random() * TAU;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = minimumRadius + Math.pow(random(), .72) * (maximumRadius - minimumRadius);
    positions[offset] = Math.cos(angle) * radial * radius;
    positions[offset + 1] = Math.sin(angle) * radial * radius;
    positions[offset + 2] = z * radius;
    sizes[index] = sizeRange[0] + random() * (sizeRange[1] - sizeRange[0]);
    tones[index] = random();
    phases[index] = random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aTone', new THREE.BufferAttribute(tones, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: opacity },
      uWarp: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
    },
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.userData.baseOpacity = opacity;
  return points;
}

const HAZE_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HAZE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPhase;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - vec2(.5);
    p.x *= 1.55;
    float radius = length(p);
    float veil = 1.0 - smoothstep(.05, .52, radius);
    float bands = .76 + .24 * sin((p.x + p.y) * 14.0 + uPhase + uTime * .035);
    float alpha = veil * bands * uOpacity;
    if (alpha < .003) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
  }
`;

function createAetherHaze(camera) {
  const group = new THREE.Group();
  const entries = [
    { position: [-3.6, 2.0, -6.0], scale: [7.5, 4.0], color: 0x315f9f, opacity: .055, phase: .3 },
    { position: [4.2, -.9, -7.0], scale: [8.4, 3.5], color: 0x644d91, opacity: .045, phase: 2.1 },
    { position: [.8, -3.1, -8.0], scale: [10.0, 3.2], color: 0x987b42, opacity: .026, phase: 4.4 },
  ];
  const planes = [];
  entries.forEach((entry) => {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uColor: { value: new THREE.Color(entry.color) },
        uOpacity: { value: entry.opacity },
        uPhase: { value: entry.phase },
        uTime: { value: 0 },
      },
      vertexShader: HAZE_VERTEX_SHADER,
      fragmentShader: HAZE_FRAGMENT_SHADER,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    plane.position.fromArray(entry.position);
    plane.scale.set(entry.scale[0], entry.scale[1], 1);
    plane.userData.baseOpacity = entry.opacity;
    group.add(plane);
    planes.push(plane);
  });
  return {
    group,
    planes,
    update(time) {
      planes.forEach((plane) => {
        plane.quaternion.copy(camera.quaternion);
        plane.material.uniforms.uTime.value = time;
      });
    },
  };
}

const PLANET_VERTEX_SHADER = `
  varying vec3 vObjectPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;

  void main() {
    vObjectPosition = position;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const PLANET_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uScan;
  uniform float uOpacity;
  uniform vec3 uNightColor;
  uniform vec3 uDayColor;
  uniform vec3 uAetherColor;
  uniform vec3 uRimColor;
  varying vec3 vObjectPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;

  float hash31(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(cell + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(cell + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(cell + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(cell + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(cell + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(cell + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(cell + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(cell + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = .5;
    for (int octave = 0; octave < 4; octave++) {
      value += valueNoise(p) * amplitude;
      p = p * 2.03 + vec3(7.1, 3.7, 5.4);
      amplitude *= .5;
    }
    return value;
  }

  void main() {
    vec3 normal = normalize(vViewNormal);
    vec3 viewDirection = normalize(vViewDirection);
    vec3 lightDirection = normalize(vec3(-.78, .42, .34));
    float light = .11 + .89 * smoothstep(-.06, .34, dot(normal, lightDirection));
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.6);
    float terrain = fbm(normalize(vObjectPosition) * 4.4 + vec3(uTime * .012, 0.0, 0.0));
    float current = .5 + .5 * sin(vObjectPosition.y * 16.0 + terrain * 8.0 + uTime * .1);
    float scanBand = exp(-pow(vObjectPosition.y * 2.1 - mix(-1.7, 1.7, uScan), 2.0) * 18.0);
    vec3 color = mix(uNightColor, uDayColor, light);
    color *= mix(.72, 1.13, smoothstep(.30, .72, terrain));
    color += uAetherColor * current * .055;
    color += uRimColor * rim * .42;
    color += uAetherColor * scanBand * uScan * .48;
    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
  }
`;

function createPlanetMaterial({ night, day, aether, rim, opacity = 1 }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uTime: { value: 0 },
      uScan: { value: 0 },
      uOpacity: { value: opacity },
      uNightColor: { value: new THREE.Color(night) },
      uDayColor: { value: new THREE.Color(day) },
      uAetherColor: { value: new THREE.Color(aether) },
      uRimColor: { value: new THREE.Color(rim) },
    },
    vertexShader: PLANET_VERTEX_SHADER,
    fragmentShader: PLANET_FRAGMENT_SHADER,
  });
}

const ATMOSPHERE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uScan;
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;

  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vViewNormal), normalize(vViewDirection))), 2.2);
    float alpha = (fresnel * .72 + uScan * .16) * uOpacity;
    if (alpha < .004) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
  }
`;

function createAtmosphereMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uScan: { value: 0 },
    },
    vertexShader: PLANET_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
  });
}

const GALAXY_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GALAXY_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uScan;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 p = (vUv - .5) * 2.0;
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float arms = .5 + .5 * cos(angle * 4.0 - radius * 15.0 + uTime * .025);
    arms = pow(arms, 7.0);
    float dust = hash21(floor(p * 150.0)) * .28;
    float disk = 1.0 - smoothstep(.05, 1.0, radius);
    float core = 1.0 - smoothstep(0.0, .24, radius);
    float rift = 1.0 - smoothstep(.018, .075, abs(p.y - sin(p.x * 3.4) * .11));
    vec3 color = mix(vec3(.19, .10, .075), vec3(.64, .47, .28), arms);
    color += vec3(.62, .54, .38) * core;
    color *= 1.0 - rift * .82;
    color += vec3(.35, .035, .022) * rift * uScan;
    float alpha = disk * (.12 + arms * .55 + core * .55 + dust) * uOpacity;
    if (alpha < .004) discard;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
  }
`;

function createGalaxyMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uScan: { value: 0 },
    },
    vertexShader: GALAXY_VERTEX_SHADER,
    fragmentShader: GALAXY_FRAGMENT_SHADER,
  });
}

const WARP_VERTEX_SHADER = `
  attribute float aEnd;
  attribute float aSeed;
  uniform float uProgress;
  uniform float uDirection;
  varying float vAlpha;

  void main() {
    float crest = sin(clamp(uProgress, 0.0, 1.0) * 3.14159265);
    vec3 p = position;
    float stretch = 1.0 + aEnd * crest * mix(1.8, 5.4, aSeed);
    p.xy *= stretch;
    p.z += uDirection * crest * (aSeed - .5) * 3.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vAlpha = crest * mix(.18, .72, aSeed);
  }
`;

const WARP_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * uOpacity);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
  }
`;

function createWarpField() {
  const random = createRandom('b4-warp-field');
  const count = 180;
  const positions = new Float32Array(count * 2 * 3);
  const ends = new Float32Array(count * 2);
  const seeds = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    const angle = random() * TAU;
    const radius = 1.2 + random() * 8.8;
    const depth = -8 + random() * 15;
    const seed = random();
    const start = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, depth);
    const end = start.clone().multiplyScalar(1.015 + random() * .03);
    const offset = index * 6;
    positions.set(start.toArray(), offset);
    positions.set(end.toArray(), offset + 3);
    ends[index * 2] = 0;
    ends[index * 2 + 1] = 1;
    seeds[index * 2] = seed;
    seeds[index * 2 + 1] = seed;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uProgress: { value: 0 },
      uDirection: { value: 1 },
      uColor: { value: new THREE.Color(0xb9d8ef) },
      uOpacity: { value: .68 },
    },
    vertexShader: WARP_VERTEX_SHADER,
    fragmentShader: WARP_FRAGMENT_SHADER,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 90;
  return lines;
}

class ControlledCameraRig {
  constructor(camera) {
    this.camera = camera;
    this.anchors = new Map();
    this.currentAnchorId = 'overview';
    this.fromPosition = camera.position.clone();
    this.fromTarget = new THREE.Vector3();
    this.fromFov = camera.fov;
    this.position = camera.position.clone();
    this.target = new THREE.Vector3();
    this.destinationPosition = camera.position.clone();
    this.destinationTarget = new THREE.Vector3();
    this.destinationFov = camera.fov;
    this.focusElapsed = 1;
    this.focusDuration = .72;
    this.pointer = new THREE.Vector2();
    this.pointerTarget = new THREE.Vector2();
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.zoomLevel = 0;
    this.zoomOffset = 0;
    this.travel = null;
  }

  setAnchors(anchors, { immediate = false, preferred = 'overview' } = {}) {
    this.anchors = new Map(anchors.map((anchor) => [anchor.id, anchor]));
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.zoomLevel = 0;
    this.zoomOffset = 0;
    const nextId = this.anchors.has(preferred) ? preferred : anchors[0]?.id;
    if (nextId) this.focus(nextId, { immediate });
  }

  focus(id, { immediate = false } = {}) {
    const anchor = this.anchors.get(id);
    if (!anchor) return false;
    this.currentAnchorId = id;
    this.fromPosition.copy(this.position);
    this.fromTarget.copy(this.target);
    this.fromFov = this.camera.fov;
    this.destinationPosition.copy(anchor.camera);
    this.destinationTarget.copy(anchor.target);
    this.destinationFov = anchor.fov;
    this.focusElapsed = immediate ? this.focusDuration : 0;
    if (immediate) {
      this.position.copy(this.destinationPosition);
      this.target.copy(this.destinationTarget);
      this.camera.fov = this.destinationFov;
      this.camera.updateProjectionMatrix();
    }
    return true;
  }

  beginTravel(targetAnchor, direction) {
    this.travel = {
      direction: Math.sign(direction) || 1,
      progress: 0,
      fromPosition: this.position.clone(),
      fromTarget: this.target.clone(),
      fromFov: this.camera.fov,
      toPosition: targetAnchor.camera.clone(),
      toTarget: targetAnchor.target.clone(),
      toFov: targetAnchor.fov,
      targetAnchorId: targetAnchor.id,
    };
  }

  setTravelProgress(progress) {
    if (this.travel) this.travel.progress = clamp(progress, 0, 1);
  }

  commitTravel() {
    if (!this.travel) return;
    this.position.copy(this.travel.toPosition);
    this.target.copy(this.travel.toTarget);
    this.camera.fov = this.travel.toFov;
    this.currentAnchorId = this.travel.targetAnchorId;
    this.destinationPosition.copy(this.position);
    this.destinationTarget.copy(this.target);
    this.destinationFov = this.camera.fov;
    this.focusElapsed = this.focusDuration;
    this.travel = null;
    this.camera.updateProjectionMatrix();
  }

  dragBy(deltaX, deltaY) {
    this.dragYaw = clamp(this.dragYaw + Number(deltaX || 0) * .0024, -.24, .24);
    this.dragPitch = clamp(this.dragPitch + Number(deltaY || 0) * .002, -.16, .16);
  }

  zoomBy(delta) {
    const direction = Math.sign(Number(delta) || 0);
    if (!direction) return;
    this.zoomLevel = clamp(this.zoomLevel + direction, -1, 1);
    this.zoomOffset = [-1.05, 0, 2.15][this.zoomLevel + 1];
  }

  setPointer(x, y) {
    this.pointerTarget.set(clamp(Number(x) || 0, -.5, .5), clamp(Number(y) || 0, -.5, .5));
  }

  update(delta) {
    const safeDelta = clamp(delta, 0, .05);
    this.pointer.lerp(this.pointerTarget, 1 - Math.pow(.004, safeDelta));

    if (this.travel) {
      const progress = easeInOutCubic(this.travel.progress);
      this.position.lerpVectors(this.travel.fromPosition, this.travel.toPosition, progress);
      this.target.lerpVectors(this.travel.fromTarget, this.travel.toTarget, progress);
      const pull = Math.sin(progress * Math.PI) * 1.35;
      const viewDirection = this.position.clone().sub(this.target).normalize();
      this.position.addScaledVector(viewDirection, pull);
      this.camera.fov = THREE.MathUtils.lerp(this.travel.fromFov, this.travel.toFov, progress)
        + Math.sin(progress * Math.PI) * 5;
    } else if (this.focusElapsed < this.focusDuration) {
      this.focusElapsed = Math.min(this.focusDuration, this.focusElapsed + safeDelta);
      const progress = easeInOutCubic(this.focusElapsed / this.focusDuration);
      this.position.lerpVectors(this.fromPosition, this.destinationPosition, progress);
      this.target.lerpVectors(this.fromTarget, this.destinationTarget, progress);
      this.camera.fov = THREE.MathUtils.lerp(this.fromFov, this.destinationFov, progress);
    }

    const worldUp = new THREE.Vector3(0, 1, 0);
    const orbitOffset = this.position.clone().sub(this.target);
    orbitOffset.applyAxisAngle(worldUp, this.dragYaw);
    const orbitRight = new THREE.Vector3().crossVectors(worldUp, orbitOffset).normalize();
    orbitOffset.applyAxisAngle(orbitRight, this.dragPitch);
    const direction = orbitOffset.clone().normalize();
    const right = new THREE.Vector3().crossVectors(worldUp, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const cameraPosition = this.target.clone()
      .add(orbitOffset)
      .addScaledVector(direction, this.zoomOffset)
      .addScaledVector(right, this.pointer.x * .12)
      .addScaledVector(up, -this.pointer.y * .08);
    const cameraTarget = this.target.clone()
      .addScaledVector(right, this.pointer.x * .025)
      .addScaledVector(up, -this.pointer.y * .018);
    this.camera.position.copy(cameraPosition);
    this.camera.lookAt(cameraTarget);
    this.camera.updateProjectionMatrix();
  }
}

function createBaseSceneAdapter(id, root, anchors, pickables, internals) {
  let opacity = 1;
  let scan = 0;
  return {
    id,
    root,
    anchors,
    defaultAnchorId: 'overview',
    pickables,
    setOpacity(value) {
      opacity = clamp(value, 0, 1);
      internals.setOpacity(opacity);
      root.visible = opacity > .002;
    },
    setScan(value) {
      scan = clamp(value, 0, 1);
      internals.setScan(scan, opacity);
    },
    setTransition(role, progress, direction) {
      const amount = clamp(progress, 0, 1);
      if (role === 'outgoing') {
        this.setOpacity(1 - smoothStep(.16, .56, amount));
        root.position.x = -Math.sign(direction || 1) * smoothStep(.12, .55, amount) * .9;
        root.scale.setScalar(1 - smoothStep(.08, .52, amount) * .08);
      } else {
        this.setOpacity(smoothStep(.48, .88, amount));
        root.position.x = Math.sign(direction || 1) * (1 - smoothStep(.46, .9, amount)) * .9;
        root.scale.setScalar(.92 + smoothStep(.46, .92, amount) * .08);
      }
      internals.setWarp(Math.sin(amount * Math.PI));
    },
    resetTransition() {
      root.position.set(0, 0, 0);
      root.scale.setScalar(1);
      this.setOpacity(1);
      internals.setWarp(0);
    },
    update(frame) {
      internals.update({ ...frame, opacity, scan });
    },
    dispose() {
      internals.dispose?.();
      disposeObjectTree(root);
    },
  };
}

function toRomanNumeral(value) {
  const entries = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let remaining = value;
  let result = '';
  entries.forEach(([amount, numeral]) => {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  });
  return result;
}

function appendRomanGlyph(positions, text, center, scale) {
  const glyphs = {
    I: [[.5, 0, .5, 1]],
    V: [[0, 1, .5, 0], [.5, 0, 1, 1]],
    X: [[0, 0, 1, 1], [0, 1, 1, 0]],
  };
  const characterWidth = scale;
  const gap = scale * .24;
  const totalWidth = text.length * characterWidth + Math.max(0, text.length - 1) * gap;
  let cursor = center.x - totalWidth * .5;
  [...text].forEach((character) => {
    glyphs[character].forEach(([x1, y1, x2, y2]) => {
      positions.push(
        cursor + x1 * characterWidth,
        center.y + (y1 - .5) * scale,
        center.z,
        cursor + x2 * characterWidth,
        center.y + (y2 - .5) * scale,
        center.z,
      );
    });
    cursor += characterWidth + gap;
  });
}

function createFf14Scene(context) {
  const { camera, quality } = context;
  const root = new THREE.Group();
  root.name = 'ff14-fourteen-worlds-scene';

  const opacityUniforms = [];
  const scanUniforms = [];
  const lineMaterials = [];
  const simpleMaterials = [];
  const starMaterials = [];
  const reflectionEntries = [];

  const farStars = createProceduralStarSea({
    seed: 2681299910,
    count: quality === 'reduced' ? 720 : 1280,
    minimumRadius: 11,
    maximumRadius: 44,
    colorA: 0x7898bd,
    colorB: 0xe5d7af,
    opacity: .27,
    sizeRange: [.82, 1.55],
  });
  const nearStars = createProceduralStarSea({
    seed: 534838699,
    count: quality === 'reduced' ? 100 : 190,
    minimumRadius: 8,
    maximumRadius: 20,
    colorA: 0xaed8f2,
    colorB: 0xb8a6cf,
    opacity: .19,
    sizeRange: [1.0, 1.8],
  });
  starMaterials.push(farStars.material, nearStars.material);
  opacityUniforms.push(farStars.material.uniforms.uOpacity, nearStars.material.uniforms.uOpacity);
  root.add(farStars, nearStars);

  const haze = createAetherHaze(camera);
  haze.group.scale.set(1.18, 1.08, 1);
  haze.planes.forEach((plane) => {
    plane.material.uniforms.uOpacity.value *= .72;
    plane.userData.baseOpacity = plane.material.uniforms.uOpacity.value;
    opacityUniforms.push(plane.material.uniforms.uOpacity);
  });
  root.add(haze.group);

  const sourceGroup = new THREE.Group();
  sourceGroup.position.set(.35, .24, -3.5);
  const sourceGeometry = new THREE.SphereGeometry(
    2.3,
    quality === 'reduced' ? 42 : 64,
    quality === 'reduced' ? 24 : 36,
  );
  const sourceMaterial = createPlanetMaterial({
    night: 0x000103,
    day: 0x03101a,
    aether: 0x18384e,
    rim: 0x4d687b,
    opacity: .92,
  });
  opacityUniforms.push(sourceMaterial.uniforms.uOpacity);
  scanUniforms.push(sourceMaterial.uniforms.uScan);
  const sourceWorld = new THREE.Mesh(sourceGeometry, sourceMaterial);
  sourceWorld.name = 'ff14-source-world';
  sourceWorld.userData.anchorId = 'source';
  sourceWorld.renderOrder = 1;

  const sourceAtmosphereMaterial = createAtmosphereMaterial(0x456e88, .14);
  opacityUniforms.push(sourceAtmosphereMaterial.uniforms.uOpacity);
  scanUniforms.push(sourceAtmosphereMaterial.uniforms.uScan);
  const sourceAtmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.37, quality === 'reduced' ? 36 : 54, quality === 'reduced' ? 20 : 30),
    sourceAtmosphereMaterial,
  );
  sourceAtmosphere.renderOrder = 2;
  sourceGroup.add(sourceWorld, sourceAtmosphere);
  root.add(sourceGroup);

  const reflections = [
    { numeral: 1, position: [-4.05, 2.12, -1.55], radius: .62, colors: [0x071525, 0x315b79, 0x9acbe4] },
    { numeral: 4, position: [4.52, 2.45, -2.55], radius: .46, colors: [0x0b1020, 0x4a526f, 0xb7a9d0] },
    { numeral: 8, position: [-4.36, -1.52, -2.85], radius: .38, colors: [0x080d19, 0x334a62, 0x8bb4cb] },
    { numeral: 9, position: [4.16, -1.48, -1.42], radius: .57, colors: [0x0c1323, 0x4d6681, 0xcabf93] },
    { numeral: 11, position: [-2.83, -2.62, -4.22], radius: .34, colors: [0x09111e, 0x354b69, 0x91bde2] },
    { numeral: 13, position: [2.98, 3.20, -4.18], radius: .43, colors: [0x090514, 0x372849, 0x9d7fb9] },
  ];
  const reflectionLabelPositions = [];
  reflections.forEach((entry, index) => {
    const group = new THREE.Group();
    group.position.fromArray(entry.position);
    group.rotation.set(.11 * index, .34 + index * .27, -.08 * index);
    const geometry = new THREE.SphereGeometry(
      entry.radius,
      quality === 'reduced' ? 24 : 34,
      quality === 'reduced' ? 14 : 20,
    );
    const material = createPlanetMaterial({
      night: entry.colors[0],
      day: entry.colors[1],
      aether: entry.colors[2],
      rim: entry.numeral === 13 ? 0xa584ba : 0xd5c99e,
      opacity: .82,
    });
    opacityUniforms.push(material.uniforms.uOpacity);
    scanUniforms.push(material.uniforms.uScan);
    const world = new THREE.Mesh(geometry, material);
    world.name = `ff14-reflection-${String(entry.numeral).padStart(2, '0')}`;
    world.userData.anchorId = 'reflections';
    world.renderOrder = 2;

    const atmosphereMaterial = createAtmosphereMaterial(entry.colors[2], .22);
    opacityUniforms.push(atmosphereMaterial.uniforms.uOpacity);
    scanUniforms.push(atmosphereMaterial.uniforms.uScan);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(entry.radius * 1.045, 26, 16),
      atmosphereMaterial,
    );
    atmosphere.renderOrder = 3;
    group.add(world, atmosphere);
    root.add(group);
    reflectionEntries.push({
      group,
      world,
      atmosphere,
      material,
      atmosphereMaterial,
      basePosition: group.position.clone(),
      phase: index * 1.13,
    });
    appendRomanGlyph(
      reflectionLabelPositions,
      toRomanNumeral(entry.numeral),
      group.position.clone().add(new THREE.Vector3(0, entry.radius + .27, .16)),
      .135,
    );
  });

  const reflectionLabelGeometry = new THREE.BufferGeometry();
  reflectionLabelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(reflectionLabelPositions, 3));
  const reflectionLabelMaterial = new THREE.LineBasicMaterial({
    color: 0xa8cbe1,
    transparent: true,
    opacity: .25,
    depthWrite: false,
  });
  lineMaterials.push(reflectionLabelMaterial);
  root.add(new THREE.LineSegments(reflectionLabelGeometry, reflectionLabelMaterial));

  const rejoinedNumerals = [2, 3, 5, 6, 7, 10, 12];
  const rejoiningLineMaterials = [];
  const rejoiningLabelPositions = [];
  const rejoiningPoints = [];
  const rejoiningShardGeometry = new THREE.TetrahedronGeometry(.075, 0);
  const rejoiningShardMaterial = new THREE.MeshBasicMaterial({
    color: 0xb6dff5,
    transparent: true,
    opacity: .2,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  simpleMaterials.push(rejoiningShardMaterial);
  const rejoiningShards = new THREE.InstancedMesh(rejoiningShardGeometry, rejoiningShardMaterial, rejoinedNumerals.length * 3);
  const rejoiningDummy = new THREE.Object3D();
  let shardIndex = 0;

  rejoinedNumerals.forEach((numeral, index) => {
    const angle = -2.48 + index * .72;
    const start = new THREE.Vector3(
      sourceGroup.position.x + Math.cos(angle) * (4.15 + (index % 2) * .45),
      sourceGroup.position.y + Math.sin(angle) * (2.85 + (index % 3) * .22),
      -3.85 + (index % 3) * .54,
    );
    const inward = start.clone().sub(sourceGroup.position).normalize();
    const end = sourceGroup.position.clone().add(inward.multiplyScalar(2.26));
    const control = start.clone().lerp(end, .54).add(new THREE.Vector3(
      Math.sin(angle) * .62,
      Math.cos(angle) * .46,
      1.02 + index * .04,
    ));
    const curve = new THREE.QuadraticBezierCurve3(start, control, end);
    const points = curve.getPoints(58);
    const segments = [];
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      if ((pointIndex + index * 2) % 9 < 5) {
        segments.push(...points[pointIndex].toArray(), ...points[pointIndex + 1].toArray());
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    const material = new THREE.LineBasicMaterial({
      color: index % 3 === 0 ? 0xd0c395 : 0x638eae,
      transparent: true,
      opacity: .09 + (index % 2) * .018,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    lineMaterials.push(material);
    rejoiningLineMaterials.push(material);
    const trace = new THREE.LineSegments(geometry, material);
    trace.renderOrder = 3;
    root.add(trace);
    rejoiningPoints.push(start, end);

    [12, 28, 44].forEach((pointIndex, shardOffset) => {
      const point = points[pointIndex];
      rejoiningDummy.position.copy(point);
      rejoiningDummy.rotation.set(index * .73 + shardOffset, pointIndex * .08, angle);
      const scale = .7 + shardOffset * .24;
      rejoiningDummy.scale.set(scale, scale * 1.8, scale);
      rejoiningDummy.updateMatrix();
      rejoiningShards.setMatrixAt(shardIndex, rejoiningDummy.matrix);
      shardIndex += 1;
    });

    appendRomanGlyph(
      rejoiningLabelPositions,
      toRomanNumeral(numeral),
      start.clone().add(new THREE.Vector3(0, .22, .12)),
      .105,
    );
  });
  rejoiningShards.instanceMatrix.needsUpdate = true;
  rejoiningShards.renderOrder = 4;
  root.add(rejoiningShards);

  const rejoiningLabelGeometry = new THREE.BufferGeometry();
  rejoiningLabelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rejoiningLabelPositions, 3));
  const rejoiningLabelMaterial = new THREE.LineBasicMaterial({
    color: 0x7f96a9,
    transparent: true,
    opacity: .14,
    depthWrite: false,
  });
  lineMaterials.push(rejoiningLabelMaterial);
  root.add(new THREE.LineSegments(rejoiningLabelGeometry, rejoiningLabelMaterial));

  const rejoiningCentroid = rejoiningPoints.reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / rejoiningPoints.length);
  const rejoiningPickMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthWrite: false,
  });
  const rejoiningPick = new THREE.Mesh(new THREE.SphereGeometry(.8, 12, 8), rejoiningPickMaterial);
  rejoiningPick.position.copy(rejoiningCentroid);
  rejoiningPick.userData.anchorId = 'rejoinings';
  root.add(rejoiningPick);

  const anchors = [
    createAnchor('overview', '十四世界', [0, 1.58, 11.0], [0, .02, -1.5], 40),
    createAnchor('source', '原初世界', [3.9, 1.45, 7.9], [.32, .2, -3.5], 35),
    createAnchor('reflections', '现存镜像', [-4.65, 2.45, 8.4], [0, .15, -2.55], 41),
    createAnchor('rejoinings', '七次回归', [4.95, -2.0, 8.25], [.1, -.35, -2.9], 39),
  ];

  const baseUniformOpacities = new Map();
  const baseLineOpacities = new Map();
  const baseSimpleOpacities = new Map();
  opacityUniforms.forEach((uniform) => baseUniformOpacities.set(uniform, uniform.value));
  lineMaterials.forEach((material) => baseLineOpacities.set(material, material.opacity));
  simpleMaterials.forEach((material) => baseSimpleOpacities.set(material, material.opacity));

  return createBaseSceneAdapter('ff14', root, anchors, [
    sourceWorld,
    ...reflectionEntries.map((entry) => entry.world),
    rejoiningPick,
  ], {
    setOpacity(value) {
      opacityUniforms.forEach((uniform) => { uniform.value = baseUniformOpacities.get(uniform) * value; });
      lineMaterials.forEach((material) => { material.opacity = baseLineOpacities.get(material) * value; });
      simpleMaterials.forEach((material) => { material.opacity = baseSimpleOpacities.get(material) * value; });
      sourceMaterial.depthWrite = value > .98;
      reflectionEntries.forEach((entry) => { entry.material.depthWrite = value > .98; });
    },
    setScan(value) {
      scanUniforms.forEach((uniform) => { uniform.value = value; });
    },
    setWarp(value) {
      starMaterials.forEach((material) => { material.uniforms.uWarp.value = value; });
    },
    update({ elapsed, delta, pointer, scan, opacity }) {
      starMaterials.forEach((material) => {
        material.uniforms.uTime.value = elapsed;
        material.uniforms.uPointer.value.copy(pointer);
      });
      haze.update(elapsed);

      sourceMaterial.uniforms.uTime.value = elapsed;
      sourceWorld.rotation.y = elapsed * .018;
      sourceAtmosphere.rotation.y = -elapsed * .009;

      reflectionEntries.forEach((entry, index) => {
        entry.material.uniforms.uTime.value = elapsed;
        entry.group.position.copy(entry.basePosition);
        entry.group.position.y += Math.sin(elapsed * .16 + entry.phase) * .045;
        entry.world.rotation.y += delta * (.012 + index * .0015);
        entry.atmosphere.rotation.y -= delta * .006;
      });

      rejoiningLineMaterials.forEach((material, index) => {
        material.opacity = baseLineOpacities.get(material) * opacity * (1 + scan * 2.1 + Math.sin(elapsed * .22 + index) * .12);
      });
      rejoiningShardMaterial.opacity = baseSimpleOpacities.get(rejoiningShardMaterial) * opacity * (1 + scan * .65);
    },
  });
}

function createTerraScene(context) {
  const { quality } = context;
  const root = new THREE.Group();
  root.name = 'arknights-terra-system-scene';
  const opacityUniforms = [];
  const scanUniforms = [];
  const lineMaterials = [];

  const stars = createProceduralStarSea({
    seed: 'terra-stars',
    count: quality === 'reduced' ? 520 : 920,
    minimumRadius: 10,
    maximumRadius: 38,
    colorA: 0x77919a,
    colorB: 0xd7a959,
    opacity: .22,
    sizeRange: [.8, 1.5],
  });
  root.add(stars);
  opacityUniforms.push(stars.material.uniforms.uOpacity);

  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xe3c17a, transparent: true, opacity: .72 });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(.42, 28, 16), sunMaterial);
  sun.position.set(-3.0, .45, -1.8);
  root.add(sun);

  const planetMaterial = createPlanetMaterial({
    night: 0x071012,
    day: 0x35585a,
    aether: 0x00bfdc,
    rim: 0xdba34c,
  });
  opacityUniforms.push(planetMaterial.uniforms.uOpacity);
  scanUniforms.push(planetMaterial.uniforms.uScan);
  const terra = new THREE.Mesh(new THREE.SphereGeometry(1.12, 48, 28), planetMaterial);
  terra.position.set(.45, 0, 0);
  terra.userData.anchorId = 'world';
  root.add(terra);

  const orbit = makeLineLoop(3.5, 128, 0x6f8d93, .13);
  orbit.rotation.x = Math.PI * .47;
  lineMaterials.push(orbit.material);
  root.add(orbit);

  const moonMaterial = new THREE.MeshBasicMaterial({ color: 0x8f9695, transparent: true, opacity: .7 });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(.18, 20, 12), moonMaterial);
  root.add(moon);

  const anchors = [
    createAnchor('overview', '行星系总览', [0, 2.1, 10.4], [.25, 0, 0], 39),
    createAnchor('world', '泰拉', [2.8, .8, 4.5], [.45, 0, 0], 34),
  ];
  const baseOpacities = new Map([
    [stars.material.uniforms.uOpacity, stars.material.uniforms.uOpacity.value],
    [planetMaterial.uniforms.uOpacity, 1],
    [sunMaterial, sunMaterial.opacity],
    [moonMaterial, moonMaterial.opacity],
    [orbit.material, orbit.material.opacity],
  ]);

  return createBaseSceneAdapter('arknights', root, anchors, [terra], {
    setOpacity(value) {
      opacityUniforms.forEach((uniform) => { uniform.value = baseOpacities.get(uniform) * value; });
      sunMaterial.opacity = baseOpacities.get(sunMaterial) * value;
      moonMaterial.opacity = baseOpacities.get(moonMaterial) * value;
      orbit.material.opacity = baseOpacities.get(orbit.material) * value;
      planetMaterial.depthWrite = value > .98;
    },
    setScan(value) {
      scanUniforms.forEach((uniform) => { uniform.value = value; });
    },
    setWarp(value) {
      stars.material.uniforms.uWarp.value = value;
    },
    update({ elapsed, pointer }) {
      stars.material.uniforms.uTime.value = elapsed;
      stars.material.uniforms.uPointer.value.copy(pointer);
      planetMaterial.uniforms.uTime.value = elapsed;
      terra.rotation.y = elapsed * .024;
      const moonAngle = elapsed * .16;
      moon.position.set(.45 + Math.cos(moonAngle) * 1.7, Math.sin(moonAngle * .7) * .18, Math.sin(moonAngle) * 1.7);
    },
  });
}

function createWh40kScene(context) {
  const { quality } = context;
  const root = new THREE.Group();
  root.name = 'wh40k-milky-way-scene';

  const stars = createProceduralStarSea({
    seed: 'wh40k-stars',
    count: quality === 'reduced' ? 650 : 1100,
    minimumRadius: 10,
    maximumRadius: 40,
    colorA: 0x786d61,
    colorB: 0xa73a30,
    opacity: .18,
    sizeRange: [.8, 1.55],
  });
  root.add(stars);

  const galaxyMaterial = createGalaxyMaterial();
  const galaxy = new THREE.Mesh(new THREE.CircleGeometry(4.25, 160), galaxyMaterial);
  galaxy.rotation.x = .94;
  galaxy.rotation.z = -.24;
  galaxy.userData.anchorId = 'galaxy';
  root.add(galaxy);

  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xc5a675, transparent: true, opacity: .34, depthWrite: false });
  const core = new THREE.Mesh(new THREE.SphereGeometry(.42, 24, 14), coreMaterial);
  core.position.set(0, .05, .2);
  core.userData.anchorId = 'core';
  root.add(core);

  const riftCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.7, -.65, .42),
    new THREE.Vector3(-1.8, .28, .48),
    new THREE.Vector3(.1, -.15, .55),
    new THREE.Vector3(2.0, .55, .5),
    new THREE.Vector3(3.7, -.05, .42),
  ]);
  const riftMaterial = new THREE.MeshBasicMaterial({ color: 0x160304, transparent: true, opacity: .82, depthWrite: false });
  const rift = new THREE.Mesh(new THREE.TubeGeometry(riftCurve, 72, .105, 7, false), riftMaterial);
  rift.userData.anchorId = 'rift';
  root.add(rift);

  const anchors = [
    createAnchor('overview', '银河总览', [0, 4.6, 10.8], [0, 0, 0], 41),
    createAnchor('galaxy', '破碎银河', [0, 2.8, 7.0], [0, 0, 0], 38),
    createAnchor('core', '银河核心', [2.7, 1.8, 4.8], [0, 0, 0], 34),
    createAnchor('rift', '大裂隙', [-2.8, 1.5, 5.2], [.1, 0, .5], 37),
  ];
  const baseStarOpacity = stars.material.uniforms.uOpacity.value;
  const baseCoreOpacity = coreMaterial.opacity;
  const baseRiftOpacity = riftMaterial.opacity;

  return createBaseSceneAdapter('wh40k', root, anchors, [galaxy, core, rift], {
    setOpacity(value) {
      stars.material.uniforms.uOpacity.value = baseStarOpacity * value;
      galaxyMaterial.uniforms.uOpacity.value = value;
      coreMaterial.opacity = baseCoreOpacity * value;
      riftMaterial.opacity = baseRiftOpacity * value;
    },
    setScan(value) {
      galaxyMaterial.uniforms.uScan.value = value;
    },
    setWarp(value) {
      stars.material.uniforms.uWarp.value = value;
    },
    update({ elapsed, pointer }) {
      stars.material.uniforms.uTime.value = elapsed;
      stars.material.uniforms.uPointer.value.copy(pointer);
      galaxyMaterial.uniforms.uTime.value = elapsed;
      galaxy.rotation.z = -.24 + elapsed * .004;
      core.scale.setScalar(1 + Math.sin(elapsed * .5) * .025);
    },
  });
}

const SCENE_FACTORIES = {
  arknights: createTerraScene,
  wh40k: createWh40kScene,
  ff14: createFf14Scene,
};

/**
 * Creates the B4 cosmic stage. The caller owns RAF, DOM events and URL state.
 * pick() expects normalized device coordinates in the [-1, 1] range.
 */
export function createCosmicStage({
  canvas,
  reducedMotion = false,
  pixelRatioCap = DEFAULT_PIXEL_RATIO_CAP,
  quality = reducedMotion ? 'reduced' : 'desktop',
} = {}) {
  if (!canvas) throw new TypeError('[B4 cosmic stage] A canvas is required.');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .96;
  renderer.sortObjects = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 120);
  camera.position.set(0, 2.2, 10.2);
  const cameraRig = new ControlledCameraRig(camera);
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = .14;
  const pointer = new THREE.Vector2();
  const warpField = createWarpField();
  scene.add(warpField);

  const sceneCache = new Map();
  let activeScene = null;
  let preparedScene = null;
  let transitionActive = false;
  let transitionProgress = 1;
  let transitionDirection = 1;
  let transitionDuration = DEFAULT_TRAVEL_DURATION;
  let scanAmount = 0;
  let elapsed = 0;
  let suspended = false;
  let destroyed = false;
  let width = 1;
  let height = 1;
  let currentPixelRatio = 1;

  function assertAlive() {
    if (destroyed) throw new Error('[B4 cosmic stage] The stage has been destroyed.');
  }

  function buildScene(worldId) {
    const factory = SCENE_FACTORIES[worldId];
    if (!factory) throw new Error(`[B4 cosmic stage] No scene factory for ${worldId}.`);
    const adapter = factory({ renderer, camera, quality });
    adapter.root.visible = false;
    adapter.root.traverse((object) => {
      if (object.material?.uniforms?.uPixelRatio) {
        object.material.uniforms.uPixelRatio.value = currentPixelRatio;
      }
    });
    return adapter;
  }

  function getOrBuildScene(worldId) {
    let adapter = sceneCache.get(worldId);
    if (!adapter) {
      adapter = buildScene(worldId);
      sceneCache.set(worldId, adapter);
    }
    return adapter;
  }

  async function prepare(worldLike) {
    assertAlive();
    const worldId = resolveWorldId(worldLike);
    const adapter = getOrBuildScene(worldId);
    return { id: adapter.id };
  }

  async function mountInitial(worldLike) {
    assertAlive();
    const worldId = resolveWorldId(worldLike);
    const initialScene = getOrBuildScene(worldId);
    if (activeScene && activeScene !== initialScene) {
      scene.remove(activeScene.root);
      activeScene.root.visible = false;
      activeScene.resetTransition();
    }
    activeScene = initialScene;
    preparedScene = null;
    if (!scene.children.includes(activeScene.root)) scene.add(activeScene.root);
    activeScene.resetTransition();
    cameraRig.setAnchors(activeScene.anchors, { immediate: true, preferred: activeScene.defaultAnchorId });
    transitionActive = false;
    transitionProgress = 1;
    warpField.visible = false;
    renderer.render(scene, camera);
    return { id: activeScene.id };
  }

  async function beginTransition(worldLike, {
    direction = 1,
    duration = DEFAULT_TRAVEL_DURATION,
  } = {}) {
    assertAlive();
    if (transitionActive) throw new Error('[B4 cosmic stage] A transition is already active.');
    const worldId = resolveWorldId(worldLike);
    preparedScene = getOrBuildScene(worldId);
    if (!activeScene) return mountInitial(worldLike);
    if (preparedScene === activeScene) {
      preparedScene = null;
      return { started: false, id: activeScene.id };
    }

    transitionDirection = Math.sign(direction) || 1;
    transitionDuration = Math.max(1, Number(duration) || DEFAULT_TRAVEL_DURATION);
    transitionProgress = 0;
    transitionActive = true;
    if (!scene.children.includes(preparedScene.root)) scene.add(preparedScene.root);
    preparedScene.resetTransition();
    preparedScene.setTransition('incoming', 0, transitionDirection);
    activeScene.setTransition('outgoing', 0, transitionDirection);
    const targetAnchor = preparedScene.anchors.find((anchor) => anchor.id === preparedScene.defaultAnchorId)
      ?? preparedScene.anchors[0];
    cameraRig.beginTravel(targetAnchor, transitionDirection);
    warpField.material.uniforms.uDirection.value = transitionDirection;
    warpField.visible = !reducedMotion;
    return {
      started: true,
      from: activeScene.id,
      to: preparedScene.id,
      duration: transitionDuration,
    };
  }

  function setProgress(progress) {
    if (!transitionActive) return false;
    transitionProgress = clamp(Number(progress) || 0, 0, 1);
    activeScene.setTransition('outgoing', transitionProgress, transitionDirection);
    preparedScene.setTransition('incoming', transitionProgress, transitionDirection);
    cameraRig.setTravelProgress(transitionProgress);
    warpField.material.uniforms.uProgress.value = transitionProgress;
    warpField.visible = !reducedMotion && transitionProgress > .001 && transitionProgress < .999;
    return true;
  }

  function commit() {
    if (!transitionActive || !preparedScene) return false;
    scene.remove(activeScene.root);
    activeScene.root.visible = false;
    activeScene.resetTransition();
    activeScene = preparedScene;
    preparedScene = null;
    activeScene.resetTransition();
    transitionActive = false;
    transitionProgress = 1;
    warpField.visible = false;
    warpField.material.uniforms.uProgress.value = 0;
    cameraRig.setAnchors(activeScene.anchors, { immediate: false, preferred: activeScene.defaultAnchorId });
    cameraRig.commitTravel();
    return true;
  }

  function focus(anchorId, options = {}) {
    if (!activeScene || transitionActive) return false;
    return cameraRig.focus(anchorId, options);
  }

  function resetFocus(options = {}) {
    return focus(activeScene?.defaultAnchorId ?? 'overview', options);
  }

  function dragBy(deltaX, deltaY) {
    if (!activeScene || transitionActive) return false;
    cameraRig.dragBy(deltaX, deltaY);
    return true;
  }

  function zoomBy(delta) {
    if (!activeScene || transitionActive) return false;
    cameraRig.zoomBy(delta);
    return true;
  }

  function pick(x, y) {
    if (!activeScene || transitionActive || destroyed) return null;
    const ndc = typeof x === 'object'
      ? new THREE.Vector2(Number(x.x) || 0, Number(x.y) || 0)
      : new THREE.Vector2(Number(x) || 0, Number(y) || 0);
    ndc.x = clamp(ndc.x, -1, 1);
    ndc.y = clamp(ndc.y, -1, 1);
    raycaster.setFromCamera(ndc, camera);
    const intersections = raycaster.intersectObjects(activeScene.pickables, true);
    const hit = intersections.find((intersection) => {
      let object = intersection.object;
      while (object && object !== activeScene.root) {
        if (object.userData?.anchorId) return true;
        object = object.parent;
      }
      return false;
    });
    if (!hit) return null;
    let object = hit.object;
    while (object && !object.userData?.anchorId) object = object.parent;
    const anchorId = object?.userData?.anchorId;
    const anchor = activeScene.anchors.find((candidate) => candidate.id === anchorId);
    return anchor ? { anchorId, label: anchor.label, distance: hit.distance } : null;
  }

  function pulseScan(strength = 1) {
    scanAmount = Math.max(scanAmount, clamp(Number(strength) || 0, 0, 1));
    return scanAmount;
  }

  function resize(nextWidth, nextHeight, pixelRatio = currentPixelRatio) {
    if (destroyed) return false;
    width = Math.max(1, Math.round(Number(nextWidth) || canvas.clientWidth || 1));
    height = Math.max(1, Math.round(Number(nextHeight) || canvas.clientHeight || 1));
    currentPixelRatio = clamp(Number(pixelRatio) || 1, .75, pixelRatioCap);
    renderer.setPixelRatio(currentPixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    sceneCache.forEach((adapter) => {
      adapter.root.traverse((object) => {
        if (object.material?.uniforms?.uPixelRatio) {
          object.material.uniforms.uPixelRatio.value = currentPixelRatio;
        }
      });
    });
    return true;
  }

  function frame({
    delta = 0,
    pointerX = 0,
    pointerY = 0,
  } = {}) {
    if (destroyed) return null;
    const safeDelta = suspended ? 0 : clamp(Number(delta) || 0, 0, .05);
    if (!suspended) elapsed += safeDelta;
    pointer.set(clamp(Number(pointerX) || 0, -.5, .5), clamp(Number(pointerY) || 0, -.5, .5));
    cameraRig.setPointer(pointer.x, pointer.y);
    cameraRig.update(safeDelta);

    scanAmount *= Math.exp(-safeDelta * 2.35);
    if (scanAmount < .001) scanAmount = 0;
    activeScene?.setScan(scanAmount);
    preparedScene?.setScan(scanAmount);
    const frameState = {
      elapsed,
      delta: safeDelta,
      pointer,
      scan: scanAmount,
      transitionProgress,
    };
    activeScene?.update(frameState);
    if (preparedScene && preparedScene !== activeScene) preparedScene.update(frameState);

    if (!suspended) renderer.render(scene, camera);
    return {
      activeWorld: activeScene?.id ?? null,
      targetWorld: preparedScene?.id ?? null,
      transitioning: transitionActive,
      progress: transitionProgress,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
    };
  }

  function suspend(value = true) {
    suspended = Boolean(value);
    return suspended;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    suspended = true;
    sceneCache.forEach((adapter) => adapter.dispose());
    sceneCache.clear();
    disposeObjectTree(warpField);
    scene.clear();
    renderer.dispose();
    activeScene = null;
    preparedScene = null;
  }

  resize(canvas.clientWidth || 1, canvas.clientHeight || 1, 1);

  return Object.freeze({
    prepare,
    mountInitial,
    beginTransition,
    setProgress,
    frame,
    resize,
    commit,
    dragBy,
    zoomBy,
    pick,
    focus,
    resetFocus,
    pulseScan,
    scan: pulseScan,
    suspend,
    destroy,
  });
}
