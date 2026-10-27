import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { inspectLocal, exampleImage, visionImages, visionManifest } from '../backend/vision.mjs';

const manifest = visionManifest();
if (!manifest.available) throw new Error(manifest.reason);
const actualHash = createHash('sha256').update(fs.readFileSync('models/vision/damage.onnx')).digest('hex');
if (manifest.model_sha256 && actualHash !== manifest.model_sha256) throw new Error('Exported model SHA-256 does not match its manifest');
const results = [];
for (const example of visionImages().examples) {
  const { file } = exampleImage(example.id);
  const { result, overlayPath, heatmapPath } = await inspectLocal(file, { dataDirectory: '.local-data/vision-validation', threshold: 0.35 });
  const original = await sharp(file).metadata();
  const overlay = await sharp(overlayPath).metadata();
  const heatmap = await sharp(heatmapPath).metadata();
  if (overlay.width !== original.width || overlay.height !== original.height || heatmap.width !== original.width || heatmap.height !== original.height) throw new Error(`Artifact geometry mismatch: ${example.id}`);
  results.push({ exampleId: example.id, kind: example.kind, sourceHash: result.sourceHash, imageDimensions: result.imageDimensions, threshold: result.threshold, elapsedMs: result.elapsedMs, detections: result.detections, notice: result.notice, geometryValidated: true });
  console.log(`${example.id}: ${result.elapsedMs} ms; ${result.detections.length} predicted region(s); artifact dimensions correct`);
}
const report = {
  runAt: new Date().toISOString(), mode: 'local_onnx', modelId: manifest.id, modelSha256: actualHash,
  purpose: 'Execution/geometry smoke test on referenced photos, not a labelled accuracy benchmark',
  threshold: 0.35, totalExamples: results.length,
  mirrorExamples: results.filter(r => r.kind === 'mirror_crop').length,
  vehicleExamples: results.filter(r => r.kind === 'damage_benchmark').length,
  damageSamples: results.filter(r => r.kind === 'damage_sample').length,
  limitations: ['No independent expert damage labels; precision/recall/IoU cannot be claimed', 'Mirror part annotations do not label defects', 'No-detection is not evidence of damage-free condition', 'Referenced photos may overlap original model training sources; not a held-out generalization benchmark'],
  results,
};
fs.mkdirSync('evaluation', { recursive: true });
fs.writeFileSync(path.resolve('evaluation/vision-smoke-results.json'), JSON.stringify(report, null, 2));
console.log(`Saved ${results.length} actual local inference observations to evaluation/vision-smoke-results.json`);
