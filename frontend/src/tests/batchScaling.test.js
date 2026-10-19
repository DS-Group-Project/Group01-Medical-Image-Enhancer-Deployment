/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildBatchUrl, resolveBatchIds } from '../utils/helpers';
import { uploadService } from '../services/uploadService';
import api from '../services/api';

vi.mock('../services/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    defaults: { baseURL: 'http://localhost:5000' }
  }
}));

describe('100-Image Batch Scaling Architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  describe('buildBatchUrl & resolveBatchIds', () => {
    it('returns standard query string for small batches (<= 8)', () => {
      const ids = ['job1', 'job2', 'job3'];
      const url = buildBatchUrl('/viewer', 'job1', ids);
      expect(url).toBe('/viewer/job1?batch=job1,job2,job3');
    });

    it('stores in sessionStorage and returns ?batch=session for large batches (e.g. 100 images)', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `job_${i + 1}`);
      const url = buildBatchUrl('/viewer', 'job_1', ids);

      expect(url).toBe('/viewer/job_1?batch=session');
      expect(sessionStorage.getItem('active_batch')).toBe(JSON.stringify(ids));
      expect(sessionStorage.getItem('batch_job_1')).toBe(JSON.stringify(ids));
    });

    it('resolves 100 job IDs from sessionStorage when ?batch=session is passed', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `job_${i + 1}`);
      sessionStorage.setItem('active_batch', JSON.stringify(ids));

      const resolved = resolveBatchIds('session', null, 'job_1');
      expect(resolved).toHaveLength(100);
      expect(resolved[0]).toBe('job_1');
      expect(resolved[99]).toBe('job_100');
    });

    it('resolves job IDs from comma-separated query string for backwards compatibility', () => {
      const resolved = resolveBatchIds('j1,j2,j3', null, 'j1');
      expect(resolved).toEqual(['j1', 'j2', 'j3']);
    });
  });

  describe('uploadService.getBatchJobsStatus', () => {
    it('fetches status for 100 jobs in a single API call instead of 100 separate requests', async () => {
      const ids = Array.from({ length: 100 }, (_, i) => `job_${i + 1}`);
      const mockJobs = ids.map(id => ({ jobId: id, status: 'completed', filename: `${id}.png` }));

      api.post.mockResolvedValueOnce({ data: { jobs: mockJobs } });

      const result = await uploadService.getBatchJobsStatus(ids);

      expect(api.post).toHaveBeenCalledTimes(1);
      expect(api.post).toHaveBeenCalledWith('/jobs/batch-status', { jobIds: ids });
      expect(result).toHaveLength(100);
      expect(result[0].id).toBe('job_1');
      expect(result[99].id).toBe('job_100');
    });
  });

  describe('uploadService.uploadImages with Chunking', () => {
    it('chunks an upload of 35 files into batches of 15 to prevent timeouts and payload limits', async () => {
      const fakeFiles = Array.from({ length: 35 }, (_, i) => ({
        name: `scan_${i + 1}.jpg`,
        size: 1024 * 1024, // 1MB
      }));

      api.post.mockResolvedValue({
        data: { jobs: [{ id: 'job_created' }] }
      });

      const onProgress = vi.fn();
      await uploadService.uploadImages(fakeFiles, onProgress);

      // 35 files / 15 per chunk = 3 API calls (15, 15, 5)
      expect(api.post).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenCalledWith(100);
    });
  });
});
