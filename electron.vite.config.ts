import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve(root, 'shared'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(root, 'electron/main/index.ts'),
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(root, 'shared'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(root, 'electron/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
        '@shared': resolve(root, 'shared'),
        '@branding': resolve(root, 'assets/branding'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(root, 'src/index.html'),
      },
    },
  },
});
