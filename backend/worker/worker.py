import os
from dotenv import load_dotenv
load_dotenv()

import boto3
import cv2
import json
import time
import base64
import requests
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from PIL import Image
from ultralytics import YOLO

# Thread lock for model inference
inference_lock = threading.Lock()

# AWS Clients Setup with High-Concurrency Connection Pooling
from botocore.config import Config
boto_config = Config(max_pool_connections=25)
s3_client = boto3.client('s3', config=boto_config)
sqs_client = boto3.client('sqs', config=boto_config)
dynamodb = boto3.resource('dynamodb', config=boto_config)

# Load Custom AI Models
import torch
torch.set_num_threads(2)
from decimal import Decimal
_orig_torch_load = torch.load
torch.load = lambda *args, **kwargs: _orig_torch_load(*args, **{**kwargs, 'weights_only': False})

# 1. Fracture Detector (YOLOv8m)
fracture_model_path = 'fracture_best.pt' if os.path.exists('fracture_best.pt') else ('best.pt' if os.path.exists('best.pt') else None)
try:
    if fracture_model_path:
        print(f"Loading custom fracture model ({fracture_model_path})...")
        fracture_model = YOLO(fracture_model_path)
        print(f"✓ Fracture model ({fracture_model_path}) loaded successfully! Classes: {fracture_model.names}")
    else:
        print("Warning: Neither fracture_best.pt nor best.pt found.")
        fracture_model = None
except Exception as e:
    print(f"Warning: Could not load fracture model. {e}")
    fracture_model = None

# 2. Bone Classifier (EfficientNet-B4, 95.8% accuracy)
bone_classifier_model = None
bone_class_names = ['CHEST', 'HAND', 'KNEE', 'LEGlowerbody', 'SHOULDER', 'WRIST']
bone_transform = None

try:
    if os.path.exists('bone_classifier_best.pt'):
        import timm
        from torchvision import transforms
        print("Loading bone classifier model (bone_classifier_best.pt)...")
        ckpt = torch.load('bone_classifier_best.pt', map_location='cpu')
        bone_classifier_model = timm.create_model('efficientnet_b4', pretrained=False, num_classes=6)
        bone_classifier_model.load_state_dict(ckpt['model_state_dict'])
        bone_classifier_model.eval()
        if 'class_names' in ckpt:
            bone_class_names = ckpt['class_names']
            
        bone_transform = transforms.Compose([
            transforms.Resize((380, 380)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        print(f"✓ Bone classifier loaded successfully! Classes: {bone_class_names}")
    else:
        print("Warning: bone_classifier_best.pt not found.")
except Exception as e:
    print(f"Warning: Could not load bone classifier: {e}")

# Helper to convert nested floats to Decimal for DynamoDB safety
def float_to_decimal(obj):
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: float_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [float_to_decimal(v) for v in obj]
    return obj

# Vision LLM Setup (for lightweight visual auto-tagging fallback)
NVIDIA_API_KEY = os.environ.get('NVIDIA_API_KEY', '')
LLM_MODEL = os.environ.get('LLM_MODEL', 'meta/llama-3.2-11b-vision-instruct')

# Configurations
QUEUE_URL = os.environ.get('SQS_QUEUE_URL')
RAW_BUCKET = os.environ.get('RAW_BUCKET_NAME')
PROCESSED_BUCKET = os.environ.get('PROCESSED_BUCKET_NAME')

# DynamoDB table (matches the Node.js API)
TABLE_NAME = dynamodb.Table('Jobs')

# How many times we retry a message before giving up and deleting it
MAX_RETRIES = 3

def process_image(download_path, upload_path):
    """Apply high-contrast medical edge-enhancement and unsharp masking pipeline."""
    # 1. Read as grayscale
    img = cv2.imread(download_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"Could not read image at {download_path}. File may be corrupt or unsupported format.")

    # 2. CLAHE — Contrast-Limited Adaptive Histogram Equalization
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    clahe_img = clahe.apply(img)

    # 3. Unsharp Masking (USM) — High-Frequency Bone Edge Sharpening
    gaussian = cv2.GaussianBlur(clahe_img, (0, 0), sigmaX=2.0)
    sharpened = cv2.addWeighted(clahe_img, 1.5, gaussian, -0.5, 0)

    # 4. Save the sharpened enhanced image
    cv2.imwrite(upload_path, sharpened)
    print(f"  ✓ Image sharpened (Unsharp Mask + CLAHE) and saved to {upload_path}")

def classify_body_part(image_path):
    """Classify body part using the local EfficientNet-B4 model (with Vision LLM fallback)."""
    # 1. Try local trained model first
    if bone_classifier_model is not None and bone_transform is not None:
        try:
            pil_img = Image.open(image_path).convert('RGB')
            tensor = bone_transform(pil_img).unsqueeze(0)
            with torch.inference_mode():
                logits = bone_classifier_model(tensor)
                probs = torch.softmax(logits, dim=1)
                conf, pred_idx = probs.max(dim=1)
                
            raw_part = bone_class_names[pred_idx.item()]
            conf_val = round(float(conf.item()), 3)
            
            part_map = {
                'CHEST': 'chest',
                'HAND': 'hand',
                'KNEE': 'knee',
                'LEGlowerbody': 'leg',
                'SHOULDER': 'shoulder',
                'WRIST': 'wrist'
            }
            cleaned = part_map.get(raw_part, raw_part.lower())
            print(f"  ✓ Local bone classifier: {cleaned} (confidence: {round(conf_val*100, 1)}%)")
            return cleaned
        except Exception as e:
            print(f"  ⚠ Local bone classifier error: {e}. Falling back to Vision API...")

    # 2. Vision API fallback
    if NVIDIA_API_KEY:
        try:
            with open(image_path, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode('utf-8')
                
            payload = {
                "model": LLM_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyze this medical image. Return strictly ONLY ONE WORD representing the anatomical body part shown (e.g., chest, hand, leg, head, knee, shoulder, wrist, pelvis). If unknown, return 'unspecified'."},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
                    ]
                }],
                "max_tokens": 10,
                "temperature": 0.1
            }
            
            res = requests.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {NVIDIA_API_KEY}", "Content-Type": "application/json"},
                json=payload,
                timeout=15
            )
            if res.status_code == 200:
                data = res.json()
                part = data.get('choices', [{}])[0].get('message', {}).get('content', '').strip().lower()
                return part if part else "unspecified"
        except Exception as e:
            print(f"  ⚠ Failed to classify body part via API: {e}")
            
    return "unspecified"

def detect_fractures(image_path):
    """Use custom trained YOLO model (conf=0.12, imgsz=768) to detect subtle and hairline fractures."""
    if fracture_model is None:
        return None, []
        
    try:
        with torch.inference_mode():
            results = fracture_model(image_path, conf=0.12, iou=0.45, imgsz=640, verbose=False)
        result = results[0]
        
        if len(result.boxes) == 0:
            return None, []
            
        h, w = result.orig_shape
        all_markers = []
        
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf_score = round(float(box.conf[0].item()), 2)
            
            cx_px = (x1 + x2) / 2
            cy_px = (y1 + y2) / 2
            radius_px = max((x2 - x1), (y2 - y1)) / 2
            
            cx_pct = round((cx_px / w) * 100, 2)
            cy_pct = round((cy_px / h) * 100, 2)
            radius_pct = round((radius_px / max(w, h)) * 100, 2)
            
            if radius_pct < 3:
                radius_pct = 3.0
                
            all_markers.append({
                "type": "circle",
                "cx": cx_pct,
                "cy": cy_pct,
                "radius": radius_pct,
                "confidence": conf_score,
                "color": "#EF4444"
            })
            
        primary = all_markers[0]
        print(f"  ✓ Custom YOLO detected {len(all_markers)} fracture site(s) (primary conf {primary['confidence']})")
        return primary, all_markers
    except Exception as e:
        print(f"  ⚠ Custom model inference failed: {e}")
        return None, []

def mark_job_failed(job_id, error_message):
    """Update DynamoDB to mark the job as failed."""
    try:
        now = datetime.utcnow().isoformat() + "Z"
        TABLE_NAME.update_item(
            Key={'jobId': job_id},
            UpdateExpression="SET #st = :failed, #err = :err, updatedAt = :now",
            ExpressionAttributeNames={'#st': 'status', '#err': 'error'},
            ExpressionAttributeValues={
                ':failed': 'failed',
                ':err': str(error_message),
                ':now': now
            }
        )
        print(f"  ✗ Job {job_id} marked as failed in DynamoDB.")
    except Exception as db_err:
        print(f"  ✗ Could not update DynamoDB for failed job {job_id}: {db_err}")

def process_single_message(message):
    receipt_handle = message['ReceiptHandle']
    receive_count = int(message.get('Attributes', {}).get('ApproximateReceiveCount', 1))

    try:
        body = json.loads(message['Body'])
        job_id = body.get('jobId', body.get('taskId'))
        image_key = body.get('originalKey', body.get('imageKey'))

        if not job_id or not image_key:
            print(f"  ✗ Malformed message (missing jobId or originalKey). Deleting.")
            sqs_client.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
            return

        print(f"\n→ Processing Job: {job_id} (attempt #{receive_count})")
        safe_key = image_key.replace('/', '_')

        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as raw_temp, \
             tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as processed_temp:
            
            local_raw_path = raw_temp.name
            local_processed_path = processed_temp.name
            raw_temp.close()
            processed_temp.close()

            try:
                # ── Step A: Download from S3 (Parallel I/O) ─────────────────────────
                print(json.dumps({"action": "audit_s3_download", "jobId": job_id, "bucket": RAW_BUCKET, "key": image_key, "msg": "Downloading original image from S3"}))
                s3_client.download_file(RAW_BUCKET, image_key, local_raw_path)

                # ── Step B: Process with OpenCV (CLAHE + USM) ───────────────────────
                process_image(local_raw_path, local_processed_path)

                # ── Step B.5 & B.6: Model Inference under thread-safe lock ───────────
                with inference_lock:
                    detected_part = classify_body_part(local_processed_path)
                    primary_fracture_marker, all_fracture_markers = detect_fractures(local_processed_path)

                # ── Step C: Upload to Processed Bucket (Parallel I/O) ───────────────
                processed_key = f"enhanced/{job_id}/{safe_key}"
                print(json.dumps({"action": "audit_s3_upload", "jobId": job_id, "bucket": PROCESSED_BUCKET, "key": processed_key, "msg": "Uploading enhanced image to S3"}))
                s3_client.upload_file(local_processed_path, PROCESSED_BUCKET, processed_key)

                # ── Step D: Update DynamoDB → completed (Parallel I/O) ──────────────
                now = datetime.utcnow().isoformat() + "Z"
                update_expr = "SET #st = :completed, enhancedKey = :ek, completedAt = :ca, updatedAt = :ca, progress = :p, bodyPart = :bp, fractureDetected = :fd, fracturesCount = :fc"
                expr_values = {
                    ':completed': 'completed',
                    ':ek': processed_key,
                    ':ca': now,
                    ':p': 100,
                    ':bp': detected_part,
                    ':fd': True if primary_fracture_marker else False,
                    ':fc': len(all_fracture_markers)
                }
                
                if primary_fracture_marker:
                    update_expr += ", customFractureMarker = :cfm"
                    expr_values[':cfm'] = float_to_decimal(primary_fracture_marker)
                    
                if all_fracture_markers:
                    update_expr += ", fractures = :frs"
                    expr_values[':frs'] = float_to_decimal(all_fracture_markers)
                    
                TABLE_NAME.update_item(
                    Key={'jobId': job_id},
                    UpdateExpression=update_expr,
                    ExpressionAttributeNames={'#st': 'status'},
                    ExpressionAttributeValues=expr_values
                )

                # ── Step E: Delete from SQS ──────────────────────────────────────────
                sqs_client.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
                print(f"  ✓ Job {job_id} completed successfully!")
            finally:
                if os.path.exists(local_raw_path):
                    os.remove(local_raw_path)
                if os.path.exists(local_processed_path):
                    os.remove(local_processed_path)

    except Exception as e:
        print(f"  ✗ Error processing message: {e}")

        if receive_count >= MAX_RETRIES:
            print(f"  ✗ Max retries ({MAX_RETRIES}) reached. Discarding message.")
            job_id = None
            try:
                body = json.loads(message['Body'])
                job_id = body.get('jobId', body.get('taskId'))
            except Exception:
                pass
            if job_id:
                mark_job_failed(job_id, str(e))
            sqs_client.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
        else:
            print(f"  ↺ Will retry (attempt {receive_count}/{MAX_RETRIES})")

def poll_queue():
    print("Worker started. Listening for messages on SQS (Concurrent Batch Mode)...")
    executor = ThreadPoolExecutor(max_workers=5)

    while True:
        try:
            response = sqs_client.receive_message(
                QueueUrl=QUEUE_URL,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=5,
                AttributeNames=['ApproximateReceiveCount']
            )

            messages = response.get('Messages', [])
            if not messages:
                time.sleep(0.1)
                continue

            print(f"\n→ Pulled batch of {len(messages)} jobs from SQS. Processing concurrently...")
            futures = [executor.submit(process_single_message, msg) for msg in messages]
            for f in futures:
                try:
                    f.result()
                except Exception as task_err:
                    print(f"Task error: {task_err}")

        except Exception as poll_err:
            print(f"Error in queue poll: {poll_err}")
            time.sleep(1)

if __name__ == "__main__":
    poll_queue()