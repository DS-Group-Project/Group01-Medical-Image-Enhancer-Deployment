import api from './api';
import safeLog from '../utils/safeLog';
import { thumbnailBlobCache } from '../components/ui/ScanThumbnail';

// Persistent in-memory blob cache for high-res viewer scans to make tab switches and re-visits instantaneous (0ms)
export const imageBlobCache = new Map();

/**
 * Service for handling image uploads and job management API calls.
 */
export const uploadService = {
  /**
   * Uploads multiple images for enhancement. Automatically chunks large batches (e.g. up to 100 images)
   * to guarantee connection stability and prevent request timeouts.
   * 
   * @param {File[]} files - An array of File objects to upload.
   * @param {Function} [onProgress] - Optional callback function to track upload progress (0-100).
   * @returns {Promise<{jobs: Object[]}>} The created job objects.
   */
  uploadImages: async (files, onProgress) => {
    if (!files || files.length === 0) return { jobs: [] };

    const CHUNK_SIZE = 15;
    if (files.length <= CHUNK_SIZE) {
      const formData = new FormData();
      files.forEach((file) => formData.append('images', file));

      const response = await api.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(percentCompleted);
          }
        },
      });
      return response.data;
    }

    // Chunked upload for larger batches (up to 100 files) to maintain fast transfer and zero timeouts
    const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0) || 1;
    let completedBytes = 0;
    const allJobs = [];

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      const chunkBytes = chunk.reduce((acc, f) => acc + (f.size || 0), 0);
      const formData = new FormData();
      chunk.forEach((file) => formData.append('images', file));

      let response;
      let attempt = 0;
      while (attempt < 3) {
        try {
          attempt++;
          response = await api.post('/upload', formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            onUploadProgress: (progressEvent) => {
              if (onProgress) {
                const currentLoaded = progressEvent.loaded || 0;
                const overallLoaded = Math.min(totalBytes, completedBytes + currentLoaded);
                onProgress(Math.round((overallLoaded * 100) / totalBytes));
              }
            },
          });
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
          await new Promise(r => setTimeout(r, 800 * attempt));
        }
      }

      completedBytes += chunkBytes;
      if (response.data?.jobs) {
        allJobs.push(...response.data.jobs);
      }
    }

    if (onProgress) onProgress(100);
    return { jobs: allJobs };
  },

  /**
   * Retrieves status for a batch of jobs (up to 100) in a single request.
   * Completely avoids N-requests-per-second polling storms.
   * 
   * @param {string[]} jobIds - Array of job IDs to query.
   * @returns {Promise<Object[]>} Array of normalized job objects.
   */
  getBatchJobsStatus: async (jobIds) => {
    if (!Array.isArray(jobIds) || jobIds.length === 0) return [];
    const baseURL = api.defaults.baseURL || 'http://localhost:5000';

    try {
      const response = await api.post('/jobs/batch-status', { jobIds: jobIds.slice(0, 100) });
      const jobs = response.data?.jobs || [];
      return jobs.map(job => {
        const thumb = job.thumbnailUrl || (
          (job.enhancedKey || job.originalKey)
            ? `/jobs/${job.id || job.jobId}/image/stream?type=${job.enhancedKey ? 'enhanced' : 'original'}`
            : null
        );
        const resolvedThumb = thumb
          ? (thumb.startsWith('http') || thumb.startsWith('data:') ? thumb : `${baseURL}${thumb}`)
          : null;

        return {
          ...job,
          id: job.id || job.jobId,
          jobId: job.jobId || job.id,
          thumbnailUrl: resolvedThumb,
          thumbnail: resolvedThumb,
        };
      });
    } catch (err) {
      safeLog.error("Batch status lookup failed, falling back to individual queries:", err?.message);
      const fallbackResults = await Promise.allSettled(
        jobIds.map(id => api.get(`/jobs/${id}`).then(r => r.data))
      );
      return fallbackResults
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
    }
  },

  /**
   * Loads a single image stream as a blob URL, leveraging the in-memory cache
   * 
   * @param {string} jobId - The unique identifier of the job.
   * @param {'enhanced'|'original'} type - Which image stream to fetch.
   * @returns {Promise<string|null>} The object URL.
   */
  loadImageStream: async (jobId, type = 'enhanced') => {
    const cacheKey = `${jobId}_${type}`;
    if (imageBlobCache.has(cacheKey)) {
      return imageBlobCache.get(cacheKey);
    }

    try {
      const res = await api.get(`/jobs/${jobId}/image/stream?type=${type}`, { responseType: 'blob' });
      if (res?.data) {
        const url = window.URL.createObjectURL(res.data);
        imageBlobCache.set(cacheKey, url);
        return url;
      }
    } catch (err) {
      safeLog.error(`Could not load ${type} image stream:`, err?.message);
    }
    return null;
  },

  /**
   * Retrieves the status of a specific enhancement job with instant cache lookup.
   * 
   * @param {string} jobId - The unique identifier of the job.
   * @returns {Promise<{id: string, status: string, originalUrl: string, enhancedUrl: string, filename: string, createdAt: string, completedAt: string}>} The job details.
   */
  getJobStatus: async (jobId) => {
    const response = await api.get(`/jobs/${jobId}`);
    const job = response.data;

    // Fast-path 1: Check high-res memory cache
    const cachedOrig = imageBlobCache.get(`${jobId}_original`);
    const cachedEnh = imageBlobCache.get(`${jobId}_enhanced`);

    if (cachedOrig) job.originalUrl = cachedOrig;
    if (cachedEnh) job.enhancedUrl = cachedEnh;

    // Fast-path 2: Check thumbnail blob cache for immediate preview
    const thumbPreview = thumbnailBlobCache?.get(jobId);
    if (!job.enhancedUrl && thumbPreview) {
      job.enhancedUrl = thumbPreview;
    }
    if (!job.originalUrl && thumbPreview) {
      job.originalUrl = thumbPreview;
    }

    // If both full images are already cached, return in 0ms!
    if (cachedOrig && cachedEnh) {
      return job;
    }

    // Fetch missing streams in parallel
    const fetchPromises = [
      !cachedOrig
        ? api.get(`/jobs/${jobId}/image/stream?type=original`, { responseType: 'blob' })
        : Promise.resolve(null),
      job.status === 'completed' && !cachedEnh
        ? api.get(`/jobs/${jobId}/image/stream?type=enhanced`, { responseType: 'blob' })
        : Promise.resolve(null),
    ];

    const [origResult, enhResult] = await Promise.allSettled(fetchPromises);

    if (origResult.status === 'fulfilled' && origResult.value?.data) {
      const blob = origResult.value.data;
      const url = window.URL.createObjectURL(blob);
      imageBlobCache.set(`${jobId}_original`, url);
      job.originalUrl = url;
      if (blob.size) {
        job.originalSize = blob.size;
        if (!job.fileSize) job.fileSize = blob.size;
      }
    } else if (origResult.status === 'rejected') {
      safeLog.error("Could not load original image blob", origResult.reason);
    }

    if (enhResult.status === 'fulfilled' && enhResult.value?.data) {
      const blob = enhResult.value.data;
      const url = window.URL.createObjectURL(blob);
      imageBlobCache.set(`${jobId}_enhanced`, url);
      job.enhancedUrl = url;
      if (blob.size) {
        job.enhancedSize = blob.size;
        job.fileSize = blob.size;
      }
    } else if (enhResult.status === 'rejected') {
      safeLog.error("Could not load enhanced image blob", enhResult.reason);
    }

    return job;
  },

  /**
   * Retrieves a paginated list of enhancement jobs.
   * 
   * @param {Object} params - Query parameters.
   * @param {number} [params.page=1] - The page number.
   * @param {number} [params.limit=10] - The number of items per page.
   * @param {string} [params.status] - Filter by job status (e.g., 'completed', 'pending').
   * @param {string} [params.search] - Search query for filenames.
   * @returns {Promise<{jobs: Object[], total: number, page: number, totalPages: number}>} Paginated jobs response.
   */
  getJobs: async (params = {}) => {
    // Backend defaults to limit=10 and cursor pagination.
    // Frontend does client-side pagination, so we fetch more upfront.
    const response = await api.get('/jobs', { params: { limit: 100, ...params } });
    const data = response.data;
    const baseURL = api.defaults.baseURL || 'http://localhost:5000';

    const jobs = (data.jobs || []).map(job => {
      const thumb = job.thumbnailUrl || (
        (job.enhancedKey || job.originalKey)
          ? `/jobs/${job.id || job.jobId}/image/stream?type=${job.enhancedKey ? 'enhanced' : 'original'}`
          : null
      );
      const resolvedThumb = thumb
        ? (thumb.startsWith('http') || thumb.startsWith('data:') ? thumb : `${baseURL}${thumb}`)
        : null;

      return {
        ...job,
        id: job.id || job.jobId,
        jobId: job.jobId || job.id,
        thumbnailUrl: resolvedThumb,
        thumbnail: resolvedThumb,
      };
    });

    return { ...data, jobs };
  },

  /**
   * Downloads an image related to a job.
   * 
   * @param {string} jobId - The unique identifier of the job.
   * @param {'original'|'enhanced'|'both'} type - The type of image(s) to download.
   * @returns {Promise<void>} Triggers file download in the browser.
   */
  downloadImage: async (jobId, type) => {
    // 1. Get the presigned URL with the download flag
    const response = await api.get(`/jobs/${jobId}/image?type=${type}&download=true`);
    const presignedUrl = response.data.url;

    if (!presignedUrl) throw new Error('Image URL not found');

    // 2. Direct the browser to the URL (S3 handles the download via Content-Disposition)
    const link = document.createElement('a');
    link.href = presignedUrl;
    // We don't need to set the download attribute because S3 forces it
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  /**
   * Deletes a specific enhancement job and its associated files.
   * 
   * @param {string} jobId - The unique identifier of the job.
   * @returns {Promise<{success: boolean, message: string}>} Success message.
   */
  deleteJob: async (jobId) => {
    if (!jobId) return { message: 'No jobId provided' };
    imageBlobCache.delete(`${jobId}_original`);
    imageBlobCache.delete(`${jobId}_enhanced`);
    if (thumbnailBlobCache && typeof thumbnailBlobCache.delete === 'function') {
      thumbnailBlobCache.delete(jobId);
    }
    const response = await api.delete(`/jobs/${jobId}`);
    return response.data;
  },

  /**
   * Deletes multiple enhancement jobs and their associated files in a single request.
   * 
   * @param {string[]} jobIds - Array of job IDs to delete.
   * @returns {Promise<{success: boolean, deletedCount: number, deletedIds: string[]}>}
   */
  deleteBatchJobs: async (jobIds) => {
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return { success: true, deletedCount: 0, deletedIds: [] };
    }
    jobIds.forEach((id) => {
      imageBlobCache.delete(`${id}_original`);
      imageBlobCache.delete(`${id}_enhanced`);
      if (thumbnailBlobCache && typeof thumbnailBlobCache.delete === 'function') {
        thumbnailBlobCache.delete(id);
      }
    });
    const response = await api.post('/jobs/batch-delete', { jobIds });
    return response.data;
  }
};

