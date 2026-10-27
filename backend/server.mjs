import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { AppError, openRepository } from './database.mjs';
import { FIELD_DEFS, FIELD_KEYS, numericFields, parseNote, hash } from './domain.mjs';
import { recognizeLocal } from './ocr.mjs';
import { inspectLocal, visionManifest, visionImages, visionSummary, exampleImage } from './vision.mjs';

const boundedText = z.string().trim().min(1).max(4000);
const revisionSchema = z.number().int().positive();
function validateFields(data) {
  const values = z.record(z.string(), z.union([z.string().max(4000), z.number().finite(), z.null()])).parse(data);
  if (!Object.keys(values).length) throw new AppError('Choose at least one field to correct');
  for (const [key, value] of Object.entries(values)) {
    if (!FIELD_KEYS.has(key)) throw new AppError(`Unsupported field: ${key}`);
    if (value === null) continue;
    if (numericFields.has(key) && (typeof value !== 'number' || value <= 0 || (key === 'donor_year' && (!Number.isInteger(value) || value < 1900 || value > new Date().getFullYear() + 1)))) throw new AppError(`Invalid numeric value for ${key}`);
    if (key === 'side' && !['left', 'right'].includes(value)) throw new AppError('Choose left, right or not confirmed');
    if (key === 'testing_status' && !['unknown', 'untested', 'partial', 'reported_pass', 'reported_fail'].includes(value)) throw new AppError('Invalid testing status');
    if (key === 'measurement_basis' && !['packaged', 'bare_part', 'unknown'].includes(value)) throw new AppError('Choose packaged, bare part or unknown measurement basis');
    if (!numericFields.has(key) && typeof value !== 'string') throw new AppError(`Text required for ${key}`);
    if (!numericFields.has(key) && value.trim() === '') throw new AppError(`Blank values are not accepted for ${key}; use the unknown checkbox instead`);
  }
  return values;
}
const safeImage = buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? 'image/jpeg' : null;
export function createApp(repository = openRepository()) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 8, fieldSize: 24000 } });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const origin = req.headers.origin;
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method) && origin) {
      try { if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error(); } catch { return res.status(403).json({ ok: false, error: { code: 'ORIGIN_DENIED', message: 'Local operator access only' } }); }
    }
    next();
  });
  app.use(express.json({ limit: '96kb' }));
  const ok = (res, data) => res.json({ ok: true, data });
  app.get('/api/health', (req, res) => ok(res, { status: 'ready', offline: true, database: 'SQLite', ocr: ['eng', 'ara'].every(l => fs.existsSync(`models/tessdata/${l}.traineddata.gz`)) }));
  app.get('/api/config', (req, res) => ok(res, { name: 'Yardpass', fields: FIELD_DEFS, mode: 'offline', languages: ['en', 'ar'], checklist: repository.checklist(), audience: 'B2B salvage seller enablement; downstream B2B and potential B2C', personas: [{ id: 'seller', label: 'Noor / salvage seller', outcome: 'Faster, evidence-grounded listing preparation and fewer hidden defects.' }, { id: 'buyer', label: 'Garage / trader buyer', outcome: 'Search by vehicle identity, part number and region with visible uncertainty.' }, { id: 'operator', label: 'Trade-lane operator', outcome: 'Prepare a UAE-to-UK quote and readiness review without pretending to clear customs.' }], rubric: [{ name: 'Business relevance and value', weight: 30 }, { name: 'AI quality and evidence', weight: 25 }, { name: 'Working prototype', weight: 20 }, { name: 'Seller experience', weight: 15 }, { name: 'Responsible design and scalability', weight: 10 }] }));
  app.get('/api/platform/overview', (req, res) => ok(res, { regions: ['AE', 'GB'], corridor: 'AE → GB', capabilities: ['vehicle/VIN/chassis identity resolution', 'part-number normalization', 'buyer search and inquiry capture', 'regional trade quote and landed-cost planning', 'operational compliance checklist', 'review-required bilingual glossary translation', 'seller evidence and revision-bound approval'], boundaries: ['No live VIN/registration provider', 'No legal customs clearance or carrier booking', 'No fitment guarantee from appearance', 'No payment or production marketplace publication'], parts: repository.listParts().length, inquiries: repository.inquiries().length, database: repository.stats() }));
  app.post('/api/identity/resolve', (req, res) => { const body = z.object({ identifier: z.string().min(3).max(64), kind: z.enum(['auto', 'vin', 'chassis', 'registration', 'part_number']).default('auto'), region: z.enum(['AE', 'GB']).default('AE'), make: z.string().max(80).optional(), model: z.string().max(80).optional(), year: z.coerce.number().int().min(1900).max(2100).optional() }).strict().parse(req.body); ok(res, repository.resolveIdentity(body, body.region)); });
  app.post('/api/parts/:id/identity', (req, res) => { const body = z.object({ expectedRevision: revisionSchema, identifier: z.string().min(3).max(64), kind: z.enum(['auto', 'vin', 'chassis', 'registration', 'part_number']).default('auto'), candidateId: z.string().min(1).max(120), region: z.enum(['AE', 'GB']).default('AE'), reason: boundedText }).strict().parse(req.body); ok(res, repository.linkIdentity(req.params.id, body.expectedRevision, body, body.region, body.reason)); });
  app.get('/api/search', (req, res) => { const query = z.string().max(120).optional().parse(req.query.query || ''); const region = z.enum(['AE', 'GB']).catch('GB').parse(req.query.region || 'GB'); const readiness = z.string().max(80).optional().parse(req.query.readiness || ''); const side = z.enum(['left', 'right']).optional().parse(req.query.side || undefined); const maxPrice = req.query.maxPrice ? z.coerce.number().nonnegative().parse(req.query.maxPrice) : null; ok(res, { query, region, results: repository.searchMarketplace({ query, region, readiness, side, maxPrice }) }); });
  app.post('/api/trade/quote', (req, res) => { const body = z.object({ partId: z.string().nullable().optional(), from: z.enum(['AE', 'GB']).default('AE'), to: z.enum(['AE', 'GB']).default('GB'), value: z.number().nonnegative().optional(), currency: z.enum(['AED', 'GBP']).default('AED'), lengthCm: z.number().positive().max(500).optional(), widthCm: z.number().positive().max(500).optional(), heightCm: z.number().positive().max(500).optional(), weightKg: z.number().positive().max(500).optional() }).strict().parse(req.body); ok(res, repository.tradeQuote(body.partId || null, body)); });
  app.post('/api/compliance/check', (req, res) => { const body = z.object({ partId: z.string().nullable().optional(), from: z.enum(['AE', 'GB']).default('AE'), to: z.enum(['AE', 'GB']).default('GB') }).strict().parse(req.body); ok(res, repository.assessCompliance(body.partId || null, body)); });
  app.post('/api/translate', (req, res) => { const body = z.object({ partId: z.string().nullable().optional(), text: z.string().min(1).max(16000), from: z.enum(['en', 'ar']), to: z.enum(['en', 'ar']) }).strict().parse(req.body); ok(res, repository.translate(body.partId || null, body)); });
  app.get('/api/inquiries', (req, res) => ok(res, repository.inquiries()));
  app.post('/api/inquiries', (req, res) => { const body = z.object({ partId: z.string().nullable().optional(), buyerLabel: z.string().trim().min(1).max(120), region: z.enum(['AE', 'GB']).default('GB'), message: z.string().trim().min(5).max(4000) }).strict().parse(req.body); ok(res, repository.createInquiry({ partId: body.partId || null, buyerLabel: body.buyerLabel, region: body.region, message: body.message })); });
  app.get('/api/parts', (req, res) => ok(res, repository.listParts().map(p => ({ id: p.id, stock_id: p.stock_id, scenario: p.scenario, batch: p.batch, revision: p.revision, readiness: p.readiness, approval: p.approval, fields: p.fields, questions: p.questions.length, conflicts: p.conflicts.length, evidenceCount: p.sources.length, image: p.sources.find(s => s.url)?.url }))));
  app.get('/api/parts/:id', (req, res) => ok(res, repository.getPart(req.params.id)));
  app.patch('/api/parts/:id', (req, res) => {
    const body = z.object({ expectedRevision: revisionSchema, fields: z.record(z.string(), z.unknown()), reason: boundedText }).strict().parse(req.body);
    ok(res, repository.correct(req.params.id, body.expectedRevision, validateFields(body.fields), body.reason));
  });
  app.post('/api/parts/:id/draft', (req, res) => {
    const body = z.object({ expectedRevision: revisionSchema, edits: z.object({ title: z.string().max(400), description: z.string().max(16000), category: z.string().max(500), specifics: z.record(z.string(), z.string().max(400)).optional() }).nullable().optional() }).strict().parse(req.body);
    ok(res, repository.saveDraft(req.params.id, body.expectedRevision, body.edits || null));
  });
  app.post('/api/parts/:id/approve', (req, res) => {
    const body = z.object({ expectedRevision: revisionSchema, contentHash: z.string().length(64), acknowledged: z.boolean() }).strict().parse(req.body);
    ok(res, repository.approve(req.params.id, body.expectedRevision, body.contentHash, body.acknowledged));
  });
  app.post('/api/parts/:id/notes', (req, res) => {
    const body = z.object({ expectedRevision: revisionSchema, text: z.string().min(1).max(20000), language: z.enum(['en', 'ar']).default('en'), approved: z.literal(true) }).strict().parse(req.body);
    ok(res, repository.addSource(req.params.id, body.expectedRevision, { kind: 'note', name: 'Seller-provided inventory/donor note', text: body.text, language: body.language, approved: true, approvalActor: 'seller_operator' }, parseNote(body.text)));
  });
  app.post('/api/parts/:id/photos', upload.single('image'), (req, res) => {
    const revision = z.coerce.number().int().positive().parse(req.body.expectedRevision);
    if (req.body.approved !== 'true') throw new AppError('Confirm source approval/anonymisation before upload');
    if (!req.file) throw new AppError('Choose a JPEG or PNG image');
    const part = repository.getPart(req.params.id);
    if (part.sources.filter(s => s.kind === 'photo').length >= 4) throw new AppError('Four images maximum per part');
    const mime = safeImage(req.file.buffer);
    if (!mime) throw new AppError('Only valid JPEG/PNG signatures are supported', 415, 'UNSUPPORTED_IMAGE');
    const assetPath = path.resolve(repository.directory, 'uploads', `${randomUUID()}.${mime === 'image/png' ? 'png' : 'jpg'}`);
    fs.writeFileSync(assetPath, req.file.buffer);
    try { ok(res, repository.addSource(req.params.id, revision, { kind: 'photo', name: req.file.originalname, assetPath, mime, sha256: hash(req.file.buffer), approved: true, approvalActor: 'seller_operator' })); } catch (e) { fs.unlinkSync(assetPath); throw e; }
  });
  app.get('/api/sources/:id/image', (req, res) => { const source = repository.sourceImage(req.params.id); res.type(source.mime).sendFile(source.asset_path, { dotfiles: 'allow' }); });
  app.post('/api/parts/:id/ocr', async (req, res, next) => {
    try {
      const body = z.object({ expectedRevision: revisionSchema, sourceId: z.string(), language: z.enum(['eng', 'ara']).default('eng') }).strict().parse(req.body);
      const part = repository.getPart(req.params.id);
      if (part.revision !== body.expectedRevision) throw new AppError('Record changed before OCR; reload', 409, 'STALE_REVISION');
      if (!part.sources.some(s => s.id === body.sourceId && s.url)) throw new AppError('Select an image belonging to this part');
      const source = repository.sourceImage(body.sourceId);
      const result = await recognizeLocal(source.asset_path, body.language);
      const candidates = parseNote(result.text);
      const updated = repository.applyExtraction(req.params.id, body.expectedRevision, body.sourceId, result.text, candidates, result.confidence, result.elapsedMs);
      ok(res, { part: updated, result, candidates });
    } catch (e) { next(e); }
  });
  app.get('/api/vision/config', (req, res) => ok(res, { model: visionManifest(), dataset: visionImages() }));
  app.get('/api/vision/summary', (req, res) => ok(res, visionSummary()));
  app.get('/api/vision/examples/:id/image', (req, res) => res.sendFile(exampleImage(req.params.id).file));
  app.get('/api/vision/examples/:id/annotation', (req, res) => res.sendFile(exampleImage(req.params.id, true).file));
  app.post('/api/vision/examples/:id/record', (req, res) => {
    const example = exampleImage(req.params.id);
    if (example.image.kind !== 'mirror_crop') throw new AppError('Whole-vehicle benchmarks cannot be added to the mirror listing scope.');
    const stockId = `REFERENCE-${example.image.id.toUpperCase()}`;
    const existing = repository.listParts().find(p => p.stock_id === stockId);
    if (existing) return ok(res, existing);
    const [id] = repository.importRecords([{ stock_id: stockId, part_type: 'Side-view mirror', description: `Reference-only mirror photograph: ${example.image.id} (not verified seller stock)` }]);
    ok(res, repository.addSource(id, 1, { kind: 'photo', name: `Reference dataset photo / ${example.image.id}`, text: JSON.stringify(example.image, null, 2), assetPath: example.file, mime: 'image/jpeg', sha256: hash(fs.readFileSync(example.file)) }));
  });
  app.get('/api/vision/results/:id/:type', (req, res) => {
    const run = repository.rawVisual(req.params.id);
    const field = { original: 'original_path', overlay: 'overlay_path', heatmap: 'heatmap_path' }[req.params.type];
    if (!field) throw new AppError('Unknown visual artifact', 404, 'NOT_FOUND');
    res.sendFile(run[field], { dotfiles: 'allow' });
  });
  app.post('/api/vision/examples/:id/inspect', async (req, res, next) => {
    try {
      const body = z.object({ threshold: z.number().min(0.1).max(0.9).default(0.35) }).strict().parse(req.body);
      const example = exampleImage(req.params.id);
      const artifacts = await inspectLocal(example.file, { threshold: body.threshold, dataDirectory: repository.directory });
      ok(res, { inspection: repository.saveStandaloneVisual(artifacts, example.file, example.image.id), example: example.image });
    } catch (error) { next(error); }
  });
  app.post('/api/vision/upload', upload.single('image'), async (req, res, next) => {
    let imagePath;
    try {
      if (req.body.approved !== 'true') throw new AppError('Confirm upload is approved/anonymised.');
      if (!req.file || !safeImage(req.file.buffer)) throw new AppError('Choose a valid JPEG or PNG');
      const threshold = z.coerce.number().min(0.1).max(0.9).parse(req.body.threshold || '0.35');
      imagePath = path.resolve(repository.directory, 'uploads', `${randomUUID()}.${safeImage(req.file.buffer) === 'image/png' ? 'png' : 'jpg'}`);
      fs.writeFileSync(imagePath, req.file.buffer);
      const artifacts = await inspectLocal(imagePath, { threshold, dataDirectory: repository.directory });
      ok(res, { inspection: repository.saveStandaloneVisual(artifacts, imagePath), example: { name: req.file.originalname, kind: 'user_upload', limitations: 'Uploaded evidence; model suggestions require human review.' } });
    } catch (error) { if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath); next(error); }
  });
  app.post('/api/parts/:id/vision', async (req, res, next) => {
    try {
      const body = z.object({ expectedRevision: revisionSchema, sourceId: z.string(), threshold: z.number().min(0.1).max(0.9).default(0.35) }).strict().parse(req.body);
      const part = repository.getPart(req.params.id);
      if (part.revision !== body.expectedRevision) throw new AppError('Record changed before inspection; reload.', 409, 'STALE_REVISION');
      if (!part.sources.some(s => s.id === body.sourceId && s.url)) throw new AppError('Choose this part’s source image.');
      if (part.visualInspections.some(run => run.source_id === body.sourceId && run.result.detections.some(d => !run.review[d.id]))) throw new AppError('Review the pending regions on this photo before running another inspection.');
      const source = repository.sourceImage(body.sourceId);
      const artifacts = await inspectLocal(source.asset_path, { threshold: body.threshold, dataDirectory: repository.directory });
      ok(res, repository.savePartVisual(req.params.id, body.expectedRevision, body.sourceId, artifacts));
    } catch (error) { next(error); }
  });
  app.post('/api/parts/:id/vision/:inspectionId/review', (req, res) => {
    const body = z.object({ expectedRevision: revisionSchema, decisions: z.array(z.object({ id: z.string(), status: z.enum(['confirmed', 'rejected']) }).strict()).min(1).max(12), reason: boundedText }).strict().parse(req.body);
    if (new Set(body.decisions.map(d => d.id)).size !== body.decisions.length) throw new AppError('Each predicted region needs one decision.');
    ok(res, repository.reviewVisual(req.params.id, body.expectedRevision, req.params.inspectionId, body.decisions, body.reason));
  });
  app.post('/api/import', upload.single('csv'), (req, res) => {
    if (req.body.approved !== 'true') throw new AppError('Confirm data is synthetic or approved/anonymised');
    if (!req.file || req.file.size > 1024 * 1024) throw new AppError('Choose a CSV up to 1 MB');
    const parsed = Papa.parse(req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', dynamicTyping: false });
    if (parsed.errors.length) throw new AppError(`CSV parse error: ${parsed.errors[0].message}`);
    const headers = parsed.meta.fields || [];
    if (!headers.includes('stock_id') || headers.length !== new Set(headers).size || parsed.meta.renamedHeaders) throw new AppError('CSV needs unique column names and stock_id');
    if (!parsed.data.length || parsed.data.length > 20) throw new AppError('Import 1–20 records at a time');
    const seen = new Set();
    const rows = parsed.data.map((raw, i) => {
      const stock_id = String(raw.stock_id || '').trim();
      if (!stock_id || stock_id.length > 80 || seen.has(stock_id)) throw new AppError(`Invalid/duplicate stock_id in row ${i + 2}`);
      seen.add(stock_id);
      const values = Object.fromEntries(Object.entries(raw).filter(([k, v]) => FIELD_KEYS.has(k) && v?.trim()).map(([k, v]) => [k, numericFields.has(k) ? Number(v) : v.trim()]));
      if (Object.keys(values).length) validateFields(values);
      return { stock_id, description: String(raw.description || '').slice(0, 500), ...values };
    });
    if (req.body.dryRun === 'true') return ok(res, { rows, count: rows.length });
    ok(res, { ids: repository.importRecords(rows) });
  });
  app.get('/api/sample-csv', (req, res) => {
    res.type('text/csv').attachment('yardpass-import-example.csv').send('stock_id,part_type,manufacturer,part_number,donor_make,donor_model,donor_year,vin,chassis_number,vehicle_trim,market,drive_side,origin_country,side,testing_status,storage_location\nNEW-001,Side-view mirror,Toyota,87910-02A10,Toyota,Corolla,2018,,NRE170,GLI,AE,right,right-hand-drive,UAE,left,untested,Rack A\n');
  });
  app.get('/api/database', (req, res) => ok(res, repository.stats()));
  app.post('/api/demo/reset', (req, res) => { const body = z.object({ confirm: z.literal('RESET_DEMO_DATA') }).strict().parse(req.body); ok(res, repository.resetDemo(body.confirm)); });
  app.get('/api/dataset', (req, res) => ok(res, JSON.parse(fs.readFileSync('datasets/manifest.json', 'utf8'))));
  app.get('/api/measurements', (req, res) => ok(res, repository.measurements()));
  app.post('/api/measurements', (req, res) => {
    const n = z.number().int().nonnegative();
    const body = z.object({ part_id: z.string().nullable().optional(), case_id: z.string().trim().min(1).max(120), truth_set_version: z.string().trim().min(1).max(120), extraction_mode: z.enum(['manual', 'replay', 'live']), workflow: z.enum(['manual', 'assisted_local_ocr', 'assisted_manual_entry']), seconds: z.number().finite().nonnegative().max(86400), populated: n, correct: n, expected_issues: n, detected_issues: n, false_positives: n, expected_disclosures: n, disclosed: n, corrections: n, notes: z.string().max(4000).default('') }).strict().parse(req.body);
    ok(res, { id: repository.saveMeasurement(body) });
  });
  app.get('/api/parts/:id/export', (req, res) => {
    const part = repository.getPart(req.params.id);
    res.type('application/json').attachment(`${part.stock_id.replace(/[^a-zA-Z0-9_-]/g, '_')}-draft.json`).send(JSON.stringify({ disclaimer: part.checklist.disclaimer, stock_id: part.stock_id, revision: part.revision, approval: part.approval, draft: part.draft, readiness: part.readiness, compatibility: part.compatibility, mode: 'offline', evidence: part.sources }, null, 2));
  });
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'API endpoint not found' } }));
  if (fs.existsSync('dist/index.html')) {
    app.use(express.static(path.resolve('dist')));
    app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html')));
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err instanceof z.ZodError ? 422 : err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500;
    const message = err instanceof z.ZodError ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : status >= 500 && !(err instanceof AppError) ? 'Internal error; accepted inventory remains unchanged' : err.message;
    if (status === 500) console.error(err);
    res.status(status).json({ ok: false, error: { code: err.code || 'VALIDATION_ERROR', message } });
  });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repository = openRepository();
  const server = createApp(repository).listen(Number(process.env.PORT) || 3000, process.env.HOST || '127.0.0.1', () => console.log(`Yardpass offline app ready: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`));
  const stop = () => server.close(() => { repository.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
