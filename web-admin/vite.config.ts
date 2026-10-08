import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['react-map-gl/mapbox', 'mapbox-gl']
  },
  build: {
    sourcemap: false, // Desativa mapas de código para impedir leitura do código fonte no navegador
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove todos os console.log em produção
        drop_debugger: true
      }
    }
  }
});