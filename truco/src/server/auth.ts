import crypto from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { Db } from './db'

export const SESSION_COOKIE = 'truco_session'
const STATE_COOKIE = 'truco_oauth_state'

export interface AuthConfig {
    jwtSecret: string
    publicUrl: string
    googleClientId?: string
    googleClientSecret?: string
    devLogin: boolean
}

export function signSession(cfg: AuthConfig, userId: number): string {
    return jwt.sign({ uid: userId }, cfg.jwtSecret, { expiresIn: '30d' })
}

export function verifySession(cfg: AuthConfig, token: string | undefined): number | null {
    if (!token) return null
    try {
        const p = jwt.verify(token, cfg.jwtSecret) as { uid: number }
        return typeof p.uid === 'number' ? p.uid : null
    } catch {
        return null
    }
}

export function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    for (const part of (header ?? '').split(';')) {
        const i = part.indexOf('=')
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    }
    return out
}

export function authRouter(cfg: AuthConfig, db: Db): Router {
    const r = Router()
    const secure = cfg.publicUrl.startsWith('https://')
    const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure, maxAge: 30 * 24 * 3600 * 1000, path: '/' }
    const redirectUri = `${cfg.publicUrl}/auth/google/callback`

    r.get('/auth/config', (_req, res) => {
        res.json({ google: !!(cfg.googleClientId && cfg.googleClientSecret), devLogin: cfg.devLogin })
    })

    r.get('/auth/google', (_req, res) => {
        if (!cfg.googleClientId) return res.status(503).send('Google OAuth não configurado (GOOGLE_CLIENT_ID)')
        const state = crypto.randomBytes(16).toString('hex')
        res.cookie(STATE_COOKIE, state, { ...cookieOpts, maxAge: 10 * 60 * 1000 })
        const params = new URLSearchParams({
            client_id: cfg.googleClientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            state,
            prompt: 'select_account'
        })
        res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
    })

    r.get('/auth/google/callback', async (req, res) => {
        try {
            const { code, state } = req.query as Record<string, string>
            if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) return res.status(400).send('Estado OAuth inválido')
            res.clearCookie(STATE_COOKIE, { path: '/' })
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: cfg.googleClientId!,
                    client_secret: cfg.googleClientSecret!,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                })
            })
            if (!tokenRes.ok) return res.status(401).send('Falha ao trocar o código com o Google')
            const tokens = (await tokenRes.json()) as { access_token: string }
            const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: { authorization: `Bearer ${tokens.access_token}` }
            })
            if (!infoRes.ok) return res.status(401).send('Falha ao ler o perfil do Google')
            const info = (await infoRes.json()) as { sub: string; email: string; name?: string; picture?: string }
            const user = db.upsertUser({
                googleId: info.sub,
                email: info.email,
                name: info.name || info.email.split('@')[0],
                avatar: info.picture ?? null
            })
            res.cookie(SESSION_COOKIE, signSession(cfg, user.id), cookieOpts)
            res.redirect('/')
        } catch (e) {
            console.error(e)
            res.status(500).send('Erro no login')
        }
    })

    // Login de teste — SOMENTE em desenvolvimento.
    r.post('/auth/dev', (req, res) => {
        if (!cfg.devLogin) return res.status(404).end()
        const name = String(req.body?.name ?? '')
            .trim()
            .slice(0, 24)
        if (!name) return res.status(400).json({ error: 'Informe um nome' })
        const user = db.upsertUser({ googleId: `dev:${name.toLowerCase()}`, email: `${name}@dev.local`, name, avatar: null })
        res.cookie(SESSION_COOKIE, signSession(cfg, user.id), cookieOpts)
        res.json({ ok: true })
    })

    r.post('/auth/logout', (_req, res) => {
        res.clearCookie(SESSION_COOKIE, { path: '/' })
        res.json({ ok: true })
    })

    return r
}
