import { defineConfig } from 'vitest/config'
import path from 'node:path'

// No @vitejs/plugin-react: vitest 4's own transform handles the JSX, and the
// plugin's last release pins vite@5, which is the sole remaining source of the
// vite and esbuild advisories. Dropping it clears both.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
})
