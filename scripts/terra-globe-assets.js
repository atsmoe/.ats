const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const DEFAULT_PLACEMENT = Object.freeze({
  longitudeCenterDegrees: -18,
  longitudeSpanDegrees: 132,
  latitudeNorthDegrees: 84,
  latitudeSouthDegrees: -82,
});

const FILES = Object.freeze({
  albedo: 'terra-globe-albedo.webp',
  clouds: 'terra-globe-clouds.png',
  landMask: 'terra-globe-land-mask.png',
  linework: 'terra-globe-linework.png',
  normal: 'terra-globe-normal.png',
  relief: 'terra-globe-relief.png',
  manifest: 'terra-globe-manifest.json',
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function createCanvas(width, channels = 4) {
  return Buffer.alloc(width * Math.round(width / 2) * channels);
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function hashNoise(x, y, seed) {
  let value = Math.imul(x + seed * 1013, 374761393) ^ Math.imul(y - seed * 1999, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, scale, seed) {
  const scaledX = x / scale;
  const scaledY = y / scale;
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const tx = smoothstep(scaledX - x0);
  const ty = smoothstep(scaledY - y0);
  const a = hashNoise(x0, y0, seed);
  const b = hashNoise(x0 + 1, y0, seed);
  const c = hashNoise(x0, y0 + 1, seed);
  const d = hashNoise(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function fractalNoise(x, y, baseScale, seed) {
  let value = 0;
  let weight = 0;
  let amplitude = 1;
  for (let octave = 0; octave < 5; octave += 1) {
    value += valueNoise(x, y, Math.max(2, baseScale / (2 ** octave)), seed + octave * 17) * amplitude;
    weight += amplitude;
    amplitude *= 0.52;
  }
  return value / weight;
}

function mixColor(from, to, amount) {
  const t = clamp(amount, 0, 1);
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * t));
}

function terrainColor(height, latitude, variation) {
  const coast = [36, 48, 39];
  const lowland = [62, 65, 43];
  const upland = [91, 76, 53];
  const stone = [132, 126, 112];
  const ice = [181, 190, 188];
  let color;
  if (height < .32) color = mixColor(coast, lowland, height / .32);
  else if (height < .64) color = mixColor(lowland, upland, (height - .32) / .32);
  else color = mixColor(upland, stone, (height - .64) / .36);
  const polar = clamp((Math.abs(latitude) - .58) / .34, 0, 1) * clamp((height - .36) / .45, 0, 1);
  color = mixColor(color, ice, polar * .82);
  const shade = .82 + variation * .32;
  return color.map((channel) => clamp(Math.round(channel * shade), 0, 255));
}

function createNormalMap(heightMap, width, height, strength = .034) {
  const normal = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = (x - 1 + width) % width;
      const x1 = (x + 1) % width;
      const dx = (heightMap[y * width + x1] - heightMap[y * width + x0]) * strength;
      const dy = (heightMap[y1 * width + x] - heightMap[y0 * width + x]) * strength;
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const offset = (y * width + x) * 3;
      normal[offset] = Math.round((-.5 * dx / length + .5) * 255);
      normal[offset + 1] = Math.round((-.5 * dy / length + .5) * 255);
      normal[offset + 2] = Math.round((.5 / length + .5) * 255);
    }
  }
  return normal;
}

function createCloudTexture(width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  const scale = Math.max(28, width / 6.2);
  for (let y = 0; y < height; y += 1) {
    const latitude = Math.abs((y / Math.max(1, height - 1)) * 2 - 1);
    const band = Math.sin(y / Math.max(6, height / 19)) * .045;
    for (let x = 0; x < width; x += 1) {
      const noise = fractalNoise(x, y * 2.75, scale, 71);
      const ridge = 1 - Math.abs(noise * 2 - 1);
      const detail = fractalNoise(x * 1.7 + 431, y * 4.1 - 97, scale * .28, 119);
      const density = ridge * .74 + detail * .26 + band - latitude * .035;
      const alpha = clamp((density - .69) * 430, 0, 92);
      const offset = (y * width + x) * 4;
      rgba[offset] = 222;
      rgba[offset + 1] = 226;
      rgba[offset + 2] = 221;
      rgba[offset + 3] = Math.round(alpha);
    }
  }
  return rgba;
}

function equirectangularPoint(longitudeDegrees, latitudeDegrees, width, height) {
  return {
    x: ((longitudeDegrees + 180) / 360) * width,
    y: ((90 - latitudeDegrees) / 180) * height,
  };
}

function detectCartographicBounds(raw, width, height) {
  const mask = new Uint8Array(width * height);
  const edgeSample = [];
  const sampleBand = Math.max(2, Math.round(Math.min(width, height) * 0.025));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= sampleBand && x < width - sampleBand && y >= sampleBand && y < height - sampleBand) continue;
      const offset = (y * width + x) * 3;
      edgeSample.push([raw[offset], raw[offset + 1], raw[offset + 2]]);
    }
  }

  edgeSample.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const middle = edgeSample[Math.floor(edgeSample.length * 0.5)] || [65, 96, 116];
  const background = { r: middle[0], g: middle[1], b: middle[2] };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const r = raw[offset];
      const g = raw[offset + 1];
      const b = raw[offset + 2];
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const neutralBright = luminance > 122 && Math.max(r, g, b) - Math.min(r, g, b) < 66;
      mask[y * width + x] = neutralBright ? 255 : 0;
    }
  }

  return { mask, background };
}

function largestComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const neighbors = [-1, 1, -width, width];

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;
    const queue = [index];
    const pixels = [];
    visited[index] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      pixels.push(current);
      const x = current % width;
      for (const delta of neighbors) {
        const next = current + delta;
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        if ((delta === -1 && x === 0) || (delta === 1 && x === width - 1)) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    if (pixels.length >= Math.max(18, mask.length * 0.000035)) components.push(pixels);
  }

  components.sort((a, b) => b.length - a.length);
  return components.slice(0, 18);
}

function boundsForComponents(components, width) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const component of components) {
    for (const index of component) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { minX, minY, maxX, maxY };
}

function hueDegrees(red, green, blue, maximum, chroma) {
  if (chroma === 0) return 0;
  let hue;
  if (maximum === red) hue = 60 * (((green - blue) / chroma) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / chroma + 2);
  else hue = 60 * ((red - green) / chroma + 4);
  return hue < 0 ? hue + 360 : hue;
}

function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;
    const queue = [index];
    const pixels = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    visited[index] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const x = current % width;
      const y = Math.floor(current / width);
      pixels.push(current);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;
          const nextX = x + xOffset;
          const nextY = y + yOffset;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
    }

    components.push({ pixels, minX, minY, maxX, maxY });
  }

  return components;
}

async function deriveOfficialCellBoundaryLinework(sourcePatch, info, landMask) {
  const { width, height } = info;
  const candidate = Buffer.alloc(width * height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (landMask[pixel] < 12) continue;
    const offset = pixel * info.channels;
    const red = sourcePatch[offset] / 255;
    const green = sourcePatch[offset + 1] / 255;
    const blue = sourcePatch[offset + 2] / 255;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const chroma = maximum - minimum;
    const saturation = maximum > 0 ? chroma / maximum : 0;
    const hue = hueDegrees(red, green, blue, maximum, chroma);
    const outsideBlueGreyBase = hue < 185 || hue > 228;

    if (saturation > .12 && maximum > .18 && maximum < .97 && outsideBlueGreyBase) {
      candidate[pixel] = 255;
    }
  }

  const joined = await sharp(candidate, { raw: { width, height, channels: 1 } })
    .blur(.45)
    .threshold(70)
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  const retainedMask = Buffer.alloc(width * height);
  const minimumPixels = Math.max(18, Math.round(width * height * .000025));
  let retainedComponents = 0;

  for (const component of connectedComponents(joined, width, height)) {
    const componentWidth = component.maxX - component.minX + 1;
    const componentHeight = component.maxY - component.minY + 1;
    const density = component.pixels.length / (componentWidth * componentHeight);
    const followsCellGeometry = componentWidth >= 8 && componentHeight >= 8 && density < .55;
    if (component.pixels.length < minimumPixels || !followsCellGeometry) continue;
    retainedComponents += 1;
    for (const pixel of component.pixels) retainedMask[pixel] = 255;
  }

  const alpha = await sharp(retainedMask, { raw: { width, height, channels: 1 } })
    .blur(.36)
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    rgba[offset] = 217;
    rgba[offset + 1] = 145;
    rgba[offset + 2] = 72;
    rgba[offset + 3] = Math.round(alpha[pixel] * .86);
  }

  return { rgba, retainedComponents };
}

async function buildTerraGlobeAssets({ sourcePath, outputDir, width = 2048 } = {}) {
  if (!sourcePath) throw new TypeError('sourcePath is required');
  if (!outputDir) throw new TypeError('outputDir is required');
  if (!Number.isInteger(width) || width < 256 || width % 2 !== 0) {
    throw new TypeError('width must be an even integer of at least 256 pixels');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const height = width / 2;
  const inspectionWidth = 900;
  const source = sharp(sourcePath).removeAlpha().toColourspace('srgb');
  const sourceMetadata = await source.metadata();
  const inspectionHeight = Math.round((sourceMetadata.height / sourceMetadata.width) * inspectionWidth);
  const { data: inspectionRaw } = await source
    .clone()
    .resize({ width: inspectionWidth, height: inspectionHeight, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const detection = detectCartographicBounds(inspectionRaw, inspectionWidth, inspectionHeight);

  const softenedMask = await sharp(Buffer.from(detection.mask), {
    raw: { width: inspectionWidth, height: inspectionHeight, channels: 1 },
  })
    .blur(4.6)
    .threshold(142)
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  const components = largestComponents(softenedMask, inspectionWidth, inspectionHeight);
  if (!components.length) throw new Error('Unable to isolate Terra cartography from the supplied source image');

  const retained = [components[0]];
  const componentMask = Buffer.alloc(inspectionWidth * inspectionHeight);
  for (const component of retained) {
    for (const index of component) componentMask[index] = 255;
  }

  const bounds = boundsForComponents(retained, inspectionWidth);
  const paddingX = Math.round((bounds.maxX - bounds.minX) * 0.035);
  const paddingY = Math.round((bounds.maxY - bounds.minY) * 0.025);
  const crop = {
    left: clamp(bounds.minX - paddingX, 0, inspectionWidth - 1),
    top: clamp(bounds.minY - paddingY, 0, inspectionHeight - 1),
    width: clamp(bounds.maxX - bounds.minX + paddingX * 2 + 1, 1, inspectionWidth),
    height: clamp(bounds.maxY - bounds.minY + paddingY * 2 + 1, 1, inspectionHeight),
  };
  crop.width = Math.min(crop.width, inspectionWidth - crop.left);
  crop.height = Math.min(crop.height, inspectionHeight - crop.top);

  const placement = DEFAULT_PLACEMENT;
  const destinationNorth = equirectangularPoint(placement.longitudeCenterDegrees, placement.latitudeNorthDegrees, width, height);
  const destinationSouth = equirectangularPoint(placement.longitudeCenterDegrees, placement.latitudeSouthDegrees, width, height);
  const destinationLeft = equirectangularPoint(
    placement.longitudeCenterDegrees - placement.longitudeSpanDegrees / 2,
    0,
    width,
    height,
  );
  const destinationRight = equirectangularPoint(
    placement.longitudeCenterDegrees + placement.longitudeSpanDegrees / 2,
    0,
    width,
    height,
  );
  const destination = {
    left: Math.round(destinationLeft.x),
    top: Math.round(destinationNorth.y),
    width: Math.round(destinationRight.x - destinationLeft.x),
    height: Math.round(destinationSouth.y - destinationNorth.y),
  };

  const croppedMask = await sharp(componentMask, {
    raw: { width: inspectionWidth, height: inspectionHeight, channels: 1 },
  })
    .extract(crop)
    .resize(destination.width, destination.height, { kernel: sharp.kernel.lanczos3 })
    .blur(Math.max(0.45, width / 3800))
    .toColourspace('b-w')
    .raw()
    .toBuffer();

  const sourceCrop = {
    left: Math.round((crop.left / inspectionWidth) * sourceMetadata.width),
    top: Math.round((crop.top / inspectionHeight) * sourceMetadata.height),
    width: Math.round((crop.width / inspectionWidth) * sourceMetadata.width),
    height: Math.round((crop.height / inspectionHeight) * sourceMetadata.height),
  };
  sourceCrop.width = Math.min(sourceCrop.width, sourceMetadata.width - sourceCrop.left);
  sourceCrop.height = Math.min(sourceCrop.height, sourceMetadata.height - sourceCrop.top);

  // Use the community map for continent placement and broad relief, then rebuild
  // the surface as a material map. This suppresses editorial labels while retaining
  // the source coastline and its coloured cartographic linework.
  const { data: sourcePatch, info: sourcePatchInfo } = await source
    .clone()
    .extract(sourceCrop)
    .resize(destination.width, destination.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const macroRelief = await sharp(sourcePatch, { raw: sourcePatchInfo })
    .greyscale()
    .blur(Math.max(7.5, destination.width / 62))
    .normalize({ lower: 2, upper: 98 })
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  const terrainDetail = await sharp(sourcePatch, { raw: sourcePatchInfo })
    .greyscale()
    .median(5)
    .blur(Math.max(.7, destination.width / 1080))
    .normalize({ lower: 2, upper: 98 })
    .toColourspace('b-w')
    .raw()
    .toBuffer();

  const terrainRgba = Buffer.alloc(destination.width * destination.height * 4);
  const reliefPatchRaw = Buffer.alloc(destination.width * destination.height, 96);
  for (let y = 0; y < destination.height; y += 1) {
    const latitude = 1 - ((destination.top + y) / Math.max(1, height - 1)) * 2;
    for (let x = 0; x < destination.width; x += 1) {
      const pixel = y * destination.width + x;
      const alpha = croppedMask[pixel] / 255;
      const output = pixel * 4;
      if (alpha <= .01) continue;

      const broad = macroRelief[pixel] / 255;
      const largeNoise = fractalNoise(x, y, Math.max(38, destination.width / 5.2), 23);
      const fineNoise = fractalNoise(x + 191, y - 73, Math.max(13, destination.width / 18), 47);
      const microNoise = fractalNoise(x * 2.15 - 37, y * 2.15 + 61, Math.max(6, destination.width / 62), 83);
      const ridgeNoise = 1 - Math.abs(fractalNoise(x * 1.45 + 211, y * 1.45 - 109, Math.max(12, destination.width / 32), 101) * 2 - 1);
      const sourceDetail = clamp((terrainDetail[pixel] - macroRelief[pixel]) / 255, -.14, .14);
      const mountainWeight = clamp((broad - .34) / .46, 0, 1);
      const terrainHeight = clamp(
        broad * .4
          + largeNoise * .24
          + fineNoise * .14
          + microNoise * .1
          + ridgeNoise * mountainWeight * .12
          + sourceDetail * .16,
        0,
        1,
      );
      const variation = clamp(largeNoise * .46 + fineNoise * .25 + microNoise * .19 + ridgeNoise * .1, 0, 1);
      const color = terrainColor(terrainHeight, latitude, variation);

      terrainRgba[output] = color[0];
      terrainRgba[output + 1] = color[1];
      terrainRgba[output + 2] = color[2];
      terrainRgba[output + 3] = Math.round(alpha * 255);
      reliefPatchRaw[pixel] = Math.round(104 + terrainHeight * 132);
    }
  }
  const terrain = await sharp(terrainRgba, {
    raw: { width: destination.width, height: destination.height, channels: 4 },
  })
    .png()
    .toBuffer();

  const oceanSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ocean" cx="42%" cy="44%" r="76%">
          <stop offset="0" stop-color="#173038"/>
          <stop offset="0.54" stop-color="#0a1d23"/>
          <stop offset="1" stop-color="#02080b"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#ocean)"/>
    </svg>
  `);
  await sharp(oceanSvg)
    .composite([{ input: terrain, left: destination.left, top: destination.top }])
    .sharpen({ sigma: .82, m1: 1.08, m2: .42 })
    .webp({ quality: 88, effort: 5, smartSubsample: true })
    .toFile(path.join(outputDir, FILES.albedo));

  const lineworkWidth = Math.max(751, destination.width);
  const lineworkHeight = Math.round(lineworkWidth * (destination.height / destination.width));
  const { data: lineworkSource, info: lineworkInfo } = await source
    .clone()
    .extract(sourceCrop)
    .resize(lineworkWidth, lineworkHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lineworkLandMask = await sharp(croppedMask, {
    raw: { width: destination.width, height: destination.height, channels: 1 },
  })
    .resize(lineworkWidth, lineworkHeight, { kernel: sharp.kernel.lanczos3 })
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  const linework = await deriveOfficialCellBoundaryLinework(
    lineworkSource,
    lineworkInfo,
    lineworkLandMask,
  );
  const lineworkPatch = await sharp(linework.rgba, {
    raw: { width: lineworkWidth, height: lineworkHeight, channels: 4 },
  })
    .resize(destination.width, destination.height, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: lineworkPatch, left: destination.left, top: destination.top }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, FILES.linework));

  const fullRelief = Buffer.alloc(width * height, 96);
  for (let y = 0; y < destination.height; y += 1) {
    reliefPatchRaw.copy(
      fullRelief,
      (destination.top + y) * width + destination.left,
      y * destination.width,
      (y + 1) * destination.width,
    );
  }
  await sharp(fullRelief, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9, palette: true, colours: 64 })
    .toFile(path.join(outputDir, FILES.relief));

  const normalMap = createNormalMap(fullRelief, width, height);
  await sharp(normalMap, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, FILES.normal));

  const clouds = createCloudTexture(width, height);
  await sharp(clouds, { raw: { width, height, channels: 4 } })
    .blur(Math.max(.35, width / 4800))
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, FILES.clouds));

  const fullMask = createCanvas(width, 1);
  for (let y = 0; y < destination.height; y += 1) {
    croppedMask.copy(
      fullMask,
      (destination.top + y) * width + destination.left,
      y * destination.width,
      (y + 1) * destination.width,
    );
  }
  await sharp(fullMask, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9, palette: true, colours: 16 })
    .toFile(path.join(outputDir, FILES.landMask));

  const landStats = await sharp(path.join(outputDir, FILES.landMask)).stats();
  const manifest = {
    schemaVersion: 1,
    source: {
      file: path.basename(sourcePath),
      width: sourceMetadata.width,
      height: sourceMetadata.height,
    },
    provenance: {
      classification: 'community-cartography',
      notice: '六边形区划边界从源图中标出的官方公开信息区域提取；地形为社区补绘。球面纹理由本站重新投影。',
      limitations: '源图没有地理坐标。本投影用于视觉呈现，不能作为精确地理测量或官方疆界数据。',
    },
    projection: {
      type: 'equirectangular-authored',
      outputAspectRatio: '2:1',
      ...placement,
      sourceCrop,
      destinationPixels: destination,
    },
    hexGrid: {
      method: 'source-highlighted-cell-boundaries-extracted',
      sourceHorizontalPeriodPixels: 50,
      claim: '保留源图中实际标出的彩色六边形区划边界，并按同一裁切关系投影到球面；未生成新的格子位置。',
      retainedComponents: linework.retainedComponents,
    },
    surfaceTreatment: {
      labels: 'suppressed',
      terrain: 'source-guided-procedural-pbr',
      atmosphere: 'separate-cloud-and-normal-maps',
    },
    compositionReference: {
      planetPlacement: 'oversized-lower-left-crop',
      lighting: 'warm-horizon-rim-with-cool-night-side',
      interface: 'sparse-perimeter-observation-frame',
    },
    metrics: {
      landCoverage: Number((landStats.channels[0].mean / 255).toFixed(6)),
    },
    buildDiagnostics: {
      inspectionSize: [inspectionWidth, inspectionHeight],
      candidateComponents: components.slice(0, 8).map((component) => ({
        pixels: component.length,
        bounds: boundsForComponents([component], inspectionWidth),
      })),
    },
  };
  fs.writeFileSync(path.join(outputDir, FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { files: { ...FILES }, manifest };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  buildTerraGlobeAssets({
    sourcePath: path.join(root, 'src', 'assets', 'images', 'arknights', 'terra-community-administrative-map.png'),
    outputDir: path.join(root, 'src', 'assets', 'images', 'star-map', 'terra'),
    width: 2048,
  })
    .then(({ manifest }) => {
      process.stdout.write(`Terra globe assets ready: ${(manifest.metrics.landCoverage * 100).toFixed(1)}% land coverage\n`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { buildTerraGlobeAssets };
