import { createHash } from 'node:crypto';

export const FIELD_DEFS = [
  ['part_type', 'Part type', 'نوع القطعة', 'text'], ['manufacturer', 'Manufacturer', 'الشركة المصنعة', 'text'],
  ['part_number', 'Identifier', 'رقم القطعة', 'text'], ['donor_make', 'Donor make', 'ماركة المركبة المانحة', 'text'],
  ['donor_model', 'Donor model', 'طراز المركبة المانحة', 'text'], ['donor_year', 'Donor year', 'سنة المركبة المانحة', 'number'],
  ['side', 'Vehicle side', 'جانب المركبة', 'side'], ['testing_status', 'Testing status', 'حالة الاختبار', 'testing'],
  ['test_details', 'Testing details', 'تفاصيل الاختبار', 'text'], ['defect_notes', 'Condition / defects', 'الحالة والعيوب', 'text'],
  ['included_components', 'Included / excluded components', 'المكونات المشمولة', 'text'], ['connector', 'Connector', 'الموصل', 'text'],
  ['length_cm', 'Packaged length (cm)', 'طول العبوة (سم)', 'number'], ['width_cm', 'Packaged width (cm)', 'عرض العبوة (سم)', 'number'],
  ['height_cm', 'Packaged height (cm)', 'ارتفاع العبوة (سم)', 'number'], ['weight_kg', 'Packaged weight (kg)', 'وزن العبوة (كغ)', 'number'], ['measurement_basis', 'Measurement basis', 'أساس القياس', 'measurement_basis'],
  ['storage_location', 'Storage location', 'موقع التخزين', 'text'], ['asking_price', 'Asking price', 'السعر المطلوب', 'number'],
  ['currency', 'Currency', 'العملة', 'text'], ['vin', 'VIN', 'رقم VIN', 'text'], ['chassis_number', 'Chassis number', 'رقم الشاسيه', 'text'],
  ['vehicle_trim', 'Vehicle trim / variant', 'فئة المركبة', 'text'], ['market', 'Vehicle market', 'سوق المركبة', 'text'],
  ['origin_country', 'Country of origin', 'بلد المنشأ', 'text'], ['drive_side', 'Driving side', 'جهة القيادة', 'text'],
].map(([key, label, ar, type]) => ({ key, label, ar, type }));
export const FIELD_KEYS = new Set(FIELD_DEFS.map(x => x.key));
export const numericFields = new Set(FIELD_DEFS.filter(x => x.type === 'number').map(x => x.key));
export const STATUS_LABELS = { ready_for_seller_review: 'Ready for seller review', information_missing: 'Information missing', specialist_review_required: 'Specialist review required' };
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

export function buildFields(assertions) {
  return Object.fromEntries(FIELD_DEFS.map(def => {
    const candidates = assertions.filter(a => a.field_key === def.key && a.active && a.value != null);
    const comparable = value => typeof value === 'string' && def.key !== 'part_number' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : value;
    const distinct = [...new Set(candidates.map(a => JSON.stringify(comparable(a.value))))];
    if (!distinct.length) return [def.key, { value: null, state: 'unknown', assertions: [] }];
    if (distinct.length > 1) return [def.key, { value: null, state: 'conflicting', assertions: candidates }];
    const preferred = candidates.find(a => a.state === 'seller_confirmed') || candidates[0];
    return [def.key, { value: preferred.value, state: preferred.state, assertions: candidates }];
  }));
}
export function compatibilityFor(fields, reference) {
  const number = fields.part_number;
  if (!number.value || number.state !== 'seller_confirmed') return { status: 'unverified', candidates: [], missing: [], message: 'Identifier not confirmed. Compatibility remains unverified.' };
  const rows = reference.filter(r => r.part_number === number.value && (!r.manufacturer || r.manufacturer === fields.manufacturer.value));
  if (!rows.length) return { status: 'unverified', candidates: [], missing: [], message: 'No supported match in the available reference. This is not proof of incompatibility.' };
  const market = fields.market?.value;
  const driveSide = fields.drive_side?.value;
  const supported = rows.filter(r => {
    const markets = JSON.parse(r.markets_json || '["AE","GB"]');
    const driveSides = JSON.parse(r.drive_sides_json || '["left","right"]');
    return (!r.side || r.side === fields.side.value) && (!r.connector || r.connector === fields.connector.value) && (!market || markets.includes(market)) && (!driveSide || driveSides.includes(driveSide));
  });
  const missing = [...new Set(rows.flatMap(r => ['side', 'connector'].filter(k => r[k] && !fields[k].value)))];
  const regionalUnverified = Boolean(market && !supported.length) || Boolean(driveSide && !supported.length);
  if (missing.length) return { status: 'constraint_missing', candidates: [], missing, message: 'Reference candidate requires additional configuration evidence.' };
  if (!supported.length) return { status: 'unverified', candidates: [], missing: [], message: regionalUnverified ? 'Available reference constraints do not support this market or driving-side configuration.' : 'Available reference constraints do not support this configuration.' };
  return { status: 'candidate_supported', candidates: supported, missing: [], message: 'Synthetic reference candidate only. No real vehicle compatibility is validated or guaranteed.' };
}
const testDescriptions = {
  unknown: 'Testing has not been recorded. Functionality is unverified.',
  untested: 'Explicitly untested. Functionality is unverified.',
  partial: 'Only the stated functions were reportedly tested. Other functions are unverified.',
  reported_pass: 'Seller reports a passed test for the stated functions; this is not an independent certification.',
  reported_fail: 'Seller reports a failed test. Failure must be disclosed.',
};
export function makeDraft(fields, compatibility, stockId) {
  const v = k => fields[k].value;
  const title = [v('manufacturer'), v('part_type') || 'Automotive part - type unconfirmed', v('side') ? `${v('side')} side` : null, 'Used'].filter(Boolean).join(' ');
  const sections = [
    ['Overview', `Used automotive part. Stock ID: ${stockId}. Identifiers: ${v('part_number') || 'not confirmed'}.`],
    ['Condition and defects', v('defect_notes') || 'Condition details are not confirmed. Ask the seller for inspection evidence.'],
    ['Testing', `${testDescriptions[v('testing_status')] || testDescriptions.unknown}${v('test_details') ? ` ${v('test_details')}` : ''}`],
    ['Included components', v('included_components') || 'Included and excluded components are not confirmed.'],
    ['Donor provenance - not fitment', [v('donor_make'), v('donor_model'), v('donor_year')].filter(Boolean).join(' ') || 'Donor information is not confirmed.'],
    ['Vehicle identity evidence', [v('vin') || v('chassis_number'), v('vehicle_trim'), v('market')].filter(Boolean).join(' / ') || 'VIN/chassis and regional variant are not confirmed.'],
    ['Compatibility', compatibility.message],
  ];
  return {
    title, description: sections.map(([name, text]) => `${name}\n${text}`).join('\n\n'),
    category: 'Vehicle Parts & Accessories / Exterior Mirrors (test suggestion, not verified marketplace metadata)',
    specifics: { Condition: 'Used', Brand: v('manufacturer') || 'Not confirmed', 'Part number': v('part_number') || 'Not confirmed', 'Vehicle side': v('side') || 'Not confirmed' },
    sections, synthetic: true,
  };
}
function ensureProtectedText(description, protectedText) {
  const current = String(description || '').trim();
  if (!protectedText || current.includes(protectedText)) return current;
  return `${current}${current ? '\n\n' : ''}Protected evidence disclosures\n${protectedText}`;
}
export function validateDraft(canonical, edits) {
  if (!edits) return [];
  const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const checks = [];
  for (const field of ['title', 'description', 'category']) {
    if (edits[field] != null && norm(edits[field]) !== norm(canonical[field])) checks.push({ field, reason: 'Free-form override requires sourced inventory correction and regeneration. Arbitrary prose is not automatically fact-verified.' });
  }
  if (edits.specifics && hash(edits.specifics) !== hash(canonical.specifics)) checks.push({ field: 'specifics', reason: 'Item specifics must be changed through sourced inventory corrections.' });
  return checks;
}
const questions = {
  part_number: ['Provide a clearer identifier photo or confirm the exact readable number.', 'يرجى تقديم صورة أوضح للرقم أو تأكيد الرقم المقروء.'],
  donor_year: ['Resolve the donor-year conflict using the donor record. This does not establish fitment.', 'يرجى حل تعارض سنة المركبة المانحة. هذا لا يثبت التوافق.'],
  side: ['Confirm physical vehicle left or right side, not driver/passenger wording.', 'أكد الجانب الأيسر أو الأيمن للمركبة.'],
  defect_notes: ['Confirm mounting-tab condition and any visible damage. Do not hide defects.', 'أكد حالة لسان التثبيت والأضرار المرئية.'],
  testing_status: ['Was it tested? Specify untested, partially tested, reported pass or failure.', 'هل تم الاختبار؟ حدد غير مختبر أو اختبار جزئي أو نتيجة الاختبار.'],
  included_components: ['Confirm which components are included and which are missing.', 'أكد المكونات المشمولة والناقصة.'],
  connector: ['Provide connector/pin evidence required by the reference candidate.', 'قدم تفاصيل الموصل المطلوبة في المرجع.'],
  vin: ['Capture the 17-character VIN from the donor document or mark it unavailable; never infer it from appearance.', 'سجل رقم VIN المكون من 17 حرفاً من مستند المركبة أو اتركه غير مؤكد.'],
  chassis_number: ['Capture the chassis number and source country/market; chassis prefix alone is not compatibility proof.', 'سجل رقم الشاسيه وسوق المركبة؛ البادئة وحدها لا تثبت التوافق.'],
  vehicle_trim: ['Confirm trim, engine/body variant and model-year range before a compatibility claim.', 'أكد الفئة والمحرك وهيكل المركبة قبل ادعاء التوافق.'],
  market: ['Confirm whether the donor is UAE, UK, GCC or another market; regional variants can differ.', 'أكد سوق المركبة لأن المواصفات الإقليمية قد تختلف.'],
  origin_country: ['Record country of origin for the trade-lane review and commercial invoice.', 'سجل بلد المنشأ لمراجعة الشحن والفاتورة التجارية.'],
  drive_side: ['Confirm left-hand-drive or right-hand-drive from a source; do not infer from the photo.', 'أكد جهة القيادة من مصدر ولا تستنتجها من الصورة.'],
  length_cm: ['Measure packaged length, width and height in cm.', 'قس طول العبوة وعرضها وارتفاعها بالسنتيمتر.'],
  width_cm: ['Measure packaged width in cm.', 'قس عرض العبوة بالسنتيمتر.'],
  height_cm: ['Measure packaged height in cm.', 'قس ارتفاع العبوة بالسنتيمتر.'],
  weight_kg: ['Confirm packaged weight in kg, not bare-part weight.', 'أكد وزن العبوة بالكيلوغرام وليس وزن القطعة فقط.'],
  measurement_basis: ['Confirm whether dimensions and weight are for the packed shipment or bare part.', 'أكد هل القياسات للعبوة أم للقطعة غير المعبأة.'],
};
export function derive(part, assertions, reference, checklist, edits = null, inspections = [], questionOutcomes = []) {
  const pendingVision = inspections.flatMap(run => run.result.detections.filter(d => !run.review[d.id]).map(d => ({ inspectionId: run.id, sourceId: run.source_id, ...d })));
  const fields = buildFields(assertions);
  const claimedTypes = assertions.filter(a => a.active && a.field_key === 'part_type' && a.value != null).map(a => String(a.value));
  const excluded = Boolean(part.excluded || claimedTypes.some(type => !/mirror|مرآة/i.test(type) || /airbag|battery|hazard|brake|safety|بطارية|وسادة هوائية/i.test(type)));
  const conflicts = FIELD_DEFS.filter(d => fields[d.key].state === 'conflicting').map(d => ({ field: d.key, label: d.label, candidates: fields[d.key].assertions }));
  const compatibility = compatibilityFor(fields, reference);
  const canonicalDraft = excluded ? { title: 'Excluded from prototype', description: 'This component is outside the approved mirror-family prototype. No listing draft is prepared.', category: 'Not applicable', specifics: {}, sections: [], synthetic: false } : makeDraft(fields, compatibility, part.stock_id);
  if (!excluded && pendingVision.length) {
    canonicalDraft.sections[1][1] += `\nAutomated visual suggestions awaiting seller review: ${[...new Set(pendingVision.map(d => d.label))].join(', ')}. These are not confirmed defects.`;
    canonicalDraft.description = canonicalDraft.sections.map(([name, text]) => `${name}\n${text}`).join('\n\n');
  }
  const protectedSections = canonicalDraft.sections.filter(([name]) => ['Condition and defects', 'Testing', 'Compatibility', 'Donor provenance - not fitment', 'Vehicle identity evidence'].includes(name));
  const protectedText = protectedSections.map(([name, text]) => `${name}\n${text}`).join('\n\n');
  const claimChecks = validateDraft(canonicalDraft, edits);
  const draft = edits ? { ...canonicalDraft, ...edits, description: ensureProtectedText(edits.description, protectedText), sections: canonicalDraft.sections } : canonicalDraft;
  const rules = [];
  const rule = (id, label, result, field = null, severity = 'blocking', action = '', ar = '') => rules.push({ id, label, result, field, severity, action, ar, version: checklist.version, rulesetVersion: checklist.ruleset_version || checklist.version, configured: !checklist.rules || checklist.rules.some(config => config.id === id), source: checklist.id, authority: checklist.authority });
  rule('SCOPE', 'Mirror family only; excluded components stopped', excluded ? 'fail' : 'pass', null, 'specialist', 'Keep excluded parts outside this prototype.');
  rule('CONFLICTS', 'Critical source conflicts resolved', conflicts.length ? 'fail' : 'pass', conflicts[0]?.field, 'blocking', 'Resolve competing assertions with source-backed confirmation.');
  rule('PART-TYPE', 'Part identity established within scope', fields.part_type.value ? 'pass' : 'unknown', 'part_type', 'blocking', 'Confirm the actual part type before preparing a category-specific listing.', 'أكد نوع القطعة قبل إعداد القائمة.');
  if (['partial', 'reported_pass', 'reported_fail'].includes(fields.testing_status.value)) {
    const details = fields.test_details.value;
    const invalidTestDetails = !details || /explicitly untested|no functionality asserted/i.test(details);
    rule('TEST-DETAILS', 'Reported test specifies functions and limitations', invalidTestDetails ? 'unknown' : 'pass', 'test_details', 'blocking', 'Provide the test method, tested functions and limitations; remove contradictory untested notes.', 'قدم طريقة الاختبار والوظائف المختبرة والقيود.');
  }
  for (const k of ['side', 'defect_notes', 'testing_status', 'included_components', 'length_cm', 'width_cm', 'height_cm', 'weight_kg', 'measurement_basis']) {
    const f = fields[k];
    const possibleDamage = k === 'defect_notes' && /possible|confirmation needed|appears/i.test(f.value || '');
    const missing = f.value == null || f.value === 'unknown' || f.state === 'conflicting' || possibleDamage || (k === 'measurement_basis' && f.value !== 'packaged');
    const label = FIELD_DEFS.find(d => d.key === k).label;
    rule(`FIELD-${k}`, `${label} supported or explicitly disclosed`, missing ? 'unknown' : 'pass', k, k === 'measurement_basis' ? 'advisory' : 'blocking', questions[k]?.[0] || `Confirm ${label}.`, questions[k]?.[1] || label);
  }
  rule('IDENTIFIER', 'Identifier/fitment uncertainty disclosed', fields.part_number.value && fields.part_number.state === 'seller_confirmed' ? 'pass' : 'unknown', 'part_number', 'advisory', questions.part_number[0], questions.part_number[1]);
  const vehicleIdentityKnown = ['vin', 'chassis_number', 'donor_make', 'donor_model', 'donor_year'].some(k => fields[k].value != null && fields[k].state !== 'conflicting');
  rule('VEHICLE-IDENTITY', 'Vehicle identity evidence is separated from compatibility', vehicleIdentityKnown ? 'pass' : 'unknown', 'chassis_number', 'advisory', questions.chassis_number[0], questions.chassis_number[1]);
  rule('REGION', 'Market and driving-side differences are disclosed', fields.market.value && fields.drive_side.value ? 'pass' : 'unknown', 'market', questions.market[0], questions.market[1]);
  if (compatibility.missing.length) rule('VARIANT', 'Reference configuration evidence available', 'unknown', compatibility.missing[0], 'blocking', questions.connector[0], questions.connector[1]);
  rule('DISCLOSURE', 'Used condition, defects and testing disclosed', claimChecks.length ? 'fail' : 'pass', null, 'blocking', 'Restore template or correct sourced facts and regenerate.');
  rule('REFERENCE', 'Checklist source available and labelled test-only', checklist.version ? 'pass' : 'unknown', null, 'blocking', 'Obtain supplied dated checklist.');
  if (pendingVision.length) rule('VISUAL-REVIEW', 'Model damage suggestions reviewed by seller', 'unknown', null, 'blocking', 'Confirm or reject each predicted region against the source photo; do not treat a heatmap as proof.', 'راجع مناطق الضرر المقترحة وأكدها أو ارفضها.');
  const status = excluded ? 'specialist_review_required' : rules.some(r => r.severity === 'blocking' && r.result !== 'pass') ? 'information_missing' : 'ready_for_seller_review';
  const actions = rules.filter(r => r.result !== 'pass').sort((a, b) => (a.severity === 'specialist' ? 0 : a.severity === 'blocking' ? 1 : 2) - (b.severity === 'specialist' ? 0 : b.severity === 'blocking' ? 1 : 2));
  const qs = actions.filter(r => r.field).map(r => ({ field: r.field, text: r.action, ar: r.ar, priority: r.severity, sources: fields[r.field]?.assertions || [] }));
  const uniqueQuestions = qs.filter((q, i) => qs.findIndex(x => x.field === q.field) === i).filter(q => {
    const latest = questionOutcomes.find(outcome => outcome.field_key === q.field);
    return !(latest?.outcome === 'unknown' && latest.revision === part.revision);
  });
  const contentHash = hash({ revision: part.revision, fields, draft, checklist, compatibility, rules, templateVersion: 'offline-v2' });
  return { excluded: excluded ? 1 : 0, fields, conflicts, compatibility, canonicalDraft, draft, claimChecks, rules, actions, pendingVision, questions: uniqueQuestions, readiness: status, contentHash, checklist, generatedFromRevision: part.revision };
}
export function parseNote(text) {
  const results = [];
  const aliases = { 'part number': 'part_number', 'part type': 'part_type', 'stock id': null, 'donor year': 'donor_year', side: 'side', manufacturer: 'manufacturer', 'testing status': 'testing_status', connector: 'connector', vin: 'vin', 'vin number': 'vin', chassis: 'chassis_number', 'chassis number': 'chassis_number', trim: 'vehicle_trim', market: 'market', 'origin country': 'origin_country', 'drive side': 'drive_side', 'measurement basis': 'measurement_basis' };
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.+?)\s*$/);
    if (!match) continue;
    const rawKey = match[1].toLowerCase();
    const key = aliases[rawKey] || (FIELD_KEYS.has(rawKey) ? rawKey : null);
    if (!key) continue;
    let value = match[2].trim();
    if (/unknown|not readable|not confirmed|\?/i.test(value)) continue;
    if (numericFields.has(key)) { value = Number(value); if (!Number.isFinite(value) || value <= 0) continue; }
    if (key === 'donor_year' && (!Number.isInteger(value) || value < 1900 || value > new Date().getFullYear() + 1)) continue;
    if (key === 'side') { value = value.toLowerCase(); if (!['left', 'right'].includes(value)) continue; }
    if (key === 'testing_status' && !Object.hasOwn(testDescriptions, value)) continue;
    results.push({ field: key, value, locator: line });
  }
  if (/لم يتم الاختبار|غير مختبر|not tested|explicitly untested/i.test(text)) results.push({ field: 'testing_status', value: 'untested', locator: 'Explicit untested phrase in source; limited reviewed phrase mapping' });
  if (/لسان التثبيت مكسور/.test(text)) results.push({ field: 'defect_notes', value: 'Broken mounting tab, source-reported', locator: 'لسان التثبيت مكسور' });
  return results.filter((r, i) => results.findIndex(x => x.field === r.field && x.value === r.value) === i);
}
