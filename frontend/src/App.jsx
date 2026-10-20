import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Toaster } from 'react-hot-toast';
import AppLayout from './components/layout/AppLayout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));
const ProcessingPage = lazy(() => import('./pages/ProcessingPage'));
const ImageViewerPage = lazy(() => import('./pages/ImageViewerPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const PageFallback = () => (
  <div className="flex items-center justify-center min-h-[400px] w-full">
    <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div></div>;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position='top-right' toastOptions={{ duration: 4000, style: { borderRadius: '12px', padding: '16px' } }} />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path='/login' element={<LoginPage />} />
            <Route path='/register' element={<RegisterPage />} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path='/' element={<DashboardPage />} />
              <Route path='/upload' element={<UploadPage />} />
              <Route path='/processing/:jobId' element={<ProcessingPage />} />
              <Route path='/viewer/:jobId' element={<ImageViewerPage />} />
              <Route path='/history' element={<HistoryPage />} />
            </Route>
            <Route path='*' element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
