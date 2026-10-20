/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import HistoryPage from '../pages/HistoryPage';
import { uploadService } from '../services/uploadService';

vi.mock('../services/uploadService', () => ({
  uploadService: {
    getJobs: vi.fn(),
    deleteJob: vi.fn(),
    deleteBatchJobs: vi.fn(),
    downloadImage: vi.fn(),
  },
}));

vi.mock('../components/ui/ScanThumbnail', () => ({
  ScanThumbnail: () => <div data-testid="scan-thumbnail" />,
  thumbnailBlobCache: new Map(),
}));

afterEach(() => {
  cleanup();
});

describe('File Deletion Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn().mockReturnValue(true);
  });

  it('renders HistoryPage with batch selection controls and triggers batch delete', async () => {
    const mockJobs = [
      { id: 'job-1', filename: 'scan1.jpg', createdAt: new Date().toISOString(), status: 'completed' },
      { id: 'job-2', filename: 'scan2.jpg', createdAt: new Date().toISOString(), status: 'completed' },
    ];

    uploadService.getJobs.mockResolvedValue(mockJobs);
    uploadService.deleteBatchJobs.mockResolvedValue({ success: true, deletedCount: 2 });

    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    );

    // Wait for jobs to render
    await waitFor(() => {
      expect(screen.getByText('scan1.jpg')).toBeDefined();
      expect(screen.getByText('scan2.jpg')).toBeDefined();
    });

    // Select all button in table header
    const selectAllBtn = screen.getByTitle('Select all on this page');
    fireEvent.click(selectAllBtn);

    // Batch action bar appears
    await waitFor(() => {
      expect(screen.getByText('2 files selected')).toBeDefined();
    });

    // Click delete selected
    const deleteBatchBtn = screen.getByText(/Delete Selected/i);
    fireEvent.click(deleteBatchBtn);

    await waitFor(() => {
      expect(uploadService.deleteBatchJobs).toHaveBeenCalledWith(expect.arrayContaining(['job-1', 'job-2']));
    });
  });

  it('allows single file deletion directly from the row', async () => {
    const mockJobs = [
      { id: 'job-single', filename: 'solo.jpg', createdAt: new Date().toISOString(), status: 'completed' },
    ];

    uploadService.getJobs.mockResolvedValue(mockJobs);
    uploadService.deleteJob.mockResolvedValue({ success: true, message: 'Deleted' });

    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('solo.jpg')).toBeDefined();
    });

    const deleteBtn = screen.getByTitle('Delete Scan');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(uploadService.deleteJob).toHaveBeenCalledWith('job-single');
    });
  });
});
