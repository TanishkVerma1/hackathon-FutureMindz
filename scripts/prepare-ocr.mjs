import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const target = path.join(process.cwd(), 'models', 'tessdata');
fs.mkdirSync(target, { recursive: true });
for (const lang of ['eng', 'ara']) {
  const pkg = require(`@tesseract.js-data/${lang}`);
  const filename = `${lang}.traineddata.gz`;
  const source = path.join(pkg.langPath, filename);
  if (!fs.existsSync(source)) throw new Error(`Language data not found at ${source}`);
  fs.copyFileSync(source, path.join(target, filename));
  console.log(`Bundled ${lang}: ${fs.statSync(source).size} bytes. Runtime uses local files only.`);
}
