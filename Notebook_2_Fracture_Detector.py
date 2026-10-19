# ================================================================
# FRACTURE DETECTOR — YOLOv8m (Clean & Robust Kaggle Version)
# ================================================================
# Dataset in sidebar: "fractures"
# No disk copying needed — reads directly from /kaggle/input/
# Batch=8 to prevent CUDA Out of Memory on T4 GPU
# Imgsz=768 for high hairline fracture sensitivity
# ================================================================


# ==== CELL 1 — Install Ultralytics =============================
!pip install -q ultralytics


# ==== CELL 2 — Imports & Environment Setup =====================
import os, glob, yaml
from pathlib import Path
import torch
from ultralytics import YOLO
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import shutil

WORK_DIR   = "/kaggle/working"
OUTPUT_DIR = f"{WORK_DIR}/fracture_detector"
os.makedirs(OUTPUT_DIR, exist_ok=True)

DEVICE = "0" if torch.cuda.is_available() else "cpu"
print(f"✅ Device: {'GPU — ' + torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}")


# ==== CELL 3 — Locate Dataset & Create data.yaml ================
# Search recursively for 'train' folder anywhere under /kaggle/input
input_dir = Path("/kaggle/input")
train_candidates = [p for p in input_dir.rglob("train") if p.is_dir() and not p.name.startswith(".")]

if not train_candidates:
    raise FileNotFoundError(f"No 'train' directory found under /kaggle/input! Available: {list(input_dir.iterdir())}")

train_dir = train_candidates[0]
dataset_root = train_dir.parent
print(f"✅ Found dataset root at: {dataset_root}")

# Detect train path
train_path = str((train_dir / "images" if (train_dir / "images").is_dir() else train_dir).resolve())

# Detect val/valid path
val_path = None
for v_name in ["valid", "val", "validation"]:
    v_dir = dataset_root / v_name
    if v_dir.is_dir():
        val_path = str((v_dir / "images" if (v_dir / "images").is_dir() else v_dir).resolve())
        break

if not val_path:
    raise FileNotFoundError(f"Could not locate 'valid' or 'val' folder in {dataset_root}")

# Detect test path
test_path = None
t_dir = dataset_root / "test"
if t_dir.is_dir():
    test_path = str((t_dir / "images" if (t_dir / "images").is_dir() else t_dir).resolve())

print("\n📂 Verified dataset paths:")
print(f"   Train: {train_path} ({len(list(Path(train_path).glob('*')))} files)")
print(f"   Val:   {val_path} ({len(list(Path(val_path).glob('*')))} files)")
if test_path:
    print(f"   Test:  {test_path} ({len(list(Path(test_path).glob('*')))} files)")

# Create data.yaml in /kaggle/working/
data_yaml_path = f"{WORK_DIR}/data.yaml"
data_config = {
    'train': train_path,
    'val':   val_path,
    'nc':    1,
    'names': ['Fracture'],
}
if test_path:
    data_config['test'] = test_path

with open(data_yaml_path, 'w') as f:
    yaml.dump(data_config, f, default_flow_style=False)

print(f"\n✅ data.yaml written to: {data_yaml_path}")
with open(data_yaml_path) as f:
    print(f.read())


# ==== CELL 4 — Train YOLOv8m ==================================
model = YOLO("yolov8m.pt")

print("🚀 Starting training... (Estimated time: ~2 to 2.5 hours on T4 GPU)\n")

results = model.train(
    data        = data_yaml_path,
    epochs      = 50,
    imgsz       = 768,           # Sharp hairline detail
    batch       = 8,             # batch=8 fits in T4 16GB VRAM (no CUDA OOM!)
    device      = DEVICE,
    patience    = 12,            # early stopping
    save        = True,
    save_period = 5,             # save checkpoint every 5 epochs
    project     = OUTPUT_DIR,
    name        = "train",
    exist_ok    = True,
    cache       = False,         # no disk cache needed for read-only input

    # Augmentations for X-ray fractures
    flipud      = 0.1,
    fliplr      = 0.5,
    mosaic      = 0.5,
    mixup       = 0.1,
    degrees     = 10.0,
    translate   = 0.1,
    scale       = 0.3,
    hsv_h       = 0.01,
    hsv_s       = 0.1,
    hsv_v       = 0.3,

    # Optimizer
    optimizer   = "AdamW",
    lr0         = 0.001,
    lrf         = 0.01,
    weight_decay = 0.0005,

    # Performance
    workers     = 2,
    amp         = True,
    verbose     = True,
)

print("\n✅ Training complete!")


# ==== CELL 5 — Evaluate on Test Set ============================
print("⏳ Running evaluation on test set...")

best_weights = f"{OUTPUT_DIR}/train/weights/best.pt"
if not os.path.exists(best_weights) or os.path.getsize(best_weights) == 0:
    # Fallback to last.pt if best.pt is empty
    best_weights = f"{OUTPUT_DIR}/train/weights/last.pt"

model_eval = YOLO(best_weights)

metrics = model_eval.val(
    data   = data_yaml_path,
    split  = "test" if test_path else "val",
    imgsz  = 768,
    device = DEVICE,
    conf   = 0.25,
)

print(f"\n{'='*50}")
print(f"📊 TEST SET RESULTS")
print(f"{'='*50}")
print(f"   mAP@50:      {metrics.box.map50:.4f}")
print(f"   mAP@50-95:   {metrics.box.map:.4f}")
print(f"   Precision:    {metrics.box.mp:.4f}")
print(f"   Recall:       {metrics.box.mr:.4f}")
print(f"{'='*50}")


# ==== CELL 6 — Visualize Results & Test Samples ================
results_dir = f"{OUTPUT_DIR}/train"

result_images = ["results.png", "confusion_matrix.png", "F1_curve.png", "PR_curve.png"]
fig, axes = plt.subplots(2, 2, figsize=(16, 12))
fig.suptitle('YOLOv8m Fracture Detector — Training Results', fontsize=16, fontweight='bold')

for ax, img_name in zip(axes.flat, result_images):
    img_path = f"{results_dir}/{img_name}"
    if os.path.exists(img_path):
        img = mpimg.imread(img_path)
        ax.imshow(img)
        ax.set_title(img_name.replace('.png', '').replace('_', ' '), fontsize=11)
    else:
        ax.text(0.5, 0.5, f'{img_name}\nnot found', ha='center', va='center')
    ax.axis('off')

plt.tight_layout()
plt.savefig(f"{OUTPUT_DIR}/all_results_summary.png", dpi=150, bbox_inches='tight')
plt.show()


# ==== CELL 7 — Save & Download Model ===========================
weights_dir = Path(f"{OUTPUT_DIR}/train/weights")
valid_pts = [p for p in weights_dir.glob("*.pt") if p.stat().st_size > 1000] if weights_dir.exists() else []

best_pt = f"{OUTPUT_DIR}/train/weights/best.pt"
last_pt = f"{OUTPUT_DIR}/train/weights/last.pt"

if os.path.exists(best_pt) and os.path.getsize(best_pt) > 1000:
    source_pt = best_pt
elif os.path.exists(last_pt) and os.path.getsize(last_pt) > 1000:
    source_pt = last_pt
elif valid_pts:
    source_pt = str(max(valid_pts, key=lambda p: p.stat().st_mtime))
else:
    raise FileNotFoundError("No valid non-empty checkpoint found!")

export_path = f"{WORK_DIR}/fracture_best.pt"
shutil.copy2(source_pt, export_path)

print(f"\n{'='*60}")
print(f"🎉 TRAINING COMPLETE & MODEL SAVED!")
print(f"{'='*60}")
print(f"   Model file:  {export_path}")
print(f"   File size:   {os.path.getsize(export_path) / 1e6:.1f} MB")
print(f"")
print(f"👉 In the right sidebar under 'Output', download 'fracture_best.pt'")
print(f"{'='*60}")
