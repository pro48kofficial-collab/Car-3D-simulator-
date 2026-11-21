import { defineConfig } from 'vite';

// base './' — щоб гра працювала з файлів усередині APK, без сервера
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 }
});
  
