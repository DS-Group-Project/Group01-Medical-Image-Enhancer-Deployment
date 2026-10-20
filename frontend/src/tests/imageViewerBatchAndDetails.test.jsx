/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ImageViewerPage from '../pages/ImageViewerPage';

afterEach(() => {
  cleanup();
});

const { mockJob1, mockJob2 } = vi.hoisted(() => {
  const j1 = {
    id: 'job_001',
    jobId: 'job_001',
    filename: 'dcsdcsd_20261018_175648_1.jpg',
    status: 'completed',
    fileSize: 24678, // ~24.1 KB
    createdAt: '2026-10-18T12:00:00.000Z',
    completedAt: '2026-10-18T12:00:02.300Z', // 2.3s
    originalUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    enhancedUrl: 'data:image/svg+xml;utf8,<svg></svg>'
  };

  const j2 = {
    id: 'job_002',
    jobId: 'job_002',
    filename: 'dcsdcsd_20261018_175648_2.jpg',
    status: 'completed',
    fileSize: 18892, // ~18.45 KB
    createdAt: '2026-10-18T12:00:00.000Z',
    completedAt: '2026-10-18T12:00:03.100Z', // 3.1s
    originalUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    enhancedUrl: 'data:image/svg+xml;utf8,<svg></svg>'
  };

  return { mockJob1: j1, mockJob2: j2 };
});

vi.mock('../services/uploadService', () => ({
  uploadService: {
    getJobStatus: vi.fn().mockImplementation(async (id) => {
      if (id === 'job_002') return mockJob2;
      return mockJob1;
    }),
    getBatchJobsStatus: vi.fn().mockResolvedValue([mockJob1, mockJob2]),
    getJobs: vi.fn().mockResolvedValue({ jobs: [mockJob1, mockJob2] }),
    downloadImage: vi.fn().mockResolvedValue(true)
  }
}));

vi.mock('../services/mockData', () => ({
  mockUploadService: {
    getJobStatus: vi.fn().mockImplementation(async (id) => {
      if (id === 'job_002') return mockJob2;
      return mockJob1;
    }),
    getBatchJobsStatus: vi.fn().mockResolvedValue([mockJob1, mockJob2]),
    getJobs: vi.fn().mockResolvedValue({ jobs: [mockJob1, mockJob2] }),
    downloadImage: vi.fn().mockResolvedValue(true)
  }
}));

// Mock Veda context
vi.mock('../context/VedaContext', () => ({
  useVeda: () => ({
    setActiveJobContext: vi.fn(),
    activeMarker: null
  })
}));

describe('ImageViewerPage Batch Examination & Real Metadata', () => {
  it('renders multi-image batch bar and allows switching between scans', async () => {
    render(
      <MemoryRouter initialEntries={['/viewer/job_001?batch=job_001,job_002']}>
        <Routes>
          <Route path="/viewer/:jobId" element={<ImageViewerPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for the job to load
    await waitFor(() => {
      expect(screen.getAllByText('dcsdcsd_20261018_175648_1.jpg').length).toBeGreaterThan(0);
    });

    // Wait for Batch Examination bar to be present
    await waitFor(() => {
      expect(screen.getByText('Batch Examination')).toBeInTheDocument();
      expect(screen.getByText(/Scan 1 of 2/i)).toBeInTheDocument();
      expect(screen.getByText('Scan 1')).toBeInTheDocument();
      expect(screen.getByText('Scan 2')).toBeInTheDocument();
      expect(screen.getByText('Download All (2)')).toBeInTheDocument();
    });
  });

  it('displays real dynamic image details instead of hardcoded fake metadata', async () => {
    render(
      <MemoryRouter initialEntries={['/viewer/job_001?batch=job_001,job_002']}>
        <Routes>
          <Route path="/viewer/:jobId" element={<ImageViewerPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Image Details')).toBeInTheDocument();
    });

    // Check that the hardcoded fake values are NOT in the document
    expect(screen.queryByText('4.2 MB')).not.toBeInTheDocument();
    expect(screen.queryByText('2048 x 2048')).not.toBeInTheDocument();
    expect(screen.queryByText('12.4s')).not.toBeInTheDocument();

    // Check that the real file size (~24.1 KB) and real processing time (2.3s) are rendered
    await waitFor(() => {
      expect(screen.getByText('24.1 KB')).toBeInTheDocument();
      expect(screen.getByText('2.3s')).toBeInTheDocument();
    });
  });
});
