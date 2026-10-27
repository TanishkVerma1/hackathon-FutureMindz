import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

// Setup-only: acquires additional real damage photographs from repositories
// listed in GitHub_Repos_Reference.docx that were not previously curated.
// No application runtime network calls.
const root = process.cwd();
const target = path.join(root, 'datasets', 'vision', 'repo-samples');
fs.mkdirSync(target, { recursive: true });

const groups = [
  {
    slug: 'mrcharlessg',
    repo: 'MRCHARLESSG/VEHICLES-DAMAGES-DETECTION',
    source: 'https://github.com/MRCHARLESSG/VEHICLES-DAMAGES-DETECTION/tree/main/custom-dataset/images',
    attribution: 'MRCHARLESSG/VEHICLES-DAMAGES-DETECTION custom-dataset images. Referenced from the supplied GitHub repos document.',
    files: ['custom-dataset/images/5.jpg', 'custom-dataset/images/8.jpg', 'custom-dataset/images/10.jpg', 'custom-dataset/images/11.jpg', 'custom-dataset/images/12.jpg', 'custom-dataset/images/13.jpg'],
  },
  {
    slug: 'mehulcode12',
    repo: 'MEHULCODE12/VEHICLE-DAMAGE-DETECTION-BASED-ON-REAL-LIFE-DATASET',
    source: 'https://github.com/MEHULCODE12/VEHICLE-DAMAGE-DETECTION-BASED-ON-REAL-LIFE-DATASET',
    attribution: 'MEHULCODE12 real-life vehicle damage dataset sample images. Referenced from the supplied GitHub repos document.',
    files: ['temp_file.jpg', 'temp_image.jpg'],
  },
  {
    slug: 'shivanshgupta',
    repo: 'ShivanshGupta-25/Car-Object-Detection-YOLO-Model',
    source: 'https://github.com/ShivanshGupta-25/Car-Object-Detection-YOLO-Model/tree/main/Images',
    attribution: 'ShivanshGupta-25 car object detection sample photo. Referenced from the supplied GitHub repos document.',
    files: ['Images/carimage3.jpg'],
  },
];

let acquired = 0;
for (const group of groups) {
  for (const file of group.files) {
    const name = `${group.slug}_${path.basename(file).replace(/\.[^.]+$/, '')}${path.extname(file).toLowerCase()}`;
    const destination = path.join(target, name);
    if (fs.existsSync(destination)) { console.log(`Already present: ${name}`); acquired++; continue; }
    const url = `https://raw.githubusercontent.com/${group.repo}/main/${encodeURIComponent(file)}`;
    const response = await fetch(url);
    if (!response.ok) { console.warn(`Skip ${name}: HTTP ${response.status}`); continue; }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${destination}.download`));
    fs.renameSync(`${destination}.download`, destination);
    console.log(`Downloaded ${name}: ${fs.statSync(destination).size} bytes`);
    acquired++;
  }
}

// Record provenance for the new groups (license status is honestly declared).
const provenanceFile = path.join(root, 'datasets', 'vision', 'repo-samples', 'provenance.json');
const provenance = {
  acquired_at: new Date().toISOString(),
  note: 'Setup-only acquisition from repositories listed in GitHub_Repos_Reference.docx (section B: vehicle damage). No repository declared a license; retained for local offline evaluation only. Review underlying photo rights before any redistribution, publication or commercial use.',
  groups: groups.map(g => ({ slug: g.slug, repository: `https://github.com/${g.repo}`, source: g.source, attribution: g.attribution, files: g.files.map(f => path.basename(f)) })),
  acquired,
};
fs.writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2));
console.log(`Acquired ${acquired} additional real photographs with provenance. No application runtime network calls.`);
