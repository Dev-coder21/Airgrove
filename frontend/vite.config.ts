import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site at https://dev-coder21.github.io/Airgrove/
  base: process.env.VITE_BASE || '/Airgrove/',
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
});
