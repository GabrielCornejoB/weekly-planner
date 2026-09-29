import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Node only. Tests are pure functions, never rendered components.
    environment: 'node',
    // describe/it/expect are imported from 'vitest' in every test file.
    globals: false,
    include: ['src/**/*.test.ts'],
  },
})
