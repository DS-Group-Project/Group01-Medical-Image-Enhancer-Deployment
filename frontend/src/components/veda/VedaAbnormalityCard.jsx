// src/components/veda/VedaAbnormalityCard.jsx
import React, { useState, useEffect } from 'react';
import { AlertCircle, Target, Eye, ZoomIn, X, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const VedaAbnormalityCard = ({ payload, imageUrl }) => {
  const [aspect, setAspect] = useState('auto');
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isZoomed) {
        setIsZoomed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZoomed]);

  if (!payload) return null;

  const marker = payload.marker;
  const cx = marker ? marker.cx : 50;
  const cy = marker ? marker.cy : 50;
  const radius = marker ? marker.radius : 10;
  const color = marker?.color || '#EF4444';

  const renderSvgOverlay = () => {
    if (!marker) return null;
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {/* Outer animated radar pulse ring */}
        <circle
          cx={`${cx}%`}
          cy={`${cy}%`}
          r={`${radius}%`}
          stroke={color}
          strokeWidth="3"
          fill="rgba(239, 68, 68, 0.22)"
          className="animate-pulse"
        />
        {/* Outer dashed framing ring */}
        <circle
          cx={`${cx}%`}
          cy={`${cy}%`}
          r={`${Math.min(radius * 1.35, 45)}%`}
          stroke={color}
          strokeWidth="1.8"
          strokeDasharray="4 4"
          fill="none"
          opacity="0.85"
        />
        {/* Center target crosshair dot */}
        <circle cx={`${cx}%`} cy={`${cy}%`} r="3.5" fill={color} />
      </svg>
    );
  };

  return (
    <div className="mt-3.5 bg-slate-900/95 border border-red-500/40 rounded-2xl p-4 sm:p-5 shadow-xl shadow-red-950/20">
      {/* Header Badge */}
      <div className="flex items-center justify-between gap-3 mb-3 pb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2 text-red-400 min-w-0">
          <AlertCircle size={18} className="animate-pulse flex-shrink-0" />
          <span className="text-sm sm:text-base font-bold tracking-wide uppercase truncate">
            {payload.condition || 'Fracture Identified'}
          </span>
        </div>
        <span className="text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/30 px-2.5 py-1 rounded-full flex items-center gap-1.5 flex-shrink-0">
          <Target size={13} />
          Defect Marked
        </span>
      </div>

      {/* Annotated Visual Overlay */}
      {imageUrl && (
        <div className="relative group my-2.5">
          <div
            onClick={() => setIsZoomed(true)}
            title="Click to view full image in high resolution"
            className="relative w-full max-h-[380px] sm:max-h-[460px] md:max-h-[500px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center mx-auto cursor-pointer transition-all duration-200 group-hover:border-red-500/50 shadow-inner"
          >
            <div
              className="relative max-w-full max-h-[380px] sm:max-h-[460px] md:max-h-[500px] flex items-center justify-center"
              style={{ aspectRatio: aspect }}
            >
              <img
                src={imageUrl}
                alt="Annotated Scan"
                onLoad={(e) => {
                  if (e.target.naturalWidth && e.target.naturalHeight) {
                    setAspect(`${e.target.naturalWidth} / ${e.target.naturalHeight}`);
                  }
                }}
                className="max-w-full max-h-[380px] sm:max-h-[460px] md:max-h-[500px] object-contain select-none block transition-transform duration-300 group-hover:scale-[1.01]"
              />

              {/* Dynamic SVG Defect Overlay */}
              {renderSvgOverlay()}
            </div>

            {/* Hover overlay hint */}
            <div className="absolute bottom-2.5 right-2.5 bg-slate-900/80 backdrop-blur-sm border border-slate-700 text-slate-200 px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 opacity-90 group-hover:opacity-100 group-hover:bg-teal-900/80 group-hover:text-teal-200 group-hover:border-teal-700/50 transition-all shadow-md">
              <ZoomIn size={14} />
              <span>Click to enlarge</span>
            </div>
          </div>
        </div>
      )}

      {/* Anatomical Details */}
      {payload.locationDescription && (
        <div className="text-xs sm:text-sm text-slate-200 mt-3 bg-slate-800/80 rounded-xl px-3.5 py-2.5 border border-slate-700/60 leading-relaxed shadow-sm">
          <span className="text-red-400 font-bold">Location:</span> {payload.locationDescription}
        </div>
      )}

      {/* Clinical Radiologist Report Description */}
      {payload.description && (
        <p className="text-sm sm:text-[15px] text-slate-100 mt-3 leading-relaxed font-normal">
          {payload.description}
        </p>
      )}

      {/* Lightbox / Zoom Modal */}
      <AnimatePresence>
        {isZoomed && imageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 sm:p-6"
            onClick={() => setIsZoomed(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-5xl w-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
            >
              {/* Lightbox Header */}
              <div className="bg-slate-950 px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertCircle size={18} />
                  <span className="font-bold text-sm sm:text-base uppercase tracking-wide">
                    {payload.condition || 'Fracture Identified'}
                  </span>
                  <span className="text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full ml-2">
                    Defect Marked
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsZoomed(false)}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                  title="Close (Esc)"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Lightbox Image View */}
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950/80 min-h-[300px]">
                <div
                  className="relative max-w-full max-h-[70vh] flex items-center justify-center"
                  style={{ aspectRatio: aspect }}
                >
                  <img
                    src={imageUrl}
                    alt="High Resolution Scan"
                    className="max-w-full max-h-[70vh] object-contain block select-none"
                  />
                  {renderSvgOverlay()}
                </div>
              </div>

              {/* Lightbox Footer */}
              {(payload.locationDescription || payload.description) && (
                <div className="bg-slate-950 px-5 py-3.5 border-t border-slate-800 text-xs sm:text-sm text-slate-200">
                  {payload.locationDescription && (
                    <div className="mb-1">
                      <span className="text-red-400 font-bold">Location:</span> {payload.locationDescription}
                    </div>
                  )}
                  {payload.description && (
                    <p className="text-slate-300 leading-relaxed">{payload.description}</p>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};