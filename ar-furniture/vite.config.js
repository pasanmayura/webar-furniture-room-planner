import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        markerAr: resolve(__dirname, 'marker-ar.html')
      }
    }
  }
});