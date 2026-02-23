import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/cboe-api': {
        target: 'https://cdn.cboe.com/api/global/delayed_quotes/options',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cboe-api/, ''),
        secure: true,
      },
      '/fred-api': {
        target: 'https://api.stlouisfed.org',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/fred-api/, ''),
        secure: true,
      }
    }
  }
})
