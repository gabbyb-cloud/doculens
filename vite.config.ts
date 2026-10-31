import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In development the Vite dev server proxies /api to the local Express server,
// so the browser only ever talks to one origin and no CORS headers are needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
  },
});
