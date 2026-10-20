/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import PatientIdModal from '../components/upload/PatientIdModal';

afterEach(() => {
  cleanup();
});

describe('PatientIdModal Component', () => {
  const dummyFile1 = new File(['data1'], 'chest_xray.png', { type: 'image/png' });
  const dummyFile2 = new File(['data2'], 'knee_lateral.jpg', { type: 'image/jpeg' });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <PatientIdModal
        isOpen={false}
        pendingFiles={[dummyFile1]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders clinical corporate modal header and compliance notices when isOpen is true', () => {
    render(
      <PatientIdModal
        isOpen={true}
        pendingFiles={[dummyFile1]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Patient Record Identification')).toBeInTheDocument();
    expect(screen.getByText('Clinical Intake Protocol')).toBeInTheDocument();
    expect(screen.getByText(/Confidential Clinical Asset Registration/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\., PID-2026-0042/i)).toBeInTheDocument();
  });

  it('shows validation error when attempting to confirm without a Patient ID', () => {
    const handleConfirm = vi.fn();
    render(
      <PatientIdModal
        isOpen={true}
        pendingFiles={[dummyFile1]}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    );

    const confirmButton = screen.getByText('Register & Rename Assets');
    fireEvent.click(confirmButton);

    expect(handleConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('A valid Patient Identification Number (PID) is required.')).toBeInTheDocument();
  });

  it('successfully confirms and renames single file in medical timestamp format', () => {
    const handleConfirm = vi.fn();
    render(
      <PatientIdModal
        isOpen={true}
        pendingFiles={[dummyFile1]}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText(/e\.g\., PID-2026-0042/i);
    fireEvent.change(input, { target: { value: 'PID-90210' } });

    const confirmButton = screen.getByText('Register & Rename Assets');
    fireEvent.click(confirmButton);

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    const renamedFiles = handleConfirm.mock.calls[0][0];
    expect(renamedFiles).toHaveLength(1);

    const renamedFile = renamedFiles[0];
    // Pattern: PID-90210_\d{8}_\d{6}\.png
    expect(renamedFile.name).toMatch(/^PID-90210_\d{8}_\d{6}\.png$/);
    expect(renamedFile.type).toBe('image/png');
  });

  it('supports multi-file batch upload with uniform Patient ID and indexed suffix', () => {
    const handleConfirm = vi.fn();
    render(
      <PatientIdModal
        isOpen={true}
        pendingFiles={[dummyFile1, dummyFile2]}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('2 Images Staged')).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/e\.g\., PID-2026-0042/i);
    fireEvent.change(input, { target: { value: 'PID-BATCH-1' } });

    const confirmButton = screen.getByText('Register & Rename Assets');
    fireEvent.click(confirmButton);

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    const renamedFiles = handleConfirm.mock.calls[0][0];
    expect(renamedFiles).toHaveLength(2);

    expect(renamedFiles[0].name).toMatch(/^PID-BATCH-1_\d{8}_\d{6}_1\.png$/);
    expect(renamedFiles[1].name).toMatch(/^PID-BATCH-1_\d{8}_\d{6}_2\.jpg$/);
  });

  it('supports multi-file batch upload with individual Patient IDs per image', () => {
    const handleConfirm = vi.fn();
    render(
      <PatientIdModal
        isOpen={true}
        pendingFiles={[dummyFile1, dummyFile2]}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    );

    // Switch to individual mode
    const individualModeBtn = screen.getByText('Individual Patient IDs');
    fireEvent.click(individualModeBtn);

    const input1 = screen.getByPlaceholderText('Patient ID #1');
    const input2 = screen.getByPlaceholderText('Patient ID #2');

    fireEvent.change(input1, { target: { value: 'PID-ALPHA' } });
    fireEvent.change(input2, { target: { value: 'PID-BETA' } });

    const confirmButton = screen.getByText('Register & Rename Assets');
    fireEvent.click(confirmButton);

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    const renamedFiles = handleConfirm.mock.calls[0][0];
    expect(renamedFiles).toHaveLength(2);

    expect(renamedFiles[0].name).toMatch(/^PID-ALPHA_\d{8}_\d{6}\.png$/);
    expect(renamedFiles[1].name).toMatch(/^PID-BETA_\d{8}_\d{6}\.jpg$/);
  });

  it('calls onCancel when clicking Discard Selection', () => {
    const handleCancel = vi.fn();
    render(
      <PatientIdModal
        isOpen={true}
        pendingFiles={[dummyFile1]}
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />
    );

    const discardBtn = screen.getByText('Discard Selection');
    fireEvent.click(discardBtn);

    expect(handleCancel).toHaveBeenCalledTimes(1);
  });
});
