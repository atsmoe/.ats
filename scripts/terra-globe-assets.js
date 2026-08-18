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
  landMask: 'terra-globe-land-mask.png',
  relief: 'terra-globe-relief.png',
  manifest: 'terra-globe-manifest.json',
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function createCanvas(width, channels = 4) {
  return Buffer.alloc(width * Math.round(width / 2) * channels);
}

function alphaImageFromMask(mask, width, height) {
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let index = 0; index < mask.length; index += 1) rgba[index * 4 + 3] = mask[index];
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
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

  // Keep the source's mountain, ice and coastline structure intact.  The source is
  // reduced directly to the authored projection instead of passing through a tiny
  // blurred draft; at globe scale its editorial labels recede while the terrain
  // still reads under raking light.
  const terrainRgb = await source
    .clone()
    .extract(sourceCrop)
    .resize(destination.width, destination.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .blur(Math.max(0.32, destination.width / 4200))
    .sharpen({ sigma: 0.72, m1: 0.72, m2: 0.28 })
    .modulate({ saturation: 0.46, brightness: 0.72 })
    .tint({ r: 118, g: 143, b: 151 })
    .png()
    .toBuffer();
  const croppedMaskRgba = await alphaImageFromMask(croppedMask, destination.width, destination.height);
  const terrain = await sharp(terrainRgb)
    .ensureAlpha()
    .composite([{ input: croppedMaskRgba, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const oceanSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ocean" cx="42%" cy="48%" r="74%">
          <stop offset="0" stop-color="#102126"/>
          <stop offset="0.58" stop-color="#081417"/>
          <stop offset="1" stop-color="#020708"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#ocean)"/>
    </svg>
  `);
  await sharp(oceanSvg)
    .composite([{ input: terrain, left: destination.left, top: destination.top }])
    .webp({ quality: 88, effort: 5, smartSubsample: true })
    .toFile(path.join(outputDir, FILES.albedo));

  const reliefPatch = await sharp(terrainRgb)
    .greyscale()
    .blur(Math.max(2.4, destination.width / 300))
    .normalize({ lower: 3, upper: 97 })
    .ensureAlpha()
    .composite([{ input: croppedMaskRgba, blend: 'dest-in' }])
    .png()
    .toBuffer();
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 96, g: 96, b: 96 },
    },
  })
    .composite([{ input: reliefPatch, left: destination.left, top: destination.top }])
    .greyscale()
    .png({ compressionLevel: 9, palette: true, colours: 64 })
    .toFile(path.join(outputDir, FILES.relief));

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
      notice: '六边形区域依据官方公开信息；地形与部分标注为社区补充。球面纹理由本站从社区地图重新投影。',
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
      method: 'source-map-cells-baked-into-albedo',
      claim: '直接保留源图中的六边形区划并随地形一同球面化，不额外生成或补齐格网。',
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
