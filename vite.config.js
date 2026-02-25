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
      },
      '/or-rankings': {
        target: 'https://openrouter.ai',
        changeOrigin: true,
        rewrite: () => '/rankings',
        secure: true,
      },
      '/zillow-csv': {
        target: 'https://files.zillowstatic.com/research/public_csvs',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/zillow-csv/, ''),
        secure: true,
      }
    }
  }
})
