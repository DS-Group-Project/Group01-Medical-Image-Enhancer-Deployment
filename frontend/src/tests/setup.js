import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
  window.alert = () => {};
  window.confirm = () => true;
}
