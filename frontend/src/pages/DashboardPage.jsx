import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, Loader2, Image as ImageIcon, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { mockUploadService } from '../services/mockData';
import StatusBadge from '../components/ui/StatusBadge';
import { safeLog } from '../utils/safeLog';
import { uploadService } from '../services/uploadService';
import { ScanThumbnail } from '../components/ui/ScanThumbnail';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export default function DashboardPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        if (USE_MOCK) {
          const result = await mockUploadService.getJobs({ limit: 4 });
          setJobs((result.jobs || []).slice(0, 4));
        } else {
          const result = await uploadService.getJobs({ limit: 10 });
          const allJobs = result.jobs || [];
          setJobs(allJobs.slice(0, 4));
        }
      } catch (error) {
        safeLog.error('Failed to fetch dashboard data:', error?.message || error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const processingCount = jobs.filter(j => j.status === 'processing').length;
  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const pageVariants = {
    hidden: { opacity: 1 },
    visible: { 
      opacity: 1,
      transition: { duration: 0.4, staggerChildren: 0.1 }
    }
  };

  const childVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { ease: 'easeOut', duration: 0.5 } }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <motion.div 
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      {/* Processing Banner */}
      <AnimatePresence>
        {processingCount > 0 && (
          <motion.div 
            initial={{ opacity: 0, height: 0, y: -20 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center text-amber-800 shadow-sm"
          >
            <Loader2 className="w-5 h-5 animate-spin mr-3 text-amber-600" />
            <span className="font-medium text-sm">You have {processingCount} image{processingCount !== 1 ? 's' : ''} currently processing. We'll notify you when they're ready.</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Welcome Section */}
      <motion.div variants={childVariants} className="flex flex-col md:flex-row md:items-end justify-between">
        <div>
          <p className="text-slate-500 font-medium mb-1">{currentDate}</p>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center">
            Welcome back, {user?.name || 'Doctor'} 
          </h1>
        </div>
      </motion.div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Recent Activity (2/3) */}
        <motion.div variants={childVariants} className="lg:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-900">Recent Activity</h3>
              <Link to="/history" className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1 transition-colors">
                View All <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 animate-pulse">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-200 rounded-xl shrink-0"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-32 bg-slate-200 rounded"></div>
                      <div className="h-3 w-20 bg-slate-200 rounded"></div>
                    </div>
                    <div className="h-6 w-20 bg-slate-200 rounded-full"></div>
                  </div>
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-12">
                <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No recent activity. Upload your first image!</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {jobs.map((job) => {
                  const id = job.id || job.jobId;
                  return (
                    <Link
                      key={id}
                      to={job.status === 'completed' ? `/viewer/${id}` : `/processing/${id}`}
                      className="flex items-center justify-between p-3.5 hover:bg-slate-50 rounded-2xl border border-transparent hover:border-slate-100 transition-all group"
                    >
                      <div className="flex items-center space-x-4">
                        {/* Visible Scan Thumbnail matching History section size */}
                        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-950 rounded-xl overflow-hidden border border-slate-700/60 shrink-0 flex items-center justify-center shadow-md">
                          <ScanThumbnail
                            jobId={id}
                            src={job.thumbnailUrl || job.enhancedUrl || job.originalUrl}
                            alt={job.filename}
                            className="w-full h-full rounded-xl group-hover:scale-105 transition-transform duration-300"
                            fallbackIconSize={28}
                          />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 text-sm sm:text-base group-hover:text-teal-600 transition-colors truncate max-w-[180px] sm:max-w-xs md:max-w-md">{job.filename}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[11px] font-medium px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md capitalize border border-slate-200/60">
                              {job.bodyPart || 'Scan'}
                            </span>
                            <span className="text-xs text-slate-400">{formatDate(job.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={job.status} size="sm" />
                        <ArrowRight className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* Right Column: Quick Upload CTA (1/3) */}
        <motion.div variants={childVariants} className="lg:col-span-1">
          <div className="relative overflow-hidden bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl p-6 text-white h-full shadow-lg flex flex-col justify-between min-h-[280px]">
            {/* Decorative Pattern overlay */}
            <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl"></div>
            <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-32 h-32 bg-teal-900 opacity-20 rounded-full blur-2xl"></div>
            
            <div className="relative z-10">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center mb-4 border border-white/20">
                <UploadCloud className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-2xl font-bold mb-2">Ready to enhance?</h3>
              <p className="text-teal-50 text-sm mb-6 max-w-[220px]">
                Upload your X-ray images for AI-powered noise reduction and enhancement.
              </p>
            </div>

            <Link 
              to="/upload" 
              className="relative z-10 w-full bg-white text-teal-700 font-semibold py-3 px-4 rounded-xl text-center hover:bg-slate-50 transition-colors shadow-sm inline-block"
            >
              Upload Now
            </Link>
          </div>
        </motion.div>

      </div>
    </motion.div>
  );
}
