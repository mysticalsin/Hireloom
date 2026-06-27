import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendors so the marketing landing doesn't ship the whole app,
        // and the authed dashboard chunk loads only after sign-in (see App.tsx lazy).
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
          motion: ['framer-motion', 'lenis'],
        },
      },
    },
  },
});
