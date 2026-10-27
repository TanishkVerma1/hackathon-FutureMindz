import importlib
import json
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
(ROOT / '.local-data' / 'vision-export' / 'config' / 'Ultralytics').mkdir(parents=True, exist_ok=True)
os.environ['YOLO_CONFIG_DIR'] = str(ROOT / '.local-data' / 'vision-export' / 'config')
os.environ['YOLO_AUTOINSTALL'] = 'false'
os.environ['ULTRALYTICS_OFFLINE'] = 'true'

import torch

checkpoint = ROOT / '.local-data' / 'vision-export' / 'damage.pt'
if not checkpoint.is_file():
    raise RuntimeError('Download and checksum-verify the referenced damage checkpoint first.')

allowed = []
for name in torch.serialization.get_unsafe_globals_in_checkpoint(checkpoint):
    if not name.startswith(('torch.nn.', 'ultralytics.nn.')):
        raise RuntimeError(f'Checkpoint contains an unexpected deserialization global: {name}')
    module_name, attr = name.rsplit('.', 1)
    value = getattr(importlib.import_module(module_name), attr)
    if not isinstance(value, type) or not issubclass(value, torch.nn.Module):
        raise RuntimeError(f'Checkpoint global is not an approved neural-network class: {name}')
    allowed.append(value)
torch.serialization.add_safe_globals(allowed)
original_load = torch.load

def restricted_load(*args, **kwargs):
    kwargs['weights_only'] = True
    return original_load(*args, **kwargs)

torch.load = restricted_load
torch.set_num_threads(4)
from ultralytics import YOLO, settings
settings.update({'sync': False})
model = YOLO(str(checkpoint), task='segment')
print('Actual damage classes:', model.names)
exported = model.export(format='onnx', imgsz=640, opset=17, simplify=False, dynamic=False, end2end=False, device='cpu', half=False, batch=1)
output = ROOT / 'models' / 'vision'
output.mkdir(parents=True, exist_ok=True)
shutil.copyfile(exported, output / 'damage.onnx')
import onnx
network = onnx.load(output / 'damage.onnx')
onnx.checker.check_model(network)
shape = lambda value: [dim.dim_value or dim.dim_param for dim in value.type.tensor_type.shape.dim]
manifest = {
    'id': 'cloudwhynot-damage-segmentation',
    'repository': 'https://github.com/cloudwhynot/car-damage-detection-yolo',
    'checkpoint_sha256': '02a2cabd2c13d165ee4e01fa78a091d9f34a859320e49c878d4d704920f6446f',
    'model': 'damage.onnx',
    'model_sha256': __import__('hashlib').sha256((output / 'damage.onnx').read_bytes()).hexdigest(),
    'classes': model.names,
    'input_size': 640,
    'inputs': {value.name: shape(value) for value in network.graph.input},
    'outputs': {value.name: shape(value) for value in network.graph.output},
    'engine': 'ONNX Runtime CPU',
    'model_role': 'Pretrained vehicle damage instance segmentation, not a dedicated detached-mirror or mounting-tab model',
    'visualization': 'Segmentation masks and score-weighted mask activation map, not Grad-CAM, not calibrated defect severity',
    'source_license': 'Repository MIT notice retained; Ultralytics derivative-model and training-data terms must also be reviewed before distribution/commercial use',
    'limitations': ['A model suggestion is not a confirmed defect', 'No detection does not establish damage-free condition', 'No functionality, fitment or authenticity inference', 'Detached mirror domain not validated'],
}
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print('Exported local ONNX model:', output / 'damage.onnx')
print('Model bytes:', (output / 'damage.onnx').stat().st_size)
print('Input/output shapes:', manifest['inputs'], manifest['outputs'])
