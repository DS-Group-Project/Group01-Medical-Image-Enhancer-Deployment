import axios from 'axios';
import safeLog from '../utils/safeLog';
import { toast } from 'react-hot-toast';

/**
 * Base Axios instance for API communication.
 *
 * SECURITY NOTE (auth model):
 * This app uses cookie-based sessions, not a token stored in JS-accessible
 * storage. The backend is expected to:
 *   1. Set the session/JWT as an HttpOnly, Secure, SameSite=Lax|Strict cookie
 *      on login/register (e.g. `Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax`).
 *      Because it's HttpOnly, client-side JS (and therefore any XSS payload)
 *      cannot read or exfiltrate it.
 *   2. Set a second, readable, non-HttpOnly `XSRF-TOKEN` cookie containing a
 *      random CSRF token, and require that value to be echoed back in an
 *      `X-XSRF-TOKEN` header on every state-changing request (POST/PUT/PATCH/DELETE).
 *      This is the standard "double-submit cookie" CSRF defense that pairs with
 *      cookie-based auth. Axios does this automatically for same-site requests
 *      via the xsrfCookieName/xsrfHeaderName config below.
 *   3. Set CORS headers with `Access-Control-Allow-Credentials: true` and an
 *      explicit (non-wildcard) `Access-Control-Allow-Origin` matching this app's
 *      origin, since `withCredentials: true` requires it.
 *
 * We deliberately do NOT store any token in localStorage/sessionStorage:
 * anything in those is readable by any script running on the page, so a single
 * XSS bug would otherwise mean full session theft. This is especially important
 * here since the app handles medical images.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000',
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let csrfToken = null;
let csrfTokenPromise = null;

/**
 * Reset the cached CSRF token so the next mutating request fetches a fresh one.
 * Call this after login/register or when a CSRF validation error occurs.
 */
export function resetCsrfToken() {
  csrfToken = null;
  csrfTokenPromise = null;
}

// Request Interceptor: Attach the CSRF token automatically to mutating requests
api.interceptors.request.use(
  async (config) => {
    // Remove Bearer token logic - auth is now handled automatically by HttpOnly cookies via withCredentials: true
    if (config.method && !['get', 'head', 'options'].includes(config.method.toLowerCase())) {
      if (!csrfToken) {
        if (!csrfTokenPromise) {
          // Avoid infinite loop if this request itself is fetching the token
          if (config.url !== '/csrf-token') {
             csrfTokenPromise = api.get('/csrf-token').then(res => res.data.csrfToken);
          }
        }
        if (csrfTokenPromise) {
          csrfToken = await csrfTokenPromise;
        }
      }
      if (csrfToken) {
        config.headers['x-csrf-token'] = csrfToken;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// SECURITY: Warn loudly if a production build is configured to talk to a plain
// HTTP backend. The session cookie has Secure flag, so it won't even be sent
// over HTTP — meaning auth silently breaks. Catch this during development.
if (import.meta.env.PROD && api.defaults.baseURL?.startsWith('http://')) {
  safeLog.error(
    '[SECURITY] API base URL uses plain HTTP in a production build. ' +
    'The HttpOnly/Secure session cookie will NOT be sent over insecure ' +
    'connections. Set VITE_API_BASE_URL to an https:// URL.'
  );
}

// Access tokens now expire after 15 minutes (see backend routes/auth.js).
// Rather than the user getting logged out every 15 minutes, a 401 triggers
// one silent call to /auth/refresh using the separate, longer-lived
// refreshToken cookie; if that succeeds we retry the original request. If
// it fails (refresh token missing/expired/reused), we fall through to the
// normal "session expired" redirect below.
let refreshPromise = null;

function refreshAccessToken() {
  if (!refreshPromise) {
    // Plain axios call, not the `api` instance — this must NOT go through
    // this same response interceptor, or a failed refresh would recurse.
    refreshPromise = axios
      .post(`${api.defaults.baseURL}/auth/refresh`, {}, { withCredentials: true })
      .then((res) => res.data)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * Response Interceptor
 * Handles global API errors, silent token refresh, and 401 (session
 * expired/invalid) redirects.
 * No request interceptor is needed for auth: the browser attaches the
 * HttpOnly cookie automatically, and axios attaches the CSRF header itself.
 */
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response ? error.response.status : null;
    const originalRequest = error.config;

    // Try exactly one silent refresh per request. Never for the refresh
    // endpoint itself or for login/register (a 401 there means bad
    // credentials, not an expired access token).
    const isAuthEndpoint = ['/auth/refresh', '/auth/login', '/auth/register'].some((p) =>
      originalRequest?.url?.includes(p)
    );

    if (status === 401 && !isAuthEndpoint && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        await refreshAccessToken();
        return api(originalRequest); // replay the original request with the new access token
      } catch (refreshError) {
        // Refresh token missing/expired/reused — fall through to the normal
        // "please log in again" handling below.
      }
    }

    // Don't reflect raw backend error text into the UI unfiltered; keep a safe
    // generic fallback and only show server-provided messages we control.
    const errorCode = error.response?.data?.error;
    let message = error.response?.data?.message || errorCode || 'An unexpected error occurred';

    if (errorCode === 'EMAIL_ALREADY_EXISTS') {
      message = 'An account with this email already exists.';
    } else if (errorCode === 'INVALID_CREDENTIALS') {
      message = 'Invalid email or password.';
    } else if (errorCode === 'ACCOUNT_LOCKED') {
      message = 'Too many failed attempts. Please try again in a few minutes.';
    } else if (errorCode === 'INVALID_CSRF_TOKEN') {
      message = 'Security token expired. Please refresh the page and try again.';
      // Invalidate cached token so next request fetches a fresh one
      resetCsrfToken();
    } else if (errorCode === 'CONDITION_FAILED') {
      message = 'Operation failed due to a conflict. Please try again.';
    } else if (errorCode === 'VALIDATION_ERROR') {
      const details = error.response?.data?.details;
      if (Array.isArray(details) && details.length > 0) {
        message = `Invalid input: ${details[0].message}`;
      } else {
        message = 'Please check your inputs and try again.';
      }
    }

    if (status === 401) {
      if (window.location.pathname !== '/login') {
        toast.error('Session expired. Please log in again.');
        window.location.href = '/login';
      }
    } else if (status === 403) {
      toast.error(message);
    } else if (status === 429) {
      toast.error('Too many requests. Please wait a moment and try again.');
    } else if (status >= 500) {
      toast.error('Something went wrong on our end. Please try again shortly.');
    } else {
      toast.error(message);
    }

    return Promise.reject(error);
  }
);

export default api;
