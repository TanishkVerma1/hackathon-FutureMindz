import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const root = process.cwd();
const staging = path.join(root, '.local-data', 'vision-export');
const cloudwhynotPhotos = path.join(root, 'datasets', 'vision', 'examples');
const umerPhotos = path.join(root, 'datasets', 'vision', 'umer-samples');
fs.mkdirSync(staging, { recursive: true });
fs.mkdirSync(cloudwhynotPhotos, { recursive: true });
fs.mkdirSync(umerPhotos, { recursive: true });

const cloudwhynot = ['kia-picanto/kia_picanto_1.png', 'kia-picanto/kia_picanto_2.png', 'kia-picanto/kia_picanto_3.png', 'kia-picanto/kia_picanto_4.png', 'suzuki-swift/suzuki_swift_1.png', 'suzuki-swift/suzuki_swift_2.png', 'suzuki-swift/suzuki_swift_3.png', 'vw-golf/vw_golf_1.jpg', 'vw-golf/vw_golf_2.jpg'];
const umerforsure = ['0003_JPEG.rf.899da2f9c84f037ca43abae1f4fdc39d.jpg', '0020_JPEG.rf.e3a4149284be3e70f9ade9f8c2ecb0ee.jpg', '0025_JPEG.rf.33918538d6962d1eef7dffd84353bcc2.jpg', '0045_JPEG.rf.db21fd7d61c7a875e5a1ae95ccd71a31.jpg', '0059_JPEG.rf.1385588f551302a3029b25736da1bc71.jpg', '0098_JPEG.rf.afacf023208c59a396e7966f96398bf3.jpg', '0116_JPEG.rf.70bf2f54ed0c08ba1ca6a707bcc2a90b.jpg', '4JI4Jok_jpg.rf.4e3cceaeeec494a9706cf70b0cac4584.jpg', 'image (1).png', 'image (2).png', 'image (3).png', 'image (4).png', 'image (5).png', 'Can-I-Drive-My-Damaged-Car.jpg', 'deflated-damaged-tyre-detail-of-an-white-car-D957G6.jpg', 'do-it-yourself-repair-job-with-pipe-tape-to-a-rear-tail-light-and-J4YRKD.jpg', 'large-car-dent-in-need-of-professional-dent-removal.jpg'];

const groups = [
  { target: cloudwhynotPhotos, prefix: '', files: cloudwhynot, base: 'https://raw.githubusercontent.com/cloudwhynot/car-damage-detection-yolo/main/assets/demo-images/' },
  { target: umerPhotos, prefix: 'umer_', files: umerforsure, base: 'https://raw.githubusercontent.com/umerforsure/Car-Damage-Detection/main/dataset/Sample%20Data/' },
];
for (const group of groups) {
  for (const file of group.files) {
    const name = group.prefix + path.basename(file);
    const destination = path.join(group.target, name);
    if (fs.existsSync(destination)) continue;
    const response = await fetch(group.base + encodeURIComponent(file));
    if (!response.ok) { console.warn(`Skip ${name}: HTTP ${response.status}`); continue; }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${destination}.download`));
    fs.renameSync(`${destination}.download`, destination);
    console.log(`Downloaded ${name}: ${fs.statSync(destination).size} bytes`);
  }
}
const core = [
  { name: 'damage.pt', target: staging, url: 'https://media.githubusercontent.com/media/cloudwhynot/car-damage-detection-yolo/main/models/damage_model/weights/best.pt', sha256: '02a2cabd2c13d165ee4e01fa78a091d9f34a859320e49c878d4d704920f6446f', bytes: 54525361 },
  { name: 'carparts-seg.zip', target: staging, url: 'https://github.com/ultralytics/assets/releases/download/v0.0.0/carparts-seg.zip', bytes: 139535504 },
];
for (const asset of core) {
  const destination = path.join(asset.target, asset.name);
  if (!fs.existsSync(destination)) {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`${asset.name}: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${destination}.download`));
    fs.renameSync(`${destination}.download`, destination);
  }
  const checksum = createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  if (asset.sha256 && asset.sha256 !== checksum) throw new Error(`Checksum mismatch: ${asset.name}`);
  if (asset.bytes && fs.statSync(destination).size !== asset.bytes) throw new Error(`Unexpected byte count: ${asset.name}`);
  console.log(`Verified ${asset.name}: ${fs.statSync(destination).size} bytes`);
}
for (const [repo, file] of [['cloudwhynot/car-damage-detection-yolo', 'cloudwhynot-LICENSE.txt'], ['umerforsure/Car-Damage-Detection', 'umerforsure-LICENSE.txt'], ['ultralytics/ultralytics', 'ultralytics-LICENSE.txt']]) {
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/main/LICENSE`);
  if (!response.ok) throw new Error(`Cannot retrieve ${repo} license`);
  fs.writeFileSync(path.join(root, 'datasets', 'vision', file), await response.text());
}
fs.writeFileSync(path.join(root, 'datasets', 'vision', 'asset-provenance.json'), JSON.stringify({
  acquired_at: new Date().toISOString(),
  sources: [
    { repository: 'https://github.com/cloudwhynot/car-damage-detection-yolo', license: 'MIT, Copyright (c) 2026 cloudwhynot; see cloudwhynot-LICENSE.txt', role: 'Damage CNN checkpoint + 9 whole-vehicle benchmark photos' },
    { repository: 'https://github.com/umerforsure/Car-Damage-Detection', license: 'MIT, see umerforsure-LICENSE.txt', role: 'Real damaged-vehicle sample photos for library expansion' },
    { archive: 'https://github.com/ultralytics/assets/releases/download/v0.0.0/carparts-seg.zip', upstream: 'https://universe.roboflow.com/gianmarco-russo-vt9xr/car-seg-un1pm', role: '12 attributed mirror crops with part annotations' },
  ],
  scope: 'Local proof-of-concept. Repository MIT licenses are not independent certification of underlying image/training-data rights. Ultralytics derivative-model terms also require review before publication/commercial use.',
  image_context: 'Whole-vehicle and part photos from public repositories, not verified detached-salvage-part photographs. Some samples may carry third-party watermarks; only non-watermarked files are curated.',
}, null, 2));
console.log('Asset acquisition complete. No application runtime network calls.');
