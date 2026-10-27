import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import Papa from 'papaparse';

const root = process.cwd();
const dataDir = path.join(root, 'datasets');
const assets = path.join(dataDir, 'assets');
fs.mkdirSync(assets, { recursive: true });
const scenarios = [
  ['Documented assembly', {}],
  ['The Corolla conflict', { part_number: null, donor_year: null, testing_status: 'unknown', defect_notes: 'Possible damaged mounting tab; confirmation needed', weight_kg: null }],
  ['Missing identifier', { part_number: null }],
  ['Ambiguous suffix', { part_number: null }],
  ['Arabic condition note', { defect_notes: 'Broken mounting tab, seller-reported' }],
  ['Arabic test note', { testing_status: 'untested' }],
  ['No testing record', { testing_status: 'unknown' }],
  ['Partial motor test', { testing_status: 'partial', test_details: 'Adjustment motor reportedly tested; heating and folding not tested' }],
  ['Which vehicle side?', { side: null }],
  ['Incomplete assembly', { included_components: 'Housing and wiring; glass and cover NOT included' }],
  ['Packaging unknown', { length_cm: null, width_cm: null, height_cm: null, weight_kg: null }],
  ['Weight needs units', { weight_kg: null }],
  ['Connector variant', { connector: null }],
  ['Outside reference coverage', { part_number: 'DEMO-NO-REFERENCE' }],
  ['Variant constraint', { connector: null }],
  ['Untested with wear', { testing_status: 'untested', defect_notes: 'Scuff on housing, seller-reported' }],
  ['Source association check', { manufacturer: null }],
  ['Correction practice', { donor_year: 2017 }],
  ['Disclosure review', { defect_notes: 'Cracked cover, seller-reported' }],
  ['Awaiting seller approval', {}],
];
const parts = scenarios.map(([scenario, overrides], i) => {
  const id = `DEMO-${String(i + 1).padStart(2, '0')}`;
  const values = {
    part_type: 'Side-view mirror', manufacturer: i === 1 ? 'Toyota' : ['Toyota', 'Honda', 'Nissan'][i % 3],
    part_number: `DEMO-MIRROR-${String(i + 1).padStart(3, '0')}`, donor_make: i === 1 ? 'Toyota' : ['Toyota', 'Honda', 'Nissan'][i % 3],
    donor_model: i === 1 ? 'Corolla' : ['Fictional compact donor', 'Fictional hatchback donor', 'Fictional sedan donor'][i % 3],
    donor_year: 2018 + i % 4, side: i % 2 ? 'right' : 'left', testing_status: 'untested',
    test_details: 'No functionality asserted. Explicitly untested in fictional seller record.',
    defect_notes: 'No visible defect reported in fictional seller record; hidden damage not assessed',
    included_components: 'Mirror housing, glass and wiring; fasteners not included',
    length_cm: 34, width_cm: 23, height_cm: 18, weight_kg: 1.8 + (i % 4) * 0.1, measurement_basis: 'packaged',
    storage_location: `Rack ${String.fromCharCode(65 + i % 4)} / bin ${i + 1}`, asking_price: 95 + i * 7, currency: 'AED', connector: '5-pin',
    ...overrides,
  };
  const notes = [`Scenario: ${scenario}`, 'All records, identifiers and confirmations are fictional demonstration data.'];
  if (i === 1) notes.push('Donor year: 2018', 'The label is partly unreadable. Possible damaged mounting tab. Electrical testing not recorded.');
  if (i === 4) notes.push('لسان التثبيت مكسور');
  if (i === 5) notes.push('لم يتم الاختبار');
  if (i === 3) notes.push('Identifier reads DEMO-MIRROR-00?; do not complete the unreadable character.');
  if (i === 16) notes.push('Manufacturer missing: confirm photo belongs to the correct stock item.');
  return { id, scenario, batch: i < 10 ? 'demo' : 'evaluation', values, notes: notes.join('\n'), image: `${id}.png` };
});
for (const part of parts) {
  const n = part.id;
  const number = part.values.part_number || 'IDENTIFIER NOT READABLE';
  const rows = [`STOCK ID: ${n}`, `PART TYPE: SIDE-VIEW MIRROR`, `PART NUMBER: ${number}`, `SIDE: ${part.values.side || 'UNKNOWN'}`, `SYNTHETIC LABEL - NOT A PRODUCT PHOTO`];
  const xml = rows.map((s, i) => `<text x="58" y="${145 + i * 72}" font-family="sans-serif" font-size="${i === 2 ? 32 : 27}" fill="#172c3a">${s}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="550"><rect width="1000" height="550" fill="#eff4f8"/><rect x="30" y="30" width="940" height="490" rx="12" fill="#ffffff" stroke="#c7d5df"/>${xml}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(assets, part.image));
}
const compatibility = parts.filter((p, i) => ![1, 2, 3, 13].includes(i)).map(p => ({
  id: `REF-${p.id}`, part_number: p.values.part_number, manufacturer: p.values.manufacturer,
  side: p.values.side || 'right', connector: '5-pin', vehicle: `${p.values.donor_make} FICTIONAL test vehicle configuration`,
  authority: 'demo_only', version: 'demo-2026-10-27', source: 'Team-authored synthetic test reference; not real fitment data',
}));
const manifest = {
  version: '1.0.0', date: '2026-10-27', authority: 'demo_only',
  records: 20, demo_records: 10, images: 'Team-generated synthetic stock-label images, not real product photographs',
  rights: 'Fictional inventory and OCR label artwork are team-authored. Separate real-photo/model provenance and license notices are retained in datasets/vision/ and models/vision/.',
  limitations: ['No real vehicle fitment validated', 'Visual model suggests damage regions; detached-mirror/mounting-tab accuracy is not validated', 'Arabic extraction uses local OCR and limited reviewed phrases, not unrestricted translation'],
  visual_inspection: { images: '24 actual Carparts-Seg mirror crops plus 9 cloudwhynot benchmarks, 17 umerforsure samples and 9 additional real damage photos from MRCHARLESSG, MEHULCODE12 and ShivanshGupta-25; 59 real photos total, separate from fictional seller stock', model: 'Local pretrained YOLO26 damage CNN exported to ONNX; six damage classes; CPU inference, no training or runtime download', provenance: 'datasets/vision/images.json and models/vision/manifest.json', visualization: 'Predicted instance masks and score-weighted mask activation, not Grad-CAM or severity; sub-threshold raw scores are informational only', license_caveat: 'Repository MIT notices and no-license caveats are retained; review obligations before public/commercial release' },
  references: [
    { url: 'https://github.com/tesseract-ocr/tesseract', decision: 'Selected local OCR engine family; Tesseract.js WASM with bundled English/Arabic language data', license: 'Apache-2.0 engine; retain package/model license notices' },
    { url: 'https://github.com/Brachingo/Car-Detection-and-Parts-Segmentation', decision: 'Actual master-branch config resolved to Ultralytics Carparts-Seg archive; 12 attributed mirror crops and original part annotation masks prepared, no damage labels inferred' },
    { url: 'https://github.com/cloudwhynot/car-damage-detection-yolo', decision: 'Four real demo photos and checksum-verified damage checkpoint used. Checkpoint exported once to CPU ONNX; masks and activation overlays are genuine predictions, not confirmed defects', license: 'Retained repository MIT notice, plus separately disclosed Ultralytics derivative/training-data obligations' },
    { url: 'https://github.com/amelia-ng/vehicle-defect-detection', decision: 'Method reference only: rights/checkpoint availability not sufficiently established; no assets imported from this repository' },
    { url: 'https://github.com/ultralytics/ultralytics', decision: 'Export-only Python dependency; no Python/PyTorch service or training in deployment. Node ONNX Runtime performs offline inference; retain/review derivative-model terms' },
    { url: 'https://github.com/JaidedAI/EasyOCR', decision: 'Deferred: PyTorch stack heavier than single-runtime local Tesseract for this prototype' },
    { url: 'https://developer.ebay.com/', decision: 'No API integration or runtime external calls' },
  ],
};
const checklist = { id: 'DEMO-UAE-UK', version: 'demo-2026-10-27', date: '2026-10-27', authority: 'demo_only', corridor: 'UAE-to-UK', ruleset_version: 'rules-2026-10-27-v2', rules: [{ id: 'SCOPE', field: 'part_type', operator: 'mirror_family_only', severity: 'specialist' }, { id: 'CONFLICTS', field: '*', operator: 'no_active_conflicts', severity: 'blocking' }, { id: 'IDENTIFIER', field: 'part_number', operator: 'seller_confirmed_or_disclosed', severity: 'advisory' }, { id: 'CONDITION', field: 'defect_notes', operator: 'present_or_unknown_disclosed', severity: 'blocking' }, { id: 'TESTING', field: 'testing_status', operator: 'present_or_unknown_disclosed', severity: 'blocking' }, { id: 'PACKAGING', field: 'measurement_basis', operator: 'packaged', severity: 'blocking' }, { id: 'VISUAL-REVIEW', field: 'visual_inspections', operator: 'all_regions_reviewed', severity: 'blocking' }, { id: 'REGION', field: 'market', operator: 'disclosed', severity: 'advisory' }], disclaimer: 'Demo-only listing and shipping-readiness checklist. Not customs clearance, legal advice, carrier acceptance, or a booking.' };
fs.writeFileSync(path.join(dataDir, 'parts.json'), JSON.stringify(parts, null, 2));
fs.writeFileSync(path.join(dataDir, 'compatibility.json'), JSON.stringify(compatibility, null, 2));
fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(dataDir, 'checklist.json'), JSON.stringify(checklist, null, 2));
fs.writeFileSync(path.join(dataDir, 'inventory.csv'), Papa.unparse(parts.map(p => ({ stock_id: p.id, description: p.scenario, ...p.values, donor_year: p.id === 'DEMO-02' ? 2017 : p.values.donor_year }))));
fs.mkdirSync(path.join(root, 'evaluation'), { recursive: true });
fs.writeFileSync(path.join(root, 'evaluation', 'answer-key.json'), JSON.stringify({ testOnly: true, note: 'Evaluator-owned: never loaded by application runtime.', cases: parts.map(p => ({ id: p.id, scenario: p.scenario, truth: p.values, expectedUnknowns: Object.keys(p.values).filter(k => p.values[k] == null || p.values[k] === 'unknown'), conflict: p.id === 'DEMO-02' ? { donor_year: [2017, 2018] } : null })) }, null, 2));
console.log(`Prepared ${parts.length} fictional records, ${parts.length} synthetic OCR labels, CSV, reference, checklist, manifest and separate evaluation key.`);
