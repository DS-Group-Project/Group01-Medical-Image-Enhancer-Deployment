import api from './api';

/**
 * Service for handling authentication related API calls.
 *
 * Auth state lives in an HttpOnly cookie the backend sets — this service
 * never reads or writes a token in localStorage/sessionStorage (see api.js
 * for why). Because JS can't read an HttpOnly cookie, "am I logged in?" is
 * answered by asking the server (getCurrentUser), not by checking storage.
 */
export const authService = {
  /**
   * Logs in a user. The backend sets the session cookie on the response;
   * we just return the user payload.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{user: Object}>}
   */
  login: async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  },

  register: async (userData) => {
    const response = await api.post('/auth/register', userData);
    return response.data;
  },

  logout: async () => {
    await api.post('/auth/logout');
  },

  /**
   * Retrieves the current authenticated user's details. This doubles as the
   * "isAuthenticated" check: a 401 means no valid session.
   *
   * @returns {Promise<{user: Object}>}
   */
  getCurrentUser: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },
};

export default authService;
