import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { inspectLocal, decodeDetections, intersectionOverUnion, exampleImage, visionImages } from '../backend/vision.mjs';
import { openRepository } from '../backend/database.mjs';
import { createApp } from '../backend/server.mjs';
import { hash } from '../backend/domain.mjs';

const temporary = () => path.join('.local-data', `vision-test-${randomUUID()}`);

test('class-aware NMS uses actual tensor output, not invented defect boxes', () => {
  assert.equal(intersectionOverUnion([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.equal(intersectionOverUnion([0, 0, 10, 10], [20, 20, 30, 30]), 0);
  const data = new Float32Array(42 * 2);
  for (let i = 0; i < 2; i++) { data[i] = 30; data[2 + i] = 30; data[4 + i] = 20; data[6 + i] = 20; data[8 + i] = i === 0 ? 0.8 : 0.7; }
  const detections = decodeDetections({ dims: [1, 42, 2], data }, { 0: 'dent', 1: 'scratch', 2: 'crack', 3: 'glass shatter', 4: 'lamp broken', 5: 'tire flat' }, 0.35);
  assert.equal(detections.length, 1); assert.equal(detections[0].label, 'dent');
});

test('actual linked photo yields local model masks and seller-reviewed condition, not automatic facts', async () => {
  const directory = temporary();
  const r = openRepository(directory);
  try {
    const { file } = exampleImage('kia_picanto_2');
    const artifacts = await inspectLocal(file, { dataDirectory: directory });
    assert.ok(artifacts.result.detections.some(d => d.label === 'dent'));
    assert.ok(artifacts.result.detections.some(d => d.label === 'lamp broken'));
    assert.equal(artifacts.result.mode, 'local_onnx');
    assert.equal(artifacts.result.requiresSellerReview, true);
    assert.equal((await sharp(artifacts.overlayPath).metadata()).width, 1080);
    assert.equal((await sharp(artifacts.heatmapPath).metadata()).height, 720);
    const original = await sharp(file).removeAlpha().raw().toBuffer();
    const overlay = await sharp(artifacts.overlayPath).removeAlpha().raw().toBuffer();
    assert.notEqual(hash(original), hash(overlay));
    let p = r.getPart('DEMO-01');
    p = r.addSource(p.id, p.revision, { kind: 'photo', name: 'Vision test input, not verified mirror stock', assetPath: file, mime: 'image/png', sha256: artifacts.result.sourceHash });
    const source = p.sources.find(s => s.name === 'Vision test input, not verified mirror stock');
    const priorCondition = p.fields.defect_notes.value;
    const pending = r.savePartVisual(p.id, p.revision, source.id, artifacts);
    assert.equal(pending.fields.defect_notes.value, priorCondition);
    assert.equal(pending.readiness, 'information_missing');
    assert.ok(pending.rules.some(rule => rule.id === 'VISUAL-REVIEW' && rule.result === 'unknown'));
    assert.match(pending.draft.description, /not confirmed defects/);
    assert.throws(() => r.approve(p.id, pending.revision, pending.contentHash, true));
    const run = pending.visualInspections[0];
    const decisions = run.result.detections.map(d => ({ id: d.id, status: d.label === 'dent' ? 'confirmed' : 'rejected' }));
    const reviewed = r.reviewVisual(p.id, pending.revision, run.id, decisions, 'Inspected test photograph: dents confirmed; lamp prediction rejected for this test.');
    assert.equal(reviewed.readiness, 'ready_for_seller_review');
    assert.match(reviewed.fields.defect_notes.value, /Seller confirms visible dent/);
    assert.equal(reviewed.pendingVision.length, 0);
    assert.ok(reviewed.visualInspections[0].review[decisions[0].id]);
    assert.throws(() => r.reviewVisual(p.id, reviewed.revision, run.id, [decisions[0]], 'Duplicate region review'));
    assert.throws(() => r.savePartVisual(p.id, p.revision, source.id, artifacts), e => e.status === 409);
  } finally { r.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('real low-resolution mirror crop safely produces aligned artifacts and no clean-condition claim', async () => {
  const directory = temporary();
  try {
    const { file, image } = exampleImage('mirror-01');
    assert.equal(image.kind, 'mirror_crop');
    const { result, overlayPath, heatmapPath } = await inspectLocal(file, { threshold: 0.9, dataDirectory: directory });
    assert.equal(result.detections.length, 0);
    assert.match(result.notice, /does NOT establish damage-free/);
    const dimensions = await sharp(file).metadata();
    const overlay = await sharp(overlayPath).metadata(), heatmap = await sharp(heatmapPath).metadata();
    assert.equal(overlay.width, dimensions.width); assert.equal(heatmap.height, dimensions.height);
    assert.equal(visionImages().mirror_crops, 24);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('local vision API serves real catalog and model artifacts without assigning benchmark donor facts', async () => {
  const directory = temporary(), r = openRepository(directory);
  const server = createApp(r).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const config = await fetch(`${base}/api/vision/config`).then(x => x.json());
    assert.equal(config.data.model.available, true);
    assert.equal(config.data.dataset.examples.length, 59);
    assert.equal(config.data.dataset.mirror_crops, 24);
    const summary = await fetch(`${base}/api/vision/summary`).then(x => x.json());
    assert.equal(summary.data.library.total, 59);
    assert.equal(summary.data.execution.available, true);
    assert.ok(summary.data.execution.imagesWithDetections > 0);
    assert.ok(summary.data.groups.length >= 5);
    const runResponse = await fetch(`${base}/api/vision/examples/kia_picanto_2/inspect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threshold: 0.35 }) });
    assert.equal(runResponse.status, 200);
    const run = (await runResponse.json()).data.inspection;
    assert.equal(run.part_id, null);
    const mask = await fetch(base + run.overlayUrl);
    assert.equal(mask.status, 200); assert.match(mask.headers.get('content-type'), /image\/png/);
    const maskBytes = await mask.arrayBuffer();
    assert.ok(maskBytes.byteLength > 1000);
    const response = await fetch(`${base}/api/vision/examples/mirror-01/record`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const part = (await response.json()).data;
    assert.equal(part.stock_id, 'REFERENCE-MIRROR-01');
    assert.equal(part.fields.donor_year.value, null);
    assert.equal(part.fields.defect_notes.value, null);
    assert.equal(part.fields.part_number.value, null);
    const excluded = await fetch(`${base}/api/vision/examples/kia_picanto_2/record`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(excluded.status, 422);
  } finally { await new Promise(resolve => server.close(resolve)); r.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
