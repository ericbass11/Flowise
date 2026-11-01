import path from 'node:path'
import fs from 'node:fs'
import { createApp } from './app'

if (fs.existsSync('.env')) process.loadEnvFile('.env')

const PORT = Number(process.env.PORT ?? 3001)
const isDev = process.env.NODE_ENV !== 'production'
const jwtSecret = process.env.JWT_SECRET ?? (isDev ? 'dev-secret-nao-use-em-producao' : '')
if (!jwtSecret) {
    console.error('Defina JWT_SECRET em produção.')
    process.exit(1)
}

const { server } = createApp({
    dbFile: process.env.DATABASE_FILE ?? path.resolve('truco.db'),
    staticDir: path.resolve('dist/client'),
    auth: {
        jwtSecret,
        publicUrl: (process.env.PUBLIC_URL ?? (isDev ? 'http://localhost:5173' : `http://localhost:${PORT}`)).replace(/\/$/, ''),
        googleClientId: process.env.GOOGLE_CLIENT_ID,
        googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
        devLogin: process.env.NODE_ENV === 'development'
    }
})

server.listen(PORT, () => console.log(`🃏 Truco do Boteco rodando em http://localhost:${PORT}`))
