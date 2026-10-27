import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createWorker } from 'tesseract.js';
import { AppError } from './database.mjs';
const require = createRequire(import.meta.url);
let busy = false;

export async function recognizeLocal(imagePath, language = 'eng') {
  if (busy) throw new AppError('Local OCR is already running. Please wait.', 409, 'OCR_BUSY');
  const languages = language === 'ara' ? ['ara', 'eng'] : ['eng'];
  const langPath = path.resolve('models/tessdata');
  for (const lang of languages) if (!fs.existsSync(path.join(langPath, `${lang}.traineddata.gz`))) throw new AppError('Offline language data missing. Run npm run setup.', 503, 'OCR_MODELS_MISSING');
  fs.mkdirSync(path.resolve(process.env.DATA_DIR || '.local-data', 'ocr-cache'), { recursive: true });
  busy = true;
  let worker;
  let expired = false;
  const started = performance.now();
  const timeoutMs = Number(process.env.OCR_TIMEOUT_MS) || 30000;
  let timeout;
  try {
    const task = (async () => {
      worker = await createWorker(languages, 1, {
        langPath,
        corePath: path.dirname(require.resolve('tesseract.js-core/package.json')),
        workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
        cachePath: path.resolve(process.env.DATA_DIR || '.local-data', 'ocr-cache'),
        gzip: true,
      });
      if (expired) { await worker.terminate(); throw new AppError('Local OCR timed out', 504, 'OCR_TIMEOUT'); }
      const { data } = await worker.recognize(imagePath);
      return { text: data.text, confidence: data.confidence, elapsedMs: Math.round(performance.now() - started), mode: 'local_ocr', engine: 'Tesseract.js 6 / local WASM and bundled language files' };
    })();
    return await Promise.race([task, new Promise((_, reject) => { timeout = setTimeout(() => { expired = true; reject(new AppError('Local OCR timed out. Accepted evidence remains unchanged; use manual transcription.', 504, 'OCR_TIMEOUT')); }, timeoutMs); })]);
  } finally {
    clearTimeout(timeout);
    if (worker) await worker.terminate().catch(() => {});
    busy = false;
  }
}
