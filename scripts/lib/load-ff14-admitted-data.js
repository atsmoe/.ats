'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  applyFf14MediaAdmission,
} = require('./ff14-media-admission.js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DATA_PATH = path.join(PROJECT_ROOT, 'src', '_data', 'ff14.json');
const DEFAULT_MANIFEST_PATH = path.join(PROJECT_ROOT, 'scripts', 'data', 'ff14-media-manifest.json');
const DEFAULT_ASSET_ROOT = path.join(PROJECT_ROOT, 'src');
const DEFAULT_EVIDENCE_ROOT = path.join(PROJECT_ROOT, 'scripts', 'data', 'ff14-media-thumbnails');

function readJsonFile(filePath, label) {
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const wrapped = new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
    wrapped.code = 'FF14_MEDIA_INPUT_UNAVAILABLE';
    wrapped.cause = error;
    throw wrapped;
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    const wrapped = new Error(`Unable to parse ${label} at ${filePath}: ${error.message}`);
    wrapped.code = 'FF14_MEDIA_INPUT_INVALID';
    wrapped.cause = error;
    throw wrapped;
  }
}

async function loadFf14AdmittedData(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || PROJECT_ROOT);
  const dataPath = path.resolve(options.dataPath || DEFAULT_DATA_PATH);
  const manifestPath = path.resolve(options.manifestPath || DEFAULT_MANIFEST_PATH);
  const assetRoot = path.resolve(options.assetRoot || DEFAULT_ASSET_ROOT);
  const evidenceRoot = path.resolve(options.evidenceRoot || path.join(workspaceRoot, 'scripts', 'data', 'ff14-media-thumbnails'));
  const ff14Data = readJsonFile(dataPath, 'FFXIV data');
  const manifest = readJsonFile(manifestPath, 'FFXIV media manifest');
  const admissionOptions = { workspaceRoot, assetRoot, evidenceRoot };
  if (options.assetInspector !== undefined) admissionOptions.assetInspector = options.assetInspector;
  if (options.evidenceInspector !== undefined) admissionOptions.evidenceInspector = options.evidenceInspector;
  if (options.inspector !== undefined) admissionOptions.inspector = options.inspector;

  const admission = await applyFf14MediaAdmission(ff14Data, manifest, admissionOptions);
  if (admission.errors.length > 0) {
    const error = new Error(`FFXIV media admission failed: ${admission.errors.join(' | ')}`);
    error.code = 'FF14_MEDIA_ADMISSION_FAILED';
    error.details = [...admission.errors];
    throw error;
  }

  return {
    data: admission.data,
    summary: admission.summary,
    rejections: admission.rejections,
    generation: JSON.parse(JSON.stringify(manifest.generation)),
  };
}

module.exports = {
  DEFAULT_ASSET_ROOT,
  DEFAULT_DATA_PATH,
  DEFAULT_EVIDENCE_ROOT,
  DEFAULT_MANIFEST_PATH,
  loadFf14AdmittedData,
};
