import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      // Cross-root imports uit supabase/functions/_shared (ADR-0033): de
      // dev-server serveert anders geen bestanden buiten frontend/ — nodig
      // voor de re-export-shims én de werkagenda-kernel. '..' = de repo-root;
      // build en Vitest hebben dit niet nodig.
      allow: ['..'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
