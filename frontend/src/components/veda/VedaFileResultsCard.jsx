import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { ScanThumbnail } from '../ui/ScanThumbnail';

export const VedaFileResultsCard = ({ payload, onCloseWidget }) => {
  const navigate = useNavigate();

  if (!payload || !payload.images || payload.images.length === 0) {
    return null;
  }

  const handleNavigate = (jobId) => {
    navigate(`/viewer/${jobId}`);
  };

  return (
    <div className="mt-3 grid grid-cols-1 gap-3.5 max-h-96 overflow-y-auto pr-1">
      {payload.images.map((img) => (
        <div
          key={img.jobId}
          onClick={() => handleNavigate(img.jobId)}
          className="flex items-center gap-4 p-3.5 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/80 hover:border-teal-500/60 rounded-2xl cursor-pointer transition-all duration-200 group text-left shadow-md"
        >
          {/* Visible Scan Thumbnail matching History section size */}
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-slate-950 border border-slate-700/80 overflow-hidden flex-shrink-0 shadow-inner">
            <ScanThumbnail
              jobId={img.jobId}
              src={img.thumbnailUrl || img.enhancedUrl || img.originalUrl}
              alt={img.filename}
              className="w-full h-full rounded-xl group-hover:scale-105 transition-transform duration-300"
              fallbackIconSize={30}
            />
          </div>

          <div className="flex-1 min-w-0 py-0.5">
            <p className="text-sm sm:text-base font-semibold text-slate-100 truncate group-hover:text-teal-300 transition-colors">
              {img.filename}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs font-medium bg-teal-950/80 text-teal-300 px-2.5 py-0.5 rounded-md border border-teal-800/50 capitalize">
                {img.bodyPart || 'Scan'}
              </span>
              <span className="text-xs sm:text-sm text-slate-400">
                {new Date(img.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-teal-400/90 mt-2 flex items-center gap-1.5 font-medium group-hover:text-teal-300">
              <span>Inspect scan</span>
              <ExternalLink size={14} />
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};