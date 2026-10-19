import "dotenv/config";

// Ensure Windows local certificate chains do not break AWS S3 and external TLS handshakes
if (process.platform === "win32" && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import express from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import cors from "cors";
import multer from "multer";
import cookieParser from "cookie-parser";
import { doubleCsrf } from "csrf-csrf";
import helmet from "helmet";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";

import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import jobsRoutes, { listUserJobs } from "./routes/jobs.js";
import vedaRoutes from "./routes/veda.js";

import { validate } from "./middleware/validate.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth, requireSelfOrAdmin } from "./middleware/auth.js";
import { createJob, getJob, getJobsByIds, listJobsForUser, deleteJobRecord } from "../../database/src/jobsRepository.js";
import { validateFileSignature } from "./utils/fileValidation.js";
import logger from "./utils/logger.js";

const app = express();

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:3000",
  "http://localhost:3001",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"],
}));

// ─── Body Parsers & Cookies ───────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: "Too many requests, please try again later." }
});
app.use(globalLimiter);

// ─── CSRF Protection ──────────────────────────────────────────────────────────
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || "default_csrf_secret_for_dev_only",
  getSessionIdentifier: (req) => req.ip || "",
  cookieName: "x-csrf-token",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  size: 64,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
});

// Endpoint for frontend to fetch CSRF token
app.get("/csrf-token", (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});

// CSRF Middleware: Bypass on /auth endpoints, batch-status query, and Bearer auth to avoid 403 on session refresh
app.use((req, res, next) => {
  if (req.path.startsWith("/auth/")) {
    return next();
  }
  if (req.path.includes("/jobs/batch-status")) {
    return next();
  }
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    return next();
  }
  doubleCsrfProtection(req, res, next);
});

// ─── AWS Clients ──────────────────────────────────────────────────────────────
const awsCredentials = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ? {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
} : undefined;

export const s3 = new S3Client({ 
  region: process.env.AWS_DEFAULT_REGION || "us-east-1",
  credentials: awsCredentials,
  maxAttempts: 5,
});
export const sqs = new SQSClient({ 
  region: process.env.AWS_DEFAULT_REGION || "us-east-1",
  credentials: awsCredentials,
});

async function uploadToS3WithRetry(commandInput, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await s3.send(new PutObjectCommand(commandInput));
    } catch (err) {
      logger.warn({ attempt, err: err.message, key: commandInput.Key }, "S3 upload attempt failed, retrying...");
      if (attempt === maxRetries) throw err;
      await new Promise(res => setTimeout(res, 300 * attempt));
    }
  }
}

export const RAW_BUCKET = process.env.RAW_BUCKET_NAME;
export const PROCESSED_BUCKET = process.env.PROCESSED_BUCKET_NAME;
export const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;

// ─── Multer (Disk Storage) ────────────────────────────────────────────────────
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 52_428_800 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/dicom"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`), false);
    }
  },
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", veda: "mounted" });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/auth", authRoutes);

app.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.use("/users", usersRoutes);
app.get(
  "/users/:userId/jobs",
  requireAuth,
  requireSelfOrAdmin("userId"),
  listUserJobs
);

// Mount Veda router
app.use("/veda", vedaRoutes);
app.use("/api/veda", vedaRoutes);

// ─── Upload Endpoint ──────────────────────────────────────────────────────────
app.post("/upload", requireAuth, upload.array("images", 100), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No image files provided" });
    }

    // Validate all file signatures concurrently for maximum throughput
    await Promise.all(req.files.map(async (file) => {
      const trueMimeType = await validateFileSignature(file.path);
      if (!trueMimeType) {
        throw new Error(`INVALID_FILE_SIGNATURE:${file.originalname}`);
      }
      file.trueMimeType = trueMimeType;
    }));

    // Process files with bounded concurrency of 15 (matching chunk batch size)
    const processFile = async (file) => {
      const imageKey = `raw/${req.user.userId}/${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;

      try {
        const fileBuffer = await fs.promises.readFile(file.path);
        
        logger.info({ action: "audit_s3_upload", userId: req.user.userId, bucket: RAW_BUCKET, key: imageKey }, "Uploading original image to S3");
        
        await uploadToS3WithRetry({
          Bucket: RAW_BUCKET,
          Key: imageKey,
          Body: fileBuffer,
          ContentLength: file.size,
          ContentType: file.trueMimeType,
        });

        const job = await createJob({
          userId: req.user.userId,
          filename: file.originalname,
          originalKey: imageKey,
          fileSize: file.size,
        });

        await sqs.send(new SendMessageCommand({
          QueueUrl: SQS_QUEUE_URL,
          MessageBody: JSON.stringify({
            jobId: job.jobId,
            originalKey: imageKey,
          }),
        }));

        return job;
      } finally {
        if (file.path && fs.existsSync(file.path)) {
          await fs.promises.unlink(file.path).catch(err => logger.error({ err }, "File cleanup error"));
        }
      }
    };

    const CONCURRENCY = 15;
    const rawJobs = [];
    for (let i = 0; i < req.files.length; i += CONCURRENCY) {
      const chunk = req.files.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(processFile));
      rawJobs.push(...chunkResults);
    }

    const jobs = rawJobs.map(normaliseJob);
    res.status(201).json({ jobs });
  } catch (err) {
    if (req.files) {
      req.files.forEach(f => {
        if (f.path && fs.existsSync(f.path)) {
          try { fs.unlinkSync(f.path); } catch (_) {}
        }
      });
    }
    if (err.message && err.message.startsWith('INVALID_FILE_SIGNATURE:')) {
      const filename = err.message.split(':')[1] || '';
      return res.status(400).json({ error: `Invalid file content for file: ${filename}` });
    }
    next(err);
  }
});

// ─── Batch Jobs Status Endpoint (Scalable single-call status polling) ───────────
const batchStatusSchema = {
  body: z.object({
    jobIds: z.array(z.string()).min(1).max(100),
  })
};

const handleBatchStatus = async (req, res, next) => {
  try {
    const { jobIds } = req.body;
    const rawJobs = await getJobsByIds(jobIds);
    const userRole = req.user.role;
    const userId = req.user.userId;
    const authorizedJobs = rawJobs.filter(j => userRole === "admin" || j.userId === userId);
    res.json({ jobs: authorizedJobs.map(normaliseJob) });
  } catch (err) {
    next(err);
  }
};

app.post("/jobs/batch-status", requireAuth, validate(batchStatusSchema), handleBatchStatus);
app.post("/api/jobs/batch-status", requireAuth, validate(batchStatusSchema), handleBatchStatus);

// ─── Jobs Endpoints ───────────────────────────────────────────────────────────
const jobsQuerySchema = {
  query: z.object({
    limit: z.string().regex(/^\d+$/).optional(),
    cursor: z.string().optional(),
    status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
    search: z.string().optional()
  }).passthrough()
};

app.get("/jobs", requireAuth, validate(jobsQuerySchema), async (req, res, next) => {
  try {
    const { limit, cursor, status } = req.query;
    const result = await listJobsForUser(req.user.userId, {
      limit: limit ? Number(limit) : 10,
      cursor,
      status,
    });

    const jobs = result.jobs.map(normaliseJob);
    res.json({ jobs, nextCursor: result.nextCursor });
  } catch (err) {
    next(err);
  }
});

app.get("/jobs/:jobId/image", requireAuth, async (req, res, next) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
    if (req.user.role !== "admin" && job.userId !== req.user.userId) {
      logger.warn({ action: "audit_access_denied", jobId: job.jobId, userId: req.user.userId }, "Unauthorized image access attempt");
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const type = req.query.type === "enhanced" ? "enhanced" : "original";
    // Prefer requested type, but fallback to originalKey if enhancedKey is not yet generated
    const key = (type === "enhanced" && job.enhancedKey) ? job.enhancedKey : job.originalKey;

    if (!key) return res.status(404).json({ error: "IMAGE_NOT_AVAILABLE" });

    const bucket = (key === job.enhancedKey && job.enhancedKey) ? PROCESSED_BUCKET : RAW_BUCKET;
    const commandParams = { Bucket: bucket, Key: key };
    if (req.query.download === "true") {
      commandParams.ResponseContentDisposition = `attachment; filename="${job.filename}"`;
    }

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand(commandParams),
      { expiresIn: 900 }
    );

    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// In-memory cache for completed job metadata to avoid repetitive DynamoDB lookups during streaming
const completedJobMetaCache = new Map();

app.get("/jobs/:jobId/image/stream", requireAuth, async (req, res, next) => {
  try {
    const jobId = req.params.jobId;
    let job = completedJobMetaCache.get(jobId);
    if (!job) {
      job = await getJob(jobId);
      if (job && job.status === "completed") {
        completedJobMetaCache.set(jobId, job);
      }
    }

    if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
    if (req.user.role !== "admin" && job.userId !== req.user.userId) {
      logger.warn({ action: "audit_access_denied", jobId: job.jobId, userId: req.user.userId }, "Unauthorized image stream attempt");
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const requestedType = req.query.type === "enhanced" ? "enhanced" : "original";
    // Prefer enhanced if requested and present; otherwise seamlessly fall back to original scan
    let key = (requestedType === "enhanced" && job.enhancedKey) ? job.enhancedKey : job.originalKey;
    let bucket = (key === job.enhancedKey && job.enhancedKey) ? PROCESSED_BUCKET : RAW_BUCKET;

    if (!key) return res.status(404).json({ error: "IMAGE_NOT_AVAILABLE" });

    // Conditional caching: if browser already cached this image, return 304 in 1ms without S3 fetch
    const etag = `"${jobId}_${requestedType}"`;
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const s3Response = await s3.send(command);
      res.setHeader("Content-Type", s3Response.ContentType || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("ETag", etag);
      s3Response.Body.pipe(res);
    } catch (s3Err) {
      // If fetching from processed bucket fails, fall back to raw bucket with originalKey
      if (bucket === PROCESSED_BUCKET && job.originalKey) {
        try {
          const fallbackCmd = new GetObjectCommand({ Bucket: RAW_BUCKET, Key: job.originalKey });
          const fallbackResp = await s3.send(fallbackCmd);
          res.setHeader("Content-Type", fallbackResp.ContentType || "image/jpeg");
          res.setHeader("Cache-Control", "public, max-age=86400, immutable");
          res.setHeader("ETag", etag);
          return fallbackResp.Body.pipe(res);
        } catch (fallbackErr) {
          logger.error({ err: fallbackErr, jobId: job.jobId }, "S3 fallback stream error");
        }
      }
      throw s3Err;
    }
  } catch (err) {
    next(err);
  }
});

const handleDeleteJob = async (req, res, next) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
    if (req.user.role !== "admin" && job.userId !== req.user.userId) {
      logger.warn({ action: "audit_access_denied", jobId: job.jobId, userId: req.user.userId }, "Unauthorized job delete attempt");
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    if (job.originalKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: RAW_BUCKET, Key: job.originalKey })).catch(err => {
        logger.error({ err, jobId: job.jobId }, "Failed to delete original image from S3");
      });
    }

    if (job.enhancedKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: PROCESSED_BUCKET, Key: job.enhancedKey })).catch(err => {
        logger.error({ err, jobId: job.jobId }, "Failed to delete enhanced image from S3");
      });
    }

    completedJobMetaCache.delete(job.jobId);
    await deleteJobRecord(job.jobId);
    logger.info({ action: "audit_delete_job", jobId: job.jobId, userId: req.user.userId }, "Job and images deleted successfully");
    res.status(200).json({ success: true, message: "Job successfully deleted", jobId: job.jobId });
  } catch (err) {
    next(err);
  }
};

app.delete("/jobs/:jobId", requireAuth, handleDeleteJob);
app.delete("/api/jobs/:jobId", requireAuth, handleDeleteJob);

// ─── Batch Delete Endpoint ───────────────────────────────────────────────────
const batchDeleteSchema = {
  body: z.object({
    jobIds: z.array(z.string()).min(1).max(100),
  })
};

const handleBatchDelete = async (req, res, next) => {
  try {
    const { jobIds } = req.body;
    const rawJobs = await getJobsByIds(jobIds);
    const userRole = req.user.role;
    const userId = req.user.userId;

    const authorizedJobs = rawJobs.filter(j => userRole === "admin" || j.userId === userId);
    const deletedIds = [];

    await Promise.all(authorizedJobs.map(async (job) => {
      try {
        if (job.originalKey) {
          await s3.send(new DeleteObjectCommand({ Bucket: RAW_BUCKET, Key: job.originalKey })).catch(err => {
            logger.error({ err, jobId: job.jobId }, "Failed to delete original image from S3 in batch delete");
          });
        }
        if (job.enhancedKey) {
          await s3.send(new DeleteObjectCommand({ Bucket: PROCESSED_BUCKET, Key: job.enhancedKey })).catch(err => {
            logger.error({ err, jobId: job.jobId }, "Failed to delete enhanced image from S3 in batch delete");
          });
        }
        completedJobMetaCache.delete(job.jobId);
        await deleteJobRecord(job.jobId);
        deletedIds.push(job.jobId);
      } catch (err) {
        logger.error({ err, jobId: job.jobId }, "Error deleting job in batch");
      }
    }));

    logger.info({ action: "audit_batch_delete_jobs", count: deletedIds.length, userId }, "Batch delete jobs completed");
    res.status(200).json({
      success: true,
      message: `Successfully deleted ${deletedIds.length} file(s)`,
      deletedIds,
      deletedCount: deletedIds.length
    });
  } catch (err) {
    next(err);
  }
};

app.post("/jobs/batch-delete", requireAuth, validate(batchDeleteSchema), handleBatchDelete);
app.post("/api/jobs/batch-delete", requireAuth, validate(batchDeleteSchema), handleBatchDelete);

app.use("/jobs", jobsRoutes);

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

function normaliseJob(job) {
  const hasEnhanced = Boolean(job.enhancedKey);
  const streamType = hasEnhanced ? "enhanced" : "original";
  const thumbnailUrl = (job.enhancedKey || job.originalKey)
    ? `/jobs/${job.jobId}/image/stream?type=${streamType}`
    : (job.thumbnailUrl || null);

  return {
    id: job.jobId,
    jobId: job.jobId,
    userId: job.userId,
    filename: job.filename,
    fileSize: job.fileSize ?? null,
    bodyPart: job.bodyPart || "unspecified",
    status: job.status,
    originalKey: job.originalKey,
    enhancedKey: job.enhancedKey,
    thumbnailUrl,
    progress: job.progress ?? 0,
    error: job.error ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
  };
}

export default app;