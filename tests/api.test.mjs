import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openRepository } from '../backend/database.mjs';
import { createApp } from '../backend/server.mjs';

test('local API normal/difficult journeys, validation, measurements and exports', async () => {
  const directory = path.join('.local-data', `api-test-${randomUUID()}`);
  const repository = openRepository(directory);
  const server = createApp(repository).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  try {
    const health = await request('/api/health');
    assert.equal(health.body.data.offline, true);
    const parts = await request('/api/parts');
    assert.equal(parts.body.data.length, 20);
    let part = (await request('/api/parts/DEMO-02')).body.data;
    assert.equal(part.conflicts.length, 1);
    const invalid = await request('/api/parts/DEMO-02', 'PATCH', { expectedRevision: part.revision, fields: { weight_kg: -1 }, reason: 'Bad measurement' });
    assert.equal(invalid.status, 422);
    const blank = await request('/api/parts/DEMO-02', 'PATCH', { expectedRevision: part.revision, fields: { defect_notes: '' }, reason: 'Blank should not become a confirmed fact' });
    assert.equal(blank.status, 422);
    const corrected = await request('/api/parts/DEMO-02', 'PATCH', { expectedRevision: part.revision, fields: { donor_year: 2018, defect_notes: 'Broken tab confirmed', testing_status: 'untested', weight_kg: 2 }, reason: 'Synthetic donor and inspection confirmation' });
    assert.equal(corrected.status, 200);
    part = corrected.body.data;
    assert.equal(part.conflicts.length, 0);
    assert.equal(part.compatibility.status, 'unverified');
    const approved = await request('/api/parts/DEMO-02/approve', 'POST', { expectedRevision: part.revision, contentHash: part.contentHash, acknowledged: true });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.approval.status, 'approved');
    const stale = await request('/api/parts/DEMO-02', 'PATCH', { expectedRevision: part.revision - 1, fields: { donor_year: 2017 }, reason: 'Stale request' });
    assert.equal(stale.status, 409);
    const edited = await request('/api/parts/DEMO-02/draft', 'POST', { expectedRevision: part.revision, edits: { title: 'Guaranteed fit', description: 'Works perfectly', category: part.draft.category } });
    assert.equal(edited.body.data.readiness, 'information_missing');
    assert.equal(edited.body.data.approval.status, 'invalidated');
    const measurement = await request('/api/measurements', 'POST', { part_id: part.id, case_id: 'DEMO-02', truth_set_version: 'evaluator-key-external-v1', extraction_mode: 'manual', workflow: 'manual', seconds: 120, populated: 10, correct: 9, expected_issues: 4, detected_issues: 3, false_positives: 1, expected_disclosures: 3, disclosed: 3, corrections: 1, notes: 'API test measurement only' });
    assert.equal(measurement.status, 200);
    const measurements = (await request('/api/measurements')).body.data;
    assert.equal(measurements.length, 1);
    assert.equal(measurements[0].case_id, 'DEMO-02');
    assert.equal(measurements[0].truth_set_version, 'evaluator-key-external-v1');
    assert.equal(measurements[0].extraction_mode, 'manual');
    const exportResponse = await fetch(`${base}/api/parts/DEMO-02/export`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-disposition'), /attachment/);
    const form = new FormData();
    form.append('approved', 'true'); form.append('dryRun', 'true');
    form.append('csv', new Blob(['stock_id,part_number,part_type\nNEW-001,001234,Side-view mirror\n'], { type: 'text/csv' }), 'inventory.csv');
    const preview = await fetch(`${base}/api/import`, { method: 'POST', body: form }).then(r => r.json());
    assert.equal(preview.data.rows[0].part_number, '001234');
    const denied = await fetch(`${base}/api/parts/DEMO-02/approve`, { method: 'POST', headers: { origin: 'https://unrelated.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    repository.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
