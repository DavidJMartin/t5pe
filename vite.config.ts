import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  // The browser keeps the library's working copy per origin (host + port), so the app must always run on the
  // same port. strictPort makes a collision an error instead of silently opening an empty library elsewhere.
  server: { port: 5055, strictPort: true },
  preview: { port: 5055, strictPort: true },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
