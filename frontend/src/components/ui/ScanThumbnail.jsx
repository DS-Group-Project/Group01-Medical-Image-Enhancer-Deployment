import React, { useState, useEffect } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import api from '../../services/api';

// In-memory cache for loaded blob URLs so we don't re-fetch the same thumbnail on tab switch
export const thumbnailBlobCache = new Map();

export const ScanThumbnail = ({ 
  jobId, 
  src, 
  alt = 'Scan thumbnail', 
  className = '', 
  fallbackIconSize = 28 
}) => {
  const targetKey = jobId || src;

  const getInitialBlob = () => {
    if (src && (src.startsWith('blob:') || src.startsWith('data:'))) {
      return src;
    }
    return targetKey && thumbnailBlobCache.has(targetKey) ? thumbnailBlobCache.get(targetKey) : null;
  };

  const [blobUrl, setBlobUrl] = useState(getInitialBlob);
  const [loading, setLoading] = useState(!blobUrl && Boolean(jobId || src));
  const [error, setError] = useState(false);

  useEffect(() => {
    // 1. Direct renderable data: or blob: URLs
    if (src && (src.startsWith('blob:') || src.startsWith('data:'))) {
      setBlobUrl(src);
      setLoading(false);
      return;
    }

    // 2. Check in-memory cache
    if (targetKey && thumbnailBlobCache.has(targetKey)) {
      setBlobUrl(thumbnailBlobCache.get(targetKey));
      setLoading(false);
      return;
    }

    let isCancelled = false;

    const fetchThumbnail = async () => {
      try {
        setLoading(true);
        setError(false);

        // 3. Determine the authenticated backend streaming endpoint
        let endpoint = null;
        if (jobId) {
          endpoint = `/jobs/${jobId}/image/stream?type=enhanced`;
        } else if (src) {
          if (src.includes('/jobs/') && src.includes('/image/stream')) {
            try {
              const parsed = new URL(src, window.location.origin);
              endpoint = parsed.pathname + parsed.search;
            } catch {
              endpoint = src;
            }
          } else if (src.startsWith('/')) {
            endpoint = src;
          }
        }

        let response = null;
        if (endpoint) {
          try {
            response = await api.get(endpoint, { responseType: 'blob' });
          } catch (firstErr) {
            // If enhanced stream failed or wasn't available yet, fall back to original scan stream
            if (endpoint.includes('type=enhanced')) {
              const fallbackEndpoint = endpoint.replace('type=enhanced', 'type=original');
              try {
                response = await api.get(fallbackEndpoint, { responseType: 'blob' });
              } catch (secondErr) {
                // Stream fallback failed
              }
            }
          }
        }

        if (!isCancelled && response?.data) {
          const url = URL.createObjectURL(response.data);
          if (targetKey) thumbnailBlobCache.set(targetKey, url);
          setBlobUrl(url);
          return;
        }

        // 4. Secondary fallback: if src is an external/direct URL, attempt direct image render
        if (!isCancelled && src && src.startsWith('http')) {
          setBlobUrl(src);
          return;
        }

        if (!isCancelled) {
          setError(true);
        }
      } catch (err) {
        if (!isCancelled) {
          // Last resort fallback to src if available
          if (src && src.startsWith('http')) {
            setBlobUrl(src);
          } else {
            setError(true);
          }
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    fetchThumbnail();

    return () => {
      isCancelled = true;
    };
  }, [jobId, src, targetKey]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-slate-950 border border-slate-800 ${className}`}>
        <Loader2 size={Math.min(fallbackIconSize, 20)} className="text-teal-400 animate-spin opacity-80" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className={`flex flex-col items-center justify-center bg-slate-950 border border-slate-800 text-slate-500 ${className}`}>
        <ImageIcon size={fallbackIconSize} className="opacity-60 text-slate-400" />
        <span className="text-[10px] text-slate-400 mt-0.5 font-mono tracking-tight font-medium">Scan</span>
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      loading="lazy"
      className={`object-cover w-full h-full ${className}`}
      onError={() => {
        if (targetKey) thumbnailBlobCache.delete(targetKey);
        setError(true);
      }}
    />
  );
};

export default ScanThumbnail;
