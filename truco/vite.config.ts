import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = 'http://localhost:3001'

export default defineConfig({
    plugins: [react()],
    root: 'src/client',
    build: { outDir: '../../dist/client', emptyOutDir: true },
    server: {
        port: 5173,
        proxy: {
            '/api': target,
            '/auth': target,
            '/socket.io': { target, ws: true }
        }
    },
    test: { root: '.', include: ['tests/**/*.test.ts'] }
} as any)
