<div align="center">

# 🏥 Medical Image Enhancer & Diagnostic AI Platform

### AI-Powered Medical Image Enhancement, Bone Classification & Fracture Detection

A secure, cloud-native, full-stack healthcare platform that enhances medical images (X-rays, MRIs, CT scans) using OpenCV, classifies anatomical bone regions, detects fractures with custom YOLOv8 models, and provides interactive clinical insights via the Veda AI Assistant — all backed by a comprehensive DevSecOps workflow.

[![DevSecOps Pipeline](https://img.shields.io/github/actions/workflow/status/DS-Group-Project/medical-image-enhancer/devsecops-pipeline.yml?branch=main&label=DevSecOps%20Pipeline&style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/DS-Group-Project/medical-image-enhancer/actions)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![AWS](https://img.shields.io/badge/AWS-S3%20%7C%20SQS%20%7C%20DynamoDB-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)](https://aws.amazon.com/)
[![Security](https://img.shields.io/badge/Security-Trivy%20Scanned-00B4D8?style=for-the-badge&logo=aquasecurity&logoColor=white)](https://trivy.dev/)
[![Secrets](https://img.shields.io/badge/Secrets-TruffleHog%20Verified-brightgreen?style=for-the-badge)](https://trufflesecurity.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Key Features](#-key-features)
- [DevSecOps & CI/CD Pipeline](#-devsecops--cicd-pipeline)
- [Container Monitoring (cAdvisor)](#-container-monitoring-cadvisor)
- [AWS Infrastructure](#-aws-infrastructure)
- [Getting Started](#-getting-started)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Security Hardening](#-security-hardening)
- [Contributing](#-contributing)

---

## 🌟 Overview

The **Medical Image Enhancer & Diagnostic AI Platform** empowers healthcare practitioners to upload radiographic images and instantly receive noise-free, contrast-optimized diagnostic visuals alongside automated deep learning evaluations:

1. **Non-Local Means Denoising**: Removes sensor and electronic noise while preserving edge definition.
2. **CLAHE (Contrast-Limited Adaptive Histogram Equalization)**: Enhances local contrast to expose fine-grained bone fissures and soft-tissue details.
3. **Deep Learning Bone Classification**: Automatically identifies anatomical regions (e.g., Elbow, Wrist, Hand, Shoulder, Knee, etc.) using fine-tuned vision models.
4. **YOLOv8 Fracture Detection**: Pinpoints bone fractures with bounding boxes and confidence scores.
5. **Veda AI Clinical Assistant**: Multi-modal conversational agent providing diagnostic interpretation and clinical explanations.
6. **Asynchronous Architecture**: Driven by AWS SQS and DynamoDB so uploads and UI interactions remain fast and non-blocking.

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Browser                            │
│           React 18 + Vite + TailwindCSS + Veda Assistant        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (JWT Cookie + CSRF)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Node.js REST API (Express)                    │
│   Auth · Upload · Jobs · Presigned URLs · Veda Route · Rate Lim │
└──────┬────────────────────┬────────────────────────┬────────────┘
       │                    │                        │
       ▼                    ▼                        ▼
  ┌─────────┐       ┌──────────────┐        ┌──────────────┐
  │   AWS   │       │   AWS SQS    │        │   AWS        │
  │   S3    │       │   Queue      │        │  DynamoDB    │
  │(Raw &   │       │(Job Messages)│        │  (Jobs DB)   │
  │Enhanced)│       └──────┬───────┘        └──────────────┘
  └─────────┘              │
                           ▼
              ┌────────────────────────────┐
              │    Python AI & CV Worker   │
              │  • Denoise + CLAHE         │
              │  • Bone Classifier (Timm)  │
              │  • Fracture Detector (YOLO)│
              └────────────────────────────┘
                           │
              ┌────────────▼───────────────┐
              │        cAdvisor            │
              │  Container Resource Monitor│
              │        Port 8080           │
              └────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, TailwindCSS, Framer Motion, React Router v7, Lucide Icons |
| **API Backend** | Node.js, Express, JWT Authentication, CSRF (`csrf-csrf`), Helmet, Zod |
| **AI / ML & CV** | Python 3.10, PyTorch, Ultralytics YOLOv8, Timm, OpenCV (`opencv-python-headless`), NumPy |
| **Cloud Storage** | AWS S3 (Raw & Processed buckets with private presigned URLs) |
| **Job Queue** | AWS SQS (Standard Queue with long polling) |
| **Database** | AWS DynamoDB (Jobs & Session metadata) |
| **Containerization** | Docker, Multi-stage Dockerfiles, Docker Compose |
| **DevSecOps** | GitHub Actions, Aqua Security Trivy, TruffleHog OSS, Dependabot |
| **Monitoring** | Google cAdvisor (live container metrics on port 8080) |

---

## 📁 Project Structure

```
medical-image-enhancer/
│
├── frontend/                       # React + Vite application
│   ├── src/
│   │   ├── components/             # Reusable UI & Veda Assistant components
│   │   ├── context/                # AuthContext, VedaContext
│   │   ├── pages/                  # Dashboard, ImageViewer, History, Upload, etc.
│   │   ├── services/               # API clients (Axios, Presigned S3)
│   │   ├── tests/                  # Frontend Vitest test suites
│   │   └── utils/                  # Patient utils, file sanitizers, helpers
│   ├── Dockerfile                  # Multi-stage build with non-root Nginx
│   └── deploy/nginx.conf           # Production Nginx reverse proxy configuration
│
├── backend/
│   ├── api/                        # Node.js Express API service
│   │   └── src/
│   │       ├── routes/             # auth.js, jobs.js, users.js, veda.js
│   │       ├── middleware/         # auth, csrf, validate, errorHandler
│   │       ├── services/           # vedaService, visionEngine
│   │       └── test/               # Vitest backend tests
│   │
│   ├── database/                   # DynamoDB data access layer
│   │   └── src/                    # jobsRepository, usersRepository, sessionsRepository
│   │
│   ├── worker/                     # Python AI & OpenCV Worker
│   │   ├── worker.py               # SQS polling + OpenCV + YOLOv8 + Timm inference
│   │   ├── bone_classifier_best.pt # Fine-tuned bone classifier weights
│   │   ├── fracture_best.pt        # Trained YOLOv8 fracture detection weights
│   │   ├── Dockerfile              # Hardened container with non-root workeruser
│   │   └── requirements.txt        # Python dependencies
│   │
│   ├── iam/                        # AWS IAM least-privilege policies
│   │   ├── api-policy.json
│   │   └── worker-policy.json
│   └── Dockerfile.api              # Node.js API container specification
│
├── tools/                          # Developer utilities & test triggers
│   ├── sample.jpg                  # Diagnostic test image
│   └── test_trigger.py             # SQS manual message trigger
│
├── .github/
│   ├── dependabot.yml              # Automated dependency security scanning
│   └── workflows/
│       └── devsecops-pipeline.yml  # Secret scanning, Unit tests, and Trivy container scan
│
├── docker-compose.yml              # Full-stack multi-container orchestration
├── .gitignore
├── .dockerignore
└── README.md
```

---

## 🔄 DevSecOps & CI/CD Pipeline

The project features a complete **DevSecOps lifecycle** running automatically on every push and pull request via GitHub Actions:

```
[ Git Push / PR ]
       │
       ▼
┌─────────────────────────┐
│ 1. TruffleHog OSS       │ ── Scans repository commit history for leaked credentials
└────────────┬────────────┘
             │ (Pass)
             ▼
┌─────────────────────────┐
│ 2. Lint & Unit Testing  │ ── Runs ESLint and Vitest across Frontend (32 tests)
└────────────┬────────────┘    and Backend API (10 tests)
             │ (Pass)
             ▼
┌─────────────────────────┐
│ 3. Docker Image Build   │ ── Builds Frontend, Backend API, and Python Worker images
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 4. Trivy Security Scan  │ ── Scans all 3 container images for CRITICAL and HIGH CVEs
└─────────────────────────┘
```

### Automated Dependency Management (Dependabot)
Configured in [`.github/dependabot.yml`](.github/dependabot.yml) to check weekly for security updates across:
- Frontend NPM dependencies
- Backend API NPM dependencies
- Backend Database NPM dependencies
- Python Worker PIP dependencies
- Docker base images

---

## 📊 Container Monitoring (cAdvisor)

Google's **cAdvisor** is bundled into the Docker Compose stack to provide live container resource telemetry:

* **URL:** `http://localhost:8080`
* **Metrics:** Real-time CPU usage, memory consumption, network throughput, and disk I/O across `frontend`, `api`, and `worker` containers.

---

## ☁️ AWS Infrastructure

| Service | Name | Configuration / Notes |
|---|---|---|
| **S3 Raw Bucket** | `RAW_BUCKET_NAME` | Private bucket for uploaded medical images. Public access blocked. |
| **S3 Processed Bucket** | `PROCESSED_BUCKET_NAME` | Private bucket for enhanced/annotated images. |
| **SQS Queue** | `ImageProcessingQueue` | Standard FIFO/Standard queue with 5-second long-polling. |
| **DynamoDB** | `Jobs` Table | Partition Key: `jobId` (String). Stores job state, patient ID, and AI detection results. |
| **IAM Policies** | Least-privilege JSONs | Defined in `backend/iam/api-policy.json` and `backend/iam/worker-policy.json`. |

---

## 🚀 Getting Started

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (>= 24.x)
- [Node.js](https://nodejs.org/) (>= 20 LTS)
- [Python](https://www.python.org/) (>= 3.10)
- [AWS CLI](https://aws.amazon.com/cli/) (configured with appropriate IAM credentials)

### 2. Environment Setup
Create a root `.env` file (or provide environment variables to docker-compose):

```env
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_DEFAULT_REGION=us-east-1
RAW_BUCKET_NAME=medical-image-raw-bucket
PROCESSED_BUCKET_NAME=medical-image-processed-bucket
JWT_SECRET=your_jwt_secret_key
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Running with Docker Compose
Start all four services (Frontend, API, Worker, cAdvisor) with a single command:

```bash
docker compose up --build
```

- **Frontend Application:** `http://localhost:3000`
- **Backend API:** `http://localhost:5000`
- **cAdvisor Monitoring:** `http://localhost:8080`

---

## 🧪 Testing & Quality Assurance

### Run Frontend Tests (Vitest)
```bash
cd frontend
npm test
```

### Run Backend API Tests (Vitest)
```bash
cd backend/api
npm test
```

### Trigger Test Job Manually
```bash
cd tools
python test_trigger.py
```

---

## 🔒 Security Hardening

- **Non-Root Containers**: Every Dockerfile explicitly creates and drops privileges to dedicated non-root users (`nginxuser`, `node`, `workeruser`).
- **HTTP Security Headers**: Enforced via Helmet.js in the API and custom Nginx security snippets in the frontend container.
- **Presigned URLs**: S3 buckets are completely private; images are accessed via time-limited (15-minute) presigned URLs.
- **File Integrity**: Magic-byte MIME checking ensures uploaded files are genuine JPEG, PNG, WebP, or DICOM files.
- **Secret Defense**: TruffleHog scanning ensures zero leaked credentials or private keys in Git history.

---

<div align="center">

**DS Group 01 — Medical Image Enhancer & Diagnostic Platform**  
*Engineered for clinical precision, scalability, and DevSecOps excellence.*

</div>
