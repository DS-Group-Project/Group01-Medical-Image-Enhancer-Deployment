import React, { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { VedaProvider } from '../../context/VedaContext';
import { VedaAssistant } from '../veda/VedaAssistant';
import Navbar from './Navbar';
import Footer from './Footer';
import { useAuth } from '../../context/AuthContext';

const AppLayout = () => {
  const { isAuthenticated, isIdleWarningOpen, remainingTime } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const handlePageShow = (event) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <VedaProvider>
      <div className="flex flex-col min-h-screen bg-gradient-to-br from-teal-100 via-sky-50 to-indigo-100">
        <Navbar />

        {/* High-Visibility, High-Contrast Top-Right Session Warning */}
        <div className="fixed top-6 right-6 z-50 pointer-events-none">
          <AnimatePresence>
            {isIdleWarningOpen && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -15, scale: 0.95 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="pointer-events-auto flex items-center gap-4 bg-slate-900/95 text-white px-5 py-4 rounded-2xl shadow-2xl ring-1 ring-white/10 backdrop-blur-md max-w-md border-l-4 border-rose-500"
              >
                {/* Countdown Circular Badge */}
                <div className="flex-shrink-0 relative flex items-center justify-center w-12 h-12 rounded-xl bg-rose-500/20 text-rose-400 font-mono font-bold text-lg border border-rose-500/30">
                  <span className="animate-pulse">{remainingTime}s</span>
                </div>

                {/* Message Content */}
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-rose-400">
                    <AlertCircle size={16} />
                    <span>Session Expiring Soon</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                    Move your mouse or press any key to remain logged in.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <main className="flex-grow pt-20 relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 1, y: 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="w-full h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>

        <Footer />

        {/* Global Floating Veda Agent */}
        <VedaAssistant />
      </div>
    </VedaProvider>
  );
};

export default AppLayout;