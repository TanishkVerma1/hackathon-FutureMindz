# Yardpass — offline salvage listing PoC

A cross-border salvage operations assistant built from the eBay case study. It organizes used-part evidence, resolves gaps/conflicts, adds vehicle/part identity resolution for VIN/chassis/registration/part-number clues, prepares editable drafts, supports buyer search and inquiry capture, provides a UAE↔UK trade-lane planning quote, runs an operational compliance checklist, and keeps approval with the seller. It remains deliberately honest: no live VIN provider, fitment guarantee, legal customs clearance, payment, carrier booking or production marketplace publication.

## What runs locally

- `frontend/`: React 19 + Vite interface with seller inventory, cross-border workspace (buyer search, identity resolution, trade lane, compliance, translation and inquiry queue), visual inspection, evaluation and database views; English/Arabic labels and light/dark themes.
- `backend/`: Express APIs and deterministic evidence/draft/checklist logic, local vehicle/part identity resolver, region profiles, buyer search/inquiries, trade quote, compliance assessment and review-required translation glossary.
- Database: SQLite through Node 24's built-in `node:sqlite`; actual relational tables and transactions.
- `models/tessdata/`: bundled English/Arabic Tesseract language files; local CPU OCR.
- `models/vision/`: local pretrained damage-segmentation ONNX graph and model/checkpoint metadata; CPU inference, no hosted endpoint.
- `datasets/`: 20 fictional records, 10 demo parts, synthetic OCR labels/CSV/notes/test references; separate `datasets/vision/` contains 24 actual mirror crops (largest, clearest Carparts-Seg annotations), 9 attributed redacted vehicle benchmarks and 26 real damage photos from 4 referenced repositories.
- `evaluation/answer-key.json`: separate evaluator truth, never loaded by application runtime or included in the Docker image.
- `#platform`: cross-border operating layer for UAE/UK identity clues, buyer search, inquiries, landed-cost planning, operational compliance and bilingual review.

**No external APIs at runtime.** No eBay API, hosted LLM, CDN/font requests or runtime model downloads. Package/model dependencies are acquired during initial setup/build only. Docker uses a normal project bridge for host-port compatibility; this is not a network firewall, but application requests remain local and browser CSP restricts connections to the same origin.

## Docker

Requirements: Docker Desktop with Linux containers. From this directory run `docker compose up -d --build`, then open **http://127.0.0.1:3000**.

- One non-root application container serves the compiled UI and backend.
- Named volume `hackathon_yardpass-data` (project name dependent) persists `/app/.local-data/yardpass.sqlite`, uploads and OCR cache.
- `docker compose ps` reports health; `docker compose logs --tail=30 app` shows startup/errors.
- `docker compose stop` stops the app without removing database data.
- Do not remove the named volume unless deliberately resetting all seller records.
- Local Windows `.local-data/yardpass.sqlite` and Docker-volume SQLite are separate stores, not live-synchronized copies.

## Native development

Tested runtime: Node `v24.14.1`, npm `11.11.0`. Use Node 24; the built-in SQLite API can emit an experimental warning on this version.

1. `npm ci`
2. `npm run setup` — creates fictional fixtures/labels and copies package-supplied OCR weights. It does not reset an existing database.
3. `npm run dev` — frontend http://127.0.0.1:5173, backend http://127.0.0.1:3000.

If Docker is already using port 3000, stop this project's container first or use the production Docker app. For a native production-style run, execute `npm run build`, then `npm start` and open http://127.0.0.1:3000.

Environment variables: `PORT`, `HOST`, `DATA_DIR`, `OCR_TIMEOUT_MS`. No key or secret is required. `.env.example` documents defaults; the Node entry does not automatically load `.env`, so set environment variables in your shell or Docker environment when overriding them.

### Reset the synthetic demo

Use **Database & data → Reset synthetic demo**, confirm the exact phrase in the UI, or call `POST /api/demo/reset` with `{ "confirm": "RESET_DEMO_DATA" }`. This deletes local seller uploads, inquiries, measurements, identity links and approvals, then restores the 20-record/10-demo synthetic pack. Docker reset requires the same action inside the running app; do not remove the named volume unless you intentionally want a complete database reset.

## Expanded operating journey

1. Open **Cross-border workspace** (`#platform`) and choose **Vehicle identity**. Try `87910-02A10` as a local part-number crosswalk candidate, or enter a VIN/chassis clue; ambiguous identifiers remain candidates and are never silently treated as fitment.
2. Use **Find a part** with a stock ID, donor make/model or identifier, then create a buyer inquiry. The seller receives an inquiry tied to a current record; no reservation/payment is implied.
3. Use **Trade lane** for the UAE → UK planning estimate. It converts AED/GBP, accounts for volumetric weight and shows assumptions plus an operational readiness checklist. It is not a carrier quote, tax decision or customs clearance.
4. Use **Bilingual copy** to translate reviewed technical terms into Arabic/English. Untranslated prose stays visible and the result is marked for human review.
5. Open **Inventory**, default **Demo batch** (ten parts).
2. Open `DEMO-01`, inspect sources, run local OCR on the synthetic label, review the draft/checklist, acknowledge limitations and approve the exact local revision.
3. Open `DEMO-02`: spreadsheet donor year 2017 conflicts with donor note 2018; identifier unreadable, possible tab damage, no test record and missing packaged weight are exposed.
4. Confirm donor year using the fixture note, confirm tab condition, select explicitly untested if appropriate and supply a measured fixture packaged weight with a reason.
5. Observe inventory/draft/checklist update together; compatibility stays unverified without a supported exact reference.
6. Try changing the draft to hide damage or claim full function/guaranteed fit. Edits are held and prior approval invalidated. Restore the evidence template or correct supported inventory facts.
7. Open **Evaluation**: all five rubric weights and real observation entry; initially business results say **Not measured**.
8. Open **Database & data**: live SQLite table counts and reference/dataset limitations.

No draft is published, no shipment booked and no authenticity/fitment/function/clearance certification is provided.

## Real inputs

- CSV: `stock_id` required; supported fields shown in the downloadable sample and `backend/domain.mjs`. IDs stay strings; duplicate stock IDs are rejected. Preview before import.
- Import 1–20 rows at a time; local total limit 120 records. Twenty seeded records exist initially.
- Upload approved/anonymised JPEG/PNG images, max 8 MB and four images per part.
- Attach English/Arabic typed notes, max 20,000 characters.
- Local OCR handles printed text; worn/blurred identifiers and Arabic handwriting are not guaranteed. Manually confirm critical transcriptions.
- Note parser supports explicit key:value fields plus a small reviewed English/Arabic phrase mapping. It is not a general-purpose translation or reasoning LLM.
- Defect identification is source/seller-led; no trained visual mounting-tab detector is claimed.
- Missing fields are unknown; no part-number completion or appearance-based fitment.

## Database design

Schema: `backend/schema.sql`.

Tables: `parts`, `sources`, `assertions`, `resolutions`, `drafts`, `readiness_results`, `approvals`, `audit_events`, `compatibility_reference`, `checklist_versions`, `evaluation_measurements`, `schema_migrations`, `visual_inspections`, `vehicle_identities`, `part_identity_links`, `buyer_inquiries`, `trade_quotes`, `compliance_assessments`, `translation_reviews`, `question_outcomes`, `extraction_runs`, `evaluator_cases`, and `evaluator_field_scores`. Assertions retain confidence, extraction method and source span; sources retain approval/anonymisation status; visual inspections persist original/model hashes, mask/heatmap paths, pending regions and seller decisions.

- Unique stock IDs, foreign keys and parameterized statements.
- WAL mode and `BEGIN IMMEDIATE` transactions.
- A correction records a seller assertion, supersedes old active values without deleting history, increments revision, updates draft/readiness and invalidates approval atomically.
- Late OCR/stale edits cannot overwrite a newer revision.
- Approval records the exact content hash/revision and explicit acknowledgment.
- Images are files linked through source IDs; no arbitrary filesystem paths are exposed.
- Trusted single-operator local deployment; not a public multi-tenant system.

## Data/repository decisions

The complete supplied `GitHub_Repos_Reference.docx` was reviewed. Tesseract is the lightweight selected engine family; Tesseract.js runs its local WASM engine with package-bundled `eng`/`ara` data.

The later asset audit followed nested files and the actual `master` branch, not only repository summaries:

- Brachingo’s `configs/carparts-seg.yaml` links the Ultralytics Carparts-Seg archive. **12 actual mirror photographs** were cropped using its original part polygons; crop geometry, source-image IDs and attribution are retained.
- `cloudwhynot/car-damage-detection-yolo` supplies **four real vehicle demo photographs** and the checksum-verified damage checkpoint. Its Git LFS file was resolved to actual weights, not treated as a 133-byte model.
- The pretrained **YOLO26m segmentation CNN** was exported once to `models/vision/damage.onnx` (approximately 94 MB). The deployed app uses **ONNX Runtime CPU**; no Python/PyTorch service, model training, GPU or remote inference is required.
- Dataset documentation displays a CC BY 4.0 badge, but the archive has no separate image-license file. The model repository’s MIT notice and Ultralytics license are retained. These declarations are not independent certification of underlying image/training-data rights: review attribution, derivative-model and redistribution obligations before public/commercial release.
- Vehicle preview images are metadata-stripped and visible plate regions blurred where present. Whole-car benchmarks remain separate from the ten-mirror listing scope.
- No assets were imported from amelia-ng or the unlicensed/unclear checkpoints in other references.

## Visual inspection: real photos, model masks and heatmaps

Open **Visual inspection** in the sidebar, or **http://127.0.0.1:3000/#vision**.

1. Select a real mirror crop, vehicle benchmark or damage photo from any of the four referenced repositories (filter buttons per source; thumbnails carry cached detection badges from the last execution report). Start with `Kia Picanto 2` or an `MRCharles SG` photo to see positive model suggestions.
2. Click **Run damage inspection**. This executes the local CNN on the selected image; results are not replayed or manually painted.
3. Switch between **Original**, **Damage masks**, and **Heatmap**. The heatmap is the model’s segmentation activation weighted by detection score. It is **not Grad-CAM**, a calibrated probability map, or damage severity.
4. Model classes are `dent`, `scratch`, `crack`, `glass shatter`, `lamp broken`, and `tire flat`. Boxes, class scores, inference time, photo/model hashes and limitations are visible.
5. Mirror crops have no damage labels; their original dataset masks identify the mirror part, not defects. That annotation is explicitly separated from predicted damage.
6. Choose **Open reference record** for a mirror crop to inspect it inside a separate source-linked record with donor/identifier/condition unknown. It is not presented as Noor’s real stock.
7. Upload your approved/anonymised photo in the standalone viewer, or attach it to a stock record and click **Inspect damage regions** in its evidence panel.
8. Positive stock findings block approval until each is confirmed or rejected by the seller. Confirmed findings create source-linked seller condition assertions and update draft/readiness; rejected findings remain in history. No detection never marks a part functional or damage-free.

The general vehicle-damage model is **not validated for detached mirrors or broken mounting tabs**. This limitation is shown in the app. Whole-vehicle benchmark detections demonstrate localization without falsely claiming a dedicated mirror-fault model.

### Vision assets and reproduction

- `datasets/vision/images.json`: 24 real mirror crops (largest/clearest annotations), 9 redacted benchmark images and 26 real damage photos from umerforsure, MRCHARLESSG, MEHULCODE12 and ShivanshGupta-25, all with provenance and per-source groups.
- `datasets/vision/cloudwhynot-LICENSE.txt`, `ultralytics-LICENSE.txt`: retained source/derivative license notices.
- `models/vision/manifest.json`: actual six-class mapping, input/output shapes and model/checkpoint SHA-256 hashes.
- `backend/vision.mjs`: preprocessing, CPU inference, class-aware NMS, prototype-mask decoding, overlays and the 60-second inspection timeout.
- `visual_inspections`: SQLite results, source hashes, per-region seller review and artifact paths.

The prepared images and ONNX model are already local. Docker/native runtime does not need the one-time Python export environment. To reacquire/re-export, use the existing `scripts/download-vision-assets.mjs`, the additional `scripts/download-extra-damage-images.mjs` (extra repo damage photos), isolated `scripts/vision-export-requirements.txt`, `scripts/export-vision-model.py` and `scripts/prepare-mirror-images.py`; these are **setup-only** and require network access/download permissions. `npm run setup` regenerates synthetic records and OCR assets, not the CNN checkpoint. Do not run arbitrary commands copied from external repositories.

`datasets/manifest.json` records decisions and limitations. Stock-label images are synthetic test artwork, **not real product photos**. Compatibility entries and checklist are **demo-only**, not official eBay metadata or real vehicle fitment. Organizer-approved data/checklist should replace them for a pilot.

## Validation

- `npm test`: domain/SQLite/API regressions, including normal/difficult cases and stale approval/extraction.
- `npm run build`: production frontend build.
- `npx playwright test`: browser journeys against a separate fresh test database on port 3101. Requires locally installed Chrome; browser-test dependency is in the lockfile. For another installed browser, adjust `playwright.config.mjs` explicitly.
- Browser tests capture screenshots in `.local-data/screenshots/` and assert no external requests in the main journey. They never change Docker's demo database.
- Evaluation measurements are entered by a reviewer with actual timings/counts, explicit case ID, evaluator-owned truth-set version, and manual/replay extraction mode. The runtime never loads `evaluation/answer-key.json`; denominators must come from the separate evaluator truth source. Automated test counts are not commercial outcome metrics.

Validation completed on 27 October 2026 (updated after library expansion):

- Production build passed; **21 domain/database/API/vision/platform tests** and **five browser journeys** passed. Tests include actual local OCR/CNN inference, real-photo masks/heatmaps, source-linked seller review, stale approval handling, identity selection, reset/reseed, evaluator metadata, CSV/RTL/dark/mobile behavior and no external application requests in tested journeys.
- Docker is healthy at http://127.0.0.1:3000. A real `Kia Picanto 2` image produced three provisional damage regions in **1,358 ms** through the container API; original, overlay and heatmap returned valid PNGs. Its result remained available after rebuilding the container with the same volume.
- `node scripts/validate-vision.mjs` checked all **59 real referenced images**, their model checksum and artifact geometry. **23 of 59** produced at least one provisional region at the 0.35 threshold (mean ≈ 746 ms per image): all 35 regions came from whole-vehicle damage photos (cloudwhynot benchmarks, umerforsure samples and the newly added MRCharles SG / Mehul photos). The 24 mirror crops produced no model output at any threshold — a disclosed model limitation, not a hidden failure; the inspection UI shows sub-threshold raw scores where the model has any signal. These are execution observations, not accuracy or clean-condition claims.
- The detailed report is `evaluation/vision-smoke-results.json`. There are no independent expert damage labels for these examples, and original model training overlap is unknown, so precision/recall, IoU and held-out generalization are **not** claimed.
- The original `DEMO-02` stock record remains at revision 1, unapproved, with its donor-year conflict intact. Automated tests use separate databases; commercial preparation benefits remain unmeasured.

## Rubric focus

| Criterion | Weight | Implemented focus |
|---|---:|---|
| Business relevance/value | 30% | Preparation workflow, stopwatch and actual manual/assisted measurement capture |
| AI quality/evidence | 25% | Local OCR/CNN masks and heatmaps, source-linked findings, seller region review, uncertainty and conflict preservation |
| Working prototype | 20% | Import-to-review path, hard case, persistence, stale-edit handling |
| Seller experience | 15% | Bilingual labels/questions, clear source workspace, correct-once updates |
| Responsible design/scalability | 10% | Offline processing, seller approval, honest data/model limits and reproducible Docker |

## Cross-border boundaries and future pilot

- Vehicle identity resolution uses a local synthetic catalog and format checks. It does not call a live VIN decoder, registration authority, OEM catalog or eBay compatibility API; candidates require seller confirmation.
- UAE/UK support is an explicit operating model: market aliases, drive-side context, AED/GBP conversion, volumetric weight, planning taxes and operational readiness are surfaced. Actual VAT, duty, HS/commodity code, importer status, carrier acceptance and customs documents require an approved provider and human/legal review.
- Buyer search and inquiry capture are local workflow simulations. There is no payment, reservation, production publication, live marketplace sync, shipment booking or buyer identity system.
- No hosted/generative LLM; drafting is evidence-grounded templates and local rules.
- Arbitrary edited prose is conservatively held; there is no universal semantic fact verifier.
- No independently validated real fitment dataset or dedicated detached-mirror/mounting-tab damage model. General vehicle-damage segmentation runs locally and has false positives/missed defects; seller review is mandatory.
- English/Arabic UI and limited phrase extraction, not unrestricted Arabic translation or guaranteed handwriting OCR.
- CSV supported; direct XLSX deferred.
- No production integration, clearance assessment, shipment booking or buyer checkout.
- No measured time savings until a fair manual/assisted study is run.
- Domain/Arabic review, approved real records, licensed references, authentication and broader evaluation are needed before a real pilot.

Requirements: `BRD.md`, `PRD.md`, `TRD.md` and `EBAY_HACKATHON_REQUIREMENTS_AND_RESEARCH.md`. Their top offline-update blocks supersede older hosted-model/JSON-store proposals retained for history.
