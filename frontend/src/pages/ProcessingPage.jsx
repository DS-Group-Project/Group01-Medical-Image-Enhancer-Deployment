import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  CheckCircle, 
  Cloud, 
  Clock, 
  Cpu, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle,
  Image as ImageIcon
} from 'lucide-react';

import { uploadService } from '../services/uploadService';
import { mockUploadService } from '../services/mockData';
import { usePolling } from '../hooks/usePolling';
import StatusBadge from '../components/ui/StatusBadge';
import { safeLog } from '../utils/safeLog';
import { buildBatchUrl, resolveBatchIds } from '../utils/helpers';
import api from '../services/api';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const activeService = USE_MOCK ? mockUploadService : uploadService;

const STEPS = [
  { id: 'pending', label: 'Uploaded', icon: CheckCircle, description: 'File received safely' },
  { id: 'queued', label: 'Queued for Processing', icon: Clock, description: 'Waiting for available worker' },
  { id: 'processing', label: 'AI Enhancement', icon: Cpu, description: 'Applying enhancement algorithms' },
  { id: 'completed', label: 'Complete', icon: CheckCircle2, description: 'Ready for review' }
];

// Time (ms) to visually hold each step before advancing to the next
const STEP_ANIMATION_DELAY = 350;
// Time (ms) to show the "Enhancement Complete!" card before navigating to viewer
const COMPLETION_DISPLAY_DELAY = 600;

/**
 * Maps a backend status string to the minimum step index the stepper should reach.
 * The backend only emits: pending | processing | completed | failed.
 * We map "processing" → step 2 so the animation walks through "queued" on the way.
 */
function backendStatusToTargetIndex(status) {
  switch (status) {
    case 'pending':    return 0;
    case 'processing': return 2;
    case 'completed':  return 3;
    default:           return 0;
  }
}

export default function ProcessingPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const batchParam = searchParams.get('batch');
  const batchIds = resolveBatchIds(batchParam, location.state?.jobIds, jobId);

  const [jobData, setJobData] = useState(null);
  const [backendStatus, setBackendStatus] = useState('pending'); // real status from API
  const [displayIndex, setDisplayIndex] = useState(0);           // animated visual step
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCompletion, setShowCompletion] = useState(false);    // shows the "Complete!" card
  const animationTimer = useRef(null);
  const completionTimer = useRef(null);

  // The target step index the animation needs to reach (driven by backend status)
  const targetIndex = backendStatusToTargetIndex(backendStatus);

  // ── Step animation: advance displayIndex one step at a time toward targetIndex ──
  useEffect(() => {
    // Clear any existing timer when dependencies change
    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
      animationTimer.current = null;
    }

    if (displayIndex < targetIndex) {
      // If already finished on backend, advance swiftly (200ms), otherwise smooth 350ms
      const delay = backendStatus === 'completed' ? 200 : STEP_ANIMATION_DELAY;
      animationTimer.current = setTimeout(() => {
        setDisplayIndex(prev => prev + 1);
      }, delay);
    }

    return () => {
      if (animationTimer.current) clearTimeout(animationTimer.current);
    };
  }, [displayIndex, targetIndex, backendStatus]);

  // ── When the animation reaches "completed" (index 3), show the card then navigate ──
  useEffect(() => {
    if (displayIndex === 3 && backendStatus === 'completed' && !showCompletion) {
      setShowCompletion(true);
      completionTimer.current = setTimeout(() => {
        const targetViewerUrl = buildBatchUrl('/viewer', jobId, batchIds);
        navigate(targetViewerUrl, { state: { jobIds: batchIds } });
      }, COMPLETION_DISPLAY_DELAY);
    }

    return () => {
      if (completionTimer.current) clearTimeout(completionTimer.current);
    };
  }, [displayIndex, backendStatus, showCompletion, navigate, jobId, batchIds]);

  // ── Lightweight polling: fetches status in 1 request (no individual HTTP storms) ──
  const fetchStatus = useCallback(async () => {
    try {
      if (batchIds.length > 1) {
        const validResults = await activeService.getBatchJobsStatus(batchIds);
        const primaryJob = validResults.find(j => j.id === jobId || j.jobId === jobId) || validResults[0];
        if (primaryJob && !jobData) setJobData(primaryJob);

        const allCompleted = validResults.length === batchIds.length && validResults.every(j => j.status === 'completed');
        const anyFailed = validResults.some(j => j.status === 'failed');

        if (allCompleted) {
          setBackendStatus('completed');
        } else if (anyFailed) {
          setBackendStatus('failed');
        } else if (validResults.some(j => j.status === 'processing')) {
          setBackendStatus('processing');
        } else {
          setBackendStatus('pending');
        }
      } else {
        const response = await api.get(`/jobs/${jobId}`);
        const data = response.data;
        if (!jobData) setJobData(data);

        setBackendStatus(data.status);
      }
      setError(null);
    } catch (err) {
      safeLog.error('Failed to fetch status', err);
      setError('Failed to fetch status');
    } finally {
      setLoading(false);
    }
  }, [jobId, batchIds, jobData]);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Keep polling rapidly (1000ms) until the backend says completed or failed
  usePolling(
    fetchStatus, 
    1000, 
    backendStatus !== 'completed' && backendStatus !== 'failed' && !error
  );

  // ── Derive display values from the animated step index ──
  const displayStatus = STEPS[displayIndex]?.id || 'pending';
  const isVisuallyComplete = displayIndex === 3;
  const progressPercent = Math.round((displayIndex / (STEPS.length - 1)) * 100);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mb-4" />
        <h2 className="text-xl font-medium text-slate-700">Connecting to job...</h2>
      </div>
    );
  }

  if (error || backendStatus === 'failed') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-red-100"
        >
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Processing Failed</h2>
          <p className="text-slate-600 mb-6">{error || 'An error occurred during AI enhancement.'}</p>
          <div className="space-y-3">
            <button
              onClick={() => { setError(null); setBackendStatus('pending'); setDisplayIndex(0); fetchStatus(); }}
              className="w-full py-3 bg-slate-900 text-white font-medium rounded-xl hover:bg-slate-800 transition-colors"
            >
              Retry Job
            </button>
            <button
              onClick={() => navigate('/upload')}
              className="w-full py-3 bg-white text-slate-700 border border-slate-200 font-medium rounded-xl hover:bg-slate-50 transition-colors"
            >
              Upload New Image
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-slate-50 pt-24 pb-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">
            {batchIds.length > 1 ? `Processing Your Images (${batchIds.length} Scans)` : 'Processing Your Image'}
          </h1>
          <p className="text-slate-500 flex items-center justify-center gap-2">
            <ImageIcon className="w-4 h-4" />
            {batchIds.length > 1 ? `Batch Examination Series (${batchIds.length} Assets)` : (jobData?.filename || 'Unknown File')}
            <span className="text-slate-300">•</span>
            ID: {jobId?.slice(0, 8)}…
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Status Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 pb-6 border-b border-slate-100 gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">Current Status</h3>
                  <p className="text-sm text-slate-500">
                    Started at: {jobData?.createdAt ? new Date(jobData.createdAt).toLocaleTimeString() : '--'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Time Remaining</p>
                    <p className="text-sm font-medium text-slate-700">
                      {isVisuallyComplete ? 'Finished' : displayStatus === 'processing' ? '~15 seconds' : 'Calculating...'}
                    </p>
                  </div>
                  <StatusBadge status={displayStatus} />
                </div>
              </div>

              {/* Stepper */}
              <div className="relative">
                <div className="absolute left-[27px] sm:left-auto sm:top-[27px] sm:w-full sm:h-auto h-full w-0.5 sm:border-t-2 border-l-2 sm:border-l-0 border-slate-200 -z-10" />
                
                <div className="flex flex-col sm:flex-row justify-between gap-6 sm:gap-0">
                  {STEPS.map((step, index) => {
                    const isActive = index === displayIndex;
                    const isPast = index < displayIndex;
                    const Icon = step.icon;

                    let circleColor = 'bg-white border-slate-300 text-slate-400';
                    if (isPast || isVisuallyComplete) circleColor = 'bg-teal-500 border-teal-500 text-white';
                    else if (isActive) circleColor = 'bg-white border-teal-500 text-teal-600 ring-4 ring-teal-50';

                    return (
                      <div key={step.id} className="flex sm:flex-col items-center sm:w-1/4 relative">
                        {/* Connecting Line active state */}
                        {(isPast || (isVisuallyComplete && index < STEPS.length - 1)) && (
                          <div className="hidden sm:block absolute top-[27px] left-1/2 w-full h-0.5 bg-gradient-to-r from-teal-500 to-indigo-500 -z-10" />
                        )}

                        <div className={`
                          w-14 h-14 rounded-full border-2 flex items-center justify-center bg-white z-10 transition-all duration-500
                          ${circleColor}
                          ${isActive && !isVisuallyComplete ? 'shadow-[0_0_15px_rgba(20,184,166,0.3)]' : ''}
                        `}>
                          <Icon className={`w-6 h-6 ${isActive && !isVisuallyComplete && (step.id === 'processing' || step.id === 'queued') ? 'animate-pulse' : ''}`} />
                        </div>
                        
                        <div className="ml-4 sm:ml-0 sm:mt-4 text-left sm:text-center">
                          <p className={`font-medium text-sm transition-colors duration-300 ${isPast || isActive ? 'text-slate-900' : 'text-slate-500'}`}>
                            {step.label}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5 hidden sm:block px-2">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Completion View */}
            {showCompletion && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-r from-teal-600 to-indigo-600 rounded-2xl shadow-lg p-8 text-center text-white relative overflow-hidden"
              >
                {/* Decorative sparkles */}
                <Sparkles className="absolute top-4 left-4 text-white/20 w-8 h-8" />
                <Sparkles className="absolute bottom-4 right-4 text-white/20 w-12 h-12" />
                <Sparkles className="absolute top-8 right-12 text-white/10 w-6 h-6" />

                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Enhancement Complete!</h2>
                <p className="text-white/80 mb-8 max-w-md mx-auto">
                  Your image has been successfully processed using our AI model. Redirecting to results...
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 relative z-10">
                  <button
                    onClick={() => navigate(`/viewer/${jobId}`)}
                    className="w-full sm:w-auto px-8 py-3 bg-white text-slate-900 font-bold rounded-xl shadow-md hover:bg-slate-50 transition-colors"
                  >
                    View Results Now
                  </button>
                  <button
                    onClick={() => navigate('/upload')}
                    className="w-full sm:w-auto px-8 py-3 bg-white/10 border border-white/20 text-white font-medium rounded-xl hover:bg-white/20 transition-colors backdrop-blur-sm"
                  >
                    Upload Another
                  </button>
                </div>
              </motion.div>
            )}

          </div>

          {/* Sidebar Area */}
          <div className="space-y-6">
            
            {/* Animated Progress Ring Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col items-center justify-center min-h-[250px]">
              <div className="relative w-40 h-40">
                {/* Background Ring */}
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50" cy="50" r="45"
                    fill="none"
                    stroke="#F1F5F9"
                    strokeWidth="8"
                  />
                  {/* Progress Ring */}
                  <motion.circle
                    cx="50" cy="50" r="45"
                    fill="none"
                    stroke="url(#gradient)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    initial={{ strokeDasharray: "0 283" }}
                    animate={{ 
                      strokeDasharray: `${(displayIndex / (STEPS.length - 1)) * 283} 283`
                    }}
                    transition={{ duration: 0.8, ease: "easeInOut" }}
                  />
                  <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#0D9488" />
                      <stop offset="100%" stopColor="#6366F1" />
                    </linearGradient>
                  </defs>
                </svg>
                
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-slate-800">
                    {progressPercent}%
                  </span>
                </div>
              </div>
              <p className="mt-4 text-sm font-medium text-slate-500 uppercase tracking-widest">
                Overall Progress
              </p>
            </div>

          </div>
        </div>
      </div>
    </motion.div>
  );
}
