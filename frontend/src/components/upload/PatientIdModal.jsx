import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, 
  UserCheck, 
  FileImage, 
  ArrowRight, 
  CheckCircle2, 
  X, 
  Layers, 
  AlertCircle, 
  Info,
  Calendar,
  Hash
} from 'lucide-react';
import { 
  generateMedicalFilename, 
  renameFile, 
  sanitizePatientId,
  formatMedicalTimestamp 
} from '../../utils/patientUtils';

/**
 * Corporate, professional modal for collecting Patient ID and renaming
 * clinical imaging assets using standard medical timestamp format.
 * 
 * Supports both single image intake and multi-image batch intake.
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {File[]} props.pendingFiles - Array of files awaiting patient ID registration
 * @param {Function} props.onConfirm - Callback receiving array of renamed File objects
 * @param {Function} props.onCancel - Callback when intake is cancelled
 */
export default function PatientIdModal({
  isOpen,
  pendingFiles = [],
  onConfirm,
  onCancel
}) {
  const [commonPatientId, setCommonPatientId] = useState('');
  const [individualIds, setIndividualIds] = useState({});
  const [batchMode, setBatchMode] = useState('uniform'); // 'uniform' or 'individual'
  const [validationError, setValidationError] = useState('');
  const [previewTimestamp, setPreviewTimestamp] = useState('');
  const primaryInputRef = useRef(null);

  const fileCount = pendingFiles.length;
  const isMultiFile = fileCount > 1;

  // Reset state and capture timestamp whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setCommonPatientId('');
      setIndividualIds({});
      setBatchMode('uniform');
      setValidationError('');
      setPreviewTimestamp(formatMedicalTimestamp(new Date()));

      // Autofocus primary input on open
      setTimeout(() => {
        primaryInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, pendingFiles]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onCancel]);

  if (!isOpen || pendingFiles.length === 0) return null;

  const handleIndividualIdChange = (index, value) => {
    setIndividualIds(prev => ({
      ...prev,
      [index]: value
    }));
    if (validationError) setValidationError('');
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();

    const timestampDate = new Date();

    if (!isMultiFile || batchMode === 'uniform') {
      const sanitized = sanitizePatientId(commonPatientId);
      if (!sanitized) {
        setValidationError('A valid Patient Identification Number (PID) is required.');
        primaryInputRef.current?.focus();
        return;
      }

      // Rename all pending files using common patient ID
      const renamed = pendingFiles.map((file, idx) => {
        const newName = generateMedicalFilename(
          sanitized,
          file.name,
          idx,
          fileCount,
          timestampDate
        );
        return renameFile(file, newName);
      });

      onConfirm(renamed);
    } else {
      // Individual mode: ensure every file has a patient ID
      const missingIndexes = [];
      const sanitizedMap = {};

      pendingFiles.forEach((file, idx) => {
        const val = sanitizePatientId(individualIds[idx] || '');
        if (!val) {
          missingIndexes.push(idx + 1);
        } else {
          sanitizedMap[idx] = val;
        }
      });

      if (missingIndexes.length > 0) {
        setValidationError(`Please provide a Patient ID for item(s): #${missingIndexes.join(', #')}`);
        return;
      }

      const renamed = pendingFiles.map((file, idx) => {
        const newName = generateMedicalFilename(
          sanitizedMap[idx],
          file.name,
          null,
          1,
          timestampDate
        );
        return renameFile(file, newName);
      });

      onConfirm(renamed);
    }
  };

  const modalContent = (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-intake-title"
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
          onClick={onCancel}
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-10 flex flex-col my-8 max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Corporate Top Accent */}
          <div className="h-1.5 bg-gradient-to-r from-teal-500 via-indigo-500 to-teal-600 w-full" />

          {/* Modal Header */}
          <div className="p-6 pb-4 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 shrink-0 shadow-sm">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-teal-100 text-teal-800 px-2.5 py-0.5 rounded-full">
                    Clinical Intake Protocol
                  </span>
                  {isMultiFile && (
                    <span className="text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      {fileCount} Images Staged
                    </span>
                  )}
                </div>
                <h2 id="patient-intake-title" className="text-xl font-bold text-slate-900">
                  Patient Record Identification
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  In accordance with clinical imaging data governance, specify the Patient ID to associate with this diagnostic intake.
                </p>
              </div>
            </div>

            <button
              onClick={onCancel}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500"
              aria-label="Close patient identification modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Body */}
          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 flex-1">
            
            {/* Multi-file Mode Selector */}
            {isMultiFile && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                  Batch Association Strategy
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBatchMode('uniform');
                      setValidationError('');
                    }}
                    className={`flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all ${
                      batchMode === 'uniform'
                        ? 'bg-white border-teal-500 shadow-sm ring-1 ring-teal-500/20'
                        : 'bg-white/60 border-slate-200 hover:bg-white text-slate-600'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                      batchMode === 'uniform' ? 'border-teal-600 bg-teal-600' : 'border-slate-300'
                    }`}>
                      {batchMode === 'uniform' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-slate-800 block">Single Patient ID</span>
                      <span className="text-xs text-slate-500">Apply to all {fileCount} scans (e.g. multi-view series)</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setBatchMode('individual');
                      setValidationError('');
                    }}
                    className={`flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all ${
                      batchMode === 'individual'
                        ? 'bg-white border-teal-500 shadow-sm ring-1 ring-teal-500/20'
                        : 'bg-white/60 border-slate-200 hover:bg-white text-slate-600'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                      batchMode === 'individual' ? 'border-teal-600 bg-teal-600' : 'border-slate-300'
                    }`}>
                      {batchMode === 'individual' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-slate-800 block">Individual Patient IDs</span>
                      <span className="text-xs text-slate-500">Specify distinct ID per image asset</span>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Input Section: Uniform Mode or Single File */}
            {(!isMultiFile || batchMode === 'uniform') && (
              <div className="space-y-3">
                <label 
                  htmlFor="common-patient-id" 
                  className="block text-sm font-semibold text-slate-800"
                >
                  Patient Identification Number (PID / MRN) <span className="text-red-500">*</span>
                </label>
                
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <UserCheck className="w-5 h-5 text-teal-600" />
                  </div>
                  <input
                    ref={primaryInputRef}
                    id="common-patient-id"
                    type="text"
                    value={commonPatientId}
                    onChange={(e) => {
                      setCommonPatientId(e.target.value);
                      if (validationError) setValidationError('');
                    }}
                    placeholder="e.g., PID-2026-0042 or MRN-98412"
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-medium text-sm sm:text-base shadow-sm"
                    autoComplete="off"
                  />
                </div>

                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Institutional MRN or alphanumeric ID. Valid characters: letters, numbers, hyphens, and underscores.</span>
                </div>
              </div>
            )}

            {/* Input Section: Individual Mode (Multi-file) */}
            {isMultiFile && batchMode === 'individual' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-semibold text-slate-800">
                    Individual Patient Identification <span className="text-red-500">*</span>
                  </label>
                  <span className="text-xs text-slate-500">{fileCount} records</span>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1 border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                  {pendingFiles.map((file, idx) => (
                    <div 
                      key={`${file.name}-${idx}`} 
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-white border border-slate-200 rounded-lg shadow-sm"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="truncate text-xs font-medium text-slate-700" title={file.name}>
                          {file.name}
                        </div>
                      </div>

                      <div className="w-full sm:w-48 shrink-0">
                        <input
                          type="text"
                          value={individualIds[idx] || ''}
                          onChange={(e) => handleIndividualIdChange(idx, e.target.value)}
                          placeholder={`Patient ID #${idx + 1}`}
                          className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-medium"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Validation Error Banner */}
            {validationError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium"
              >
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span>{validationError}</span>
              </motion.div>
            )}

            {/* Live Filename Standardization Preview */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-teal-600" />
                  Standardized File Renaming Preview
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  Timestamp: {previewTimestamp}
                </span>
              </div>

              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {pendingFiles.slice(0, 3).map((file, idx) => {
                  const targetId = (!isMultiFile || batchMode === 'uniform')
                    ? (sanitizePatientId(commonPatientId) || 'PID-EXAMPLE')
                    : (sanitizePatientId(individualIds[idx]) || `PID-${idx + 1}`);

                  const previewName = generateMedicalFilename(
                    targetId,
                    file.name,
                    (!isMultiFile || batchMode === 'individual') ? null : idx,
                    (!isMultiFile || batchMode === 'individual') ? 1 : fileCount,
                    new Date()
                  );

                  return (
                    <div 
                      key={`prev-${idx}`}
                      className="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-slate-200 font-mono gap-2"
                    >
                      <span className="truncate text-slate-500 max-w-[40%]" title={file.name}>
                        {file.name}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                      <span className="truncate text-teal-700 font-semibold max-w-[50%]" title={previewName}>
                        {previewName}
                      </span>
                    </div>
                  );
                })}

                {pendingFiles.length > 3 && (
                  <p className="text-[11px] text-slate-400 text-center pt-1 italic">
                    + {pendingFiles.length - 3} more file{pendingFiles.length - 3 > 1 ? 's' : ''} in batch
                  </p>
                )}
              </div>
            </div>

            {/* Compliance Footer Note */}
            <div className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed bg-teal-50/50 border border-teal-100 rounded-xl p-3">
              <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <span>
                <strong>Confidential Clinical Asset Registration:</strong> In accordance with DICOM and HIPAA security practices, assets are renamed with verified Patient IDs and synchronized timestamps to preserve chain of custody across diagnostic workflows.
              </span>
            </div>

            {/* Modal Actions */}
            <div className="pt-2 flex flex-col-reverse sm:flex-row items-center justify-end gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onCancel}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors"
              >
                Discard Selection
              </button>

              <button
                type="submit"
                className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-teal-600 to-indigo-600 hover:from-teal-700 hover:to-indigo-700 text-white rounded-xl font-semibold text-sm shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Register & Rename Assets</span>
              </button>
            </div>

          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
