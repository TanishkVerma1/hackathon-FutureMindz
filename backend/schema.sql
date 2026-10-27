PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY, stock_id TEXT UNIQUE NOT NULL, scenario TEXT NOT NULL DEFAULT '', batch TEXT NOT NULL DEFAULT 'imported',
  revision INTEGER NOT NULL DEFAULT 1, excluded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en', text TEXT NOT NULL DEFAULT '',
  asset_path TEXT, mime TEXT, sha256 TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0, approval_status TEXT NOT NULL DEFAULT 'not_recorded', approval_actor TEXT, approved_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assertions (
  id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, field_key TEXT NOT NULL, value_json TEXT NOT NULL,
  state TEXT NOT NULL, locator TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, confidence REAL NOT NULL DEFAULT 0,
  extraction_method TEXT NOT NULL DEFAULT 'unknown', model_version TEXT, source_span TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assertions_part_field ON assertions(part_id, field_key, active);
CREATE TABLE IF NOT EXISTS resolutions (
  id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL, value_json TEXT NOT NULL, reason TEXT NOT NULL, revision INTEGER NOT NULL,
  chosen_assertion_id TEXT, competing_assertion_ids_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  part_id TEXT PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
  generated_json TEXT NOT NULL, edits_json TEXT, validation_json TEXT NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS readiness_results (
  part_id TEXT PRIMARY KEY REFERENCES parts(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
  status TEXT NOT NULL, checklist_version TEXT NOT NULL, results_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL, status TEXT NOT NULL, acknowledged INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_part ON approvals(part_id, created_at);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, part_id TEXT REFERENCES parts(id) ON DELETE CASCADE, revision INTEGER,
  event TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS compatibility_reference (
  id TEXT PRIMARY KEY, part_number TEXT NOT NULL, manufacturer TEXT, side TEXT, connector TEXT,
  vehicle TEXT NOT NULL, authority TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL, markets_json TEXT NOT NULL DEFAULT '["AE","GB"]', drive_sides_json TEXT NOT NULL DEFAULT '["left","right"]'
);
CREATE TABLE IF NOT EXISTS checklist_versions (id TEXT PRIMARY KEY, version TEXT NOT NULL, config_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evaluation_measurements (
  id TEXT PRIMARY KEY, part_id TEXT REFERENCES parts(id) ON DELETE SET NULL, workflow TEXT NOT NULL,
  seconds REAL NOT NULL CHECK(seconds >= 0), populated INTEGER NOT NULL, correct INTEGER NOT NULL,
  expected_issues INTEGER NOT NULL, detected_issues INTEGER NOT NULL, false_positives INTEGER NOT NULL,
  expected_disclosures INTEGER NOT NULL, disclosed INTEGER NOT NULL, corrections INTEGER NOT NULL,
  notes TEXT NOT NULL, case_id TEXT, truth_set_version TEXT, extraction_mode TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS visual_inspections (
  id TEXT PRIMARY KEY, part_id TEXT REFERENCES parts(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES sources(id) ON DELETE CASCADE, example_id TEXT,
  revision INTEGER, source_hash TEXT NOT NULL, result_json TEXT NOT NULL, review_json TEXT NOT NULL DEFAULT '{}',
  original_path TEXT NOT NULL, overlay_path TEXT NOT NULL, heatmap_path TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visual_inspections_part ON visual_inspections(part_id);
CREATE TABLE IF NOT EXISTS question_outcomes (
  id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE, field_key TEXT NOT NULL,
  question_key TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS question_outcomes_part_field ON question_outcomes(part_id, field_key, question_key);
CREATE TABLE IF NOT EXISTS extraction_runs (
  id TEXT PRIMARY KEY, part_id TEXT REFERENCES parts(id) ON DELETE CASCADE, source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  mode TEXT NOT NULL, status TEXT NOT NULL, engine TEXT NOT NULL, version TEXT NOT NULL, source_hash TEXT,
  result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS extraction_runs_part ON extraction_runs(part_id, created_at);
CREATE TABLE IF NOT EXISTS evaluator_cases (
  id TEXT PRIMARY KEY, case_label TEXT NOT NULL, truth_set_version TEXT NOT NULL, truth_source TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evaluator_field_scores (
  id TEXT PRIMARY KEY, measurement_id TEXT NOT NULL REFERENCES evaluation_measurements(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL, expected_state TEXT NOT NULL, observed_state TEXT NOT NULL, correct INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vehicle_identities (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, identifier_kind TEXT NOT NULL, normalized TEXT NOT NULL,
  region TEXT NOT NULL, vehicle_json TEXT NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL,
  source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vehicle_identities_normalized ON vehicle_identities(normalized);
CREATE TABLE IF NOT EXISTS part_identity_links (
  id TEXT PRIMARY KEY, part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE, vehicle_id TEXT NOT NULL,
  identity_kind TEXT NOT NULL, identifier TEXT NOT NULL, normalized TEXT NOT NULL, confidence REAL NOT NULL,
  status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS part_identity_links_part ON part_identity_links(part_id);
CREATE TABLE IF NOT EXISTS buyer_inquiries (
  id TEXT PRIMARY KEY, part_id TEXT REFERENCES parts(id) ON DELETE SET NULL, buyer_label TEXT NOT NULL,
  region TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trade_quotes (
  id TEXT PRIMARY KEY, part_id TEXT REFERENCES parts(id) ON DELETE SET NULL, origin TEXT NOT NULL, destination TEXT NOT NULL,
  quote_json TEXT NOT NULL, assumptions_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS compliance_assessments (
  id TEXT PRIMARY KEY, part_id TEXT REFERENCES parts(id) ON DELETE SET NULL, origin TEXT NOT NULL, destination TEXT NOT NULL,
  assessment_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS translation_reviews (
  id TEXT PRIMARY KEY, part_id TEXT REFERENCES parts(id) ON DELETE SET NULL, source_language TEXT NOT NULL,
  target_language TEXT NOT NULL, source_text TEXT NOT NULL, translated_text TEXT NOT NULL, status TEXT NOT NULL,
  confidence REAL NOT NULL, created_at TEXT NOT NULL
);
