<div align="center">

# 🏥 Medical Image Enhancer

### AI-Powered Medical Image Enhancement Platform

A secure, cloud-native, full-stack application that enhances medical images (X-rays, MRIs, CT scans) using OpenCV's advanced processing pipeline — deployed on AWS with a complete DevSecOps workflow.

[![DevSecOps Pipeline](https://img.shields.io/github/actions/workflow/status/DS-Group-Project/Group01-Medical-Image-Enhancer-Deployment/devsecops-pipeline.yml?branch=main&label=DevSecOps%20Pipeline&style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/DS-Group-Project/Group01-Medical-Image-Enhancer-Deployment/actions)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![AWS](https://img.shields.io/badge/AWS-S3%20%7C%20SQS%20%7C%20DynamoDB-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)](https://aws.amazon.com/)
[![Security](https://img.shields.io/badge/Security-Trivy%20Scanned-00B4D8?style=for-the-badge&logo=aquasecurity&logoColor=white)](https://trivy.dev/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Getting Started](#-getting-started)
- [AWS Infrastructure](#-aws-infrastructure)
- [API Reference](#-api-reference)
- [DevSecOps Pipeline](#-devsecops-pipeline)
- [Testing & Load Testing](#-testing--load-testing)
- [Security](#-security)
- [GitHub Repositories](#-github-repositories)
- [Contributing](#-contributing)

---

## 🌟 Overview

The **Medical Image Enhancer** is a cloud-native web platform that allows healthcare professionals to upload medical images and receive enhanced versions powered by computer vision algorithms. The system uses:

- **Non-Local Means Denoising** to remove noise from X-ray images
- **CLAHE (Contrast-Limited Adaptive Histogram Equalization)** to dramatically improve contrast and reveal hidden diagnostic features
- A **fully asynchronous job queue** (AWS SQS) so the UI never blocks, even under heavy load

> Built as a Group 01 DS project with a focus on security, scalability, and real-world DevSecOps practices.

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Browser                            │
│                  React + Vite + TailwindCSS                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (JWT + CSRF)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Node.js REST API (Express)                    │
│   Auth · Upload · Jobs · Presigned URLs · Rate Limiting         │
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
              │   Python OpenCV Worker     │
              │  Denoise → CLAHE → Upload  │
              └────────────────────────────┘
                           │
              ┌────────────▼───────────────┐
              │        cAdvisor            │
              │  Container Resource Monitor│
              │        Port 8080           │
              └────────────────────────────┘
```

**Data Flow:**
1. User uploads image(s) via the React frontend
2. Node.js API validates, uploads to **S3 (raw bucket)**, creates a **DynamoDB** job record, and enqueues a message to **SQS**
3. Python Worker polls SQS, downloads the image, applies the OpenCV enhancement pipeline, and uploads the result to **S3 (processed bucket)**
4. Worker updates DynamoDB job status to `completed`
5. Frontend polls job status and displays side-by-side before/after comparison

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TailwindCSS, Framer Motion, React Router v7 |
| **API Backend** | Node.js, Express, JWT Auth, CSRF Protection, Helmet, Zod |
| **Image Processing** | Python 3, OpenCV (`opencv-python-headless`), NumPy |
| **Cloud Storage** | AWS S3 (raw images + processed images) |
| **Job Queue** | AWS SQS (Standard Queue, long polling) |
| **Database** | AWS DynamoDB (Jobs table) |
| **Containerization** | Docker, Docker Compose |
| **Monitoring** | cAdvisor (container resource monitoring) |
| **CI/CD Security** | GitHub Actions, Trivy vulnerability scanner |
| **Dependency Updates** | Dependabot |

---

## 📁 Project Structure

```
medical-image-enhancer/
│
├── frontend/                       # React + Vite application
│   ├── src/
│   │   ├── components/             # Reusable UI components
│   │   │   ├── dashboard/          # Dashboard widgets
│   │   │   ├── layout/             # Navbar, Footer, AppLayout
│   │   │   ├── ui/                 # Button, Modal, Cards, Badges
│   │   │   └── upload/             # Drag-and-drop upload zone
│   │   ├── pages/                  # Route pages
│   │   │   ├── LoginPage.jsx
│   │   │   ├── RegisterPage.jsx
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── UploadPage.jsx
│   │   │   ├── ProcessingPage.jsx
│   │   │   ├── ImageViewerPage.jsx
│   │   │   └── HistoryPage.jsx
│   │   ├── services/               # API calls (axios)
│   │   ├── context/                # AuthContext
│   │   ├── hooks/                  # useAuth, usePolling
│   │   └── utils/                  # Validation, sanitizers, helpers
│   ├── Dockerfile                  # Multi-stage Nginx build
│   └── deploy/nginx.conf           # Production Nginx config
│
├── backend/
│   ├── api/                        # Node.js Express API
│   │   └── src/
│   │       ├── app.js              # Main Express app and all routes
│   │       ├── routes/             # auth.js, jobs.js, users.js
│   │       ├── middleware/         # auth.js, validate.js, errorHandler.js
│   │       └── utils/             # logger, fileValidation, captcha, sanitizeUrl
│   │
│   ├── database/                   # DynamoDB repository layer
│   │   └── src/
│   │       ├── jobsRepository.js
│   │       ├── usersRepository.js
│   │       └── sessionsRepository.js
│   │
│   ├── worker/                     # Python OpenCV image processor
│   │   ├── worker.py               # SQS polling + OpenCV pipeline
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   │
│   ├── iam/                        # AWS IAM policy definitions
│   │   ├── api-policy.json
│   │   └── worker-policy.json
│   │
│   └── Dockerfile.api              # Node.js API Dockerfile
│
├── tools/                          # Developer utilities
│   ├── load_test.py                # SQS load test (100 jobs)
│   ├── test_trigger.py             # Manual job trigger
│   └── sample.jpg                  # Test image
│
├── .github/
│   └── workflows/
│       └── devsecops-pipeline.yml  # CI/CD: Build + Trivy scan
│
├── docker-compose.yml              # Full-stack orchestration
├── .dockerignore
├── .gitignore
└── README.md
```

---

## ✨ Features

### 🔐 Security-First Design
- **JWT Authentication** with `httpOnly` cookie sessions
- **CSRF Protection** via double-submit cookie pattern (`csrf-csrf`)
- **Helmet.js** HTTP security headers on all API responses
- **Magic-byte file validation** — checks actual file content, not just MIME type
- **Input sanitization** and **Zod schema validation** on all endpoints
- **Rate limiting** (1000 req / 15 min per IP, stricter on auth routes)
- **IAM least-privilege** policies for both API and worker services

### 🖼️ Image Enhancement Pipeline
- **Non-Local Means Denoising** — reduces digital noise while preserving edges
- **CLAHE** — reveals diagnostic detail invisible in raw images
- **Grayscale processing** — optimized for medical imaging standards
- **Automatic retry** — failed jobs retry up to 3x before marking as failed
- Supports: `JPEG`, `PNG`, `WebP`, `DICOM`

### 📊 Dashboard & UX
- Real-time job status polling
- Side-by-side before/after image comparison viewer
- Paginated job history with status filtering
- Drag-and-drop multi-file upload (up to 10 files, 50MB each)
- Responsive design with smooth animations (Framer Motion)

### 🔧 DevOps & Monitoring
- **Docker Compose** for one-command local deployment
- **cAdvisor** live container resource monitoring at `http://localhost:8080`
- **GitHub Actions** CI/CD with Trivy security scanning
- **Dependabot** automated dependency updates
- Structured JSON audit logging via `pino`

---

## ✅ Prerequisites

Ensure the following are installed:

| Tool | Version | Purpose |
|------|---------|---------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | >= 24.x | Container runtime |
| [Node.js](https://nodejs.org/) | >= 20 LTS | Frontend & API local dev |
| [Python](https://www.python.org/) | >= 3.11 | Worker local dev |
| [AWS CLI](https://aws.amazon.com/cli/) | >= 2.x | AWS infrastructure setup |
| Git | Any | Version control |

---

## 🚀 Getting Started

### 1. Environment Setup

Clone the repository and set up your environment:

```bash
git clone https://github.com/DS-Group-Project/Group01-Medical-Image-Enhancer-Deployment.git
cd Group01-Medical-Image-Enhancer-Deployment
```

Create a root `.env` file:

```bash
# On Linux/macOS:
cp frontend/.env.example .env

# On Windows:
copy frontend\.env.example .env
```

Edit `.env` with your AWS credentials:

```env
# AWS Credentials
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_DEFAULT_REGION=us-east-1

# S3 Buckets
RAW_BUCKET_NAME=your-raw-images-bucket
PROCESSED_BUCKET_NAME=your-processed-images-bucket

# SQS Queue
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT_ID/ImageProcessingQueue

# Application Secrets
JWT_SECRET=your_super_secret_jwt_key_min_32_chars
CSRF_SECRET=your_csrf_secret_key
```

> **Warning:** Never commit `.env` to version control. It is already in `.gitignore`.

---

### 2. Running with Docker Compose

This is the **recommended** way to run the full stack:

```bash
docker compose up --build
```

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:3000 | React web application |
| API | http://localhost:5000 | Node.js REST API |
| cAdvisor | http://localhost:8080 | Container monitoring dashboard |
| Worker | — | Runs headlessly, processes jobs from SQS |

To stop all services:
```bash
docker compose down
```

---

### 3. Running Locally (Development)

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Available at http://localhost:3000
```

**API Backend:**
```bash
cd backend/api
npm install
node src/index.js
# Available at http://localhost:5000
```

**Python Worker:**
```bash
cd backend/worker
pip install -r requirements.txt
python worker.py
```

---

## ☁️ AWS Infrastructure

The application requires the following AWS resources:

### S3 Buckets
| Bucket | Purpose |
|--------|---------|
| `RAW_BUCKET_NAME` | Stores original uploaded images |
| `PROCESSED_BUCKET_NAME` | Stores OpenCV-enhanced output images |

Enable **Block All Public Access** on both buckets. Images are accessed only via **presigned URLs** (15-minute expiry).

### SQS Queue
- Type: **Standard Queue**
- Name: `ImageProcessingQueue`
- Long polling enabled (`WaitTimeSeconds: 5`)

### DynamoDB Table
- Table name: **`Jobs`**
- Partition key: `jobId` (String)

### IAM Policies
Minimal IAM policies for each service are defined in:
- `backend/iam/api-policy.json` — S3, SQS, DynamoDB permissions for the Node.js API
- `backend/iam/worker-policy.json` — S3, SQS, DynamoDB permissions for the Python Worker

---

## 📡 API Reference

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/auth/register` | Create new user account | No |
| `POST` | `/auth/login` | Login and receive JWT | No |
| `POST` | `/auth/logout` | Invalidate session | Yes |
| `GET` | `/auth/me` | Get current user info | Yes |
| `GET` | `/csrf-token` | Fetch CSRF token | No |

### Image Jobs

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/upload` | Upload images (up to 10, 50MB each) | Yes |
| `GET` | `/jobs` | List your jobs (paginated, filterable) | Yes |
| `GET` | `/jobs/:jobId/image?type=original\|enhanced` | Get presigned image URL | Yes |
| `GET` | `/jobs/:jobId/image/stream` | Stream image through API proxy | Yes |
| `DELETE` | `/jobs/:jobId` | Delete job and S3 objects | Yes |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | API health check — returns `{ status: "ok" }` |

---

## 🔄 DevSecOps Pipeline

Every push to `main` or `feature/python-worker` triggers the GitHub Actions pipeline:

```
Jobs:
  build-and-scan:
    1. Checkout code
    2. Build Python Worker Docker image
    3. Run Trivy vulnerability scan (CRITICAL + HIGH severity)
```

**Trivy** scans both OS packages and application libraries inside the Docker image. The pipeline reports vulnerabilities without failing builds (`exit-code: 0`) — suitable to switch to `exit-code: 1` before production release.

See: [`.github/workflows/devsecops-pipeline.yml`](.github/workflows/devsecops-pipeline.yml)

---

## 🧪 Testing & Load Testing

### Unit Tests

**Frontend** (Vitest + React Testing Library):
```bash
cd frontend
npm run test
```

**API Backend** (Vitest):
```bash
cd backend/api
npm run test
```

### Load Testing (SQS)

Simulate 100 concurrent image processing jobs being sent to the queue:

```bash
cd tools
pip install boto3 python-dotenv
python load_test.py
```

This will:
- Send 100 job messages to the SQS queue
- Each message references `sample.jpg` as the image key
- Watch the Python Worker terminal to see real-time processing without crashes

### Manual Job Trigger

Send a single test job to verify the full pipeline end-to-end:

```bash
cd tools
python test_trigger.py
```

---

## 🔒 Security

This project follows security best practices at every layer:

| Layer | Measure |
|-------|---------|
| **Transport** | HTTPS in production, HSTS headers via Helmet |
| **Authentication** | JWT with short expiry, `httpOnly` cookies |
| **CSRF** | Double-submit cookie pattern on all state-changing routes |
| **File Upload** | Magic-byte validation rejects disguised malicious files |
| **Input** | Zod schema validation + sanitization on all endpoints |
| **Rate Limiting** | IP-based limits (1000 req / 15 min) on all routes |
| **Containers** | Trivy vulnerability scans on every CI build |
| **AWS** | Least-privilege IAM, no public S3 bucket access |
| **Dependencies** | Dependabot auto-PRs for security patches |
| **Logging** | Structured JSON audit logging with `pino` |

See `frontend/SECURITY.md` for the full vulnerability disclosure policy.

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat: add DICOM viewer support"
   ```
4. Push to your branch:
   ```bash
   git push origin feature/your-feature-name
   ```
5. Open a Pull Request against `main`

---

## 🗂️ GitHub Repositories

This project follows a **decoupled architecture**. The source code is divided into separate repositories for frontend, backend, and deployment to follow industry best practices.

| Repository | Description | Link |
|------------|-------------|------|
| 🚀 **Main Deployment** | Integrated `docker-compose` setup, CI/CD DevSecOps pipelines (Trivy), Resource Monitoring (cAdvisor), and full system instructions | [![Deployment](https://img.shields.io/badge/GitHub-Deployment-181717?style=flat-square&logo=github)](https://github.com/DS-Group-Project/Group01-Medical-Image-Enhancer-Deployment) |
| 🎨 **Frontend** | React.js Single Page Application and UI components | [![Frontend](https://img.shields.io/badge/GitHub-Frontend-181717?style=flat-square&logo=github)](https://github.com/DS-Group-Project/Group01-Medical-Image-Enhancer-Frontend) |
| ⚙️ **Backend & Worker** | Node.js REST API Gateway and the Python OpenCV Background Worker | [![Backend](https://img.shields.io/badge/GitHub-Backend-181717?style=flat-square&logo=github)](https://github.com/DS-Group-Project/Group01-Medical-Image-Enhancer-Backend) |

### Clone Individual Repositories

```bash
# Main Deployment Repository (docker-compose + CI/CD)
git clone https://github.com/DS-Group-Project/Group01-Medical-Image-Enhancer-Deployment.git

# Frontend Repository (React.js SPA)
git clone https://github.com/DS-Group-Project/Group01-Medical-Image-Enhancer-Frontend.git

# Backend & Worker Repository (Node.js API + Python Worker)
git clone https://github.com/DS-Group-Project/Group01-Medical-Image-Enhancer-Backend.git
```

---

<div align="center">

**DS Group 01 — Medical Image Enhancer**

Built with security, scalability, and real-world DevSecOps practices in mind.

[Back to Top](#-medical-image-enhancer)

</div>
