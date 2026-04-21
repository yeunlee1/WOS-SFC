import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PATHS = [
  '/auth', '/notices', '/alliance-notices', '/rallies', '/members', '/boards',
  '/uploads', '/translations', '/users', '/translate', '/tts-audio', '/time', '/admin',
  '/me', '/rally-groups',
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      ...Object.fromEntries(
        API_PATHS.map((p) => [p, { target: 'http://localhost:3001', changeOrigin: true }])
      ),
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
