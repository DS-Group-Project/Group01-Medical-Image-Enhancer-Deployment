import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { authService } from '../services/authService';
import { mockAuthService } from '../services/mockData';
import { resetCsrfToken } from '../services/api';

export const AuthContext = createContext(null);

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const activeAuthService = USE_MOCK ? mockAuthService : authService;

// Total idle duration: 15 minutes
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
// Warning duration: final 10 seconds
const WARNING_DURATION_SEC = 10;
const WARNING_TIME_MS = IDLE_TIMEOUT_MS - WARNING_DURATION_SEC * 1000;
const ACTIVITY_EVENTS = ['mousemove','mousedown', 'keydown', 'touchstart', 'scroll'];

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Warning & Countdown states
  const [isIdleWarningOpen, setIsIdleWarningOpen] = useState(false);
  const [remainingTime, setRemainingTime] = useState(WARNING_DURATION_SEC);

  const idleTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);

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
      // Drop local auth state even if server logout call fails
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      setIsIdleWarningOpen(false);
      if (!options.silent) {
        window.location.href = '/login';
      }
    }
  }, []);

  // Idle timeout and 10-second countdown logic
  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const clearAllTimers = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };

    const startCountdown = () => {
      setIsIdleWarningOpen(true);
      setRemainingTime(WARNING_DURATION_SEC);

      let timeLeft = WARNING_DURATION_SEC;
      countdownIntervalRef.current = setInterval(() => {
        timeLeft -= 1;
        setRemainingTime(timeLeft);

        if (timeLeft <= 0) {
          clearInterval(countdownIntervalRef.current);
          setIsIdleWarningOpen(false);
          logout({ silent: true }).finally(() => {
            window.location.href = '/login?reason=idle';
          });
        }
      }, 1000);
    };

    const resetIdleTimer = () => {
      clearAllTimers();
      setIsIdleWarningOpen(false);
      setRemainingTime(WARNING_DURATION_SEC);

      idleTimerRef.current = setTimeout(() => {
        startCountdown();
      }, WARNING_TIME_MS);
    };

    resetIdleTimer();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetIdleTimer));

    return () => {
      clearAllTimers();
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
    isIdleWarningOpen,
    remainingTime,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};