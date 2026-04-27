import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PATHS = [
  '/auth', '/notices', '/alliance-notices', '/rallies', '/members', '/boards',
  '/uploads', '/translations', '/users', '/translate', '/tts-audio', '/time', '/admin',
  '/me', '/rally-groups',
];

// 백엔드 주소 — 워크트리 분리 작업 시 다른 포트로 분기 가능 (예: VITE_API_TARGET=http://localhost:3002)
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      ...Object.fromEntries(
        API_PATHS.map((p) => [p, { target: API_TARGET, changeOrigin: true }])
      ),
      '/socket.io': {
        target: API_TARGET,
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
