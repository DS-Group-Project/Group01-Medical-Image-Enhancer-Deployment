/**
 * Mock Data and Services for local development and testing without a backend.
 */

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// SECURITY: No external CDN URLs in mock data. In a medical/healthcare app,
// loading images from third-party services (picsum.photos, pravatar.cc) leaks
// network requests that could be logged, and violates the app's CSP policy.
// Use null — the UI components handle missing URLs with local placeholders.
export const mockUser = {
  id: 'usr_001',
  name: 'Dr. Jane Smith',
  email: 'jane.smith@medical.example.com',
  avatar: null,
  role: 'radiologist'
};

const getDaysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

const makeSvgThumb = (title, color = '%230d9488') =>
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="%23090d16"/><circle cx="150" cy="150" r="105" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="8 6" opacity="0.3"/><path d="M100 80 Q150 120 200 80 M150 60 L150 240 M100 220 Q150 180 200 220 M120 150 L180 150" stroke="${color}" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.75"/><text x="150" y="275" fill="%23cbd5e1" font-family="sans-serif" font-weight="600" font-size="14" text-anchor="middle">${title}</text></svg>`;

export const mockJobs = [
  { id: 'job_001', status: 'completed', filename: 'chest_xray_001.jpg', createdAt: getDaysAgo(0), completedAt: getDaysAgo(0), thumbnailUrl: makeSvgThumb('Chest X-Ray'), originalUrl: makeSvgThumb('Chest X-Ray'), enhancedUrl: makeSvgThumb('Chest Enhanced', '%232dd4bf') },
  { id: 'job_002', status: 'processing', filename: 'brain_mri_ax.png', createdAt: getDaysAgo(0), progress: 45, thumbnailUrl: makeSvgThumb('Brain MRI', '%2338bdf8'), originalUrl: makeSvgThumb('Brain MRI', '%2338bdf8') },
  { id: 'job_003', status: 'completed', filename: 'knee_xr_lat.jpg', createdAt: getDaysAgo(1), completedAt: getDaysAgo(1), thumbnailUrl: makeSvgThumb('Knee X-Ray'), originalUrl: makeSvgThumb('Knee X-Ray'), enhancedUrl: makeSvgThumb('Knee Enhanced', '%232dd4bf') },
  { id: 'job_004', status: 'pending', filename: 'spine_ct_03.dcm', createdAt: getDaysAgo(1), thumbnailUrl: makeSvgThumb('Spine CT', '%23818cf8'), originalUrl: makeSvgThumb('Spine CT', '%23818cf8') },
  { id: 'job_005', status: 'failed', filename: 'corrupted_file.jpg', createdAt: getDaysAgo(2), error: 'Invalid image format or corrupted data', thumbnailUrl: makeSvgThumb('Corrupted Scan', '%23ef4444'), originalUrl: makeSvgThumb('Corrupted Scan', '%23ef4444') },
  { id: 'job_006', status: 'completed', filename: 'dental_panoramic.png', createdAt: getDaysAgo(2), completedAt: getDaysAgo(2), thumbnailUrl: makeSvgThumb('Dental X-Ray'), originalUrl: makeSvgThumb('Dental X-Ray'), enhancedUrl: makeSvgThumb('Dental Enhanced', '%232dd4bf') },
  { id: 'job_007', status: 'completed', filename: 'hand_xray_AP.jpg', createdAt: getDaysAgo(3), completedAt: getDaysAgo(3), thumbnailUrl: makeSvgThumb('Hand X-Ray'), originalUrl: makeSvgThumb('Hand X-Ray'), enhancedUrl: makeSvgThumb('Hand Enhanced', '%232dd4bf') },
  { id: 'job_008', status: 'completed', filename: 'chest_CT_coronal.png', createdAt: getDaysAgo(3), completedAt: getDaysAgo(3), thumbnailUrl: makeSvgThumb('Chest CT'), originalUrl: makeSvgThumb('Chest CT'), enhancedUrl: makeSvgThumb('Chest CT Enhanced', '%232dd4bf') },
  { id: 'job_009', status: 'processing', filename: 'pelvis_mri_t2.dcm', createdAt: getDaysAgo(4), progress: 85, thumbnailUrl: makeSvgThumb('Pelvis MRI', '%23a855f7'), originalUrl: makeSvgThumb('Pelvis MRI', '%23a855f7') },
  { id: 'job_010', status: 'completed', filename: 'skull_xray_lat.jpg', createdAt: getDaysAgo(5), completedAt: getDaysAgo(5), thumbnailUrl: makeSvgThumb('Skull X-Ray'), originalUrl: makeSvgThumb('Skull X-Ray'), enhancedUrl: makeSvgThumb('Skull Enhanced', '%232dd4bf') },
  { id: 'job_011', status: 'completed', filename: 'shoulder_mri.png', createdAt: getDaysAgo(6), completedAt: getDaysAgo(6), thumbnailUrl: makeSvgThumb('Shoulder MRI'), originalUrl: makeSvgThumb('Shoulder MRI'), enhancedUrl: makeSvgThumb('Shoulder Enhanced', '%232dd4bf') },
  { id: 'job_012', status: 'completed', filename: 'abd_ultrasound.jpg', createdAt: getDaysAgo(7), completedAt: getDaysAgo(7), thumbnailUrl: makeSvgThumb('Ultrasound', '%2306b6d4'), originalUrl: makeSvgThumb('Ultrasound', '%2306b6d4'), enhancedUrl: makeSvgThumb('Ultrasound Enhanced', '%232dd4bf') },
];

export const mockStats = {
  totalUploads: 147,
  processing: 3,
  completed: 138,
  failed: 6
};

/**
 * Mock auth session state.
 *
 * Deliberately kept in memory (module-level variable) rather than in
 * localStorage/sessionStorage. The real backend will use an HttpOnly cookie
 * that JS cannot read, so the mock should not simulate "logged in" via any
 * JS-readable storage either — that would make the mock's security shape
 * misleading and mask bugs (e.g. code that accidentally reads a client-side
 * token) before they hit the real backend. A page refresh resetting the
 * mock session is expected and mirrors calling getCurrentUser() against a
 * real server after a cookie expires.
 */
let mockSessionActive = false;

export const mockAuthService = {
  login: async (email, password) => {
    await delay(600);
    if (!email || !password) {
      throw { response: { status: 400, data: { message: 'Email and password are required' } } };
    }
    // NOTE: this mock intentionally does not "validate" credentials against a
    // real user store because there isn't one yet — any non-empty email and
    // password 'succeeds', matching how most people wire up mocks before the
    // backend exists. Don't carry this permissiveness into the real authService.
    mockSessionActive = true;
    return { user: mockUser };
  },
  register: async (userData) => {
    await delay(800);
    mockSessionActive = true;
    return { user: { ...mockUser, name: userData.name, email: userData.email } };
  },
  logout: async () => {
    await delay(300);
    mockSessionActive = false;
  },
  getCurrentUser: async () => {
    await delay(400);
    if (!mockSessionActive) {
      throw { response: { status: 401, data: { message: 'Unauthorized' } } };
    }
    return { user: mockUser };
  },
};

export const mockUploadService = {
  uploadImages: async (files, onProgress) => {
    // Simulate upload progress
    if (onProgress) {
      for (let i = 10; i <= 100; i += 10) {
        await delay(100);
        onProgress(i);
      }
    } else {
      await delay(1000);
    }
    const newJobs = files.map((file, idx) => ({
      id: `job_new_${Date.now()}_${idx}`,
      status: 'pending',
      filename: file.name,
      fileSize: file.size,
      createdAt: new Date().toISOString(),
      originalUrl: URL.createObjectURL(file)
    }));
    return { jobs: newJobs };
  },
  getJobStatus: async (jobId) => {
    await delay(300);
    const job = mockJobs.find(j => j.id === jobId) || { id: jobId, status: 'completed', filename: 'mock.jpg' };
    return {
      ...job,
      originalUrl: job.originalUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="%230f172a"/><text x="50%" y="50%" fill="%230d9488" font-family="sans-serif" font-size="24" text-anchor="middle" dominant-baseline="middle">Original X-Ray (Sample)</text></svg>',
      enhancedUrl: job.enhancedUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="%23042f2e"/><text x="50%" y="50%" fill="%232dd4bf" font-family="sans-serif" font-size="24" text-anchor="middle" dominant-baseline="middle">Enhanced X-Ray (Sample)</text></svg>',
    };
  },
  getBatchJobsStatus: async (jobIds) => {
    await delay(200);
    return jobIds.map(id => {
      const job = mockJobs.find(j => j.id === id) || { id, status: 'completed', filename: 'mock.jpg' };
      return {
        ...job,
        jobId: job.id,
        thumbnailUrl: job.thumbnailUrl || job.enhancedUrl || job.originalUrl,
      };
    });
  },
  getJobs: async (params = {}) => {
    await delay(500);
    const { page = 1, limit = 10, status, search } = params;
    let filteredJobs = [...mockJobs];
    
    if (status) {
      filteredJobs = filteredJobs.filter(job => job.status === status);
    }
    if (search) {
      filteredJobs = filteredJobs.filter(job => job.filename.toLowerCase().includes(search.toLowerCase()));
    }
    
    const startIndex = (page - 1) * limit;
    const paginatedJobs = filteredJobs.slice(startIndex, startIndex + limit);
    
    return {
      jobs: paginatedJobs,
      total: filteredJobs.length,
      page,
      totalPages: Math.ceil(filteredJobs.length / limit)
    };
  },
  downloadImage: async (jobId, type) => {
    await delay(600);
    // Simulate file download by creating an empty blob
    const url = window.URL.createObjectURL(new Blob(['mock data']));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${type}-${jobId}.mock`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
  deleteJob: async (jobId) => {
    await delay(400);
    return { success: true, message: 'Job deleted successfully' };
  },
  deleteBatchJobs: async (jobIds) => {
    await delay(400);
    return { success: true, message: `Successfully deleted ${jobIds.length} job(s)`, deletedCount: jobIds.length, deletedIds: jobIds };
  }
};
