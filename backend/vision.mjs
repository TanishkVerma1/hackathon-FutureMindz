import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { AppError } from './database.mjs';

let sessionPromise;
let busy = false;
const directory = path.resolve('models/vision');
export function visionManifest() {
  if (!fs.existsSync(path.join(directory, 'damage.onnx')) || !fs.existsSync(path.join(directory, 'manifest.json'))) return { available: false, reason: 'Local ONNX vision model has not been prepared.' };
  return { available: true, ...JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) };
}
export function visionImages() {
  return fs.existsSync('datasets/vision/images.json') ? JSON.parse(fs.readFileSync('datasets/vision/images.json', 'utf8')) : { examples: [], mirror_crops: 0, vehicle_benchmarks: 0 };
}
export function visionSummary() {
  const dataset = visionImages();
  const reportFile = 'evaluation/vision-smoke-results.json';
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  const groups = {};
  for (const example of dataset.examples) {
    const key = example.group || (example.kind === 'mirror_crop' ? 'carparts_seg' : example.kind === 'damage_benchmark' ? 'cloudwhynot' : 'other');
    if (!groups[key]) groups[key] = { group: key, label: example.group_label || (example.kind === 'mirror_crop' ? 'Carparts-Seg mirror crops' : example.kind === 'damage_benchmark' ? 'cloudwhynot benchmarks' : 'Damage samples'), kind: example.kind, label_repo: example.source, count: 0, withDetections: 0, detections: 0 };
    groups[key].count++;
    if (report) {
      const row = report.results.find(r => r.exampleId === example.id);
      if (row) {
        if (row.detections.length > 0) groups[key].withDetections++;
        groups[key].detections += row.detections.length;
      }
    }
  }
  return {
    library: { total: dataset.examples.length, mirror_crops: dataset.mirror_crops || 0, damage_benchmarks: dataset.damage_benchmarks || 0, damage_samples: dataset.damage_samples || 0, sample_groups: dataset.sample_groups || [] },
    execution: report ? { available: true, runAt: report.runAt, threshold: report.threshold, modelId: report.modelId, meanMs: Math.round(report.results.reduce((a, r) => a + r.elapsedMs, 0) / report.results.length), imagesWithDetections: report.results.filter(r => r.detections.length > 0).length, totalDetections: report.results.reduce((a, r) => a + r.detections.length, 0), classCounts: Object.entries(report.results.flatMap(r => r.detections.map(d => d.label)).reduce((a, label) => { a[label] = (a[label] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]), results: report.results.map(r => ({ exampleId: r.exampleId, kind: r.kind, detections: r.detections.length, labels: r.detections.map(d => d.label), elapsedMs: r.elapsedMs, notice: r.detections.length ? undefined : r.notice })) } : { available: false, reason: 'No local execution report yet. Run node scripts/validate-vision.mjs to generate one.' },
    groups: Object.values(groups).sort((a, b) => b.count - a.count),
  };
}
export function exampleImage(id, annotation = false) {
  const image = visionImages().examples.find(x => x.id === id);
  if (!image) throw new AppError('Vision example not found', 404, 'NOT_FOUND');
  const file = annotation ? image.annotation_file : image.file;
  if (!file) throw new AppError('No dataset annotation for this example', 404, 'NOT_FOUND');
  return { image, file: path.resolve('datasets/vision', file) };
}
export const intersectionOverUnion = (a, b) => {
  const overlap = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - overlap;
  return area > 0 ? overlap / area : 0;
};
export function decodeDetections(tensor, classes, threshold = 0.35) {
  const [batch, channels, count] = tensor.dims;
  const classCount = Object.keys(classes).length;
  if (batch !== 1 || channels !== 4 + classCount + 32) throw new AppError('Unexpected local model output shape', 500, 'MODEL_CONTRACT');
  const values = tensor.data;
  const candidates = [];
  for (let i = 0; i < count; i++) {
    let score = 0, classId = 0;
    for (let c = 0; c < classCount; c++) { const value = values[(4 + c) * count + i]; if (value > score) { score = value; classId = c; } }
    if (!Number.isFinite(score) || score < threshold) continue;
    const x = values[i], y = values[count + i], w = values[2 * count + i], h = values[3 * count + i];
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    candidates.push({ classId, label: classes[classId], score, box: [x - w / 2, y - h / 2, x + w / 2, y + h / 2], coefficients: Array.from({ length: 32 }, (_, c) => values[(4 + classCount + c) * count + i]) });
  }
  const selected = [];
  for (const detection of candidates.sort((a, b) => b.score - a.score).slice(0, 200)) {
    if (selected.some(other => other.classId === detection.classId && intersectionOverUnion(other.box, detection.box) > 0.5)) continue;
    selected.push(detection);
    if (selected.length >= 12) break;
  }
  return selected;
}
export async function inspectLocal(imagePath, { threshold = 0.35, dataDirectory = process.env.DATA_DIR || '.local-data' } = {}) {
  if (busy) throw new AppError('A local visual inspection is already running.', 409, 'VISION_BUSY');
  const manifest = visionManifest();
  if (!manifest.available) throw new AppError(manifest.reason, 503, 'VISION_MODEL_MISSING');
  busy = true;
  let expired = false;
  let timer;
  const started = performance.now();
  const task = (async () => {
    const metadata = await sharp(imagePath, { limitInputPixels: 20000000 }).metadata();
    const originalWidth = metadata.width, originalHeight = metadata.height;
    if (!originalWidth || !originalHeight || originalWidth * originalHeight > 20000000) throw new AppError('Image dimensions exceed the visual-inspection limit');
    const size = manifest.input_size;
    const preprocessing = { originalDimensions: [originalWidth, originalHeight], upscaled: false, sharpened: false, autoContrast: false };
    let pipe = sharp(imagePath).removeAlpha().toColourspace('srgb');
    if (Math.min(originalWidth, originalHeight) < 224) {
      pipe = pipe.resize(Math.max(320, originalWidth), Math.max(320, originalHeight), { fit: 'inside', kernel: 'lanczos3' }).sharpen({ sigma: 1.2 });
      preprocessing.upscaled = true; preprocessing.sharpened = true;
    }
    pipe = pipe.normalise(); preprocessing.autoContrast = true;
    const { data: raw, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
    const pipeWidth = info.width, pipeHeight = info.height;
    const scale = Math.min(size / pipeWidth, size / pipeHeight);
    const resizedWidth = Math.round(pipeWidth * scale), resizedHeight = Math.round(pipeHeight * scale);
    const left = Math.floor((size - resizedWidth) / 2), top = Math.floor((size - resizedHeight) / 2);
    const padded = await sharp(raw, { raw: { width: pipeWidth, height: pipeHeight, channels: 3 } }).resize(resizedWidth, resizedHeight, { fit: 'fill' }).extend({ left, right: size - resizedWidth - left, top, bottom: size - resizedHeight - top, background: { r: 114, g: 114, b: 114 } }).raw().toBuffer();
    const chw = new Float32Array(3 * size * size);
    for (let i = 0; i < size * size; i++) { chw[i] = padded[i * 3] / 255; chw[size * size + i] = padded[i * 3 + 1] / 255; chw[2 * size * size + i] = padded[i * 3 + 2] / 255; }
    if (!sessionPromise) sessionPromise = ort.InferenceSession.create(path.join(directory, 'damage.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: 4, interOpNumThreads: 1, graphOptimizationLevel: 'all' }).catch(error => { sessionPromise = null; throw error; });
    const session = await sessionPromise;
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', chw, [1, 3, size, size]) });
    if (expired) throw new AppError('Inspection timed out; no findings were committed.', 504, 'VISION_TIMEOUT');
    const detectionTensor = output[session.outputNames[0]];
    const proto = output[session.outputNames[1]];
    if (proto.dims.join(',') !== '1,32,160,160') throw new AppError('Unexpected mask prototype shape', 500, 'MODEL_CONTRACT');
    const detections = decodeDetections(detectionTensor, manifest.classes, threshold).filter(d => d.box[2] > left && d.box[0] < left + resizedWidth && d.box[3] > top && d.box[1] < top + resizedHeight);
    const weakFloor = Math.min(0.1, threshold);
    const weakCandidates = threshold > weakFloor ? decodeDetections(detectionTensor, manifest.classes, weakFloor).filter(d => d.score < threshold && d.box[2] > left && d.box[0] < left + resizedWidth && d.box[3] > top && d.box[1] < top + resizedHeight).slice(0, 6) : [];
    const maskSize = 160, cells = maskSize * maskSize;
    const heat = new Float32Array(cells);
    const overlayPixels = Buffer.alloc(cells * 4);
    const heatPixels = Buffer.alloc(cells * 4);
    const colors = [[239, 100, 54], [36, 160, 220], [210, 66, 130], [164, 104, 234], [245, 174, 50], [75, 185, 129]];
    for (const d of detections) {
      const color = colors[d.classId];
      for (let y = Math.max(0, Math.floor(d.box[1] / 4)); y < Math.min(maskSize, Math.ceil(d.box[3] / 4)); y++) for (let x = Math.max(0, Math.floor(d.box[0] / 4)); x < Math.min(maskSize, Math.ceil(d.box[2] / 4)); x++) {
        const i = y * maskSize + x;
        let logit = 0;
        for (let c = 0; c < 32; c++) logit += d.coefficients[c] * proto.data[c * cells + i];
        const activation = 1 / (1 + Math.exp(-logit));
        if (activation < 0.5) continue;
        const strength = activation * d.score;
        if (strength <= heat[i]) continue;
        heat[i] = strength;
        overlayPixels[i * 4] = color[0]; overlayPixels[i * 4 + 1] = color[1]; overlayPixels[i * 4 + 2] = color[2]; overlayPixels[i * 4 + 3] = 125;
      }
    }
    for (let i = 0; i < cells; i++) if (heat[i] > 0) {
      const strength = heat[i];
      heatPixels[i * 4] = Math.round(255 * Math.min(1, strength * 2));
      heatPixels[i * 4 + 1] = Math.round(255 * Math.max(0, 1 - Math.abs(strength - 0.5) * 2));
      heatPixels[i * 4 + 2] = Math.round(255 * Math.max(0, 1 - strength * 2));
      heatPixels[i * 4 + 3] = 150;
    }
    const resizeMask = async (buffer, targetWidth, targetHeight) => {
      const letterboxed = await sharp(buffer, { raw: { width: maskSize, height: maskSize, channels: 4 } }).resize(size, size, { kernel: 'nearest' }).png().toBuffer();
      return sharp(letterboxed).extract({ left, top, width: resizedWidth, height: resizedHeight }).resize(targetWidth, targetHeight, { kernel: 'nearest' }).png().toBuffer();
    };
    const overlay = await resizeMask(overlayPixels, originalWidth, originalHeight), heatmap = await resizeMask(heatPixels, originalWidth, originalHeight);
    const origScale = pipeWidth / originalWidth;
    const toOriginalBox = box => [Math.max(0, Math.round((box[0] - left) / scale / origScale)), Math.max(0, Math.round((box[1] - top) / scale / origScale)), Math.min(originalWidth, Math.round((box[2] - left) / scale / origScale)), Math.min(originalHeight, Math.round((box[3] - top) / scale / origScale))];
    const findings = detections.map((d, index) => ({ id: `d${index}`, label: d.label, classId: d.classId, score: Number(d.score.toFixed(4)), box: toOriginalBox(d.box), state: 'model_suggestion', color: colors[d.classId] }));
    const boxSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${originalWidth}" height="${originalHeight}">${findings.map(d => { const [x0, y0, x1, y1] = d.box; const c = `rgb(${d.color.join(',')})`; const font = Math.max(13, Math.round(originalWidth / 70)); const yy = Math.max(font + 6, y0); return `<rect x="${x0}" y="${y0}" width="${Math.max(1, x1 - x0)}" height="${Math.max(1, y1 - y0)}" fill="none" stroke="${c}" stroke-width="${Math.max(2, originalWidth / 500)}"/><rect x="${x0}" y="${yy - font - 6}" width="${font * (d.label.length + 6) * 0.62}" height="${font + 7}" fill="${c}"/><text x="${x0 + 4}" y="${yy - 4}" font-family="sans-serif" font-size="${font}" fill="white">${d.label} ${Math.round(d.score * 100)}%</text>`; }).join('')}</svg>`;
    const id = randomUUID();
    const resultDirectory = path.resolve(dataDirectory, 'vision-results', id);
    fs.mkdirSync(resultDirectory, { recursive: true });
    const overlayPath = path.join(resultDirectory, 'overlay.png'), heatmapPath = path.join(resultDirectory, 'heatmap.png');
    await sharp(imagePath).removeAlpha().composite([{ input: overlay }, { input: Buffer.from(boxSvg) }]).png().toFile(overlayPath);
    await sharp(imagePath).removeAlpha().composite([{ input: heatmap }]).png().toFile(heatmapPath);
    const sourceHash = createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex');
    const result = { id, mode: 'local_onnx', engine: 'ONNX Runtime CPU', modelId: manifest.id, checkpointSha256: manifest.checkpoint_sha256, inputSize: size, imageDimensions: [originalWidth, originalHeight], sourceHash, threshold, preprocessing, detections: findings, weakDetections: weakCandidates.map(d => ({ label: d.label, classId: d.classId, score: Number(d.score.toFixed(4)), box: toOriginalBox(d.box), note: 'Below the selected threshold; shown to explain model behaviour, never treated as findings.' })), bestScore: findings.length ? findings[0].score : (weakCandidates[0]?.score ?? 0), elapsedMs: Math.round(performance.now() - started), visualization: manifest.visualization, modelRole: manifest.model_role, requiresSellerReview: findings.length > 0, notice: findings.length ? 'Predicted damage regions require seller confirmation; model scores are not calibrated certainty or severity.' : 'No predicted damage above this threshold. This does NOT establish damage-free condition or functionality.' + (weakCandidates.length ? ` The strongest sub-threshold suggestion was ${Math.round(weakCandidates[0].score * 100)}% (${weakCandidates[0].label}); lower the threshold to surface it.` : ''), limitations: manifest.limitations };
    fs.writeFileSync(path.join(resultDirectory, 'result.json'), JSON.stringify(result, null, 2));
    return { result, overlayPath, heatmapPath };
  })().finally(() => { busy = false; });
  try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new AppError('Visual inspection timed out; accepted stock facts are unchanged.', 504, 'VISION_TIMEOUT')); }, 60000); })]); } finally { clearTimeout(timer); }
}
export function artifactPath(id, type, dataDirectory = process.env.DATA_DIR || '.local-data') {
  if (!/^[0-9a-f-]{36}$/.test(id) || !['overlay', 'heatmap'].includes(type)) throw new AppError('Invalid visual artifact', 404, 'NOT_FOUND');
  const file = path.resolve(dataDirectory, 'vision-results', id, `${type}.png`);
  if (!fs.existsSync(file)) throw new AppError('Visual artifact not found', 404, 'NOT_FOUND');
  return file;
}
