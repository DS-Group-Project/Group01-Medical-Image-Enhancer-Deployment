import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { authService } from '../services/authService';
import { mockAuthService } from '../services/mockData';
import { resetCsrfToken } from '../services/api';

export const AuthContext = createContext(null);

/**
 * Custom hook to consume the AuthContext.
 * Throws an error if used outside of an AuthProvider.
 */
export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Only ever use the mock service when explicitly opted in via env var. The
// previous `|| true` fallback here meant mock auth silently stayed active
// even in a production build that forgot to set VITE_USE_MOCK=false, which
// would let anyone "log in" with no real credential check. Fail closed instead:
// no explicit "true" means we talk to the real backend.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const activeAuthService = USE_MOCK ? mockAuthService : authService;

// Auto-logout after this many ms of inactivity. Medical-imaging apps
// commonly enforce a short idle timeout so a session left open on a shared
// workstation doesn't stay live indefinitely. This is a UX-layer safeguard;
// the backend should independently expire the session cookie server-side too.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];

/**
 * AuthProvider component that wraps the application to provide authentication context.
 *
 * Authentication state is derived by asking the server (getCurrentUser), not
 * by reading a client-side token, because the real session lives in an
 * HttpOnly cookie the frontend cannot and should not read directly.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const idleTimerRef = useRef(null);

  const refreshSession = useCallback(async () => {
    try {
      const data = await activeAuthService.getCurrentUser();
      setUser(data.user);
      setIsAuthenticated(true);
      return true;
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      await refreshSession();
      setIsLoading(false);
    };
    initAuth();
  }, [refreshSession]);

  const login = async (email, password) => {
    const data = await activeAuthService.login(email, password);
    resetCsrfToken();
    setUser(data.user);
    setIsAuthenticated(true);
    return data;
  };

  const register = async (userData) => {
    const data = await activeAuthService.register(userData);
    resetCsrfToken();
    setUser(data.user);
    setIsAuthenticated(true);
    return data;
  };

  const logout = useCallback(async (options = {}) => {
    try {
      await activeAuthService.logout();
    } catch (error) {
      // Even if the server call fails, drop local auth state so the UI
      // doesn't keep showing the user as logged in.
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      if (!options.silent) {
        window.location.href = '/login';
      }
    }
  }, []);

  // Idle-timeout auto logout, only while authenticated.
  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        logout({ silent: true }).finally(() => {
          window.location.href = '/login?reason=idle';
        });
      }, IDLE_TIMEOUT_MS);
    };

    resetIdleTimer();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetIdleTimer));

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [isAuthenticated, logout]);

  const value = {
    user,
    isAuthenticated,
    isLoading,
    login,
    register,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
