const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(
  ROOT,
  'src',
  'assets',
  'images',
  'arknights',
  'terra-community-administrative-map.png',
);
const BACKGROUND = path.join(
  ROOT,
  'src',
  'assets',
  'images',
  'star-map',
  'scenes',
  'terra-observation-natural.webp',
);
const MANIFEST = path.join(ROOT, 'scripts', 'data', 'terra-territory-regions.json');
const OUTPUT = path.join(
  ROOT,
  'src',
  'assets',
  'images',
  'star-map',
  'scenes',
  'terra-territory-projection.svg',
);
const AUDIT_DIR = path.join(ROOT, 'tmp', 'terra-territory-production-audit');
const AUDIT_ENABLED = process.argv.includes('--audit');

const TARGET = Object.freeze({ width: 1672, height: 941 });
const PLANET_CLIP = Object.freeze({ cx: 353.29, cy: 966.86, radius: 784.56 });
const SOURCE_SCALE = 2048;

// The approved observation plate is authored art, not a geodetic projection.
// These points register recognizable terrain/coast features from the reviewed
// community map to the same features in the plate. The manifest keeps the
// official hex topology in source space; this spline only places it visually.
const CONTROL_POINTS = Object.freeze([
  { id: 'northwest-shelf', source: [364.9, 1828.0], target: [168, 330] },
  { id: 'north-central-shelf', source: [1431.2, 1828.0], target: [402, 354] },
  { id: 'northeast-shelf', source: [3601.2, 1900.6], target: [958, 442] },
  { id: 'eastern-coast', source: [3830.4, 2864.9], target: [1070, 652] },
  { id: 'southeast-coast', source: [2604.2, 3901.8], target: [824, 776] },
  { id: 'southern-peninsula', source: [1431.2, 4523.9], target: [594, 906] },
  { id: 'southwest-coast', source: [364.9, 3901.8], target: [322, 778] },
  { id: 'western-coast', source: [231.6, 2864.9], target: [212, 572] },
  { id: 'central-inland-sea', source: [1964.4, 3020.4], target: [614, 620] },
  { id: 'eastern-lake', source: [3137.3, 2502.0], target: [918, 526] },
  { id: 'southern-inland-sea', source: [2124.3, 3720.3], target: [652, 752] },
  { id: 'western-southland', source: [898.1, 3616.6], target: [468, 742] },
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.writeFileSync(file, content);
  return true;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) throw new Error('Missing manually reviewed territory manifest');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported territory manifest schema');
  if (manifest.source.sha256 !== sha256(SOURCE)) {
    throw new Error('Community map changed after territory review');
  }
  if (manifest.regions.some((region) => region.review?.status !== 'manual-verified')) {
    throw new Error('The production manifest contains an unverified region');
  }
  return manifest;
}

function radialBasis(distanceSquared) {
  return distanceSquared <= 1e-12 ? 0 : distanceSquared * Math.log(distanceSquared);
}

function solveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    if (Math.abs(divisor) < 1e-10) throw new Error('Singular territory calibration');
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const multiplier = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= multiplier * augmented[pivot][column];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function createThinPlateSpline(points, targetAxis) {
  const count = points.length;
  const size = count + 3;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const values = Array(size).fill(0);
  const normalized = points.map(({ source }) => (
    [source[0] / SOURCE_SCALE, source[1] / SOURCE_SCALE]
  ));
  for (let row = 0; row < count; row += 1) {
    const [x, y] = normalized[row];
    for (let column = 0; column < count; column += 1) {
      const dx = x - normalized[column][0];
      const dy = y - normalized[column][1];
      matrix[row][column] = radialBasis(dx * dx + dy * dy);
    }
    matrix[row][count] = 1;
    matrix[row][count + 1] = x;
    matrix[row][count + 2] = y;
    matrix[count][row] = 1;
    matrix[count + 1][row] = x;
    matrix[count + 2][row] = y;
    values[row] = points[row].target[targetAxis];
  }
  const coefficients = solveLinearSystem(matrix, values);
  return (sourceX, sourceY) => {
    const x = sourceX / SOURCE_SCALE;
    const y = sourceY / SOURCE_SCALE;
    let result = coefficients[count] + coefficients[count + 1] * x + coefficients[count + 2] * y;
    for (let index = 0; index < count; index += 1) {
      const dx = x - normalized[index][0];
      const dy = y - normalized[index][1];
      result += coefficients[index] * radialBasis(dx * dx + dy * dy);
    }
    return result;
  };
}

function pointKey([x, y]) {
  return `${x.toFixed(3)},${y.toFixed(3)}`;
}

function edgeKey(a, b) {
  const left = pointKey(a);
  const right = pointKey(b);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function cellGeometry(cellId, grid) {
  const compactMatch = /^r(-?\d+)c(-?\d+)$/.exec(cellId);
  const [row, column] = compactMatch
    ? compactMatch.slice(1).map(Number)
    : cellId.split(':').map(Number);
  if (!Number.isInteger(row) || !Number.isInteger(column)) {
    throw new Error(`Invalid territory cell id: ${cellId}`);
  }
  const parity = ((row % 2) + 2) % 2;
  const center = [
    (parity ? grid.oddRowOriginX : grid.evenRowOriginX) + column * grid.horizontalPeriod,
    grid.originY + row * grid.rowStep,
  ];
  const vertices = [
    [center[0], center[1] - grid.radius],
    [center[0] + grid.horizontalPeriod / 2, center[1] - grid.radius / 2],
    [center[0] + grid.horizontalPeriod / 2, center[1] + grid.radius / 2],
    [center[0], center[1] + grid.radius],
    [center[0] - grid.horizontalPeriod / 2, center[1] + grid.radius / 2],
    [center[0] - grid.horizontalPeriod / 2, center[1] - grid.radius / 2],
  ];
  return { id: cellId, center, vertices };
}

function regionGeometry(region, grid) {
  const cells = region.selectedCellIds.map((cellId) => cellGeometry(cellId, grid));
  const uniqueEdges = new Map();
  for (const cell of cells) {
    cell.vertices.forEach((a, index) => {
      const b = cell.vertices[(index + 1) % cell.vertices.length];
      const key = edgeKey(a, b);
      if (uniqueEdges.has(key)) uniqueEdges.delete(key);
      else uniqueEdges.set(key, { key, a, b });
    });
  }
  return { cells, boundaryEdges: [...uniqueEdges.values()] };
}

function svgPathForPolygon(points) {
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;
}

function projectedCellPath(cell, project) {
  const points = [];
  cell.vertices.forEach((start, edgeIndex) => {
    const end = cell.vertices[(edgeIndex + 1) % cell.vertices.length];
    for (let sample = 0; sample < 4; sample += 1) {
      const progress = sample / 4;
      points.push(project([
        start[0] + (end[0] - start[0]) * progress,
        start[1] + (end[1] - start[1]) * progress,
      ]));
    }
  });
  return svgPathForPolygon(points);
}

function subdividedProjectedEdge(edge, project) {
  const points = [];
  for (let index = 0; index <= 4; index += 1) {
    const progress = index / 4;
    points.push(project([
      edge.a[0] + (edge.b[0] - edge.a[0]) * progress,
      edge.a[1] + (edge.b[1] - edge.a[1]) * progress,
    ]));
  }
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}`;
}

function buildProductionSvg(manifest, geometries, project) {
  const regionGroups = manifest.regions.map((region) => {
    const geometry = geometries.get(region.id);
    const cellPaths = geometry.cells.map((cell) => (
      projectedCellPath(cell, project)
    )).join('');
    const boundaryPaths = geometry.boundaryEdges.map((edge) => (
      subdividedProjectedEdge(edge, project)
    )).join('');
    return `
      <g data-region="${region.id}">
        <path class="territory-cells" fill="${region.color}" stroke="${region.color}" d="${cellPaths}"/>
        <path class="territory-boundary" stroke="${region.color}" d="${boundaryPaths}"/>
      </g>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${TARGET.width}" height="${TARGET.height}"
  viewBox="0 0 ${TARGET.width} ${TARGET.height}" data-projection="visual-reprojection">
  <metadata>Official hex topology manually reviewed against the pinned community map; visually reprojected onto authored observation art.</metadata>
  <defs>
    <clipPath id="terra-planet"><circle cx="${PLANET_CLIP.cx}" cy="${PLANET_CLIP.cy}" r="${PLANET_CLIP.radius}"/></clipPath>
  </defs>
  <style>
    .territory-cells{fill-opacity:.055;stroke-opacity:.2;stroke-width:.72;stroke-linejoin:miter;vector-effect:non-scaling-stroke}
    .territory-boundary{fill:none;stroke-opacity:.96;stroke-width:1.75;stroke-linecap:square;stroke-linejoin:miter;vector-effect:non-scaling-stroke}
  </style>
  <g clip-path="url(#terra-planet)">${regionGroups}
  </g>
</svg>
`;
}

function buildSourceAuditSvg(manifest, geometries, sourceWidth, sourceHeight) {
  const groups = manifest.regions.map((region) => {
    const geometry = geometries.get(region.id);
    const cells = geometry.cells.map((cell) => svgPathForPolygon(cell.vertices)).join('');
    const edges = geometry.boundaryEdges.map(({ a, b }) => (
      `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`
    )).join('');
    return `<g><path class="cells" fill="${region.color}" d="${cells}"/><path class="edges" stroke="${region.color}" d="${edges}"/></g>`;
  }).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}">
    <style>.cells{fill-opacity:.12;stroke:none}.edges{fill:none;stroke-width:5;stroke-linecap:square;stroke-linejoin:miter}</style>
    ${groups}
  </svg>`);
}

function buildCalibrationSvg(points, width, height, coordinateKey) {
  const markers = points.map((point, index) => {
    const [x, y] = point[coordinateKey];
    const anchor = x > width * .72 ? 'end' : 'start';
    const labelX = x + (anchor === 'end' ? -18 : 18);
    return `<g data-control-point="${point.id}">
      <circle cx="${x}" cy="${y}" r="10"/>
      <path d="M${x - 18} ${y}H${x + 18}M${x} ${y - 18}V${y + 18}"/>
      <text x="${labelX}" y="${y - 15}" text-anchor="${anchor}">${String(index + 1).padStart(2, '0')} ${point.id}</text>
    </g>`;
  }).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
      circle,path{fill:none;stroke:#ffb02e;stroke-width:3;vector-effect:non-scaling-stroke}
      text{fill:#fff4d6;stroke:#05080b;stroke-width:5;paint-order:stroke;stroke-linejoin:round;font:700 20px ui-monospace,monospace;letter-spacing:.04em}
    </style>
    ${markers}
  </svg>`);
}

async function build() {
  const manifest = loadManifest();
  const [sourceMetadata, backgroundMetadata] = await Promise.all([
    sharp(SOURCE).metadata(),
    sharp(BACKGROUND).metadata(),
  ]);
  if (sourceMetadata.width !== manifest.source.size[0]
    || sourceMetadata.height !== manifest.source.size[1]) {
    throw new Error('Community map dimensions changed after review');
  }
  if (backgroundMetadata.width !== TARGET.width || backgroundMetadata.height !== TARGET.height) {
    throw new Error('Unexpected Terra observation plate dimensions');
  }

  const ownerByCell = new Map();
  const geometries = new Map();
  for (const region of manifest.regions) {
    for (const cellId of region.selectedCellIds) {
      if (ownerByCell.has(cellId)) {
        throw new Error(`${cellId} is assigned to ${ownerByCell.get(cellId)} and ${region.id}`);
      }
      ownerByCell.set(cellId, region.id);
    }
    const geometry = regionGeometry(region, manifest.grid);
    const reviewedEdgeCount = region.review.visibleBoundaryEdges
      + region.review.inferredOccludedEdges;
    if (reviewedEdgeCount !== geometry.boundaryEdges.length) {
      throw new Error(
        `${region.id} review counts ${reviewedEdgeCount} edges but its cells produce `
        + `${geometry.boundaryEdges.length}`,
      );
    }
    geometries.set(region.id, geometry);
  }

  const mapX = createThinPlateSpline(CONTROL_POINTS, 0);
  const mapY = createThinPlateSpline(CONTROL_POINTS, 1);
  const project = ([x, y]) => [mapX(x, y), mapY(x, y)];
  const svg = buildProductionSvg(manifest, geometries, project);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeIfChanged(OUTPUT, svg);

  const report = {
    source: path.relative(ROOT, SOURCE),
    sourceSha256: manifest.source.sha256,
    output: path.relative(ROOT, OUTPUT),
    projection: 'visual-reprojection',
    regionCount: manifest.regions.length,
    cellCount: ownerByCell.size,
    boundaryEdgeCount: [...geometries.values()]
      .reduce((total, geometry) => total + geometry.boundaryEdges.length, 0),
    controlPoints: CONTROL_POINTS,
    limitation: 'The observation plate has no geographic coordinate system; placement is visually registered and cannot be treated as survey-grade geography.',
  };
  if (AUDIT_ENABLED) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const sourceAudit = buildSourceAuditSvg(
      manifest,
      geometries,
      sourceMetadata.width,
      sourceMetadata.height,
    );
    const sourceAuditWidth = 1600;
    const sourceAuditHeight = Math.round(
      sourceAuditWidth * sourceMetadata.height / sourceMetadata.width,
    );
    const sourceAuditBase = await sharp(SOURCE)
      .resize(sourceAuditWidth, sourceAuditHeight, { fit: 'fill' })
      .png()
      .toBuffer();
    const sourceAuditRaster = await sharp(sourceAudit)
      .resize(sourceAuditWidth, sourceAuditHeight, { fit: 'fill' })
      .png()
      .toBuffer();
    await sharp(sourceAuditBase)
      .composite([{ input: sourceAuditRaster }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(AUDIT_DIR, 'source-registration.png'));
    const sourceCalibrationRaster = await sharp(buildCalibrationSvg(
      CONTROL_POINTS,
      sourceMetadata.width,
      sourceMetadata.height,
      'source',
    ))
      .resize(sourceAuditWidth, sourceAuditHeight, { fit: 'fill' })
      .png()
      .toBuffer();
    await sharp(sourceAuditBase)
      .composite([{ input: sourceCalibrationRaster }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(AUDIT_DIR, 'source-calibration.png'));
    const observationOverlayRaster = await sharp(Buffer.from(svg))
      .resize(TARGET.width, TARGET.height, { fit: 'fill' })
      .png()
      .toBuffer();
    await sharp(BACKGROUND)
      .composite([{ input: observationOverlayRaster }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(AUDIT_DIR, 'observation-registration.png'));
    const targetCalibrationRaster = await sharp(buildCalibrationSvg(
      CONTROL_POINTS,
      TARGET.width,
      TARGET.height,
      'target',
    ))
      .png()
      .toBuffer();
    await sharp(BACKGROUND)
      .composite([{ input: targetCalibrationRaster }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(AUDIT_DIR, 'observation-calibration.png'));
    writeIfChanged(path.join(AUDIT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

build().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
