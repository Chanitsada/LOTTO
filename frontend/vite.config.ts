import path from 'node:path'
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(() => {
  // Server-side configuration reads the backend port only. Root secrets stay
  // outside the client bundle and the development server's served files.
  const root = path.resolve(import.meta.dirname, '..')
  const environmentFile = path.join(root, '.env')
  const filePort = fs.existsSync(environmentFile)
    ? parseEnv(fs.readFileSync(environmentFile, 'utf8')).PORT
    : undefined
  const port = process.env.PORT ?? filePort ?? '3000'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Backend PORT must be a whole number from 1 to 65535.')
  }
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      fs: { strict: true, allow: [import.meta.dirname] },
      proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true } },
    },
  }
})
