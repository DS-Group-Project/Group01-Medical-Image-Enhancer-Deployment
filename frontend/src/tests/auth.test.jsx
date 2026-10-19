/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

afterEach(() => {
  cleanup();
});
import RegisterPage from '../pages/RegisterPage.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import { authService } from '../services/authService.js';

vi.mock('../services/authService.js', () => ({
  authService: {
    register: vi.fn(),
    login: vi.fn()
  }
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const mockLogin = vi.fn();
const mockRegister = vi.fn();
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ login: mockLogin, register: mockRegister, user: null })
}));

describe('Frontend Auth Flows', () => {
  describe('RegisterPage', () => {
    it('validates password match before submission', async () => {
      render(
        <BrowserRouter>
          <RegisterPage />
        </BrowserRouter>
      );
      
      const nameInput = screen.getAllByPlaceholderText(/Full Name/i)[0];
      const emailInput = screen.getAllByPlaceholderText(/Email/i)[0];
      const passwordInput = screen.getAllByPlaceholderText(/^Password/i)[0] || screen.getAllByPlaceholderText(/Password/i)[0];
      const confirmPasswordInput = screen.getAllByPlaceholderText(/Confirm Password/i)[0];
      
      fireEvent.change(nameInput, { target: { value: 'Test' } });
      fireEvent.change(emailInput, { target: { value: 'test@t.com' } });
      fireEvent.change(passwordInput, { target: { value: 'pwd1' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'pwd2' } });
      
      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
      
      expect(await screen.findByText(/Passwords do not match/i)).not.toBeNull();
      expect(authService.register).not.toHaveBeenCalled();
    });

    it('submits successfully when passwords match', async () => {
      mockRegister.mockResolvedValue({});
      
      render(
        <BrowserRouter>
          <RegisterPage />
        </BrowserRouter>
      );
      
      const nameInput = screen.getAllByPlaceholderText(/Full Name/i)[0];
      const emailInput = screen.getAllByPlaceholderText(/Email/i)[0];
      const passwordInput = screen.getAllByPlaceholderText(/^Password/i)[0] || screen.getAllByPlaceholderText(/Password/i)[0];
      const confirmPasswordInput = screen.getAllByPlaceholderText(/Confirm Password/i)[0];
      
      fireEvent.change(nameInput, { target: { value: 'Test' } });
      fireEvent.change(emailInput, { target: { value: 'test@t.com' } });
      fireEvent.change(passwordInput, { target: { value: 'StrongP@ssw0rd1' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'StrongP@ssw0rd1' } });
      
      const termsCheckbox = screen.getByRole('checkbox', { name: /I agree/i });
      fireEvent.click(termsCheckbox);

      fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
      
      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalledWith({
          name: 'Test',
          email: 'test@t.com',
          password: 'StrongP@ssw0rd1',
          confirmPassword: 'StrongP@ssw0rd1'
        });
        expect(mockNavigate).toHaveBeenCalledWith('/');
      });
    });
  });

  describe('LoginPage', () => {
    it('submits login data and navigates on success', async () => {
      mockLogin.mockResolvedValue({});
      
      render(
        <BrowserRouter>
          <LoginPage />
        </BrowserRouter>
      );
      
      const emailInput = screen.getAllByPlaceholderText(/Email/i)[0];
      const passwordInput = screen.getAllByPlaceholderText(/Password/i)[0];
      
      fireEvent.change(emailInput, { target: { value: 'test@t.com' } });
      fireEvent.change(passwordInput, { target: { value: 'pwd1' } });
      
      fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
      
      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith('test@t.com', 'pwd1');
        expect(mockNavigate).toHaveBeenCalledWith('/');
      });
    });
  });
});
