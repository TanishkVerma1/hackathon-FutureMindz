import { createHash } from 'node:crypto';

export const REGION_PROFILES = {
  AE: {
    code: 'AE', name: 'United Arab Emirates', currency: 'AED', locale: 'en-AE', driveSide: 'right', distanceUnit: 'km', weightUnit: 'kg',
    sellerRole: 'Dubai salvage seller', buyerRole: 'UAE exporter / local garage',
    taxNote: 'UAE VAT and export treatment must be confirmed for the actual transaction; this calculator is a planning estimate only.',
    identityNote: 'UAE listings commonly use chassis/VIN, donor make/model/year and part number together. Registration/plate data is not stored by this prototype.',
  },
  GB: {
    code: 'GB', name: 'United Kingdom', currency: 'GBP', locale: 'en-GB', driveSide: 'left', distanceUnit: 'miles', weightUnit: 'kg',
    sellerRole: 'UK importer / garage / trader', buyerRole: 'UK buyer',
    taxNote: 'UK VAT, import VAT, duty, commodity code and border requirements depend on the actual shipment and importer status; no legal clearance is provided.',
    identityNote: 'UK buyers may use registration, VIN/chassis, OEM number or vehicle make/model/year. Registration lookup is intentionally not connected to a live government service.',
  },
};

export const VEHICLE_CATALOG = [
  { id: 'veh-toyota-corolla-e170', make: 'Toyota', model: 'Corolla', generation: 'E170', years: [2014, 2019], markets: ['AE', 'GB'], driveSides: ['left', 'right'], wmi: ['JTD', 'AHT'], chassisPrefixes: ['NRE170', 'ZRE172'], aliases: ['Corolla E170', 'Corolla 2017', 'Corolla 2018'] },
  { id: 'veh-toyota-camry-xv70', make: 'Toyota', model: 'Camry', generation: 'XV70', years: [2018, 2023], markets: ['AE', 'GB'], driveSides: ['left', 'right'], wmi: ['JTN'], chassisPrefixes: ['AXVA70'], aliases: ['Camry XV70'] },
  { id: 'veh-kia-picanto-ja', make: 'Kia', model: 'Picanto', generation: 'JA', years: [2017, 2024], markets: ['AE', 'GB'], driveSides: ['left', 'right'], wmi: ['KNAB', 'KNA'], chassisPrefixes: ['JA'], aliases: ['Picanto JA', 'Picanto 2018'] },
  { id: 'veh-vw-golf-mk7', make: 'Volkswagen', model: 'Golf', generation: 'Mk7', years: [2013, 2020], markets: ['GB', 'AE'], driveSides: ['left', 'right'], wmi: ['WVW'], chassisPrefixes: ['AU'], aliases: ['Golf Mk7', 'Golf 2017'] },
  { id: 'veh-suzuki-swift-zc', make: 'Suzuki', model: 'Swift', generation: 'ZC', years: [2017, 2023], markets: ['GB', 'AE'], driveSides: ['left', 'right'], wmi: ['JS'], chassisPrefixes: ['ZC13S', 'ZC83S'], aliases: ['Swift 2018', 'Swift ZC'] },
  { id: 'veh-hyundai-i10-pa', make: 'Hyundai', model: 'i10', generation: 'PA', years: [2008, 2013], markets: ['AE', 'GB'], driveSides: ['left', 'right'], wmi: ['KMH'], chassisPrefixes: ['PA'], aliases: ['i10 PA'] },
];

export const PART_CROSSWALK = [
  { normalized: '87910-02A10', aliases: ['8791002A10', '87910 02A10'], manufacturer: 'Toyota', partType: 'Side-view mirror', vehicles: ['veh-toyota-corolla-e170'], side: 'right', connector: '6-pin', markets: ['AE', 'GB'] },
  { normalized: '87940-02A10', aliases: ['8794002A10', '87940 02A10'], manufacturer: 'Toyota', partType: 'Side-view mirror', vehicles: ['veh-toyota-corolla-e170'], side: 'left', connector: '6-pin', markets: ['AE', 'GB'] },
  { normalized: '87610-G6000', aliases: ['87610G6000'], manufacturer: 'Kia', partType: 'Side-view mirror', vehicles: ['veh-kia-picanto-ja'], side: 'left', connector: '5-pin', markets: ['AE', 'GB'] },
  { normalized: '5G1857507', aliases: ['5G1 857 507'], manufacturer: 'Volkswagen', partType: 'Side-view mirror', vehicles: ['veh-vw-golf-mk7'], side: 'left', connector: '8-pin', markets: ['GB', 'AE'] },
  { normalized: '84701-68P00', aliases: ['8470168P00'], manufacturer: 'Suzuki', partType: 'Side-view mirror', vehicles: ['veh-suzuki-swift-zc'], side: 'right', connector: '5-pin', markets: ['GB', 'AE'] },
];

const FX = { 'AED:GBP': 0.214, 'GBP:AED': 4.67, 'AED:AED': 1, 'GBP:GBP': 1 };
const now = () => new Date().toISOString();

export function normalizeIdentifier(value, kind = 'auto') {
  const raw = String(value || '').trim().toUpperCase();
  const compact = raw.replace(/[\s-]+/g, '');
  if (!compact) return { valid: false, kind, raw, normalized: '', reason: 'Enter a VIN, chassis number, registration, or part number.' };
  if (kind === 'vin' || (kind === 'auto' && compact.length === 17 && /^[A-Z0-9]+$/.test(compact))) {
    const validChars = !/[IOQ]/.test(compact);
    return { valid: compact.length === 17 && validChars, kind: 'vin', raw, normalized: compact, reason: compact.length !== 17 ? 'VINs are normally 17 characters.' : !validChars ? 'VINs cannot contain I, O or Q.' : '' };
  }
  if (kind === 'registration') return { valid: /^[A-Z0-9]{2,10}$/.test(compact), kind, raw, normalized: compact, reason: 'Registration formats vary by country; use it as a search hint, not proof of identity.' };
  if (kind === 'part_number' || (kind === 'auto' && /\d/.test(compact) && compact.length >= 5 && compact.length <= 16)) return { valid: compact.length >= 4, kind: 'part_number', raw, normalized: compact, reason: '' };
  return { valid: compact.length >= 3, kind: 'chassis', raw, normalized: compact, reason: 'Chassis prefix lookup is local and coverage-limited; confirm against the donor documents.' };
}

function yearFromVin(vin) {
  const map = { A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017, J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025, T: 2026 };
  return map[vin[9]] || null;
}
function wmiMatches(vin, vehicle) { return vehicle.wmi.some(prefix => vin.startsWith(prefix)); }
function prefixMatches(identifier, vehicle) { return vehicle.chassisPrefixes.some(prefix => identifier.startsWith(prefix)); }

export function resolveIdentity(input, region = 'AE') {
  const parsed = normalizeIdentifier(input.identifier || input.value, input.kind || 'auto');
  if (!parsed.valid) return { parsed, candidates: [], confidence: 0, status: 'invalid', explanation: parsed.reason };
  if (parsed.kind === 'part_number') {
    const key = parsed.normalized;
    const matches = PART_CROSSWALK.filter(part => part.normalized.replace(/[- ]/g, '') === key || part.aliases.some(alias => alias.replace(/[- ]/g, '') === key));
    const candidates = matches.map(part => ({ ...part, candidateId: part.normalized, vehicleRecords: part.vehicles.map(id => VEHICLE_CATALOG.find(v => v.id === id)).filter(Boolean), marketMatch: part.markets.includes(region) }));
    return { parsed, status: candidates.length ? 'candidate_supported' : 'unverified', confidence: candidates.length ? 0.96 : 0, candidates, explanation: candidates.length ? 'Exact local crosswalk candidate. Confirm side, connector and label photo before publishing.' : 'No exact local crosswalk match. This is not proof the part is incompatible.' };
  }
  const candidates = VEHICLE_CATALOG.map(vehicle => {
    let score = 0;
    if (parsed.kind === 'vin' && wmiMatches(parsed.normalized, vehicle)) score += 0.55;
    if (parsed.kind !== 'vin' && prefixMatches(parsed.normalized, vehicle)) score += 0.6;
    if (input.make && vehicle.make.toLowerCase() === String(input.make).toLowerCase()) score += 0.2;
    if (input.model && vehicle.model.toLowerCase() === String(input.model).toLowerCase()) score += 0.2;
    const year = parsed.kind === 'vin' ? yearFromVin(parsed.normalized) : Number(input.year) || null;
    if (year && year >= vehicle.years[0] && year <= vehicle.years[1]) score += 0.15;
    if (vehicle.markets.includes(region)) score += 0.05;
    return { ...vehicle, inferredYear: year, confidence: Math.min(0.99, Number(score.toFixed(2))), matchReasons: [score >= 0.55 ? 'identifier prefix matched' : null, year ? `model year ${year} considered` : null, vehicle.markets.includes(region) ? `${region} market catalog coverage` : null].filter(Boolean) };
  }).filter(v => v.confidence >= 0.55).sort((a, b) => b.confidence - a.confidence);
  return { parsed, status: candidates.length ? 'candidate_supported' : 'unverified', confidence: candidates[0]?.confidence || 0, candidates, explanation: candidates.length ? 'Local catalog candidate only. Validate the VIN/chassis against donor documents and the physical label.' : 'No local candidate. Ask for a clearer chassis/VIN, donor document, make/model/year and market.' };
}

export function normalizePartNumber(value) {
  const parsed = normalizeIdentifier(value, 'part_number');
  const crosswalk = PART_CROSSWALK.find(part => part.normalized.replace(/[- ]/g, '') === parsed.normalized);
  return { ...parsed, canonical: crosswalk?.normalized || parsed.raw.trim().toUpperCase().replace(/\s+/g, ' '), crosswalk: crosswalk || null, warning: 'O/0 and I/1 are preserved; do not auto-correct ambiguous characters without label evidence.' };
}

export function regionProfile(code) { return REGION_PROFILES[String(code || 'AE').toUpperCase()] || REGION_PROFILES.AE; }
export function convertCurrency(amount, from = 'AED', to = 'GBP') { const rate = FX[`${from}:${to}`] || 1; return { amount: Number((Number(amount || 0) * rate).toFixed(2)), from, to, rate, asOf: now(), source: 'local demo FX table; refresh with an approved provider before a transaction' }; }

export function calculateTradeQuote({ value = 0, currency = 'AED', lengthCm = 40, widthCm = 30, heightCm = 20, weightKg = 2, from = 'AE', to = 'GB' } = {}) {
  const origin = regionProfile(from), destination = regionProfile(to);
  const volumetricWeight = Math.max(Number(weightKg) || 0, (Number(lengthCm) * Number(widthCm) * Number(heightCm)) / 5000);
  const distanceBand = from === to ? 1 : 2;
  const shipping = 42 * distanceBand + volumetricWeight * 9;
  const converted = convertCurrency(value, currency, destination.currency);
  const shippingConverted = convertCurrency(shipping, 'AED', destination.currency);
  const dutyBase = converted.amount + shippingConverted.amount;
  const estimatedImport = Number((dutyBase * (to === 'GB' ? 0.2 : 0.05)).toFixed(2));
  const total = Number((dutyBase + estimatedImport).toFixed(2));
  return { origin, destination, inputValue: Number(value), inputCurrency: currency, volumetricWeightKg: Number(volumetricWeight.toFixed(2)), estimatedShipping: shippingConverted, estimatedImportTaxes: { amount: estimatedImport, currency: destination.currency, rate: to === 'GB' ? 0.2 : 0.05, label: to === 'GB' ? 'Planning allowance for UK import VAT/duty; actual commodity code required.' : 'Planning allowance for destination taxes; verify actual UAE treatment.' }, estimatedLandedCost: { amount: total, currency: destination.currency }, assumptions: ['Demo lane estimate, not a carrier quote.', 'Commodity/HS code, origin, importer status, VAT registration, restricted-goods status and insurance can change the result.', 'Confirm dimensions and packaged weight before accepting a buyer quote.'], calculatedAt: now() };
}

export function complianceAssessment({ part = {}, from = 'AE', to = 'GB' } = {}) {
  const origin = regionProfile(from), destination = regionProfile(to);
  const fields = part.fields || {};
  const value = key => fields[key]?.value ?? part[key] ?? null;
  const rules = [
    { id: 'IDENTITY', label: 'Part identity and identifier evidence', status: value('part_number') ? 'review' : 'blocked', action: value('part_number') ? 'Retain the readable identifier photo and confirm the canonical number.' : 'Capture a clear part-number/chassis label or explicitly mark it unavailable.' },
    { id: 'ORIGIN', label: 'Country of origin / donor provenance', status: value('donor_make') && value('donor_year') ? 'review' : 'blocked', action: 'Record donor vehicle evidence and country of origin; donor facts do not prove compatibility.' },
    { id: 'PACKAGING', label: 'Packaged dimensions and weight', status: value('weight_kg') && value('length_cm') && value('width_cm') && value('height_cm') ? 'ready' : 'blocked', action: 'Measure the packed item, not only the bare part.' },
    { id: 'CONDITION', label: 'Used condition, defects and testing disclosure', status: value('defect_notes') && value('testing_status') ? 'review' : 'blocked', action: 'Disclose visible defects and testing limitations in the buyer-facing draft.' },
    { id: 'HAZMAT', label: 'Restricted or safety-critical screening', status: /airbag|battery|hazard|brake|safety/i.test(`${value('part_type') || ''} ${part.scenario || ''}`) ? 'blocked' : 'review', action: 'Do not ship until a specialist confirms carrier acceptance and applicable restrictions.' },
    { id: 'LANE', label: `${origin.code} → ${destination.code} trade-lane review`, status: 'review', action: `${origin.taxNote} ${destination.taxNote}` },
  ];
  return { origin, destination, rules, status: rules.some(r => r.status === 'blocked') ? 'blocked' : 'review', disclaimer: 'This is an operational readiness aid, not customs clearance, legal advice, tax advice or carrier acceptance.' };
}

const GLOSSARY = {
  'mirror': 'مرآة', 'side-view mirror': 'مرآة جانبية', 'left': 'يسار', 'right': 'يمين', 'used': 'مستعمل', 'untested': 'غير مختبر', 'not confirmed': 'غير مؤكد', 'damaged': 'متضرر', 'mounting tab': 'لسان التثبيت', 'connector': 'الموصل', 'condition': 'الحالة', 'testing': 'الاختبار', 'compatible': 'متوافق', 'donor vehicle': 'المركبة المانحة',
};
const reverseGlossary = Object.fromEntries(Object.entries(GLOSSARY).map(([en, ar]) => [ar, en]));
export function translateText(text, from = 'en', to = 'ar') {
  const source = String(text || '');
  if (from === to) return { source, translated: source, confidence: 1, reviewRequired: false, method: 'identity' };
  const map = from === 'en' && to === 'ar' ? GLOSSARY : reverseGlossary;
  let translated = source;
  let replacements = 0;
  for (const [key, value] of Object.entries(map)) { const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'gi'); if (re.test(translated)) { translated = translated.replace(re, value); replacements++; } }
  return { source, translated, confidence: replacements ? Math.min(0.8, 0.35 + replacements * 0.1) : 0.15, reviewRequired: true, method: 'reviewed technical glossary; untranslated prose remains unchanged', replacements, warning: 'Review the translated listing with a fluent operator before sending to a buyer.' };
}

export function scoreSearch(part, query, region = 'GB') {
  const fields = part.fields || {};
  const haystack = [part.stock_id, part.scenario, ...Object.values(fields).map(f => f?.value)].filter(Boolean).join(' ').toLowerCase();
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const normalizedPart = normalizePartNumber(query || '');
  let score = normalizedQuery ? (haystack.includes(normalizedQuery) ? 0.8 : 0) : 0.4;
  const crosswalk = normalizedPart.crosswalk;
  if (crosswalk && String(fields.part_number?.value || '').replace(/[- ]/g, '') === crosswalk.normalized.replace(/[- ]/g, '')) score = 1;
  if (fields.currency?.value && fields.currency.value !== regionProfile(region).currency) score -= 0.05;
  return { score: Math.max(0, Number(score.toFixed(2))), match: score >= 0.8 ? 'exact' : score >= 0.4 ? 'related' : 'weak' };
}

export function platformHash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
