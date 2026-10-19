import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowDown, Share2, Upload, Maximize2, Minimize2, ZoomIn, ZoomOut,
  ChevronDown, ChevronUp, GripVertical, AlertTriangle, AlertCircle, Target, Eye, EyeOff,
  ChevronLeft, ChevronRight, Layers, DownloadCloud, FileImage, CheckCircle2, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadService } from '../services/uploadService';
import { mockUploadService } from '../services/mockData';
import StatusBadge from '../components/ui/StatusBadge';
import { useVeda } from '../context/VedaContext';
import { formatFileSize, buildBatchUrl, resolveBatchIds } from '../utils/helpers';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const activeService = USE_MOCK ? mockUploadService : uploadService;

const FALLBACK_ORIGINAL = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="%230f172a"/><text x="50%" y="50%" fill="%2394a3b8" font-family="sans-serif" font-size="22" text-anchor="middle" dominant-baseline="middle">Original Scan Not Available</text></svg>';
const FALLBACK_ENHANCED = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="%23042f2e"/><text x="50%" y="50%" fill="%232dd4bf" font-family="sans-serif" font-size="22" text-anchor="middle" dominant-baseline="middle">Enhanced Scan Not Available</text></svg>';

const ImageViewerPage = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const batchParam = searchParams.get('batch');
  const [batchIds, setBatchIds] = useState(() =>
    resolveBatchIds(batchParam, location.state?.jobIds, jobId)
  );
  const [batchJobs, setBatchJobs] = useState([]);

  const { setActiveJobContext, activeMarker } = useVeda();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('side-by-side'); // 'side-by-side' or 'slider'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMetadata, setShowMetadata] = useState(true);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [showMarker, setShowMarker] = useState(false);
  const [imageAspect, setImageAspect] = useState('auto');
  const [imageDimensions, setImageDimensions] = useState(null);
  const [measuredFileSize, setMeasuredFileSize] = useState(null);
  const sliderRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    let originalBlobUrl = null;
    let enhancedBlobUrl = null;

    const fetchJob = async () => {
      try {
        setLoading(true);
        const data = await activeService.getJobStatus(jobId);
        if (!isMounted) return;

        if (data.status !== 'completed') {
          navigate(`/processing/${jobId}`);
          return;
        }

        originalBlobUrl = data.originalUrl;
        enhancedBlobUrl = data.enhancedUrl;

        setJob(data);
        setActiveJobContext({
          jobId: data.id || data.jobId,
          filename: data.filename,
          imageUrl: data.enhancedUrl || data.originalUrl
        });
      } catch (err) {
        if (!isMounted) return;
        setError('Failed to load image data. It might have been deleted or does not exist.');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    fetchJob();
    
    return () => {
      isMounted = false;
      setActiveJobContext(null);
    };
  }, [jobId, navigate, setActiveJobContext]);

  // Sync batch IDs from URL/state or auto-detect sibling files in the intake
  useEffect(() => {
    const resolved = resolveBatchIds(batchParam, location.state?.jobIds, jobId);
    if (resolved && resolved.length > 1) {
      setBatchIds(resolved);
    } else if (batchParam) {
      setBatchIds(batchParam.split(',').filter(Boolean));
    } else if (location.state?.jobIds?.length) {
      setBatchIds(location.state.jobIds);
    } else if (job?.createdAt) {
      activeService.getJobs({ limit: 15 }).then(res => {
        const list = res.jobs || [];
        const currentCreated = new Date(job.createdAt).getTime();
        const siblings = list.filter(j => {
          const t = new Date(j.createdAt).getTime();
          return Math.abs(t - currentCreated) <= 90000;
        });
        if (siblings.length > 1) {
          siblings.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          setBatchIds(siblings.map(s => s.id || s.jobId));
        }
      }).catch(() => {});
    }
  }, [batchParam, location.state, job?.createdAt, jobId]);

  // Load batch job items (lightweight metadata & thumbnails, avoids downloading 100 full-res scans)
  useEffect(() => {
    if (batchIds.length > 1) {
      let isSubscribed = true;
      activeService.getBatchJobsStatus(batchIds).then(results => {
        if (isSubscribed) {
          setBatchJobs(results.filter(Boolean));
        }
      }).catch(() => {});
      return () => { isSubscribed = false; };
    }
  }, [batchIds]);

  // Dynamically measure actual file size from the loaded blob
  useEffect(() => {
    setMeasuredFileSize(null);
    setImageDimensions(null);

    if (job?.fileSize && typeof job.fileSize === 'number') {
      setMeasuredFileSize(job.fileSize);
    } else if (job?.enhancedUrl || job?.originalUrl) {
      const targetUrl = job.enhancedUrl || job.originalUrl;
      if (targetUrl && targetUrl.startsWith('blob:')) {
        fetch(targetUrl)
          .then(res => res.blob())
          .then(blob => {
            if (blob && blob.size) {
              setMeasuredFileSize(blob.size);
            }
          })
          .catch(() => {});
      }
    }
  }, [job]);

  const currentBatchIndex = batchIds.indexOf(jobId);

  // Background prefetch adjacent scans in the batch for instant, zero-latency transitions
  useEffect(() => {
    if (!batchIds || batchIds.length <= 1 || currentBatchIndex < 0) return;
    const nextId = batchIds[currentBatchIndex + 1];
    const prevId = batchIds[currentBatchIndex - 1];
    
    if (nextId) {
      activeService.getJobStatus(nextId).catch(() => {});
    }
    if (prevId) {
      activeService.getJobStatus(prevId).catch(() => {});
    }
  }, [batchIds, currentBatchIndex]);

  const navigateToBatchJob = (targetId) => {
    if (!targetId || targetId === jobId) return;
    const targetUrl = buildBatchUrl('/viewer', targetId, batchIds);
    navigate(targetUrl, { state: { jobIds: batchIds } });
  };

  const handlePrevJob = () => {
    if (currentBatchIndex > 0) {
      navigateToBatchJob(batchIds[currentBatchIndex - 1]);
    }
  };

  const handleNextJob = () => {
    if (currentBatchIndex < batchIds.length - 1) {
      navigateToBatchJob(batchIds[currentBatchIndex + 1]);
    }
  };

  const handleDownloadAll = async () => {
    try {
      toast.loading(`Downloading all ${batchIds.length} enhanced scans...`, { id: 'batch-dl' });
      for (const id of batchIds) {
        await activeService.downloadImage(id, 'enhanced');
        await new Promise(r => setTimeout(r, 400));
      }
      toast.success(`All ${batchIds.length} scans downloaded successfully!`, { id: 'batch-dl' });
    } catch (err) {
      toast.error('Failed to download some scans in batch.', { id: 'batch-dl' });
    }
  };

  const handleDeleteCurrentScan = async () => {
    if (window.confirm('Are you sure you want to permanently delete this scan? This will remove both original and enhanced images from the system.')) {
      try {
        await activeService.deleteJob(jobId);
        toast.success('Scan deleted successfully');
        if (batchIds && batchIds.length > 1) {
          const remainingIds = batchIds.filter(id => id !== jobId);
          const nextIndex = currentBatchIndex >= remainingIds.length ? remainingIds.length - 1 : currentBatchIndex;
          const nextId = remainingIds[nextIndex];
          const nextUrl = buildBatchUrl('/viewer', nextId, remainingIds);
          navigate(nextUrl, { state: { jobIds: remainingIds } });
        } else {
          navigate('/history');
        }
      } catch (err) {
        toast.error('Failed to delete scan. Please try again.');
      }
    }
  };

  const calculateProcessingTime = () => {
    if (!job?.createdAt) return 'Real-time';
    if (!job?.completedAt) return '< 1s';
    const start = new Date(job.createdAt).getTime();
    const end = new Date(job.completedAt).getTime();
    const diff = (end - start) / 1000;
    if (diff <= 0 || isNaN(diff)) return '< 1s';
    if (diff < 1) return `${diff.toFixed(1)}s`;
    return `${diff.toFixed(1)}s`;
  };

  const handleSliderMove = (event) => {
    if (!isDragging || !sliderRef.current) return;
    
    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX !== undefined ? event.clientX : event.touches[0].clientX, rect.right));
    const position = ((x - rect.left) / rect.width) * 100;
    
    setSliderPosition(Math.max(0, Math.min(position, 100)));
  };

  const handleDragStart = () => setIsDragging(true);
  const handleDragEnd = () => setIsDragging(false);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleSliderMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleSliderMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
    } else {
      window.removeEventListener('mousemove', handleSliderMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleSliderMove);
      window.removeEventListener('touchend', handleDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleSliderMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleSliderMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        toast.error(`Error attempting to enable fullscreen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const copyShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success('Link copied to clipboard!');
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col space-y-4">
        <div className="h-16 bg-slate-200 animate-pulse rounded-xl"></div>
        <div className="flex-1 bg-slate-200 animate-pulse rounded-2xl min-h-[500px]"></div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="flex-1 p-6 flex items-center justify-center">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Error Loading Image</h2>
          <p className="text-slate-600 mb-6">{error}</p>
          <button 
            onClick={() => navigate('/history')}
            className="px-6 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
          >
            Back to History
          </button>
        </div>
      </div>
    );
  }

  // Use the correct property names from the data model (originalUrl / enhancedUrl) with local SVG fallback.
  const originalImageUrl = job.originalUrl || FALLBACK_ORIGINAL;
  const enhancedImageUrl = job.enhancedUrl || FALLBACK_ENHANCED;
  const fractureMarker = activeMarker || job?.analysis?.marker || job?.customFractureMarker;

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50" ref={containerRef}>
      {/* Header Bar */}
      {!isFullscreen && (
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <h1 className="text-xl font-semibold text-slate-800 truncate max-w-[200px] sm:max-w-md">
              {job.filename}
            </h1>
            <StatusBadge status={job.status} />
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto justify-end">
            {fractureMarker && (
              <button
                onClick={() => setShowMarker(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm ${
                  showMarker
                    ? 'bg-red-500 text-white ring-2 ring-red-400/50 shadow-red-500/20'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title="Toggle Fracture Site Annotation"
              >
                <Target size={14} className={showMarker ? 'animate-pulse text-white' : 'text-red-500'} />
                <span>{showMarker ? 'Fracture Marked' : 'Show Marker'}</span>
              </button>
            )}

            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setViewMode('slider')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'slider' ? 'bg-teal-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Slider
              </button>
              <button
                onClick={() => setViewMode('side-by-side')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'side-by-side' ? 'bg-teal-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Side by Side
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <button onClick={copyShareLink} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg tooltip" title="Share">
                <Share2 size={20} />
              </button>
              <div className="relative group">
                <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors">
                  <ArrowDown size={18} />
                  Download
                </button>
                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button onClick={() => uploadService.downloadImage(jobId, 'enhanced').then(() => toast.success('Download started')).catch(() => toast.error('Download failed'))} className="block w-full text-left px-4 py-2 hover:bg-slate-50 text-sm text-slate-700 border-b border-slate-100">Download Enhanced</button>
                  <button onClick={() => uploadService.downloadImage(jobId, 'original').then(() => toast.success('Download started')).catch(() => toast.error('Download failed'))} className="block w-full text-left px-4 py-2 hover:bg-slate-50 text-sm text-slate-700 border-b border-slate-100">Download Original</button>
                  <button onClick={() => uploadService.downloadImage(jobId, 'both').then(() => toast.success('ZIP download started')).catch(() => toast.error('Download failed'))} className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm text-slate-700">Download Both (ZIP)</button>
                </div>
              </div>
              <button
                onClick={handleDeleteCurrentScan}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium transition-colors border border-red-200/80"
                title="Delete this scan"
              >
                <Trash2 size={18} />
                <span className="hidden sm:inline">Delete</span>
              </button>
              <button onClick={() => navigate('/upload')} className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg font-medium transition-colors">
                <Upload size={18} />
                <span className="hidden sm:inline">Upload Another</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Image Batch Examination Bar */}
      {!isFullscreen && batchIds.length > 1 && (
        <div className="bg-white border-b border-slate-200 px-6 py-3 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-teal-50 border border-teal-200 text-teal-700">
                <Layers size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Batch Examination
                  </span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800 font-semibold">
                    Scan {currentBatchIndex !== -1 ? currentBatchIndex + 1 : 1} of {batchIds.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium truncate max-w-sm mt-0.5" title={job.filename}>
                  {job.filename}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevJob}
                disabled={currentBatchIndex <= 0}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-all shadow-xs"
                title="Previous Scan"
              >
                <ChevronLeft size={15} />
                <span>Previous</span>
              </button>
              <button
                onClick={handleNextJob}
                disabled={currentBatchIndex === -1 || currentBatchIndex >= batchIds.length - 1}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-all shadow-xs"
                title="Next Scan"
              >
                <span>Next</span>
                <ChevronRight size={15} />
              </button>
              <button
                onClick={handleDownloadAll}
                className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-teal-600 to-indigo-600 text-white text-xs font-semibold hover:from-teal-700 hover:to-indigo-700 shadow-sm flex items-center gap-1.5 transition-all"
                title="Download all enhanced scans in batch"
              >
                <DownloadCloud size={15} />
                <span>Download All ({batchIds.length})</span>
              </button>
            </div>
          </div>

          {/* Thumbnail Strip */}
          <div className="flex items-center gap-2.5 overflow-x-auto py-1 no-scrollbar">
            {batchIds.map((id, index) => {
              const batchJob = batchJobs.find(j => (j.id === id || j.jobId === id));
              const isActive = id === jobId;
              const displayName = batchJob?.filename || `Scan #${index + 1}`;
              const thumbSrc = batchJob?.thumbnailUrl || batchJob?.enhancedUrl || batchJob?.originalUrl;

              return (
                <button
                  key={id}
                  onClick={() => navigateToBatchJob(id)}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl border text-left shrink-0 transition-all ${
                    isActive
                      ? 'border-teal-500 bg-teal-50/80 ring-2 ring-teal-500/20 shadow-xs'
                      : 'border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700/60 overflow-hidden flex items-center justify-center shrink-0">
                    {thumbSrc ? (
                      <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <FileImage size={15} className="text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0 pr-1">
                    <div className="flex items-center gap-1">
                      <span className={`text-[11px] font-bold ${isActive ? 'text-teal-900' : 'text-slate-700'}`}>
                        Scan {index + 1}
                      </span>
                      {isActive && <CheckCircle2 size={12} className="text-teal-600" />}
                    </div>
                    <p className="text-[10px] text-slate-500 truncate max-w-[130px] font-mono" title={displayName}>
                      {displayName}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Viewer Area */}
      <div className="flex-1 relative flex flex-col p-4 sm:p-6 overflow-hidden">
        {/* Fullscreen controls overlay */}
        {isFullscreen && (
          <div className="absolute top-4 right-4 z-50 flex gap-2 bg-black/50 backdrop-blur-sm p-2 rounded-xl">
            <button onClick={toggleFullscreen} className="p-2 text-white hover:bg-white/20 rounded-lg">
              <Minimize2 size={24} />
            </button>
          </div>
        )}
        
        {!isFullscreen && (
          <div className="absolute top-8 right-8 z-10">
            <button onClick={toggleFullscreen} className="p-2 bg-white/80 backdrop-blur-sm shadow-sm text-slate-700 hover:bg-white rounded-lg">
              <Maximize2 size={20} />
            </button>
          </div>
        )}

        {/* Viewers */}
        <div className="flex-1 bg-slate-200/50 rounded-2xl overflow-hidden relative shadow-inner border border-slate-200 flex items-center justify-center">
          
          {viewMode === 'slider' ? (
            <div 
              ref={sliderRef}
              className="relative w-full h-full max-h-full max-w-5xl mx-auto select-none overflow-hidden flex items-center justify-center"
              onMouseDown={handleDragStart}
              onTouchStart={handleDragStart}
            >
              {/* Right: Enhanced (Background) */}
              <div className="absolute inset-0 flex items-center justify-center">
                <img 
                  src={enhancedImageUrl} 
                  alt="Enhanced" 
                  onLoad={(e) => {
                    if (e.target.naturalWidth && e.target.naturalHeight) {
                      setImageAspect(`${e.target.naturalWidth} / ${e.target.naturalHeight}`);
                      setImageDimensions({ width: e.target.naturalWidth, height: e.target.naturalHeight });
                    }
                  }}
                  className="max-w-full max-h-full object-contain pointer-events-none"
                  draggable={false}
                />
              </div>

              {/* Left: Original (Clipped) */}
              <div 
                className="absolute inset-0 flex items-center justify-center overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
              >
                <img 
                  src={originalImageUrl} 
                  alt="Original" 
                  onLoad={(e) => {
                    if (e.target.naturalWidth && e.target.naturalHeight) {
                      setImageAspect(`${e.target.naturalWidth} / ${e.target.naturalHeight}`);
                      setImageDimensions(prev => prev || { width: e.target.naturalWidth, height: e.target.naturalHeight });
                    }
                  }}
                  className="max-w-full max-h-full object-contain pointer-events-none"
                  draggable={false}
                />
              </div>

              {/* Dynamic Fracture Marker Overlay (locked to image aspect ratio) */}
              {showMarker && fractureMarker && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                  <div
                    className="relative max-w-full max-h-full w-full h-full flex items-center justify-center"
                    style={{ aspectRatio: imageAspect }}
                  >
                    <svg className="absolute inset-0 w-full h-full pointer-events-none">
                      {/* Pulsing defect ring */}
                      <circle
                        cx={`${fractureMarker.cx}%`}
                        cy={`${fractureMarker.cy}%`}
                        r={`${fractureMarker.radius || 10}%`}
                        stroke={fractureMarker.color || '#EF4444'}
                        strokeWidth="3"
                        fill="rgba(239, 68, 68, 0.22)"
                        className="animate-pulse"
                      />
                      {/* Radar dashed framing ring */}
                      <circle
                        cx={`${fractureMarker.cx}%`}
                        cy={`${fractureMarker.cy}%`}
                        r={`${Math.min((fractureMarker.radius || 10) * 1.35, 45)}%`}
                        stroke={fractureMarker.color || '#EF4444'}
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                        fill="none"
                        opacity="0.8"
                      />
                      {/* Center target crosshair */}
                      <circle
                        cx={`${fractureMarker.cx}%`}
                        cy={`${fractureMarker.cy}%`}
                        r="3.5"
                        fill={fractureMarker.color || '#EF4444'}
                      />
                    </svg>

                    {/* Tag badge */}
                    <div
                      className="absolute pointer-events-auto bg-slate-950/90 text-white text-[11px] px-2.5 py-1 rounded-lg border border-red-500 shadow-xl backdrop-blur-sm -translate-x-1/2 flex items-center gap-1.5 whitespace-nowrap"
                      style={{
                        left: `${fractureMarker.cx}%`,
                        top: `calc(${fractureMarker.cy}% + ${fractureMarker.radius || 10}% + 6px)`
                      }}
                    >
                      <Target size={12} className="text-red-400" />
                      <span className="font-bold text-red-400">Fracture</span>
                      {fractureMarker.condition && (
                        <span className="text-slate-300">({fractureMarker.condition})</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Slider Handle & Line */}
              <div 
                className="absolute inset-y-0 w-0.5 bg-teal-500 cursor-ew-resize z-20 shadow-[0_0_10px_rgba(20,184,166,0.5)]"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-white border-2 border-teal-500 rounded-full flex items-center justify-center shadow-lg pointer-events-none">
                  <GripVertical size={16} className="text-teal-600" />
                </div>
              </div>

              {/* Labels */}
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-sm font-medium z-10 pointer-events-none">
                Original
              </div>
              <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-sm text-teal-400 px-3 py-1.5 rounded-lg text-sm font-medium z-10 pointer-events-none border border-teal-500/30">
                Enhanced
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col md:flex-row gap-4 p-4 overflow-auto">
              <div className="flex-1 flex flex-col gap-2">
                <div className="text-center font-medium text-slate-700 bg-white/50 py-2 rounded-lg border border-slate-200 shadow-sm">Original</div>
                <div className="flex-1 rounded-xl overflow-hidden bg-black/5 flex items-center justify-center relative group">
                  <img 
                    src={originalImageUrl} 
                    alt="Original" 
                    onLoad={(e) => {
                      if (e.target.naturalWidth && e.target.naturalHeight) {
                        setImageDimensions(prev => prev || { width: e.target.naturalWidth, height: e.target.naturalHeight });
                      }
                    }}
                    className="max-w-full max-h-full object-contain transition-transform duration-300 group-hover:scale-105" 
                  />
                  {showMarker && fractureMarker && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="relative max-w-full max-h-full w-full h-full" style={{ aspectRatio: imageAspect }}>
                        <svg className="absolute inset-0 w-full h-full pointer-events-none">
                          <circle cx={`${fractureMarker.cx}%`} cy={`${fractureMarker.cy}%`} r={`${fractureMarker.radius || 10}%`} stroke="#EF4444" strokeWidth="2.5" fill="rgba(239, 68, 68, 0.2)" className="animate-pulse" />
                          <circle cx={`${fractureMarker.cx}%`} cy={`${fractureMarker.cy}%`} r="3" fill="#EF4444" />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <div className="text-center font-medium text-teal-700 bg-teal-50 py-2 rounded-lg border border-teal-100 shadow-sm">Enhanced</div>
                <div className="flex-1 rounded-xl overflow-hidden bg-black/5 flex items-center justify-center relative group">
                  <img 
                    src={enhancedImageUrl} 
                    alt="Enhanced" 
                    onLoad={(e) => {
                      if (e.target.naturalWidth && e.target.naturalHeight) {
                        setImageDimensions({ width: e.target.naturalWidth, height: e.target.naturalHeight });
                      }
                    }}
                    className="max-w-full max-h-full object-contain transition-transform duration-300 group-hover:scale-105" 
                  />
                  {showMarker && fractureMarker && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="relative max-w-full max-h-full w-full h-full" style={{ aspectRatio: imageAspect }}>
                        <svg className="absolute inset-0 w-full h-full pointer-events-none">
                          <circle cx={`${fractureMarker.cx}%`} cy={`${fractureMarker.cy}%`} r={`${fractureMarker.radius || 10}%`} stroke="#EF4444" strokeWidth="2.5" fill="rgba(239, 68, 68, 0.2)" className="animate-pulse" />
                          <circle cx={`${fractureMarker.cx}%`} cy={`${fractureMarker.cy}%`} r="3" fill="#EF4444" />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Metadata Panel */}
        {!isFullscreen && (
          <div className="mt-4 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden transition-all duration-300">
            <button 
              onClick={() => setShowMetadata(!showMetadata)}
              className="w-full px-6 py-3 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <span className="font-semibold text-slate-700">Image Details</span>
              {showMetadata ? <ChevronUp size={20} className="text-slate-500" /> : <ChevronDown size={20} className="text-slate-500" />}
            </button>
            
            <AnimatePresence>
              {showMetadata && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 border-t border-slate-100">
                    <div>
                      <p className="text-sm text-slate-500 mb-1">File Size</p>
                      <p className="font-semibold text-slate-800">
                        {measuredFileSize 
                          ? formatFileSize(measuredFileSize) 
                          : (job?.fileSize ? formatFileSize(job.fileSize) : 'Available')}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Dimensions</p>
                      <p className="font-semibold text-slate-800">
                        {imageDimensions 
                          ? `${imageDimensions.width} × ${imageDimensions.height}` 
                          : 'Analyzing...'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Date Processed</p>
                      <p className="font-semibold text-slate-800">
                        {new Date(job.completedAt || job.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Processing Time</p>
                      <p className="font-semibold text-slate-800">
                        {calculateProcessingTime()}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageViewerPage;
