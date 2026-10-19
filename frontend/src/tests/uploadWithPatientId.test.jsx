/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import UploadPage from '../pages/UploadPage';
import { uploadService } from '../services/uploadService';

afterEach(() => {
  cleanup();
});

// Mock uploadService
vi.mock('../services/uploadService', () => ({
  uploadService: {
    uploadImages: vi.fn().mockResolvedValue({
      jobs: [{ jobId: 'job_test_123', status: 'pending' }]
    })
  }
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Mock validateFileSignatures to immediately treat dropped files as valid
vi.mock('../utils/fileValidation', async () => {
  const actual = await vi.importActual('../utils/fileValidation');
  return {
    ...actual,
    validateFileSignatures: vi.fn().mockImplementation(async (files) => ({
      valid: files,
      invalid: []
    }))
  };
});

describe('UploadPage with Patient ID Workflow', () => {
  it('opens Patient ID modal when files are dropped, renames file, and submits renamed file', async () => {
    render(
      <BrowserRouter>
        <UploadPage />
      </BrowserRouter>
    );

    // Initial state: Upload zone visible
    expect(screen.getByText(/Drag & drop your X-ray images here/i)).toBeInTheDocument();

    // Find dropzone input
    const inputEl = screen.getByLabelText('File upload input');
    const dummyFile = new File(['mock content'], 'initial_scan.png', { type: 'image/png' });

    // Simulate file drop / selection
    fireEvent.change(inputEl, { target: { files: [dummyFile] } });

    // Expect modal to appear with corporate title
    await waitFor(() => {
      expect(screen.getByText('Patient Record Identification')).toBeInTheDocument();
      expect(screen.getByText('Clinical Intake Protocol')).toBeInTheDocument();
    });

    // Enter Patient ID
    const pidInput = screen.getByPlaceholderText(/e\.g\., PID-2026-0042/i);
    fireEvent.change(pidInput, { target: { value: 'PID-CLINIC-778' } });

    // Confirm and rename
    const confirmBtn = screen.getByText('Register & Rename Assets');
    fireEvent.click(confirmBtn);

    // Modal should close and file preview card should appear with renamed filename pattern
    await waitFor(() => {
      expect(screen.queryByText('Patient Record Identification')).not.toBeInTheDocument();
      expect(screen.getByTitle(/PID-CLINIC-778_\d{8}_\d{6}\.png/i)).toBeInTheDocument();
    });

    // Verify upload button is available
    const uploadBtn = screen.getByRole('button', { name: /Upload & Enhance/i });
    expect(uploadBtn).toBeInTheDocument();

    // Trigger upload
    fireEvent.click(uploadBtn);

    // Verify uploadImages was called with the renamed file
    await waitFor(() => {
      expect(uploadService.uploadImages).toHaveBeenCalledTimes(1);
      const uploadedFiles = uploadService.uploadImages.mock.calls[0][0];
      expect(uploadedFiles).toHaveLength(1);
      expect(uploadedFiles[0].name).toMatch(/^PID-CLINIC-778_\d{8}_\d{6}\.png$/);
    });
  });
});
