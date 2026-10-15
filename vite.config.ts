import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the static build works from any sub-path
  // (GitHub Pages, a NAS folder, or the root of an Nginx container).
  base: './',
  server: {
    host: true,
    port: 8080,
  },
  preview: {
    host: true,
    port: 8080,
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
