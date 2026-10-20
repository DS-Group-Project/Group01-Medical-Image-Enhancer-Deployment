import { describe, it, expect } from 'vitest';
import {
  formatMedicalTimestamp,
  sanitizePatientId,
  generateMedicalFilename,
  renameFile
} from '../utils/patientUtils';

describe('patientUtils', () => {
  describe('formatMedicalTimestamp', () => {
    it('formats a date to YYYYMMDD_HHMMSS', () => {
      const fixedDate = new Date(2026, 9, 18, 14, 30, 45); // Month is 0-indexed: 9 = October
      const formatted = formatMedicalTimestamp(fixedDate);
      expect(formatted).toBe('20261018_143045');
    });

    it('pads single digits with leading zeroes', () => {
      const fixedDate = new Date(2026, 0, 5, 8, 4, 9); // Jan 5, 2026 08:04:09
      const formatted = formatMedicalTimestamp(fixedDate);
      expect(formatted).toBe('20260105_080409');
    });
  });

  describe('sanitizePatientId', () => {
    it('preserves valid alphanumeric, hyphen, and underscore characters', () => {
      expect(sanitizePatientId('PID-2026_9842')).toBe('PID-2026_9842');
    });

    it('replaces spaces and special characters with underscores', () => {
      expect(sanitizePatientId('PID 123 #45')).toBe('PID_123_45');
    });

    it('trims leading and trailing whitespace', () => {
      expect(sanitizePatientId('   MRN-4421   ')).toBe('MRN-4421');
    });

    it('returns empty string for null or non-string values', () => {
      expect(sanitizePatientId(null)).toBe('');
      expect(sanitizePatientId(undefined)).toBe('');
    });
  });

  describe('generateMedicalFilename', () => {
    const fixedDate = new Date(2026, 9, 18, 17, 15, 30); // 20261018_171530

    it('generates correct filename for a single file in medical timestamp format', () => {
      const filename = generateMedicalFilename('PID-1001', 'chest_xray.png', null, 1, fixedDate);
      expect(filename).toBe('PID-1001_20261018_171530.png');
    });

    it('generates indexed filenames for multi-file batches', () => {
      const file1 = generateMedicalFilename('PID-1001', 'scan_ap.jpg', 0, 2, fixedDate);
      const file2 = generateMedicalFilename('PID-1001', 'scan_lat.jpg', 1, 2, fixedDate);

      expect(file1).toBe('PID-1001_20261018_171530_1.jpg');
      expect(file2).toBe('PID-1001_20261018_171530_2.jpg');
    });

    it('handles files with DICOM or other uppercase extensions', () => {
      const filename = generateMedicalFilename('PATIENT_01', 'slice.DCM', 0, 1, fixedDate);
      expect(filename).toBe('PATIENT_01_20261018_171530.DCM');
    });

    it('handles files without extensions', () => {
      const filename = generateMedicalFilename('PATIENT_01', 'scanfile', 0, 1, fixedDate);
      expect(filename).toBe('PATIENT_01_20261018_171530');
    });
  });

  describe('renameFile', () => {
    it('creates a new File instance with updated name preserving content and type', () => {
      const originalBlob = new Blob(['sample-image-data'], { type: 'image/png' });
      const originalFile = new File([originalBlob], 'original.png', { type: 'image/png' });

      const renamed = renameFile(originalFile, 'PID-001_20261018_171530.png');

      expect(renamed.name).toBe('PID-001_20261018_171530.png');
      expect(renamed.type).toBe('image/png');
      expect(renamed.size).toBe(originalFile.size);
    });
  });
});
