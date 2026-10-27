import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { openRepository } from '../backend/database.mjs';
import { createApp } from '../backend/server.mjs';

const temporary = () => path.join('.local-data', `platform-test-${randomUUID()}`);

test('cross-region identity, buyer search, trade quote, compliance, translation and inquiry APIs work locally', async () => {
  const directory = temporary();
  const repository = openRepository(directory);
  const server = createApp(repository).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, options) => {
    const response = await fetch(base + url, options);
    const body = await response.json();
    assert.equal(response.ok, true, body.error?.message);
    return body.data;
  };
  try {
    const identity = await request('/api/identity/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: '87910-02A10', kind: 'part_number', region: 'GB' }) });
    assert.equal(identity.status, 'candidate_supported');
    assert.equal(identity.candidates[0].side, 'right');
    assert.equal(identity.candidates[0].marketMatch, true);
    const partBeforeLink = (await request('/api/parts/DEMO-01')).revision;
    const linked = await request('/api/parts/DEMO-01/identity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: partBeforeLink, identifier: '87910-02A10', kind: 'part_number', candidateId: identity.candidates[0].candidateId, region: 'GB', reason: 'Selected exact candidate from the current resolver result.' }) });
    assert.equal(linked.identities[0].vehicle_id, '87910-02A10');

    const results = await request('/api/search?query=DEMO-01&region=GB');
    assert.equal(results.results.length, 1);
    assert.equal(results.results[0].stockId, 'DEMO-01');

    const quote = await request('/api/trade/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partId: 'DEMO-01', from: 'AE', to: 'GB' }) });
    assert.equal(quote.origin.code, 'AE');
    assert.equal(quote.destination.code, 'GB');
    assert.equal(quote.estimatedLandedCost.currency, 'GBP');
    assert.ok(quote.assumptions.length > 0);
    assert.equal(quote.inputProvenance.weightKg.source, 'seller_record');

    const compliance = await request('/api/compliance/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partId: 'DEMO-01', from: 'AE', to: 'GB' }) });
    assert.equal(compliance.origin.code, 'AE');
    assert.ok(compliance.rules.some(rule => rule.id === 'LANE'));

    const translation = await request('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Used side-view mirror. Identifier not confirmed.', from: 'en', to: 'ar' }) });
    assert.match(translation.translated, /مرآة/);
    assert.equal(translation.reviewRequired, true);

    const inquiry = await request('/api/inquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partId: 'DEMO-01', buyerLabel: 'UK garage', region: 'GB', message: 'Please confirm connector and packed dimensions.' }) });
    assert.equal(inquiry.status, 'new');
    assert.equal(repository.inquiries().length, 1);
    const reset = await request('/api/demo/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'RESET_DEMO_DATA' }) });
    assert.equal(reset.parts, 20);
    assert.equal(repository.inquiries().length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
