import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor';
            }
            if (id.includes('bootstrap') || id.includes('react-bootstrap')) {
              return 'bootstrap-vendor';
            }
            if (id.includes('recharts')) {
              return 'recharts-vendor';
            }
            if (id.includes('axios')) {
              return 'axios-vendor';
            }
            if (id.includes('date-fns')) {
              return 'date-fns-vendor';
            }
            if (id.includes('algoliasearch') || id.includes('instantsearch')) {
              return 'algolia-vendor';
            }
            return 'vendor'; // all other node_modules
          }
        },
      },
    },
  },
})
