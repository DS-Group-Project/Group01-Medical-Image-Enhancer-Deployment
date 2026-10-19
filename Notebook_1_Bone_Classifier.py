# ================================================================
# NOTEBOOK 1: BONE TYPE CLASSIFIER — EfficientNet-B4
# ================================================================
# KAGGLE SETUP STEPS:
#   1. Go to kaggle.com → "New Notebook"
#   2. Right sidebar → Settings → Accelerator → GPU T4 x2
#   3. Right sidebar → "Add Input" → "Upload" → upload Dataset.zip
#      Kaggle will name it something like "dataset" — note the exact name
#   4. Paste each CELL below into a separate notebook cell
#   5. Update KAGGLE_DATASET_NAME in Cell 2 if needed
#   6. Run all cells
# ================================================================


# ==== CELL 1 — Install Dependencies ============================
!pip install -q timm scikit-learn seaborn


# ==== CELL 2 — Imports & Configuration =========================
import os, time, glob, shutil
import torch
import torch.nn as nn
import torch.optim as optim
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader
from torchvision import datasets, transforms
import timm
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import confusion_matrix, classification_report
from pathlib import Path

# ╔══════════════════════════════════════════════════════╗
# ║  CHANGE THIS to your Kaggle dataset name             ║
# ║  Look at the left sidebar under /kaggle/input/       ║
# ║  e.g. if it shows "dataset" → keep as-is             ║
# ║  if it shows "bone-xray-split" → change it           ║
# ╚══════════════════════════════════════════════════════╝
KAGGLE_DATASET_NAME = "dataset"

INPUT_ROOT = f"/kaggle/input/{KAGGLE_DATASET_NAME}"
WORK_DIR   = "/kaggle/working"
SPLIT_DIR  = f"{WORK_DIR}/split_ready"       # reorganized for PyTorch
OUTPUT_DIR = f"{WORK_DIR}/bone_classifier"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Model config
MODEL_NAME   = "efficientnet_b4"
IMAGE_SIZE   = 380            # EfficientNet-B4 native resolution
BATCH_SIZE   = 32
NUM_EPOCHS   = 40
LR           = 3e-4
WEIGHT_DECAY = 1e-4
PATIENCE     = 8              # early stopping patience
NUM_WORKERS  = 4

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"✅ Device: {DEVICE}")
if DEVICE.type == "cuda":
    print(f"   GPU: {torch.cuda.get_device_name(0)}")
    print(f"   VRAM: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB")


# ==== CELL 3 — Auto-Detect & Reorganize Dataset ================
# Your zip structure:  Dataset/CHEST/train/images...
# PyTorch ImageFolder needs:  train/CHEST/images...
# This cell flips the hierarchy automatically.
# ================================================================

def find_bone_root(base):
    """Walk down until we find the folder containing bone-type dirs."""
    BONES = {'CHEST', 'HAND', 'KNEE', 'WRIST', 'SHOULDER'}
    base = Path(base)
    # Check base itself
    children = {d.name for d in base.iterdir() if d.is_dir()}
    if len(children & BONES) >= 3:
        return base
    # Check one level deeper
    for sub in base.iterdir():
        if sub.is_dir():
            grandchildren = {d.name for d in sub.iterdir() if d.is_dir()}
            if len(grandchildren & BONES) >= 3:
                return sub
    raise FileNotFoundError(f"Could not find bone folders under {base}")

def reorganize_dataset(src_root, dst_root):
    """Convert  BONE/split/img  →  split/BONE/img  for PyTorch ImageFolder."""
    src_root = Path(src_root)
    dst_root = Path(dst_root)
    IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff'}
    stats = {}

    for bone_dir in sorted(src_root.iterdir()):
        if not bone_dir.is_dir():
            continue
        bone_name = bone_dir.name
        stats[bone_name] = {}

        for split_name in ['train', 'val', 'test']:
            split_src = bone_dir / split_name
            if not split_src.exists():
                continue
            dest = dst_root / split_name / bone_name
            dest.mkdir(parents=True, exist_ok=True)
            count = 0
            for img in split_src.rglob('*'):
                if img.is_file() and img.suffix.lower() in IMAGE_EXT:
                    shutil.copy2(img, dest / img.name)
                    count += 1
            stats[bone_name][split_name] = count

    return stats

if not Path(SPLIT_DIR).exists():
    print("⏳ Detecting dataset structure...")
    bone_root = find_bone_root(INPUT_ROOT)
    print(f"   Found bone folders at: {bone_root}")
    print(f"   Bone types: {[d.name for d in sorted(bone_root.iterdir()) if d.is_dir()]}")

    print("⏳ Reorganizing for PyTorch (this takes ~2 min for 4GB)...")
    stats = reorganize_dataset(bone_root, SPLIT_DIR)

    print("\n✅ Reorganization Complete!")
    print(f"{'Bone':<18} {'Train':>6} {'Val':>6} {'Test':>6}")
    print("-" * 40)
    for bone, splits in stats.items():
        print(f"{bone:<18} {splits.get('train',0):>6} {splits.get('val',0):>6} {splits.get('test',0):>6}")
else:
    print("✅ Already reorganized — skipping.")


# ==== CELL 4 — Data Loaders with Medical Augmentation ===========
train_transform = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.RandomHorizontalFlip(p=0.5),
    transforms.RandomRotation(degrees=15),
    transforms.ColorJitter(brightness=0.3, contrast=0.3),
    transforms.RandomAffine(degrees=0, translate=(0.05, 0.05), scale=(0.95, 1.05)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225]),
    transforms.RandomErasing(p=0.1),
])

eval_transform = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225]),
])

train_ds = datasets.ImageFolder(f"{SPLIT_DIR}/train", transform=train_transform)
val_ds   = datasets.ImageFolder(f"{SPLIT_DIR}/val",   transform=eval_transform)
test_ds  = datasets.ImageFolder(f"{SPLIT_DIR}/test",  transform=eval_transform)

CLASS_NAMES = train_ds.classes
NUM_CLASSES = len(CLASS_NAMES)

train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,
                          num_workers=NUM_WORKERS, pin_memory=True)
val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False,
                          num_workers=NUM_WORKERS, pin_memory=True)
test_loader  = DataLoader(test_ds,  batch_size=BATCH_SIZE, shuffle=False,
                          num_workers=NUM_WORKERS, pin_memory=True)

print(f"✅ Dataset loaded!")
print(f"   Train: {len(train_ds):,}  |  Val: {len(val_ds):,}  |  Test: {len(test_ds):,}")
print(f"   Classes ({NUM_CLASSES}): {CLASS_NAMES}")
print(f"   Batches per epoch: {len(train_loader)}")


# ==== CELL 5 — Build Model (EfficientNet-B4 pretrained) =========
model = timm.create_model(MODEL_NAME, pretrained=True, num_classes=NUM_CLASSES)
model = model.to(DEVICE)

total_params   = sum(p.numel() for p in model.parameters())
train_params   = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"✅ {MODEL_NAME} loaded")
print(f"   Total params:     {total_params:,}")
print(f"   Trainable params: {train_params:,}")
print(f"   Output classes:   {NUM_CLASSES}")

# Loss with label smoothing (helps with medical image noise)
criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
optimizer = optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
scheduler = CosineAnnealingLR(optimizer, T_max=NUM_EPOCHS, eta_min=1e-6)


# ==== CELL 6 — Training Loop ===================================
history = {'train_loss': [], 'val_loss': [], 'train_acc': [], 'val_acc': []}
best_val_acc     = 0.0
patience_counter = 0
best_path        = f"{OUTPUT_DIR}/bone_classifier_best.pt"

print(f"\n{'='*65}")
print(f"  TRAINING — {NUM_EPOCHS} epochs max | Early stop patience = {PATIENCE}")
print(f"  Model: {MODEL_NAME} | Image: {IMAGE_SIZE}x{IMAGE_SIZE} | BS: {BATCH_SIZE}")
print(f"{'='*65}\n")

for epoch in range(NUM_EPOCHS):
    t0 = time.time()

    # ---- Training ----
    model.train()
    run_loss, correct, total = 0.0, 0, 0
    for imgs, labels in train_loader:
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        optimizer.zero_grad()
        outputs = model(imgs)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        run_loss += loss.item() * imgs.size(0)
        _, preds = outputs.max(1)
        correct += preds.eq(labels).sum().item()
        total   += labels.size(0)

    train_loss = run_loss / total
    train_acc  = correct / total * 100

    # ---- Validation ----
    model.eval()
    run_loss, correct, total = 0.0, 0, 0
    with torch.no_grad():
        for imgs, labels in val_loader:
            imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
            outputs = model(imgs)
            loss = criterion(outputs, labels)

            run_loss += loss.item() * imgs.size(0)
            _, preds = outputs.max(1)
            correct += preds.eq(labels).sum().item()
            total   += labels.size(0)

    val_loss = run_loss / total
    val_acc  = correct / total * 100

    scheduler.step()
    elapsed = time.time() - t0

    history['train_loss'].append(train_loss)
    history['val_loss'].append(val_loss)
    history['train_acc'].append(train_acc)
    history['val_acc'].append(val_acc)

    # Save best
    flag = ""
    if val_acc > best_val_acc:
        best_val_acc = val_acc
        patience_counter = 0
        torch.save({
            'epoch':            epoch,
            'model_state_dict': model.state_dict(),
            'val_acc':          val_acc,
            'class_names':      CLASS_NAMES,
            'num_classes':      NUM_CLASSES,
            'model_name':       MODEL_NAME,
            'image_size':       IMAGE_SIZE,
        }, best_path)
        flag = "  ⭐ SAVED"
    else:
        patience_counter += 1

    print(f"Epoch [{epoch+1:02d}/{NUM_EPOCHS}]  "
          f"Train: {train_acc:5.1f}% ({train_loss:.4f})  |  "
          f"Val: {val_acc:5.1f}% ({val_loss:.4f})  |  "
          f"LR: {scheduler.get_last_lr()[0]:.1e}  |  "
          f"{elapsed:.0f}s{flag}")

    if patience_counter >= PATIENCE:
        print(f"\n⏹  Early stopping at epoch {epoch+1} — no improvement for {PATIENCE} epochs.")
        break

print(f"\n{'='*65}")
print(f"🏆 Best Validation Accuracy: {best_val_acc:.2f}%")
print(f"📦 Saved to: {best_path}")
print(f"{'='*65}")


# ==== CELL 7 — Training Curves =================================
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
fig.suptitle('Bone Classifier — EfficientNet-B4 Training', fontsize=14, fontweight='bold')

epochs_range = range(1, len(history['train_loss']) + 1)

ax1.plot(epochs_range, history['train_loss'], 'r-', linewidth=2, label='Train Loss')
ax1.plot(epochs_range, history['val_loss'],   'b-', linewidth=2, label='Val Loss')
ax1.set_xlabel('Epoch'); ax1.set_ylabel('Loss'); ax1.set_title('Loss')
ax1.legend(); ax1.grid(True, alpha=0.3)

ax2.plot(epochs_range, history['train_acc'], 'r-', linewidth=2, label='Train Acc')
ax2.plot(epochs_range, history['val_acc'],   'b-', linewidth=2, label='Val Acc')
ax2.axhline(y=best_val_acc, color='green', linestyle='--', label=f'Best: {best_val_acc:.1f}%')
ax2.set_xlabel('Epoch'); ax2.set_ylabel('Accuracy (%)'); ax2.set_title('Accuracy')
ax2.legend(); ax2.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig(f"{OUTPUT_DIR}/training_curves.png", dpi=150, bbox_inches='tight')
plt.show()
print("✅ Saved training_curves.png")


# ==== CELL 8 — Test Set Evaluation =============================
print("⏳ Loading best model for final test evaluation...")
ckpt = torch.load(best_path, map_location=DEVICE)
model.load_state_dict(ckpt['model_state_dict'])
model.eval()

all_preds, all_labels = [], []
with torch.no_grad():
    for imgs, labels in test_loader:
        imgs = imgs.to(DEVICE)
        outputs = model(imgs)
        _, preds = outputs.max(1)
        all_preds.extend(preds.cpu().numpy())
        all_labels.extend(labels.numpy())

all_preds  = np.array(all_preds)
all_labels = np.array(all_labels)
test_acc   = (all_preds == all_labels).mean() * 100

print(f"\n🎯 Test Accuracy: {test_acc:.2f}%\n")
print("📊 Classification Report:")
print(classification_report(all_labels, all_preds, target_names=CLASS_NAMES, digits=4))

# Confusion Matrix
cm = confusion_matrix(all_labels, all_preds)
plt.figure(figsize=(9, 7))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES)
plt.title(f'Bone Classifier — Confusion Matrix (Test Acc: {test_acc:.1f}%)', fontweight='bold')
plt.ylabel('True Label')
plt.xlabel('Predicted Label')
plt.xticks(rotation=45, ha='right')
plt.tight_layout()
plt.savefig(f"{OUTPUT_DIR}/confusion_matrix.png", dpi=150, bbox_inches='tight')
plt.show()
print("✅ Saved confusion_matrix.png")


# ==== CELL 9 — Download Your Model ==============================
# After this cell runs, go to:
#   /kaggle/working/bone_classifier/
# and download "bone_classifier_best.pt"
# This is the file you'll put in your backend worker.

import json

# Also save class names separately for easy loading later
meta = {
    'model_name':  MODEL_NAME,
    'image_size':  IMAGE_SIZE,
    'num_classes': NUM_CLASSES,
    'class_names': list(CLASS_NAMES),
    'best_val_acc': best_val_acc,
    'test_acc':     float(test_acc),
}
with open(f"{OUTPUT_DIR}/model_meta.json", 'w') as f:
    json.dump(meta, f, indent=2)

print(f"\n📦 FILES TO DOWNLOAD (from right sidebar → Output):")
print(f"   1. {OUTPUT_DIR}/bone_classifier_best.pt   ← THE MODEL")
print(f"   2. {OUTPUT_DIR}/model_meta.json            ← metadata")
print(f"   3. {OUTPUT_DIR}/training_curves.png         ← graphs")
print(f"   4. {OUTPUT_DIR}/confusion_matrix.png        ← evaluation")
print(f"\n✅ ALL DONE! Download bone_classifier_best.pt and we'll integrate it.")
