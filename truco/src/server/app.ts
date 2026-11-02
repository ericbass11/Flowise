import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import cookieParser from 'cookie-parser'
import { Server, Socket } from 'socket.io'
import { z } from 'zod'
import { RuleError } from '../engine/game'
import { BOT_LEVELS } from '../bots/bot'
import { AuthConfig, SESSION_COOKIE, authRouter, parseCookies, verifySession } from './auth'
import { Db } from './db'
import { DEFAULT_TIMING, RoomManager, Timing, UserLite } from './rooms'
import { computeStats } from './stats'
import crypto from 'node:crypto'

export interface AppOptions {
    auth: AuthConfig
    dbFile: string
    staticDir?: string
    timing?: Timing
    /** E-mails com acesso ao painel /admin. Vazio + login de dev = qualquer um (só em desenvolvimento). */
    adminEmails?: string[]
}

const actionSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('play'), index: z.number().int().min(0).max(2), covered: z.boolean().optional() }),
    z.object({ type: z.literal('raise') }),
    z.object({ type: z.literal('accept') }),
    z.object({ type: z.literal('run') }),
    z.object({ type: z.literal('mao11'), play: z.boolean() })
])

export function createApp(opts: AppOptions) {
    const db = new Db(opts.dbFile)
    const app = express()
    app.use(express.json())
    app.use(cookieParser())
    app.use(authRouter(opts.auth, db))

    const currentUser = (req: express.Request) => {
        const uid = verifySession(opts.auth, req.cookies?.[SESSION_COOKIE])
        return uid ? db.getUser(uid) : undefined
    }

    const adminEmails = (opts.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)
    const isAdmin = (email: string) => adminEmails.includes(email.toLowerCase()) || (adminEmails.length === 0 && opts.auth.devLogin)

    app.get('/api/me', (req, res) => {
        const u = currentUser(req)
        if (!u) return res.status(401).json({ error: 'não autenticado' })
        res.json({ ...u, isAdmin: isAdmin(u.email) })
    })

    // Registro de visita (página carregada). Visitante anônimo identificado por cookie.
    app.post('/api/track', (req, res) => {
        let vid = req.cookies?.truco_vid as string | undefined
        if (!vid || !/^[a-f0-9]{32}$/.test(vid)) {
            vid = crypto.randomBytes(16).toString('hex')
            res.cookie('truco_vid', vid, { httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 3600 * 1000, path: '/' })
        }
        db.recordEvent('visit', currentUser(req)?.id ?? null, vid)
        res.status(204).end()
    })

    app.get('/api/admin/stats', (req, res) => {
        const u = currentUser(req)
        if (!u) return res.status(401).json({ error: 'não autenticado' })
        if (!isAdmin(u.email)) return res.status(403).json({ error: 'sem permissão' })
        const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30
        const online = new Set<number>()
        for (const sock of io.of('/').sockets.values()) if (sock.data.user) online.add(sock.data.user.id)
        const active = [...mgr.rooms.values()].filter((r) => r.status === 'playing' || r.status === 'paused')
        res.json(
            computeStats(db, days, {
                online: online.size,
                tablesPlaying: active.length,
                playersInGame: active.reduce((a, r) => a + r.humans().length, 0),
                queue: mgr.queue.length
            })
        )
    })
    app.get('/api/ranking', (_req, res) => res.json(db.leaderboard()))
    app.get('/api/history', (req, res) => {
        const u = currentUser(req)
        if (!u) return res.status(401).json({ error: 'não autenticado' })
        res.json(db.history(u.id))
    })

    if (opts.staticDir && fs.existsSync(opts.staticDir)) {
        app.use(express.static(opts.staticDir))
        app.get(/^\/(?!api|auth|socket\.io).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')))
    }

    const server = http.createServer(app)
    const io = new Server(server, { cors: { origin: false } })
    const mgr = new RoomManager(io, db, opts.timing ?? DEFAULT_TIMING)

    io.use((socket, next) => {
        const uid = verifySession(opts.auth, parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE])
        const u = uid ? db.getUser(uid) : undefined
        if (!u) return next(new Error('não autenticado'))
        socket.data.user = { id: u.id, name: u.name, avatar: u.avatar } satisfies UserLite
        next()
    })

    io.on('connection', (socket: Socket) => {
        const user = socket.data.user as UserLite
        socket.join(`u:${user.id}`)
        db.recordEvent('session', user.id)
        mgr.onConnect(user)

        const handle =
            <T>(fn: (arg: T) => unknown) =>
            (arg: T, ack?: (r: { ok: boolean; error?: string; data?: unknown }) => void) => {
                try {
                    const data = fn(arg)
                    ack?.({ ok: true, data })
                } catch (e) {
                    const msg = e instanceof RuleError || e instanceof z.ZodError ? (e instanceof z.ZodError ? 'Dados inválidos' : e.message) : 'Erro interno'
                    if (!(e instanceof RuleError) && !(e instanceof z.ZodError)) console.error(e)
                    ack?.({ ok: false, error: msg })
                }
            }

        const room = () => {
            const r = mgr.userRoom.get(user.id)
            if (!r) throw new RuleError('Você não está em uma sala')
            return r
        }
        const hostRoom = () => {
            const r = room()
            if (r.hostId !== user.id) throw new RuleError('Só o dono da sala pode fazer isso')
            return r
        }

        socket.on('room:create', handle(() => mgr.createRoom(user).code))
        socket.on('room:join', handle((code: unknown) => mgr.joinRoom(user, z.string().min(1).max(10).parse(code)).code))
        socket.on('room:leave', handle(() => mgr.leaveRoom(user.id)))
        socket.on(
            'room:seat',
            handle((seat: unknown) => {
                const r = room()
                r.sit(user, z.number().int().min(0).max(3).parse(seat))
                r.broadcast()
            })
        )
        socket.on(
            'room:addBot',
            handle((arg: unknown) => {
                const { seat, level } = z.object({ seat: z.number().int().min(0).max(3), level: z.enum(BOT_LEVELS as [string, ...string[]]) }).parse(arg)
                const r = hostRoom()
                r.addBot(seat, level as any)
                r.broadcast()
            })
        )
        socket.on(
            'room:fillBots',
            handle((level: unknown) => {
                const lv = z.enum(BOT_LEVELS as [string, ...string[]]).parse(level)
                const r = hostRoom()
                r.seats.forEach((s, i) => s.kind === 'empty' && r.addBot(i, lv as any))
                r.broadcast()
            })
        )
        socket.on(
            'room:removeBot',
            handle((seat: unknown) => {
                const r = hostRoom()
                r.clearSeat(z.number().int().min(0).max(3).parse(seat))
                r.broadcast()
            })
        )
        socket.on('room:start', handle(() => hostRoom().start(false)))
        socket.on('game:action', handle((a: unknown) => room().act(user.id, actionSchema.parse(a))))
        socket.on('chat:send', handle((t: unknown) => room().chatFrom(user.id, z.string().max(500).parse(t))))
        socket.on('signal:send', handle((k: unknown) => room().signalFrom(user.id, z.string().parse(k) as any)))
        socket.on('queue:join', handle(() => mgr.joinQueue(user)))
        socket.on('queue:leave', handle(() => mgr.leaveQueue(user.id)))

        socket.on('disconnect', () => {
            if ((io.sockets.adapter.rooms.get(`u:${user.id}`)?.size ?? 0) === 0) mgr.onDisconnect(user.id)
        })
    })

    return { app, server, io, mgr, db }
}
