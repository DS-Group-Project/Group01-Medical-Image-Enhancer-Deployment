import { loadEnv } from 'vite';

const mode = process.env.NODE_ENV || 'production';
const env = loadEnv(mode, process.cwd(), '');

if (env.VITE_USE_MOCK !== 'false') {
  console.error('\n[SECURITY ERROR] VITE_USE_MOCK must be explicitly set to "false" before building for production.');
  console.error(`Current resolved value: "${env.VITE_USE_MOCK}"\n`);
  process.exit(1);
}

console.log('[SECURITY] VITE_USE_MOCK is false. Safe to build.');
