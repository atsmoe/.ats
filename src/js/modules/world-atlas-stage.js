import * as THREE from 'three';

const TAU = Math.PI * 2;
const TERRA_RADIUS = 9.6;
const WORLD_IDS = ['arknights', 'wh40k', 'ff14'];
const WORLD_POSITIONS = Object.freeze({
  arknights: new THREE.Vector3(0, 0, 0),
  wh40k: new THREE.Vector3(42, 10, -31),
  ff14: new THREE.Vector3(-39, 12, -53),
});

const VIEW_SPECS = Object.freeze({
  arknights: {
    cameraOffset: new THREE.Vector3(2.7, 3.8, 19.4),
    targetOffset: new THREE.Vector3(4.7, 2.45, 0),
    fov: 43,
  },
  wh40k: {
    cameraOffset: new THREE.Vector3(3.8, 8.7, 21.5),
    targetOffset: new THREE.Vector3(2.3, 0, 0),
    fov: 43,
  },
  ff14: {
    cameraOffset: new THREE.Vector3(3.6, 5.8, 20.5),
    targetOffset: new THREE.Vector3(2.4, .1, 0),
    fov: 42,
  },
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function easeInOutCubic(value) {
  if (value < .5) return 4 * value * value * value;
  return 1 - ((-2 * value + 2) ** 3) / 2;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFactory(seed) {
  let state = hashString(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createRadialTexture() {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x / (size - 1)) * 2 - 1;
      const ny = (y / (size - 1)) * 2 - 1;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const alpha = Math.round(255 * Math.pow(Math.max(0, 1 - distance), 2.7));
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function createGlowSprite(texture, color, scale, opacity = .6) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

function createOrbit(radius, color, opacity = .16, segments = 220) {
  const positions = new Float32Array((segments + 1) * 3);
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * TAU;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = 0;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.Line(geometry, material);
}

function createAtmosphere(radius, color, opacity) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec3 vNormalView;
      void main() {
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormalView;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float rim = pow(max(0.0, 1.0 - abs(vNormalView.z)), 2.25);
        gl_FragColor = vec4(uColor, rim * uOpacity);
      }
    `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 72, 44), material);
}

function createStarField(quality) {
  const random = randomFactory('formal-spatial-atlas-stars');
  const count = quality === 'reduced' ? 1900 : 4400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const warm = new THREE.Color(0xd8c69b);
  const cold = new THREE.Color(0x8ca6c0);
  const neutral = new THREE.Color(0xd8dbe0);
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const radius = 38 + Math.pow(random(), .72) * 155;
    const theta = random() * TAU;
    const phi = Math.acos(2 * random() - 1);
    positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[index * 3 + 1] = Math.cos(phi) * radius;
    positions[index * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    color.copy(random() > .83 ? warm : cold).lerp(neutral, random() * .68);
    const intensity = .35 + random() * .9;
    colors[index * 3] = color.r * intensity;
    colors[index * 3 + 1] = color.g * intensity;
    colors[index * 3 + 2] = color.b * intensity;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: quality === 'reduced' ? .11 : .085,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: .72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

function loadTexture(loader, url, { srgb = false } = {}) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (texture) => {
        if (srgb) texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = 4;
        resolve(texture);
      },
      undefined,
      () => resolve(null),
    );
  });
}

export function createTerraSystem({ quality, glowTexture, textureLoader }) {
  const root = new THREE.Group();
  root.name = 'terra-system';
  root.position.copy(WORLD_POSITIONS.arknights);

  const content = new THREE.Group();
  content.rotation.set(.06, -.58, -.1);
  root.add(content);

  const detail = quality === 'reduced' ? [64, 40] : [112, 72];
  const planetMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a2525,
    emissive: 0x030707,
    emissiveIntensity: .2,
    roughness: .74,
    metalness: .01,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(TERRA_RADIUS, detail[0], detail[1]), planetMaterial);
  planet.name = 'terra-planet';
  planet.userData.worldId = 'arknights';
  content.add(planet);

  const atmosphereWarm = createAtmosphere(TERRA_RADIUS + .42, 0xffc184, .68);
  const atmosphereCold = createAtmosphere(TERRA_RADIUS + .22, 0x77a7b2, .2);
  content.add(atmosphereWarm, atmosphereCold);

  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xdde2de,
    transparent: true,
    opacity: 0,
    alphaTest: .012,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  });
  const cloudLayer = new THREE.Mesh(
    new THREE.SphereGeometry(TERRA_RADIUS + .075, detail[0], detail[1]),
    cloudMaterial,
  );
  cloudLayer.name = 'terra-cloud-layer';
  content.add(cloudLayer);

  const lineworkMaterial = new THREE.MeshBasicMaterial({
    color: 0xf0a354,
    transparent: true,
    opacity: .42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lineworkLayer = new THREE.Mesh(
    new THREE.SphereGeometry(TERRA_RADIUS + .035, detail[0], detail[1]),
    lineworkMaterial,
  );
  lineworkLayer.name = 'terra-source-linework';
  content.add(lineworkLayer);

  const nearOrbit = createOrbit(12.75, 0xd9a441, .1);
  nearOrbit.rotation.set(1.26, .1, -.18);
  const farOrbit = createOrbit(15.4, 0x6d9698, .055);
  farOrbit.rotation.set(.72, -.34, .28);
  content.add(nearOrbit, farOrbit);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(.74, 28, 18),
    new THREE.MeshStandardMaterial({ color: 0x657278, roughness: .96, metalness: 0 }),
  );
  moon.position.set(12.45, 1.6, .8);
  content.add(moon);

  const observationGlow = createGlowSprite(glowTexture, 0xd9a441, 21, .1);
  observationGlow.position.set(-6.6, 5.9, -3.8);
  const horizonGlow = createGlowSprite(glowTexture, 0xffc48b, 6.8, .78);
  horizonGlow.position.set(8.7, 2.25, 3.9);
  root.add(observationGlow, horizonGlow);

  const terraKey = new THREE.DirectionalLight(0xffd0a2, 2.35);
  terraKey.position.set(12, 5.5, 10);
  root.add(terraKey);

  const ready = Promise.all([
    loadTexture(textureLoader, './assets/images/star-map/terra/terra-globe-albedo.webp', { srgb: true }),
    loadTexture(textureLoader, './assets/images/star-map/terra/terra-globe-clouds.png', { srgb: true }),
    loadTexture(textureLoader, './assets/images/star-map/terra/terra-globe-linework.png', { srgb: true }),
    loadTexture(textureLoader, './assets/images/star-map/terra/terra-globe-normal.png'),
    loadTexture(textureLoader, './assets/images/star-map/terra/terra-globe-relief.png'),
  ]).then(([albedo, clouds, linework, normal, relief]) => {
    if (albedo) {
      planetMaterial.map = albedo;
      planetMaterial.color.set(0xffffff);
      planetMaterial.needsUpdate = true;
    }
    if (clouds) {
      cloudMaterial.map = clouds;
      cloudMaterial.opacity = .34;
      cloudMaterial.needsUpdate = true;
    }
    if (linework) {
      lineworkMaterial.map = linework;
      lineworkMaterial.needsUpdate = true;
    }
    if (normal) {
      planetMaterial.normalMap = normal;
      planetMaterial.normalScale.set(.82, .82);
      planetMaterial.needsUpdate = true;
    }
    if (relief) {
      planetMaterial.bumpMap = relief;
      planetMaterial.bumpScale = .24;
      planetMaterial.needsUpdate = true;
    }
  });

  return {
    id: 'arknights',
    root,
    content,
    pickables: [planet],
    ready,
    update(elapsed, delta, reducedMotion) {
      if (reducedMotion) return;
      content.rotation.y += delta * .006;
      cloudLayer.rotation.y += delta * .008;
      const angle = elapsed * .055 + .34;
      moon.position.set(Math.cos(angle) * 12.55, 1.45 + Math.sin(angle * 1.7) * .44, Math.sin(angle) * 12.55);
      observationGlow.material.opacity = .085 + Math.sin(elapsed * .42) * .018;
      horizonGlow.material.opacity = .72 + Math.sin(elapsed * .24) * .055;
    },
  };
}

function createGalaxyPoints(quality) {
  const count = quality === 'reduced' ? 3900 : 8600;
  const random = randomFactory('formal-broken-galaxy');
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const gold = new THREE.Color(0xc5ad78);
  const red = new THREE.Color(0x9c302d);
  const ash = new THREE.Color(0x757b80);
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const arm = index % 5;
    const radius = Math.pow(random(), .62) * 8.2;
    const angle = radius * 1.18 + arm * (TAU / 5) + (random() - .5) * (.36 + radius * .055);
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = (random() - .5) * (.16 + radius * .07);
    positions[index * 3 + 2] = Math.sin(angle) * radius;
    color.copy(random() > .86 ? red : gold).lerp(ash, random() * .3);
    const intensity = .48 + random() * 1.05;
    colors[index * 3] = color.r * intensity;
    colors[index * 3 + 1] = color.g * intensity;
    colors[index * 3 + 2] = color.b * intensity;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: quality === 'reduced' ? .09 : .075,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: .88,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

export function createBrokenGalaxy({ quality, glowTexture }) {
  const root = new THREE.Group();
  root.name = 'broken-galaxy';
  root.position.copy(WORLD_POSITIONS.wh40k);

  const content = new THREE.Group();
  content.rotation.set(.92, -.08, -.23);
  root.add(content);

  const galaxy = createGalaxyPoints(quality);
  galaxy.userData.worldId = 'wh40k';
  content.add(galaxy);

  const coreGlow = createGlowSprite(glowTexture, 0xd4bb80, 8.6, .55);
  coreGlow.position.z = .2;
  content.add(coreGlow);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(.31, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xf0d39a, transparent: true, opacity: .92 }),
  );
  core.userData.worldId = 'wh40k';
  content.add(core);

  const riftCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-7.8, -.05, -1.6),
    new THREE.Vector3(-5.4, .22, .18),
    new THREE.Vector3(-2.7, -.18, -.62),
    new THREE.Vector3(-.4, .16, .48),
    new THREE.Vector3(2.2, -.12, -.15),
    new THREE.Vector3(5.1, .18, 1.02),
    new THREE.Vector3(8.0, -.08, 1.82),
  ]);
  const shadow = new THREE.Mesh(
    new THREE.TubeGeometry(riftCurve, 150, .24, 7, false),
    new THREE.MeshBasicMaterial({ color: 0x020104, transparent: true, opacity: .98, depthWrite: false }),
  );
  const rift = new THREE.Mesh(
    new THREE.TubeGeometry(riftCurve, 150, .075, 6, false),
    new THREE.MeshBasicMaterial({
      color: 0xc53a37,
      transparent: true,
      opacity: .82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  shadow.userData.worldId = 'wh40k';
  rift.userData.worldId = 'wh40k';
  content.add(shadow, rift);

  const outerExtent = createOrbit(9.1, 0x80715c, .14);
  const innerExtent = createOrbit(6.4, 0x8e302d, .11);
  content.add(outerExtent, innerExtent);

  const signalGlow = createGlowSprite(glowTexture, 0xb9433e, 18, .14);
  root.add(signalGlow);

  return {
    id: 'wh40k',
    root,
    content,
    pickables: [galaxy, core, shadow, rift],
    ready: Promise.resolve(),
    update(elapsed, delta, reducedMotion) {
      if (reducedMotion) return;
      content.rotation.y += delta * .004;
      core.scale.setScalar(1 + Math.sin(elapsed * .63) * .08);
      coreGlow.material.opacity = .48 + Math.sin(elapsed * .39) * .08;
      rift.material.opacity = .72 + Math.sin(elapsed * .72) * .1;
    },
  };
}

function createReflectionTrace(start, color, phase = 0) {
  const control = start.clone().multiplyScalar(.55);
  control.y += .8 + phase * .08;
  control.z += 1.15;
  const curve = new THREE.QuadraticBezierCurve3(start, control, new THREE.Vector3(0, 0, 0));
  const points = curve.getPoints(68);
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    if ((index + phase) % 10 < 5) segments.push(...points[index].toArray(), ...points[index + 1].toArray());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: .22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.LineSegments(geometry, material);
}

export function createFourteenWorlds({ quality, glowTexture }) {
  const root = new THREE.Group();
  root.name = 'fourteen-worlds';
  root.position.copy(WORLD_POSITIONS.ff14);

  const content = new THREE.Group();
  content.rotation.set(.08, -.18, -.11);
  root.add(content);

  const sourceMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x244f69,
    emissive: 0x0b2739,
    emissiveIntensity: .58,
    roughness: .62,
    metalness: .02,
    clearcoat: .24,
  });
  const source = new THREE.Mesh(
    new THREE.SphereGeometry(2.7, quality === 'reduced' ? 48 : 80, quality === 'reduced' ? 30 : 50),
    sourceMaterial,
  );
  source.userData.worldId = 'ff14';
  content.add(source, createAtmosphere(2.88, 0x8fc8f3, .36));

  const sourceGlow = createGlowSprite(glowTexture, 0x8fc8f3, 10.5, .23);
  sourceGlow.position.z = -1.2;
  content.add(sourceGlow);

  const extantIndices = new Set([0, 2, 5, 7, 9, 12]);
  const worlds = [];
  const traces = [];
  const palette = [0x8fc8f3, 0xb99bd4, 0xd1bd78];

  for (let index = 0; index < 13; index += 1) {
    const angle = (index / 13) * TAU - .72;
    const radius = index % 2 === 0 ? 5.25 : 6.35;
    const position = new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle * 2.13) * 1.62,
      Math.sin(angle) * radius * .62,
    );
    const color = palette[index % palette.length];

    if (extantIndices.has(index)) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(.31 + (index % 3) * .045, 26, 16),
        new THREE.MeshPhysicalMaterial({
          color,
          emissive: color,
          emissiveIntensity: .18,
          roughness: .7,
          metalness: 0,
        }),
      );
      sphere.position.copy(position);
      sphere.userData.worldId = 'ff14';
      sphere.userData.base = position.clone();
      sphere.userData.phase = index * .61;
      worlds.push(sphere);
      content.add(sphere);
    } else {
      const trace = createReflectionTrace(position, color, index);
      traces.push(trace);
      content.add(trace);
    }
  }

  const orbitA = createOrbit(5.4, 0x8fc8f3, .18);
  orbitA.rotation.set(.52, .12, -.22);
  const orbitB = createOrbit(6.3, 0xb99bd4, .12);
  orbitB.rotation.set(1.08, -.26, .34);
  const orbitC = createOrbit(7.15, 0xd1bd78, .075);
  orbitC.rotation.set(.76, .42, -.13);
  content.add(orbitA, orbitB, orbitC);

  const signalGlow = createGlowSprite(glowTexture, 0x8fc8f3, 18, .15);
  root.add(signalGlow);

  return {
    id: 'ff14',
    root,
    content,
    pickables: [source, ...worlds],
    ready: Promise.resolve(),
    update(elapsed, delta, reducedMotion) {
      if (reducedMotion) return;
      source.rotation.y += delta * .026;
      worlds.forEach((world, index) => {
        world.position.copy(world.userData.base);
        world.position.y += Math.sin(elapsed * .24 + world.userData.phase) * .08;
        world.rotation.y += delta * (.018 + index * .002);
      });
      orbitA.rotation.z += delta * .006;
      orbitB.rotation.z -= delta * .004;
      traces.forEach((trace, index) => {
        trace.material.opacity = .14 + Math.sin(elapsed * .3 + index * .7) * .045;
      });
      sourceGlow.material.opacity = .2 + Math.sin(elapsed * .36) * .035;
    },
  };
}

function disposeTree(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value?.isTexture) value.dispose();
      });
      material.dispose?.();
    });
  });
}

function viewFor(worldId, zoomDelta = 0) {
  const origin = WORLD_POSITIONS[worldId];
  const spec = VIEW_SPECS[worldId];
  const target = origin.clone().add(spec.targetOffset);
  const direction = spec.cameraOffset.clone().sub(spec.targetOffset).normalize();
  const camera = origin.clone().add(spec.cameraOffset).addScaledVector(direction, zoomDelta);
  return { camera, target, fov: spec.fov };
}

export function createWorldAtlasStage({ canvas, initialWorld = 'arknights', reducedMotion = false }) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('A canvas element is required');
  if (!WORLD_IDS.includes(initialWorld)) throw new RangeError(`Unknown world: ${initialWorld}`);

  const quality = reducedMotion || window.innerWidth < 760 ? 'reduced' : 'full';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'full', powerPreference: 'high-performance' });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x020609, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'reduced' ? 1.25 : 1.8));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020609);
  scene.fog = new THREE.FogExp2(0x020609, .0037);

  const camera = new THREE.PerspectiveCamera(41, 1, .1, 420);
  const glowTexture = createRadialTexture();
  const textureLoader = new THREE.TextureLoader();
  const starField = createStarField(quality);
  scene.add(starField);

  const ambient = new THREE.HemisphereLight(0x8398a4, 0x030506, .56);
  const key = new THREE.DirectionalLight(0xe1a746, 2.5);
  key.position.set(-12, 9, 14);
  const coolFill = new THREE.DirectionalLight(0x5e91a0, .72);
  coolFill.position.set(10, -4, 7);
  scene.add(ambient, key, coolFill);

  const worlds = {
    arknights: createTerraSystem({ quality, glowTexture, textureLoader }),
    wh40k: createBrokenGalaxy({ quality, glowTexture }),
    ff14: createFourteenWorlds({ quality, glowTexture }),
  };
  WORLD_IDS.forEach((worldId) => scene.add(worlds[worldId].root));

  let activeWorld = initialWorld;
  let activeTarget = viewFor(initialWorld);
  let cameraTarget = activeTarget.target.clone();
  let travel = null;
  let zoomDelta = 0;
  let suspended = false;
  let destroyed = false;

  camera.position.copy(activeTarget.camera);
  camera.fov = activeTarget.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(cameraTarget);

  function focusWorld(worldId, { immediate = false } = {}) {
    if (!WORLD_IDS.includes(worldId)) return false;
    activeWorld = worldId;
    zoomDelta = 0;
    const destination = viewFor(worldId);
    if (immediate || reducedMotion) {
      camera.position.copy(destination.camera);
      cameraTarget.copy(destination.target);
      camera.fov = destination.fov;
      camera.updateProjectionMatrix();
      camera.lookAt(cameraTarget);
      travel = null;
    } else {
      travel = {
        elapsed: 0,
        duration: 1.38,
        fromCamera: camera.position.clone(),
        fromTarget: cameraTarget.clone(),
        fromFov: camera.fov,
        toCamera: destination.camera,
        toTarget: destination.target,
        toFov: destination.fov,
      };
    }
    return true;
  }

  function resize(width, height, pixelRatio = window.devicePixelRatio || 1) {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    renderer.setPixelRatio(Math.min(pixelRatio, quality === 'reduced' ? 1.25 : 1.8));
    renderer.setSize(safeWidth, safeHeight, false);
    camera.aspect = safeWidth / safeHeight;
    camera.updateProjectionMatrix();
  }

  function dragBy(deltaX, deltaY) {
    if (travel) return;
    const content = worlds[activeWorld].content;
    content.rotation.y += deltaX * .0045;
    content.rotation.x = clamp(content.rotation.x + deltaY * .0032, -.65, 1.24);
  }

  function zoomBy(deltaY) {
    if (travel) return;
    zoomDelta = clamp(zoomDelta + deltaY * .008, -4.2, 6.8);
    const desired = viewFor(activeWorld, zoomDelta);
    camera.position.lerp(desired.camera, .36);
    cameraTarget.lerp(desired.target, .36);
    camera.lookAt(cameraTarget);
  }

  function screenPositions() {
    const result = {};
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    WORLD_IDS.forEach((worldId) => {
      const projected = WORLD_POSITIONS[worldId].clone().project(camera);
      result[worldId] = {
        x: (projected.x * .5 + .5) * width,
        y: (-projected.y * .5 + .5) * height,
        depth: clamp(1 - (projected.z + 1) * .5, .12, 1),
        visible: projected.z > -1.4 && projected.z < 1.08,
      };
    });
    return result;
  }

  function pick(normalizedX, normalizedY) {
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = .7;
    raycaster.setFromCamera(new THREE.Vector2(normalizedX, normalizedY), camera);
    const pickables = WORLD_IDS.flatMap((worldId) => worlds[worldId].pickables);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    return hit?.object?.userData?.worldId ?? null;
  }

  function frame({ delta, now }) {
    if (destroyed || suspended) return;
    const safeDelta = Math.min(.05, Math.max(0, delta));
    const elapsed = now / 1000;

    if (travel) {
      travel.elapsed += safeDelta;
      const progress = clamp(travel.elapsed / travel.duration, 0, 1);
      const eased = easeInOutCubic(progress);
      camera.position.lerpVectors(travel.fromCamera, travel.toCamera, eased);
      cameraTarget.lerpVectors(travel.fromTarget, travel.toTarget, eased);
      camera.fov = THREE.MathUtils.lerp(travel.fromFov, travel.toFov, eased);
      camera.updateProjectionMatrix();
      if (progress >= 1) travel = null;
    }

    WORLD_IDS.forEach((worldId) => worlds[worldId].update(elapsed, safeDelta, reducedMotion));
    if (!reducedMotion) starField.rotation.y += safeDelta * .0016;
    camera.lookAt(cameraTarget);
    renderer.render(scene, camera);
  }

  function suspend(value) {
    suspended = Boolean(value);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    disposeTree(scene);
    glowTexture.dispose();
    renderer.dispose();
  }

  return {
    ready: Promise.all(WORLD_IDS.map((worldId) => worlds[worldId].ready)),
    focusWorld,
    resize,
    dragBy,
    zoomBy,
    screenPositions,
    pick,
    frame,
    suspend,
    destroy,
  };
}
