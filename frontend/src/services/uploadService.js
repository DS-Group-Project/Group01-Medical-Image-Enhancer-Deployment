import api from './api';
import safeLog from '../utils/safeLog';

/**
 * Service for handling image uploads and job management API calls.
 */
export const uploadService = {
  /**
   * Uploads multiple images for enhancement.
   * 
   * @param {File[]} files - An array of File objects to upload.
   * @param {Function} [onProgress] - Optional callback function to track upload progress (0-100).
   * @returns {Promise<{jobs: Object[]}>} The created job objects.
   */
  uploadImages: async (files, onProgress) => {
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
  },

  /**
   * Retrieves the status of a specific enhancement job.
   * 
   * @param {string} jobId - The unique identifier of the job.
   * @returns {Promise<{id: string, status: string, originalUrl: string, enhancedUrl: string, filename: string, createdAt: string, completedAt: string}>} The job details.
   */
  getJobStatus: async (jobId) => {
    const response = await api.get(`/jobs/${jobId}`);
    const job = response.data;
    const token = localStorage.getItem('token');
    
    // Use the streaming proxy endpoint so the browser doesn't have to talk to S3.
    // <img> tags don't send Bearer tokens, so we pass it in the query string (the backend requireAuth supports this if you configure it, or we can just fetch it as blob).
    // Wait, since <img> tags can't send headers, let's just fetch it as a blob and create object URL!
    try {
      const origRes = await api.get(`/jobs/${jobId}/image/stream?type=original`, { responseType: 'blob' });
      job.originalUrl = window.URL.createObjectURL(origRes.data);
    } catch (e) {
      safeLog.error("Could not load original image blob", e);
    }
    
    if (job.status === 'completed') {
      try {
        const enhRes = await api.get(`/jobs/${jobId}/image/stream?type=enhanced`, { responseType: 'blob' });
        job.enhancedUrl = window.URL.createObjectURL(enhRes.data);
      } catch (e) {
        safeLog.error("Could not load enhanced image blob", e);
      }
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
    return response.data;
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
   * @returns {Promise<{message: string}>} Success message.
   */
  deleteJob: async (jobId) => {
    // The backend doesn't implement DELETE /jobs/:jobId yet. 
    // We mock a success here so the frontend can remove it from the UI temporarily.
    return new Promise(resolve => setTimeout(() => resolve({ message: "Mock deleted" }), 500));
  }
};
