import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { derive, hash, FIELD_KEYS } from './domain.mjs';
import { VEHICLE_CATALOG, resolveIdentity, calculateTradeQuote, complianceAssessment, translateText, platformHash, scoreSearch, regionProfile } from './platform.mjs';

const now = () => new Date().toISOString();
export class AppError extends Error {
  constructor(message, status = 422, code = 'VALIDATION_ERROR') { super(message); this.status = status; this.code = code; }
}
export function openRepository(directory = process.env.DATA_DIR || '.local-data', seed = true) {
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(directory, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'yardpass.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(fs.readFileSync('backend/schema.sql', 'utf8'));
  const ensureColumn = (table, column, definition) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn('sources', 'approval_status', "TEXT NOT NULL DEFAULT 'not_recorded'");
  ensureColumn('sources', 'approval_actor', 'TEXT');
  ensureColumn('sources', 'approved_at', 'TEXT');
  ensureColumn('assertions', 'confidence', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('assertions', 'extraction_method', "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn('assertions', 'model_version', 'TEXT');
  ensureColumn('assertions', 'source_span', 'TEXT');
  ensureColumn('resolutions', 'chosen_assertion_id', 'TEXT');
  ensureColumn('resolutions', 'competing_assertion_ids_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('compatibility_reference', 'markets_json', "TEXT NOT NULL DEFAULT '[\"AE\",\"GB\"]'");
  ensureColumn('compatibility_reference', 'drive_sides_json', "TEXT NOT NULL DEFAULT '[\"left\",\"right\"]'");
  ensureColumn('evaluation_measurements', 'case_id', 'TEXT');
  ensureColumn('evaluation_measurements', 'truth_set_version', 'TEXT');
  ensureColumn('evaluation_measurements', 'extraction_mode', "TEXT NOT NULL DEFAULT 'manual'");
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,?)').run(now());
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,?)').run(now());
  const referenceFile = JSON.parse(fs.readFileSync('datasets/compatibility.json', 'utf8'));
  const checklistFile = JSON.parse(fs.readFileSync('datasets/checklist.json', 'utf8'));
  for (const r of referenceFile) db.prepare('INSERT OR IGNORE INTO compatibility_reference(id,part_number,manufacturer,side,connector,vehicle,authority,version,source,markets_json,drive_sides_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(r.id, r.part_number, r.manufacturer, r.side, r.connector, r.vehicle, r.authority, r.version, r.source, JSON.stringify(r.markets || ['AE', 'GB']), JSON.stringify(r.drive_sides || ['left', 'right']));
  const repairReferenceJson = db.prepare('UPDATE compatibility_reference SET markets_json=?, drive_sides_json=? WHERE id=?');
  for (const row of db.prepare('SELECT id,markets_json,drive_sides_json FROM compatibility_reference').all()) {
    let markets = ['AE', 'GB'], driveSides = ['left', 'right'];
    try { markets = JSON.parse(row.markets_json); } catch {}
    try { driveSides = JSON.parse(row.drive_sides_json); } catch {}
    repairReferenceJson.run(JSON.stringify(markets), JSON.stringify(driveSides), row.id);
  }
  const existingChecklist = db.prepare('SELECT version,config_json FROM checklist_versions WHERE id=?').get(checklistFile.id);
  if (!existingChecklist) db.prepare('INSERT INTO checklist_versions(id,version,config_json) VALUES(?,?,?)').run(checklistFile.id, checklistFile.version, JSON.stringify(checklistFile));
  else {
    let existingConfig = {};
    try { existingConfig = JSON.parse(existingChecklist.config_json); } catch {}
    if (!Array.isArray(existingConfig.rules)) db.prepare('UPDATE checklist_versions SET version=?, config_json=? WHERE id=?').run(checklistFile.version, JSON.stringify(checklistFile), checklistFile.id);
  }
  const vehicleInsert = db.prepare('INSERT OR IGNORE INTO vehicle_identities(id,identifier,identifier_kind,normalized,region,vehicle_json,confidence,status,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const vehicle of VEHICLE_CATALOG) vehicleInsert.run(vehicle.id, vehicle.chassisPrefixes[0], 'catalog', vehicle.chassisPrefixes[0], 'AE', JSON.stringify(vehicle), 1, 'catalog', 'Local cross-region vehicle catalog / synthetic reference', now());
  const reference = () => db.prepare('SELECT * FROM compatibility_reference').all();
  const checklist = () => JSON.parse(db.prepare('SELECT config_json FROM checklist_versions ORDER BY rowid DESC LIMIT 1').get().config_json);
  const audit = (partId, revision, event, details) => db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run(randomUUID(), partId, revision, event, JSON.stringify(details), now());
  const rawPart = id => { const p = db.prepare('SELECT * FROM parts WHERE id=?').get(id); if (!p) throw new AppError('Part not found', 404, 'NOT_FOUND'); return p; };
  const assertionsFor = id => db.prepare('SELECT * FROM assertions WHERE part_id=? ORDER BY rowid').all(id).map(a => ({ ...a, value: JSON.parse(a.value_json) }));
  const questionOutcomesFor = id => db.prepare('SELECT * FROM question_outcomes WHERE part_id=? ORDER BY rowid DESC').all(id);
  const sourcesFor = id => db.prepare('SELECT * FROM sources WHERE part_id=? ORDER BY rowid').all(id);
  const visualView = row => {
    const { original_path, overlay_path, heatmap_path, result_json, review_json, ...publicRow } = row;
    return { ...publicRow, result: JSON.parse(result_json), review: JSON.parse(review_json), originalUrl: `/api/vision/results/${row.id}/original`, overlayUrl: `/api/vision/results/${row.id}/overlay`, heatmapUrl: `/api/vision/results/${row.id}/heatmap` };
  };
  const inspectionsFor = id => db.prepare('SELECT * FROM visual_inspections WHERE part_id=? ORDER BY rowid DESC').all(id).map(visualView);
  const rawVisual = id => { const row = db.prepare('SELECT * FROM visual_inspections WHERE id=?').get(id); if (!row) throw new AppError('Visual inspection not found', 404, 'NOT_FOUND'); return row; };
  const insertVisual = (artifacts, originalPath, partId = null, sourceId = null, exampleId = null, revision = null) => {
    const result = artifacts.result;
    db.prepare('INSERT INTO visual_inspections VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(result.id, partId, sourceId, exampleId, revision, result.sourceHash, JSON.stringify(result), '{}', originalPath, artifacts.overlayPath, artifacts.heatmapPath, now());
    return visualView(rawVisual(result.id));
  };
  const insertSource = (id, { kind, name, text = '', language = 'en', assetPath = null, mime = null, synthetic = false, approved = synthetic, approvalActor = synthetic ? 'seed_fixture' : 'seller_operator', sha256 = hash(text || name) }) => {
    const sourceId = randomUUID();
    const approvalStatus = approved ? (synthetic ? 'synthetic_approved' : 'approved_anonymised') : 'not_recorded';
    db.prepare('INSERT INTO sources(id,part_id,kind,name,language,text,asset_path,mime,sha256,synthetic,approval_status,approval_actor,approved_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sourceId, id, kind, name, language, text, assetPath, mime, sha256, synthetic ? 1 : 0, approvalStatus, approved ? approvalActor : null, approved ? now() : null, now());
    return sourceId;
  };
  const insertAssertion = (id, sourceId, field, value, state = 'observed', locator = 'Source text', metadata = {}) => {
    if (!FIELD_KEYS.has(field)) throw new AppError(`Unsupported field ${field}`);
    const assertionId = randomUUID();
    const confidence = Number.isFinite(metadata.confidence) ? Math.max(0, Math.min(1, metadata.confidence)) : state === 'seller_confirmed' ? 1 : state === 'observed' ? 0.75 : 0;
    db.prepare('INSERT INTO assertions(id,part_id,source_id,field_key,value_json,state,locator,active,confidence,extraction_method,model_version,source_span,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(assertionId, id, sourceId, field, JSON.stringify(value), state, locator, 1, confidence, metadata.extractionMethod || (state === 'seller_confirmed' ? 'seller_confirmation' : 'source_observation'), metadata.modelVersion || null, metadata.sourceSpan || locator, now());
    return assertionId;
  };
  const recalculate = (id, edits = undefined) => {
    const p = rawPart(id);
    const previous = db.prepare('SELECT * FROM drafts WHERE part_id=?').get(id);
    const currentEdits = edits === undefined ? previous?.edits_json ? JSON.parse(previous.edits_json) : null : edits;
    const output = derive(p, assertionsFor(id), reference(), checklist(), currentEdits, inspectionsFor(id), questionOutcomesFor(id));
    if (previous && previous.content_hash !== output.contentHash) db.prepare("UPDATE approvals SET status='invalidated' WHERE part_id=? AND status='approved'").run(id);
    db.prepare('INSERT INTO drafts VALUES(?,?,?,?,?,?,?) ON CONFLICT(part_id) DO UPDATE SET revision=excluded.revision,generated_json=excluded.generated_json,edits_json=excluded.edits_json,validation_json=excluded.validation_json,content_hash=excluded.content_hash,updated_at=excluded.updated_at').run(id, p.revision, JSON.stringify(output.canonicalDraft), currentEdits ? JSON.stringify(currentEdits) : null, JSON.stringify(output.claimChecks), output.contentHash, now());
    db.prepare('INSERT INTO readiness_results VALUES(?,?,?,?,?,?) ON CONFLICT(part_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,checklist_version=excluded.checklist_version,results_json=excluded.results_json,updated_at=excluded.updated_at').run(id, p.revision, output.readiness, checklist().version, JSON.stringify(output.rules), now());
    return output;
  };
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const addSeed = () => {
    const parts = JSON.parse(fs.readFileSync('datasets/parts.json', 'utf8'));
    for (const p of parts) {
      const created = now();
      db.prepare('INSERT INTO parts(id,stock_id,scenario,batch,revision,excluded,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(p.id, p.id, p.scenario, p.batch, 1, 0, created, created);
      const recordSource = insertSource(p.id, { kind: 'fictional_seller_record', name: 'Synthetic seller record / prior fictional confirmations', text: JSON.stringify(p.values, null, 2), synthetic: true });
      for (const [key, value] of Object.entries(p.values)) if (value != null && value !== 'unknown') insertAssertion(p.id, recordSource, key, value, 'seller_confirmed', `Synthetic record field: ${key}`, { confidence: 1, extractionMethod: 'seed_fixture' });
      if (p.values.measurement_basis == null && p.values.length_cm && p.values.width_cm && p.values.height_cm && p.values.weight_kg) insertAssertion(p.id, recordSource, 'measurement_basis', 'packaged', 'seller_confirmed', 'Synthetic fixture dimensions are explicitly packaged measurements', { confidence: 1, extractionMethod: 'seed_fixture' });
      const csvSource = insertSource(p.id, { kind: 'spreadsheet', name: `inventory.csv / stock ${p.id}`, text: JSON.stringify({ ...p.values, donor_year: p.id === 'DEMO-02' ? 2017 : p.values.donor_year }), synthetic: true });
      if (p.id === 'DEMO-02') {
        insertAssertion(p.id, csvSource, 'donor_year', 2017, 'observed', 'Spreadsheet: Toyota Corolla mirror, 2017');
        const donorSource = insertSource(p.id, { kind: 'donor_note', name: 'Synthetic dismantling note', text: 'Toyota Corolla donor year: 2018. Electrical testing has not been recorded.', synthetic: true });
        insertAssertion(p.id, donorSource, 'donor_year', 2018, 'observed', 'Dismantling note: 2018');
      }
      insertSource(p.id, { kind: 'note', name: 'Multilingual scenario note', text: p.notes, language: /[\u0600-\u06ff]/.test(p.notes) ? 'ar' : 'en', synthetic: true });
      const assetPath = path.resolve('datasets/assets', p.image);
      insertSource(p.id, { kind: 'photo', name: 'Synthetic stock-label image (not a product photo)', assetPath, mime: 'image/png', synthetic: true, sha256: hash(fs.readFileSync(assetPath)) });
      recalculate(p.id);
      audit(p.id, 1, 'seed', { mode: 'synthetic', note: 'Fictional prior confirmations; not model inference or actual product evidence' });
    }
  };
  const resetDemo = () => transaction(() => {
    for (const table of ['evaluator_field_scores', 'evaluation_measurements', 'translation_reviews', 'compliance_assessments', 'trade_quotes', 'buyer_inquiries', 'parts']) db.exec(`DELETE FROM ${table}`);
    fs.rmSync(path.join(directory, 'uploads'), { recursive: true, force: true });
    fs.mkdirSync(path.join(directory, 'uploads'), { recursive: true });
    addSeed();
    for (const { id } of db.prepare('SELECT id FROM parts').all()) recalculate(id);
    return { reset: true, parts: db.prepare('SELECT count(*) AS n FROM parts').get().n, message: 'Synthetic demo records restored; seller uploads and measurements deleted.' };
  });
  if (seed && db.prepare('SELECT count(*) AS n FROM parts').get().n === 0) transaction(addSeed);
  transaction(() => { for (const { id } of db.prepare('SELECT id FROM parts').all()) recalculate(id); });
  const listParts = () => db.prepare('SELECT id FROM parts ORDER BY stock_id').all().map(p => getPart(p.id));
  const getPart = id => {
    const p = rawPart(id);
    const saved = db.prepare('SELECT * FROM drafts WHERE part_id=?').get(id);
    const edits = saved?.edits_json ? JSON.parse(saved.edits_json) : null;
    const output = derive(p, assertionsFor(id), reference(), checklist(), edits, inspectionsFor(id), questionOutcomesFor(id));
    const approval = db.prepare('SELECT * FROM approvals WHERE part_id=? ORDER BY rowid DESC LIMIT 1').get(id) || null;
    const sourceRows = sourcesFor(id);
    const sourceName = new Map(sourceRows.map(source => [source.id, source.name]));
    const fields = Object.fromEntries(Object.entries(output.fields).map(([key, field]) => [key, { ...field, assertions: field.assertions.map(assertion => ({ ...assertion, source_name: sourceName.get(assertion.source_id) || 'Unknown source' })) }]));
    const publicAssertions = assertionsFor(id).map(assertion => ({ ...assertion, source_name: sourceName.get(assertion.source_id) || 'Unknown source' }));
    return { ...p, ...output, fields, visualInspections: inspectionsFor(id), identities: db.prepare('SELECT * FROM part_identity_links WHERE part_id=? ORDER BY created_at DESC').all(id), questionOutcomes: questionOutcomesFor(id), resolutions: db.prepare('SELECT * FROM resolutions WHERE part_id=? ORDER BY created_at DESC').all(id).map(r => ({ ...r, competing_assertion_ids: JSON.parse(r.competing_assertion_ids_json || '[]') })), extractionRuns: db.prepare('SELECT * FROM extraction_runs WHERE part_id=? ORDER BY created_at DESC').all(id), sources: sourceRows.map(({ asset_path, ...s }) => ({ ...s, url: asset_path ? `/api/sources/${s.id}/image` : null })), assertions: publicAssertions, approval, audit: db.prepare('SELECT * FROM audit_events WHERE part_id=? ORDER BY rowid DESC LIMIT 30').all(id).map(e => ({ ...e, details: JSON.parse(e.details_json) })) };
  };
  const mutate = (id, expectedRevision, event, fn, edits = undefined) => transaction(() => {
    const p = rawPart(id);
    if (p.revision !== expectedRevision) throw new AppError('This record changed. Reload before applying your correction.', 409, 'STALE_REVISION');
    fn(p);
    db.prepare('UPDATE parts SET revision=revision+1, updated_at=? WHERE id=?').run(now(), id);
    db.prepare("UPDATE approvals SET status='invalidated' WHERE part_id=? AND status='approved'").run(id);
    const output = recalculate(id, edits);
    audit(id, p.revision + 1, event, { readiness: output.readiness });
    return getPart(id);
  });
  return {
    db, directory, getPart, rawPart, assertionsFor, sourcesFor, checklist, reference,
    listParts,
    correct: (id, revision, corrections, reason) => mutate(id, revision, 'seller_correction', () => {
      const sourceId = insertSource(id, { kind: 'seller_confirmation', name: 'Seller correction / confirmation', text: JSON.stringify({ reason, corrections }), synthetic: false, approved: true, approvalActor: 'seller_operator' });
      for (const [field, value] of Object.entries(corrections)) {
        const competing = db.prepare('SELECT id FROM assertions WHERE part_id=? AND field_key=? AND active=1').all(id, field).map(row => row.id);
        db.prepare('UPDATE assertions SET active=0 WHERE part_id=? AND field_key=?').run(id, field);
        const chosen = insertAssertion(id, sourceId, field, value, value == null ? 'unknown' : 'seller_confirmed', reason, { confidence: value == null ? 0 : 1, extractionMethod: 'seller_confirmation' });
        db.prepare('INSERT INTO resolutions(id,part_id,field_key,value_json,reason,revision,chosen_assertion_id,competing_assertion_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), id, field, JSON.stringify(value), reason, revision + 1, value == null ? null : chosen, JSON.stringify(competing), now());
        db.prepare('INSERT INTO question_outcomes(id,part_id,field_key,question_key,outcome,reason,revision,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), id, field, `FIELD-${field}`, value == null ? 'unknown' : 'resolved', reason, revision + 1, now());
      }
      if (corrections.part_type != null) db.prepare('UPDATE parts SET excluded=? WHERE id=?').run(/airbag|battery|hazard|brake|safety|بطارية|وسادة هوائية/i.test(corrections.part_type) || !/mirror|مرآة/i.test(corrections.part_type) ? 1 : 0, id);
    }, null),
    addSource: (id, revision, source, extracted = []) => mutate(id, revision, 'source_added', () => {
      const sourceId = insertSource(id, source);
      for (const r of extracted) insertAssertion(id, sourceId, r.field, r.value, 'observed', r.locator);
    }),
    applyExtraction: (id, revision, sourceId, text, candidates, confidence, elapsedMs) => mutate(id, revision, 'local_ocr', () => {
      if (!sourcesFor(id).some(s => s.id === sourceId)) throw new AppError('OCR source does not belong to this part');
      const extractedSource = insertSource(id, { kind: 'local_ocr', name: 'Tesseract local OCR transcription', text, language: 'en+ar', synthetic: sourcesFor(id).find(s => s.id === sourceId).synthetic === 1 });
      for (const r of candidates) insertAssertion(id, extractedSource, r.field, r.value, 'observed', `OCR image source ${sourceId}: ${r.locator}`, { confidence: r.confidence ?? confidence, extractionMethod: 'local_ocr', modelVersion: 'tesseract.js-6-local', sourceSpan: r.locator });
      db.prepare('INSERT INTO extraction_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), id, sourceId, 'replay', 'completed', 'Tesseract.js local OCR', 'tesseract.js-6-local', sourcesFor(id).find(s => s.id === sourceId)?.sha256 || null, JSON.stringify({ text, candidates, confidence, elapsedMs }), now());
      audit(id, revision + 1, 'ocr_result', { mode: 'replay', engine: 'tesseract.js', version: 'tesseract.js-6-local', sourceId, confidence, elapsedMs, characters: text.length });
    }),
    rawVisual,
    getVisual: id => visualView(rawVisual(id)),
    saveStandaloneVisual: (artifacts, originalPath, exampleId = null) => transaction(() => insertVisual(artifacts, originalPath, null, null, exampleId)),
    savePartVisual: (id, revision, sourceId, artifacts) => mutate(id, revision, 'local_visual_inspection', () => {
      const source = sourcesFor(id).find(s => s.id === sourceId && s.asset_path);
      if (!source || source.sha256 !== artifacts.result.sourceHash) throw new AppError('Visual source changed or does not belong to this stock record', 409, 'STALE_SOURCE');
      insertVisual(artifacts, source.asset_path, id, sourceId, null, revision + 1);
      db.prepare('INSERT INTO extraction_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), id, sourceId, 'local', 'completed', artifacts.result.engine, artifacts.result.modelId, artifacts.result.sourceHash, JSON.stringify({ inspectionId: artifacts.result.id, detections: artifacts.result.detections, threshold: artifacts.result.threshold }), now());
      insertSource(id, { kind: 'visual_model', name: 'Local CNN segmentation suggestions - not confirmed defects', text: JSON.stringify({ inspectionId: artifacts.result.id, sourceId, model: artifacts.result.modelId, findings: artifacts.result.detections, notice: artifacts.result.notice }, null, 2), approved: true, approvalActor: 'local_model' });
    }, null),
    reviewVisual: (id, revision, inspectionId, decisions, reason) => mutate(id, revision, 'seller_visual_review', () => {
      const run = rawVisual(inspectionId);
      if (run.part_id !== id) throw new AppError('Inspection does not belong to this stock record');
      const source = sourcesFor(id).find(s => s.id === run.source_id);
      if (!source || source.sha256 !== run.source_hash) throw new AppError('Inspection source no longer matches', 409, 'STALE_SOURCE');
      const result = JSON.parse(run.result_json), review = JSON.parse(run.review_json);
      const confirmed = [];
      for (const decision of decisions) {
        const finding = result.detections.find(d => d.id === decision.id);
        if (!finding) throw new AppError('Unknown predicted region');
        if (review[decision.id]) throw new AppError('This region was already reviewed. Use a sourced inventory correction to revise confirmed condition.');
        review[decision.id] = { status: decision.status, reason, reviewedAt: now() };
        if (decision.status === 'confirmed') confirmed.push(finding.label);
      }
      db.prepare('UPDATE visual_inspections SET review_json=? WHERE id=?').run(JSON.stringify(review), inspectionId);
      const confirmationSource = insertSource(id, { kind: 'seller_confirmation', name: 'Seller review of local visual predictions', text: JSON.stringify({ inspectionId, sourceId: run.source_id, decisions, reason }, null, 2) });
      if (confirmed.length) {
        const fields = derive(rawPart(id), assertionsFor(id), reference(), checklist()).fields;
        const oldCondition = fields.defect_notes.value;
        const previous = !oldCondition || /no visible defect reported/i.test(oldCondition) ? 'Condition updated after seller review of the photo; hidden damage remains unassessed.' : oldCondition;
        const condition = `${previous}\nSeller confirms visible ${[...new Set(confirmed)].join(', ')} in inspected photo. Review note: ${reason}`;
        db.prepare('UPDATE assertions SET active=0 WHERE part_id=? AND field_key=?').run(id, 'defect_notes');
        insertAssertion(id, confirmationSource, 'defect_notes', condition, 'seller_confirmed', `Seller-reviewed regions in inspection ${inspectionId}`);
        db.prepare('INSERT INTO resolutions(id,part_id,field_key,value_json,reason,revision,chosen_assertion_id,competing_assertion_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), id, 'defect_notes', JSON.stringify(condition), reason, revision + 1, null, '[]', now());
      }
    }, null),
    saveDraft: (id, revision, edits) => mutate(id, revision, edits ? 'draft_edit_held_or_validated' : 'draft_regenerated', () => {}, edits),
    approve: (id, revision, expectedHash, acknowledged) => transaction(() => {
      const part = getPart(id);
      if (part.revision !== revision || part.contentHash !== expectedHash) throw new AppError('Review the current record revision before approval', 409, 'STALE_REVISION');
      if (!acknowledged || part.excluded || part.readiness !== 'ready_for_seller_review' || part.claimChecks.length) throw new AppError('Resolve blockers and acknowledge limitations before approval');
      if (part.approval?.status === 'approved' && part.approval.revision === revision) return part;
      db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?,?)').run(randomUUID(), id, revision, expectedHash, 'approved', 1, now());
      audit(id, revision, 'seller_approved', { note: 'Local draft only; no publication, fitment guarantee, or clearance' });
      return getPart(id);
    }),
    importRecords: rows => transaction(() => {
      if (db.prepare('SELECT count(*) AS n FROM parts').get().n + rows.length > 120) throw new AppError('Local PoC import limit is 120 records');
      for (const row of rows) if (db.prepare('SELECT id FROM parts WHERE stock_id=?').get(row.stock_id)) throw new AppError(`Stock ID already exists: ${row.stock_id}`, 409, 'DUPLICATE_STOCK');
      const ids = [];
      for (const row of rows) {
        const id = randomUUID();
        const excluded = /airbag|battery|hazard|brake|safety|بطارية|وسادة هوائية/i.test(`${row.part_type || ''} ${row.description || ''}`) || (row.part_type && !/mirror|مرآة/i.test(row.part_type));
        db.prepare('INSERT INTO parts VALUES(?,?,?,?,?,?,?,?)').run(id, row.stock_id, row.description || 'Imported stock', 'imported', 1, excluded ? 1 : 0, now(), now());
        const sourceId = insertSource(id, { kind: 'spreadsheet', name: `CSV stock ${row.stock_id}`, text: JSON.stringify(row, null, 2), synthetic: false });
        for (const [field, value] of Object.entries(row)) if (FIELD_KEYS.has(field) && value != null && value !== '') insertAssertion(id, sourceId, field, value, 'observed', `CSV field ${field}`);
        recalculate(id); audit(id, 1, 'csv_import', { sourceId }); ids.push(id);
      }
      return ids;
    }),
    sourceImage: sourceId => { const s = db.prepare('SELECT * FROM sources WHERE id=?').get(sourceId); if (!s?.asset_path) throw new AppError('Image not found', 404, 'NOT_FOUND'); return s; },
    measurements: () => db.prepare('SELECT * FROM evaluation_measurements ORDER BY rowid DESC').all(),
    saveMeasurement: m => {
      if (m.part_id) rawPart(m.part_id);
      if (m.correct > m.populated || m.detected_issues > m.expected_issues || m.disclosed > m.expected_disclosures) throw new AppError('Correct/detected/disclosed counts cannot exceed their denominators');
      const id = randomUUID();
      db.prepare('INSERT INTO evaluation_measurements(id,part_id,workflow,seconds,populated,correct,expected_issues,detected_issues,false_positives,expected_disclosures,disclosed,corrections,notes,case_id,truth_set_version,extraction_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, m.part_id || null, m.workflow, m.seconds, m.populated, m.correct, m.expected_issues, m.detected_issues, m.false_positives, m.expected_disclosures, m.disclosed, m.corrections, m.notes, m.case_id, m.truth_set_version, m.extraction_mode, now());
      return id;
    },
    resolveIdentity: (input, region = 'AE') => {
      const result = resolveIdentity(input, region);
      const parsed = result.parsed;
      if (parsed?.normalized) db.prepare('INSERT INTO vehicle_identities VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), parsed.raw, parsed.kind, parsed.normalized, region, JSON.stringify(result.candidates || []), result.confidence || 0, result.status, 'Local resolver query; candidate output requires human confirmation', now());
      return result;
    },
    linkIdentity: (id, revision, input, region = 'AE', reason = 'Seller linked local identity candidate') => mutate(id, revision, 'identity_linked', () => {
      const result = resolveIdentity(input, region);
      if (!result.candidates.length) throw new AppError('No local identity candidate to link. Keep the identifier unverified and add stronger evidence.');
      const selected = result.candidates.find(candidate => (candidate.candidateId || candidate.id || candidate.normalized) === input.candidateId);
      if (!selected) throw new AppError('Selected identity candidate is not part of the current resolver result. Resolve again before linking.', 409, 'STALE_IDENTITY_CANDIDATE');
      const parsed = result.parsed;
      db.prepare('INSERT INTO part_identity_links VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), id, selected.candidateId || selected.id || selected.normalized, parsed.kind, parsed.raw, parsed.normalized, selected.confidence || result.confidence, 'seller_confirmed_candidate', reason, now());
      const sourceId = insertSource(id, { kind: 'identity_resolution', name: 'Local vehicle/part identity resolution', text: JSON.stringify({ input, region, selected, result }, null, 2), synthetic: false, approved: true });
      if (parsed.kind === 'vin') insertAssertion(id, sourceId, 'vin', parsed.normalized, 'seller_confirmed', reason, { confidence: selected.confidence || result.confidence, extractionMethod: 'identity_resolution' });
      else if (parsed.kind === 'chassis') insertAssertion(id, sourceId, 'chassis_number', parsed.normalized, 'seller_confirmed', reason, { confidence: selected.confidence || result.confidence, extractionMethod: 'identity_resolution' });
      else if (parsed.kind === 'part_number') insertAssertion(id, sourceId, 'part_number', selected.normalized, 'seller_confirmed', reason, { confidence: selected.confidence || result.confidence, extractionMethod: 'identity_resolution' });
    }),
    identitiesForPart: id => db.prepare('SELECT * FROM part_identity_links WHERE part_id=? ORDER BY created_at DESC').all(id),
    searchMarketplace: ({ query = '', region = 'GB', readiness = '', side = '', maxPrice = null } = {}) => listParts().filter(p => !p.excluded).map(part => ({ part, match: scoreSearch(part, query, region) })).filter(row => row.match.score > 0 && (!readiness || row.part.readiness === readiness) && (!side || row.part.fields.side.value === side) && (maxPrice == null || Number(row.part.fields.asking_price.value || 0) <= Number(maxPrice))).sort((a, b) => b.match.score - a.match.score).slice(0, 50).map(({ part, match }) => ({ id: part.id, stockId: part.stock_id, title: part.draft.title, description: part.draft.description, scenario: part.scenario, readiness: part.readiness, approval: part.approval?.status || 'pending', match, fields: part.fields, compatibility: part.compatibility, region: regionProfile(region), sourceCount: part.sources.length, buyerNotice: 'Seller approval and regional fitment review are still required.' })),
    tradeQuote: (partId, input) => {
      const part = partId ? getPart(partId) : { fields: {} };
      const measured = (inputKey, fieldKey, fallback) => input[inputKey] != null ? { value: input[inputKey], source: 'operator_input' } : part.fields?.[fieldKey]?.value != null ? { value: part.fields[fieldKey].value, source: 'seller_record' } : { value: fallback, source: 'demo_assumption' };
      const amount = measured('value', 'asking_price', 0), currency = measured('currency', 'currency', 'AED'), length = measured('lengthCm', 'length_cm', 40), width = measured('widthCm', 'width_cm', 30), height = measured('heightCm', 'height_cm', 20), weight = measured('weightKg', 'weight_kg', 2);
      const quote = calculateTradeQuote({ ...input, value: amount.value, currency: currency.value, lengthCm: length.value, widthCm: width.value, heightCm: height.value, weightKg: weight.value });
      quote.inputProvenance = { value: amount, currency, lengthCm: length, widthCm: width, heightCm: height, weightKg: weight, measurementBasis: { value: part.fields?.measurement_basis?.value || 'unknown', source: part.fields?.measurement_basis?.value ? 'seller_record' : 'missing' } };
      if (quote.inputProvenance.measurementBasis.value !== 'packaged') quote.assumptions.unshift('Packaging basis is not confirmed as packaged; this landed-cost estimate must not be used for a buyer quote until packed measurements are recorded.');
      const id = randomUUID();
      db.prepare('INSERT INTO trade_quotes VALUES(?,?,?,?,?,?,?)').run(id, partId || null, quote.origin.code, quote.destination.code, JSON.stringify(quote), platformHash(quote.assumptions), now());
      return { id, ...quote };
    },
    assessCompliance: (partId, input) => {
      const part = partId ? getPart(partId) : { fields: {} };
      const assessment = complianceAssessment({ part, from: input.from || 'AE', to: input.to || 'GB' });
      const id = randomUUID();
      db.prepare('INSERT INTO compliance_assessments VALUES(?,?,?,?,?,?)').run(id, partId || null, assessment.origin.code, assessment.destination.code, JSON.stringify(assessment), now());
      return { id, ...assessment };
    },
    translate: (partId, input) => {
      const result = translateText(input.text, input.from || 'en', input.to || 'ar');
      const id = randomUUID();
      db.prepare('INSERT INTO translation_reviews VALUES(?,?,?,?,?,?,?,?,?)').run(id, partId || null, input.from || 'en', input.to || 'ar', result.source, result.translated, result.reviewRequired ? 'review_required' : 'accepted', result.confidence, now());
      return { id, ...result };
    },
    createInquiry: ({ partId = null, buyerLabel = 'Anonymous local buyer', region = 'GB', message }) => {
      if (partId) rawPart(partId);
      const id = randomUUID();
      db.prepare('INSERT INTO buyer_inquiries VALUES(?,?,?,?,?,?,?)').run(id, partId, buyerLabel, region, message, 'new', now());
      if (partId) audit(partId, rawPart(partId).revision, 'buyer_inquiry_received', { inquiryId: id, region });
      return db.prepare('SELECT * FROM buyer_inquiries WHERE id=?').get(id);
    },
    inquiries: () => db.prepare('SELECT * FROM buyer_inquiries ORDER BY created_at DESC').all(),
    resetDemo,
    stats: () => ({ tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x => ({ name: x.name, rows: db.prepare(`SELECT count(*) AS n FROM ${x.name}`).get().n })), sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version }),
    close: () => db.close(),
  };
}
