from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
import hashlib
import json
from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
archive = ROOT / '.local-data' / 'vision-export' / 'carparts-seg.zip'
output = ROOT / 'datasets' / 'vision' / 'mirrors'
output.mkdir(parents=True, exist_ok=True)
previews = ROOT / 'datasets' / 'vision' / 'previews'
umerPreviews = ROOT / 'datasets' / 'vision' / 'umer-previews'
previews.mkdir(parents=True, exist_ok=True)
umerPreviews.mkdir(parents=True, exist_ok=True)
entries = []

# --- Mirror crops from Carparts-Seg: pick the 24 largest, clearest mirror annotations ---
MIRROR_TARGET = 24
candidates = []
with ZipFile(archive) as z:
    names = set(z.namelist())
    labels = sorted(n for n in names if n.startswith('labels/test/') and n.endswith('.txt'))
    for label_path in labels:
        stem = Path(label_path).stem
        image_path = next((f'images/test/{stem}{suffix}' for suffix in ['.jpg', '.png', '.jpeg'] if f'images/test/{stem}{suffix}' in names), None)
        if not image_path:
            continue
        for line_index, line in enumerate(z.read(label_path).decode().splitlines()):
            values = line.split()
            if not values or int(values[0]) not in [17, 19] or len(values) < 7:
                continue
            coords = [float(v) for v in values[1:]]
            if len(coords) % 2 or any(v < 0 or v > 1 for v in coords):
                continue
            with Image.open(BytesIO(z.read(image_path))) as opened:
                w, h = opened.size
            points = [(coords[i] * w, coords[i + 1] * h) for i in range(0, len(coords), 2)]
            x0, y0 = min(x for x, y in points), min(y for x, y in points)
            x1, y1 = max(x for x, y in points), max(y for x, y in points)
            if x1 - x0 < 40 or y1 - y0 < 25:
                continue
            candidates.append((label_path, line_index, values, (x0, y0, x1, y1), w, h, image_path))
    candidates.sort(key=lambda c: ((c[3][2] - c[3][0]) * (c[3][3] - c[3][1]), c[0], c[1]), reverse=True)
    entries = []
    for label_path, line_index, values, (x0, y0, x1, y1), w, h, image_path in candidates[:MIRROR_TARGET]:
        image = Image.open(BytesIO(z.read(image_path))).convert('RGB')
        padding = max(10, int(max(x1 - x0, y1 - y0) * 0.12))
        box = (max(0, int(x0) - padding), max(0, int(y0) - padding), min(w, int(x1) + padding), min(h, int(y1) + padding))
        crop = image.crop(box)
        image_id = f'mirror-{len(entries) + 1:02d}'
        destination = output / f'{image_id}.jpg'
        crop.save(destination, quality=93)
        mask = Image.new('L', crop.size, 0)
        polygon = [(float(values[1 + i * 2]) * w - box[0], float(values[2 + i * 2]) * h - box[1]) for i in range((len(values) - 1) // 2)]
        ImageDraw.Draw(mask).polygon(polygon, fill=255)
        mask.save(output / f'{image_id}-annotation.png')
        entries.append({
            'id': image_id, 'name': f'Real mirror crop {len(entries) + 1}', 'file': f'mirrors/{image_id}.jpg',
            'annotation_file': f'mirrors/{image_id}-annotation.png',
            'kind': 'mirror_crop', 'dataset_label': 'left_mirror' if int(values[0]) == 17 else 'right_mirror',
            'source_image': image_path, 'source_label': label_path, 'annotation_line': line_index,
            'crop_box': box, 'original_dimensions': [w, h],
            'source': 'https://github.com/ultralytics/assets/releases/download/v0.0.0/carparts-seg.zip',
            'upstream': 'https://universe.roboflow.com/gianmarco-russo-vt9xr/car-seg-un1pm',
            'attribution': 'car-seg Dataset, Gianmarco Russo, Roboflow Universe (2023), distributed as Ultralytics Carparts-Seg. Cropped for this prototype; original part annotations retained.',
            'declared_license': 'CC BY 4.0 badge displayed on Ultralytics Carparts-Seg dataset documentation; archive has no separate license file. Image-specific rights not independently audited; review before publication/commercial use.',
            'license_url': 'https://creativecommons.org/licenses/by/4.0/',
            'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
            'limitations': 'Attached-vehicle mirror crop, not verified detached-salvage stock. Dataset part mask is ground-truth annotation, not damage prediction. Donor, functionality, fitment and physical side convention remain unverified. Small crops are inherently low-resolution; the CNN may produce no detections at standard thresholds.',
        })

# --- Cloudwhynot vehicle benchmarks: redact plates, save preview ---
plate_boxes = {
    'kia_picanto_1': (0.72, 0.60, 0.85, 0.74), 'kia_picanto_2': (0.66, 0.56, 0.82, 0.72),
    'kia_picanto_3': (0.875, 0.37, 1.0, 0.59), 'kia_picanto_4': (0.70, 0.58, 0.86, 0.76),
    'suzuki_swift_1': (0.81, 0.46, 0.92, 0.60), 'suzuki_swift_2': (0.78, 0.50, 0.90, 0.64),
    'suzuki_swift_3': (0.80, 0.52, 0.91, 0.66),
}
benchmarks = []
for path in sorted((ROOT / 'datasets' / 'vision' / 'examples').glob('*.png')):
    preview = Image.open(path).convert('RGB')
    if path.stem in plate_boxes:
        box = tuple(int(v * (preview.width if i % 2 == 0 else preview.height)) for i, v in enumerate(plate_boxes[path.stem]))
        preview.paste(preview.crop(box).filter(ImageFilter.GaussianBlur(22)), box)
    destination = previews / path.name
    preview.save(destination)
    benchmarks.append({
        'id': path.stem, 'name': path.stem.replace('_', ' ').replace('kia picanto', 'Kia Picanto').replace('suzuki swift', 'Suzuki Swift').replace('vw golf', 'VW Golf').title(),
        'file': f'previews/{path.name}', 'kind': 'damage_benchmark', 'vehicle': path.stem.split('_')[0].replace('kia', 'Kia').replace('suzuki', 'Suzuki').replace('vw', 'VW').upper() + ' ' + path.stem.split('_')[1].title(),
        'modifications': 'Metadata stripped; visible plate region blurred where present.',
        'original_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'source': 'https://github.com/cloudwhynot/car-damage-detection-yolo/tree/main/assets/demo-images',
        'attribution': 'cloudwhynot/car-damage-detection-yolo, Copyright (c) 2026 cloudwhynot. Repository-provided demo image; retained MIT notice applies subject to third-party rights.',
        'declared_license': 'Source repository MIT; underlying image rights not independently certified.',
        'limitations': 'Whole vehicle damage benchmark, outside the ten-mirror listing scope. Never used as invented stock or donor evidence.',
        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
    })
for path in sorted((ROOT / 'datasets' / 'vision' / 'examples').glob('*.jpg')):
    preview = Image.open(path).convert('RGB')
    destination = previews / (path.stem + '.jpg')
    preview.save(destination, quality=90)
    benchmarks.append({
        'id': path.stem, 'name': path.stem.replace('_', ' ').replace('vw golf', 'VW Golf').title(),
        'file': f'previews/{path.stem}.jpg', 'kind': 'damage_benchmark', 'vehicle': 'VW Golf',
        'modifications': 'Metadata stripped.',
        'original_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'source': 'https://github.com/cloudwhynot/car-damage-detection-yolo/tree/main/assets/demo-images',
        'attribution': 'cloudwhynot/car-damage-detection-yolo, Copyright (c) 2026 cloudwhynot. Repository-provided demo image.',
        'declared_license': 'Source repository MIT; underlying image rights not independently certified.',
        'limitations': 'Whole vehicle damage benchmark, outside the ten-mirror listing scope.',
        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
    })

# --- umerforsure damage samples: skip watermarked stock, keep Roboflow + unlabeled photos ---
skip_patterns = ['gettyimages', 'istockphoto', '360_F_', 'images.jpeg']
umer_samples = []
for path in sorted((ROOT / 'datasets' / 'vision' / 'umer-samples').iterdir()):
    if any(s in path.name for s in skip_patterns):
        continue
    if not path.suffix.lower() in ['.jpg', '.jpeg', '.png']:
        continue
    image = Image.open(path).convert('RGB')
    destination = umerPreviews / path.name
    image.save(destination, quality=90)
    label = path.stem.replace('umer_', '').split('.')[0].replace('-', ' ').replace('_', ' ')
    umer_samples.append({
        'id': 'umer_' + path.stem.replace('umer_', '').split('.')[0][:20],
        'name': f'Damage sample: {label[:30]}', 'file': f'umer-previews/{path.name}', 'kind': 'damage_sample',
        'group': 'umerforsure', 'group_label': 'umerforsure samples',
        'modifications': 'Metadata stripped.',
        'source': 'https://github.com/umerforsure/Car-Damage-Detection/tree/main/dataset/Sample%20Data',
        'attribution': 'umerforsure/Car-Damage-Detection, MIT license. Sample data subset; underlying photo rights not independently certified.',
        'declared_license': 'Source repository MIT; image-specific rights not audited. Roboflow-exported samples inherit their upstream provenance.',
        'limitations': 'Real damaged-vehicle photograph. No verified ground-truth damage labels or detached-part coverage. Not seller stock evidence.',
        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
    })

# --- Additional real damage photos from other repositories in GitHub_Repos_Reference.docx ---
repo_meta = {
    'mrcharlessg': {
        'label': 'MRCharles SG damage photos',
        'source': 'https://github.com/MRCHARLESSG/VEHICLES-DAMAGES-DETECTION/tree/main/custom-dataset/images',
        'attribution': 'MRCHARLESSG/VEHICLES-DAMAGES-DETECTION custom-dataset images, referenced from the supplied GitHub repos document.',
        'declared_license': 'No repository license declared. Retained for local offline evaluation only; review underlying photo rights before redistribution or publication.',
    },
    'mehulcode12': {
        'label': 'Mehul real-life damage photos',
        'source': 'https://github.com/MEHULCODE12/VEHICLE-DAMAGE-DETECTION-BASED-ON-REAL-LIFE-DATASET',
        'attribution': 'MEHULCODE12 real-life vehicle damage dataset sample images, referenced from the supplied GitHub repos document.',
        'declared_license': 'No repository license declared. Retained for local offline evaluation only; review underlying photo rights before redistribution or publication.',
    },
    'shivanshgupta': {
        'label': 'Shivansh car photos',
        'source': 'https://github.com/ShivanshGupta-25/Car-Object-Detection-YOLO-Model/tree/main/Images',
        'attribution': 'ShivanshGupta-25 car object detection sample photo, referenced from the supplied GitHub repos document.',
        'declared_license': 'No repository license declared. Retained for local offline evaluation only; review underlying photo rights before redistribution or publication.',
    },
}
repoPreviews = ROOT / 'datasets' / 'vision' / 'repo-previews'
repoPreviews.mkdir(parents=True, exist_ok=True)
repo_samples = []
repoDirectory = ROOT / 'datasets' / 'vision' / 'repo-samples'
if repoDirectory.exists():
    for path in sorted(repoDirectory.iterdir()):
        if path.name == 'provenance.json' or path.suffix.lower() not in ['.jpg', '.jpeg', '.png']:
            continue
        slug = path.name.split('_')[0]
        meta = repo_meta.get(slug)
        if not meta:
            continue
        image = Image.open(path).convert('RGB')
        destination = repoPreviews / path.name
        image.save(destination, quality=90)
        label = path.stem.replace(f'{slug}_', '').replace('_', ' ').replace('-', ' ')
        repo_samples.append({
            'id': path.stem[:40], 'name': f'Damage photo: {label[:34]}',
            'file': f'repo-previews/{path.name}', 'kind': 'damage_sample', 'group': slug, 'group_label': meta['label'],
            'modifications': 'Metadata stripped.',
            'source': meta['source'], 'attribution': meta['attribution'],
            'declared_license': meta['declared_license'],
            'limitations': 'Real vehicle photograph from a public repository. No verified ground-truth damage labels or detached-part coverage. Not seller stock evidence.',
            'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        })

all_examples = entries + benchmarks + umer_samples + repo_samples
damage_samples = umer_samples + repo_samples
manifest = {
    'date': '2026-10-27', 'mirror_crops': len(entries), 'damage_benchmarks': len(benchmarks), 'damage_samples': len(damage_samples),
    'sample_groups': [
        {'group': 'umerforsure', 'label': 'umerforsure samples', 'count': len(umer_samples)},
        {'group': 'mrcharlessg', 'label': 'MRCharles SG damage photos', 'count': len([s for s in repo_samples if s['group'] == 'mrcharlessg'])},
        {'group': 'mehulcode12', 'label': 'Mehul real-life damage photos', 'count': len([s for s in repo_samples if s['group'] == 'mehulcode12'])},
        {'group': 'shivanshgupta', 'label': 'Shivansh car photos', 'count': len([s for s in repo_samples if s['group'] == 'shivanshgupta'])},
    ],
    'examples': all_examples,
}
(ROOT / 'datasets' / 'vision' / 'images.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(f'Catalog: {len(entries)} mirror crops + {len(benchmarks)} vehicle benchmarks + {len(umer_samples)} umerforsure + {len(repo_samples)} additional repo samples = {len(all_examples)} real photos')
