/**
 * Clinical utilities for Patient ID formatting and medical asset renaming.
 */

/**
 * Formats a Date object into clinical timestamp format: YYYYMMDD_HHMMSS
 * 
 * @param {Date} [date=new Date()]
 * @returns {string} Timestamp formatted as YYYYMMDD_HHMMSS
 */
export function formatMedicalTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Sanitizes a patient ID by trimming, replacing illegal filename characters with underscores,
 * and ensuring safe clinical asset naming.
 * 
 * @param {string} patientId - Raw patient ID input
 * @returns {string} Sanitized patient ID
 */
export function sanitizePatientId(patientId) {
  if (!patientId || typeof patientId !== 'string') return '';
  return patientId
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_');
}

/**
 * Generates a standardized clinical filename using the medical timestamp format:
 * <Patient_ID>_<YYYYMMDD_HHMMSS>[_index].<extension>
 * 
 * @param {string} patientId - Patient ID string
 * @param {string} originalFilename - Original filename to preserve extension
 * @param {number|null} [index=null] - 0-based file index for batch uploads
 * @param {number} [totalFiles=1] - Total number of files in the batch
 * @param {Date} [timestampDate=new Date()] - Optional date object for deterministic timestamp
 * @returns {string} Formatted medical filename
 */
export function generateMedicalFilename(
  patientId,
  originalFilename = '',
  index = null,
  totalFiles = 1,
  timestampDate = new Date()
) {
  const cleanId = sanitizePatientId(patientId) || 'UNKNOWN_PATIENT';
  const timestamp = formatMedicalTimestamp(timestampDate);

  // Extract extension including the dot
  const extIndex = originalFilename.lastIndexOf('.');
  const ext = extIndex !== -1 ? originalFilename.substring(extIndex) : '';

  // Append index suffix if batch contains multiple files
  const suffix = totalFiles > 1 && index !== null ? `_${index + 1}` : '';

  return `${cleanId}_${timestamp}${suffix}${ext}`;
}

/**
 * Creates a new File object with the renamed medical filename while preserving
 * underlying blob content, MIME type, and last modified timestamp.
 * 
 * @param {File} file - Original browser File object
 * @param {string} newFilename - Target medical filename
 * @returns {File} Renamed File object
 */
export function renameFile(file, newFilename) {
  return new File([file], newFilename, {
    type: file.type,
    lastModified: file.lastModified || Date.now(),
  });
}
