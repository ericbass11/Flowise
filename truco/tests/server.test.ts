import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AddressInfo } from 'node:net'
import { io as connect, Socket } from 'socket.io-client'
import { createApp } from '../src/server/app'
import { decide } from '../src/bots/bot'
import type { RoomPayload } from '../src/server/rooms'

const fast = { turnMs: 2000, pauseMs: 300, queueBotMs: 300, botDelay: [1, 3] as [number, number], handOverMs: 5 }
let ctx: ReturnType<typeof createApp>
let base = ''

beforeAll(async () => {
    ctx = createApp({
        dbFile: ':memory:',
        timing: fast,
        openAdmin: true,
        auth: { jwtSecret: 'test', publicUrl: 'http://localhost', devLogin: true }
    })
    await new Promise<void>((r) => ctx.server.listen(0, () => r()))
    base = `http://127.0.0.1:${(ctx.server.address() as AddressInfo).port}`
})
afterAll(() => {
    ctx.mgr.close()
    ctx.io.close()
})

async function login(name: string): Promise<{ cookie: string; socket: Socket }> {
    const res = await fetch(`${base}/auth/dev`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
    })
    const cookie = res.headers.get('set-cookie')!.split(';')[0]
    const socket = connect(base, { extraHeaders: { cookie }, transports: ['websocket'] })
    await new Promise<void>((r) => socket.on('connect', () => r()))
    return { cookie, socket }
}

const emit = (s: Socket, ev: string, arg?: unknown) =>
    new Promise<any>((resolve) => s.emit(ev, arg, (r: any) => resolve(r)))

/** Joga automaticamente como humano usando a heurística média. */
function autoplay(s: Socket): Promise<RoomPayload> {
    return new Promise((resolve) => {
        let busy = false
        s.on('room', (p: RoomPayload) => {
            if (p.status === 'finished') return resolve(p)
            if (p.status !== 'playing' || !p.view || !p.view.legal.length || busy) return
            const a = decide(p.view, 'medio', { partnerSignals: [] })
            if (!a) return
            busy = true
            s.emit('game:action', a, () => (busy = false))
        })
    })
}

describe('servidor', () => {
    it('rejeita socket sem login', async () => {
        const s = connect(base, { transports: ['websocket'] })
        const err = await new Promise<Error>((r) => s.on('connect_error', r))
        expect(err.message).toMatch(/autenticado/)
        s.close()
    })

    it('sala privada com 3 robôs joga até o fim e grava histórico', async () => {
        const { socket, cookie } = await login('Ana')
        const code = (await emit(socket, 'room:create')).data
        expect(code).toMatch(/^[A-Z0-9]{5}$/)
        expect((await emit(socket, 'room:fillBots', 'dificil')).ok).toBe(true)
        const done = autoplay(socket)
        expect((await emit(socket, 'room:start')).ok).toBe(true)
        const final = await done
        expect(final.result!.walkover).toBe(false)
        expect(Math.max(...final.result!.scores)).toBeGreaterThanOrEqual(12)
        expect(final.chat.length).toBeGreaterThan(0)
        const hist = await (await fetch(`${base}/api/history`, { headers: { cookie } })).json()
        expect(hist).toHaveLength(1)
        expect(hist[0].ranked).toBe(false)
        expect(hist[0].players.filter((p: any) => p.isBot)).toHaveLength(3)
        socket.close()
    }, 30000)

    it('fila com 4 humanos vale Elo; W.O. por queda conta como derrota', async () => {
        const players = await Promise.all(['P1', 'P2', 'P3', 'P4'].map(login))
        const matched = players.map(
            (p) => new Promise<any>((r) => p.socket.on('queue', (q: any) => q.matched && r(q)))
        )
        for (const p of players) await emit(p.socket, 'queue:join')
        const qs = await Promise.all(matched)
        expect(qs.every((q) => q.ranked)).toBe(true)
        // P1 (assento 0, dupla 0) cai e não volta -> W.O.
        const finished = new Promise<RoomPayload>((r) => players[1].socket.on('room', (p: RoomPayload) => p.status === 'finished' && r(p)))
        const paused = new Promise<RoomPayload>((r) => players[1].socket.on('room', (p: RoomPayload) => p.status === 'paused' && r(p)))
        players[0].socket.close()
        expect((await paused).pausedBy).toBe('P1')
        const f = await finished
        expect(f.result).toMatchObject({ walkover: true, winner: 1 })
        const ranking = await (await fetch(`${base}/api/ranking`)).json()
        const elo = Object.fromEntries(ranking.map((u: any) => [u.name, u.elo]))
        expect(elo.P1).toBe(984)
        expect(elo.P3).toBe(984)
        expect(elo.P2).toBe(1016)
        expect(elo.P4).toBe(1016)
        players.slice(1).forEach((p) => p.socket.close())
    }, 15000)

    it('fila sozinho completa com robôs após o tempo e não vale Elo', async () => {
        const { socket } = await login('Solo')
        const matched = new Promise<any>((r) => socket.on('queue', (q: any) => q.matched && r(q)))
        await emit(socket, 'queue:join')
        const q = await matched
        expect(q.ranked).toBe(false)
        const room = await new Promise<RoomPayload>((r) => socket.on('room', (p: RoomPayload) => r(p)))
        expect(room.seats.filter((s) => s.kind === 'bot')).toHaveLength(3)
        await emit(socket, 'room:leave')
        socket.close()
    }, 10000)

    it('pausa e retoma quando o jogador reconecta', async () => {
        const a = await login('Bia')
        await emit(a.socket, 'room:create')
        await emit(a.socket, 'room:fillBots', 'facil')
        await emit(a.socket, 'room:start')
        ctx.mgr.timing.pauseMs = 5000
        a.socket.close()
        await new Promise((r) => setTimeout(r, 50))
        const room = ctx.mgr.rooms.get([...ctx.mgr.rooms.keys()].pop()!)!
        expect(room.status).toBe('paused')
        const again = connect(base, { extraHeaders: { cookie: a.cookie }, transports: ['websocket'] })
        const p = await new Promise<RoomPayload>((r) => again.on('room', (x: RoomPayload) => x.status === 'playing' && r(x)))
        expect(p.mySeat).toBe(0)
        ctx.mgr.timing.pauseMs = 300
        await emit(again, 'room:leave')
        again.close()
    }, 10000)
})
