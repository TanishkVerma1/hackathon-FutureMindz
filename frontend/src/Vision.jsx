import React, { useEffect, useState } from 'react';
import { IconScan, IconPhoto, IconAlertTriangle, IconCheck, IconUpload, IconArrowUpRight, IconShieldCheck, IconLayersLinked, IconGauge } from '@tabler/icons-react';
import { api, navigate } from './api.js';
import { ErrorBox } from './App.jsx';

export function InspectionResult({ run, compact = false }) {
  const [view, setView] = useState('overlay');
  if (!run) return null;
  const result = run.result;
  const imageUrl = view === 'heatmap' ? run.heatmapUrl : view === 'original' ? run.originalUrl : run.overlayUrl;
  return <section className={`inspection-result ${compact ? 'compact-inspection' : ''}`}>
    <div className="section-heading"><div><h3>Model-derived visual result</h3><p>{result.engine} / {result.elapsedMs} ms / threshold {Math.round(result.threshold * 100)}%</p></div><span className="subtle-tag">{result.detections.length} predictions</span></div>
    <div className="vision-view-switch" role="group" aria-label="Visual inspection view">{[['original', 'Original'], ['overlay', 'Damage masks'], ['heatmap', 'Heatmap']].map(([key, label]) => <button key={key} className={view === key ? 'selected' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
    <img className="inspection-image" src={imageUrl} alt={view === 'heatmap' ? 'Local CNN score-weighted segmentation activation overlay, not confirmed damage' : view === 'overlay' ? 'Local CNN predicted masks and labelled damage regions' : 'Original inspected photograph'} />
    {view === 'heatmap' && <div className="heatmap-legend"><span className="heatmap-ramp" /><span>Lower → higher mask activation × detection score</span></div>}
    <p className="helper">{result.visualization}. Colors are not calibrated severity, electrical condition or repair cost.</p>
    <div className={`vision-notice ${result.detections.length ? 'has-findings' : ''}`}><IconAlertTriangle size={17} /><p>{result.notice}</p></div>
    {result.detections.length > 0 ? <div className="detected-regions">{result.detections.map(d => <div className="detected-region" key={d.id}><span className="region-color" style={{ backgroundColor: `rgb(${d.color.join(',')})` }} /><div><strong>{d.label}</strong><small>Region {d.id} / box [{d.box.join(', ')}]</small></div><span className="model-score">{Math.round(d.score * 100)}%<small>model score</small></span><span className="subtle-tag">{run.review?.[d.id]?.status || 'Needs seller review'}</span></div>)}</div> : <><p className="helper">No regions met the selected threshold. Small, low-resolution, detached or out-of-domain parts can be missed. Continue physical inspection.</p>
      {result.weakDetections?.length > 0 && <div className="weak-regions"><h4><IconGauge size={15} /> Sub-threshold model output (informational, never findings)</h4>{result.weakDetections.map((d, i) => <div className="detected-region weak" key={i}><span className="region-color" style={{ backgroundColor: `rgb(${d.classId === 0 ? '239,100,54' : d.classId === 1 ? '36,160,220' : d.classId === 4 ? '245,174,50' : '164,104,234'})` }} /><div><strong>{d.label}</strong><small>{Math.round(d.score * 100)}% — below the selected threshold</small></div></div>)}<p className="helper">These are the model’s strongest raw scores under your threshold. Lowering the threshold surfaces them as reviewable predictions; a higher threshold suppresses them. No threshold proves a damage-free part.</p></div>}</>}
    <details><summary>Model and source traceability</summary><p className="helper">{result.modelRole}</p><p className="hash-text mono">Checkpoint SHA-256: {result.checkpointSha256}</p><p className="hash-text mono">Photo SHA-256: {result.sourceHash}</p><p className="helper">Input size {result.inputSize}px; original {result.imageDimensions.join(' × ')}px. No hosted inference.</p></details>
  </section>;
}
function ReviewFindings({ run, part, onUpdated }) {
  const [decisions, setDecisions] = useState({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = run.result.detections.filter(d => !run.review[d.id]);
  if (!pending.length) return <p className="helper success-text"><IconCheck size={14} /> All regions in this run have recorded seller review.</p>;
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const selected = pending.filter(d => decisions[d.id]).map(d => ({ id: d.id, status: decisions[d.id] })); const updated = await api(`/parts/${part.id}/vision/${run.id}/review`, { method: 'POST', body: { expectedRevision: part.revision, decisions: selected, reason } }); await onUpdated(updated); setDecisions({}); setReason(''); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <form className="visual-review-form" onSubmit={submit}><h3><IconShieldCheck size={17} /> Review against the actual photo</h3><p className="helper">Only explicit confirmation becomes a seller-reported condition assertion. Rejected predictions remain in history; unreviewed regions block approval.</p><ErrorBox message={error} />{pending.map(d => <label className="field-label" key={d.id}>{d.label} / region {d.id}<select value={decisions[d.id] || ''} onChange={e => setDecisions({ ...decisions, [d.id]: e.target.value })}><option value="">Not reviewed</option><option value="confirmed">I confirm this visible defect</option><option value="rejected">I reject this model prediction</option></select></label>)}<label className="field-label">Review evidence / reason<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={4000} required rows={3} placeholder="Describe the visible evidence or why this is a false positive." /></label><button className="button primary" disabled={busy || reason.trim().length < 3 || !pending.some(d => decisions[d.id])}><IconCheck size={16} />{busy ? 'Saving review…' : 'Save region review'}</button></form>;
}
export function StockVision({ part, sourceId, onUpdated, lang = 'en', disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = part.visualInspections?.find(r => r.source_id === sourceId);
  const inspect = async () => {
    setBusy(true); setError('');
    try { const updated = await api(`/parts/${part.id}/vision`, { method: 'POST', body: { expectedRevision: part.revision, sourceId, threshold: 0.35 } }); await onUpdated(updated); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="stock-vision"><div className="section-heading"><h3><IconScan size={18} />{lang === 'ar' ? 'فحص بصري محلي' : 'Local visual inspection'}</h3><span className="subtle-tag">CNN / CPU</span></div><p className="helper">Predict visible damage regions from this photo. Not functionality or fitment. Detached-mirror accuracy is not validated.</p><ErrorBox message={error} /><button className="button secondary" disabled={!sourceId || disabled || busy || Boolean(run?.result.detections.some(d => !run.review[d.id]))} onClick={inspect}><IconScan size={17} />{busy ? 'Inspecting locally…' : lang === 'ar' ? 'فحص مناطق الضرر' : 'Inspect damage regions'}</button>{!sourceId && <p className="helper">Select a photo source to inspect.</p>}{run && <><InspectionResult key={run.id} run={run} compact />{run.result.detections.length > 0 && <ReviewFindings key={run.id} run={run} part={part} onUpdated={onUpdated} />}</>}</section>;
}
export default function Vision({ lang = 'en', onRecordAdded }) {
  const [config, setConfig] = useState(null);
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState('kia_picanto_2');
  const [filter, setFilter] = useState('all');
  const [threshold, setThreshold] = useState(0.35);
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [approved, setApproved] = useState(false);
  const [uploadedExample, setUploadedExample] = useState(null);
  useEffect(() => { api('/vision/config').then(setConfig).catch(e => setError(e.message)); api('/vision/summary').then(setSummary).catch(() => setSummary(null)); }, []);
  const examples = config?.dataset.examples || [];
  const groups = config?.dataset.sample_groups || [];
  const example = uploadedExample || examples.find(x => x.id === selected);
  const shown = examples.filter(x => filter === 'all' || x.kind === filter || x.group === filter);
  const summaryRow = id => summary?.execution?.results?.find(r => r.exampleId === id);
  const inspect = async (atThreshold = threshold) => {
    if (!example?.id) return;
    setBusy(true); setError('');
    try { const data = await api(`/vision/examples/${example.id}/inspect`, { method: 'POST', body: { threshold: atThreshold } }); setRun(data.inspection); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const upload = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const body = new FormData(); body.append('image', file); body.append('approved', String(approved)); body.append('threshold', threshold); const data = await api('/vision/upload', { method: 'POST', body }); setRun(data.inspection); setUploadedExample(data.example); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const addRecord = async () => {
    setBusy(true); setError('');
    try { const p = await api(`/vision/examples/${example.id}/record`, { method: 'POST', body: {} }); await onRecordAdded(); navigate('part', p.id); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <><header className="page-header"><div><h1>{lang === 'ar' ? 'شاهد الصورة، وافحص مناطق الضرر.' : 'Inspect the image. Locate the damage.'}</h1><p>Real images from your reference links, a local pretrained CNN, and transparent model-derived overlays.</p></div><span className="subtle-tag"><IconScan size={16} />Offline ONNX / CPU</span></header><ErrorBox message={error} clear={() => setError('')} />
    <section className="vision-intro"><div><IconPhoto size={22} /><strong>{config?.dataset.mirror_crops || 0} real mirror crops</strong><span>Cropped from the Carparts-Seg archive</span></div><div><IconLayersLinked size={22} /><strong>{(config?.dataset.damage_benchmarks || 0) + (config?.dataset.damage_samples || 0)} real damage photos</strong><span>cloudwhynot, umerforsure, MRCharles SG, Mehul & Shivansh repositories</span></div><div><IconShieldCheck size={22} /><strong>{summary?.execution ? `${summary.execution.imagesWithDetections} / ${summary.library.total} images show model output` : 'Predictions stay provisional'}</strong><span>{summary?.execution ? `At ${Math.round(summary.execution.threshold * 100)}% threshold; mean ${summary.execution.meanMs} ms local inference` : 'Seller review, not automated certification'}</span></div></section>
    {!config?.model.available && config && <div className="vision-notice"><IconAlertTriangle size={18} /><p>Local vision model is unavailable. Prepare the ONNX model before inspection; no online fallback is used.</p></div>}
    <div className="vision-layout"><aside className="vision-library"><div className="pane-heading"><h2>Reference image library</h2><span>{shown.length} of {examples.length} images</span></div><div className="vision-library-filter"><select aria-label="Reference image type" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All reference images</option><option value="mirror_crop">Real mirror crops ({config?.dataset.mirror_crops || 0})</option><option value="damage_benchmark">Vehicle benchmarks ({config?.dataset.damage_benchmarks || 0})</option>{groups.map(g => <option key={g.group} value={g.group}>{g.label} ({g.count})</option>)}</select></div><div className="vision-thumbnails">{shown.map(image => { const row = summaryRow(image.id); return <button className={selected === image.id && !uploadedExample ? 'selected' : ''} key={image.id} onClick={() => { setSelected(image.id); setUploadedExample(null); setRun(null); setError(''); }} disabled={busy}><img src={`/api/vision/examples/${image.id}/image`} alt={image.kind === 'mirror_crop' ? 'Actual mirror photograph cropped from the referenced parts dataset' : 'Referenced real vehicle damage photograph'} /><strong>{image.name}</strong><span>{image.kind === 'mirror_crop' ? image.dataset_label : image.group_label || 'Vehicle damage benchmark'}</span>{row && <em className={`thumb-badge ${row.detections > 0 ? 'has-regions' : 'no-regions'}`}>{row.detections > 0 ? `${row.detections} region${row.detections > 1 ? 's' : ''} @ ${Math.round(summary.execution.threshold * 100)}%` : 'no output @ 35%'}</em>}</button>;})}</div></aside>
    <section className="vision-main">{example && <><div className="section-heading"><div><h2>{example.name}</h2><p>{example.kind === 'mirror_crop' ? 'Actual attached-mirror crop. Donor and functionality unknown.' : example.kind === 'user_upload' ? 'Your uploaded image; private local inspection.' : example.kind === 'damage_sample' ? 'Real damaged-vehicle photograph from the referenced repositories. Benchmark only, never seller stock.' : 'Whole-vehicle benchmark, outside the ten-mirror listing scope.'}</p></div>{example.kind === 'mirror_crop' && <button className="button secondary small" onClick={addRecord} disabled={busy}>Open reference record <IconArrowUpRight size={16} /></button>}</div>
      {!run && <img className="vision-original" src={example.id ? `/api/vision/examples/${example.id}/image` : undefined} alt="Actual selected reference image for local inspection" />}
      <div className="vision-run-controls"><label className="field-label">Detection threshold: {Math.round(threshold * 100)}%<input aria-label="Detection threshold" type="range" min="0.1" max="0.9" step="0.05" value={threshold} onChange={e => setThreshold(Number(e.target.value))} disabled={busy} /></label><div className="threshold-presets" role="group" aria-label="Threshold presets">{[['Sensitive', 0.15], ['Balanced', 0.35], ['Strict', 0.55]].map(([label, value]) => <button key={label} type="button" className={Math.abs(threshold - value) < 0.01 ? 'selected' : ''} onClick={() => setThreshold(value)} disabled={busy}>{label} {Math.round(value * 100)}%</button>)}</div><button className="button primary" disabled={busy || !example.id || !config?.model.available} onClick={() => inspect()}><IconScan size={18} />{busy ? 'Running local CNN…' : 'Run damage inspection'}</button></div>
      {run && <InspectionResult key={run.id} run={run} />}
      {run && run.result.detections.length === 0 && run.result.threshold > 0.15 && <button className="button secondary small rerun-lower" disabled={busy} onClick={() => { setThreshold(0.15); inspect(0.15); }}><IconGauge size={16} />Re-run at 15% threshold to surface the strongest raw scores</button>}
      <details className="vision-provenance"><summary>Image source, modifications and licensing</summary><p>{example.attribution || 'User-provided photo; user confirms approval/anonymisation.'}</p><p>{example.declared_license}</p><p>{example.modifications}</p><p>{example.limitations}</p>{example.source && <p className="hash-text">Source: {example.source}</p>}{example.source_image && <p className="mono">Original image: {example.source_image}</p>}{example.annotation_file && <><p className="helper">The following is the dataset’s mirror-part annotation, NOT predicted damage or a CNN heatmap.</p><img className="dataset-annotation" src={`/api/vision/examples/${example.id}/annotation`} alt="Dataset part segmentation annotation, not damage prediction" /></>}</details>
    </>}
    <details className="vision-upload"><summary><IconUpload size={16} /> Inspect your own approved photograph</summary><form onSubmit={upload}><label className="field-label">JPEG or PNG, maximum 8 MB<input type="file" accept="image/jpeg,image/png" onChange={e => setFile(e.target.files[0] || null)} /></label><label className="checkbox-label"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />I confirm the image is approved/anonymised and I understand model results are suggestions.</label><button className="button secondary" disabled={busy || !file || !approved}><IconUpload size={17} />Upload and inspect locally</button></form></details>
    <div className="scope-note compact"><IconAlertTriangle size={18} /><p>Model classes: {Object.values(config?.model.classes || {}).join(', ')}. No dedicated mounting-tab training, electrical testing, authenticity or vehicle-fitment validation. The model can miss damage or highlight reflections; no detection is not proof of good condition.</p></div></section></div>
  </>;
}
