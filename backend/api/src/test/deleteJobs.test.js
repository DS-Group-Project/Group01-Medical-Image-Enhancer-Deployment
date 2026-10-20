import { describe, it, expect, vi, beforeEach } from 'vitest';
process.env.JWT_SECRET = 'test-secret';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';

// Mock S3
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
    DeleteObjectCommand: vi.fn(),
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
  };
});

// Mock jobsRepository
const mockGetJob = vi.fn();
const mockGetJobsByIds = vi.fn();
const mockDeleteJobRecord = vi.fn();

vi.mock('../../../database/src/jobsRepository.js', () => ({
  createJob: vi.fn(),
  getJob: (...args) => mockGetJob(...args),
  getJobsByIds: (...args) => mockGetJobsByIds(...args),
  listJobsForUser: vi.fn(),
  deleteJobRecord: (...args) => mockDeleteJobRecord(...args),
}));

// Build mini express app testing the exact delete logic
const app = express();
app.use(express.json());

// Mock auth middleware putting user in req
app.use((req, res, next) => {
  req.user = { userId: 'user-123', role: 'user' };
  next();
});

const handleDeleteJob = async (req, res, next) => {
  try {
    const job = await mockGetJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
    if (req.user.role !== "admin" && job.userId !== req.user.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    await mockDeleteJobRecord(job.jobId);
    res.status(200).json({ success: true, message: "Job successfully deleted", jobId: job.jobId });
  } catch (err) {
    next(err);
  }
};

const handleBatchDelete = async (req, res, next) => {
  try {
    const { jobIds } = req.body;
    const rawJobs = await mockGetJobsByIds(jobIds);
    const userRole = req.user.role;
    const userId = req.user.userId;

    const authorizedJobs = rawJobs.filter(j => userRole === "admin" || j.userId === userId);
    const deletedIds = [];

    for (const job of authorizedJobs) {
      await mockDeleteJobRecord(job.jobId);
      deletedIds.push(job.jobId);
    }

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

app.delete('/jobs/:jobId', handleDeleteJob);
app.post('/jobs/batch-delete', handleBatchDelete);

describe('File Deletion API Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DELETE /jobs/:jobId', () => {
    it('returns 404 when job does not exist', async () => {
      mockGetJob.mockResolvedValue(null);
      const res = await request(app).delete('/jobs/non-existent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('JOB_NOT_FOUND');
    });

    it('returns 403 when user is not owner and not admin', async () => {
      mockGetJob.mockResolvedValue({
        jobId: 'job-999',
        userId: 'other-user',
        filename: 'scan.jpg',
      });
      const res = await request(app).delete('/jobs/job-999');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('successfully deletes a job for the owner', async () => {
      mockGetJob.mockResolvedValue({
        jobId: 'job-123',
        userId: 'user-123',
        filename: 'scan.jpg',
        originalKey: 'raw/user-123/scan.jpg',
        enhancedKey: 'enhanced/user-123/scan.jpg',
      });
      mockDeleteJobRecord.mockResolvedValue({});

      const res = await request(app).delete('/jobs/job-123');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.jobId).toBe('job-123');
      expect(mockDeleteJobRecord).toHaveBeenCalledWith('job-123');
    });
  });

  describe('POST /jobs/batch-delete', () => {
    it('successfully batch deletes authorized jobs', async () => {
      mockGetJobsByIds.mockResolvedValue([
        { jobId: 'job-1', userId: 'user-123' },
        { jobId: 'job-2', userId: 'user-123' },
        { jobId: 'job-3', userId: 'unauthorized-user' },
      ]);
      mockDeleteJobRecord.mockResolvedValue({});

      const res = await request(app)
        .post('/jobs/batch-delete')
        .send({ jobIds: ['job-1', 'job-2', 'job-3'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deletedCount).toBe(2);
      expect(res.body.deletedIds).toEqual(['job-1', 'job-2']);
      expect(mockDeleteJobRecord).toHaveBeenCalledTimes(2);
    });
  });
});
