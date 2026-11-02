import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AddressInfo } from 'node:net'
import { createApp } from '../src/server/app'

let ctx: ReturnType<typeof createApp>
let base = ''

beforeAll(async () => {
    ctx = createApp({
        dbFile: ':memory:',
        adminEmails: ['chefe@dev.local'],
        auth: { jwtSecret: 'test', publicUrl: 'http://localhost', devLogin: true }
    })
    await new Promise<void>((r) => ctx.server.listen(0, () => r()))
    base = `http://127.0.0.1:${(ctx.server.address() as AddressInfo).port}`
})
afterAll(() => {
    ctx.mgr.close()
    ctx.io.close()
})

async function login(name: string) {
    const res = await fetch(`${base}/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    return res.headers.get('set-cookie')!.split(';')[0]
}

describe('painel /admin', () => {
    it('só e-mails autorizados acessam', async () => {
        const anon = await fetch(`${base}/api/admin/stats`)
        expect(anon.status).toBe(401)
        const zeCookie = await login('ze')
        expect((await fetch(`${base}/api/admin/stats`, { headers: { cookie: zeCookie } })).status).toBe(403)
        const me = await (await fetch(`${base}/api/me`, { headers: { cookie: zeCookie } })).json()
        expect(me.isAdmin).toBe(false)
    })

    it('conta visitas, cadastros, logins e partidas', async () => {
        const chefe = await login('chefe')
        // 3 visitas do mesmo visitante + 1 de outro
        const first = await fetch(`${base}/api/track`, { method: 'POST' })
        const vid = first.headers.get('set-cookie')!.split(';')[0]
        await fetch(`${base}/api/track`, { method: 'POST', headers: { cookie: vid } })
        await fetch(`${base}/api/track`, { method: 'POST', headers: { cookie: vid } })
        await fetch(`${base}/api/track`, { method: 'POST' })
        ctx.db.recordMatch({
            kind: 'private',
            ranked: false,
            scores: [12, 7],
            winner: 0,
            walkover: false,
            durationSec: 600,
            seats: [0, 1, 2, 3].map((seat) => ({ seat, userId: seat === 0 ? 2 : null, name: `P${seat}`, isBot: seat !== 0, botLevel: seat ? 'medio' : null }))
        })
        const res = await fetch(`${base}/api/admin/stats?days=7`, { headers: { cookie: chefe } })
        expect(res.status).toBe(200)
        const s = await res.json()
        expect(s.days).toBe(7)
        expect(s.series).toHaveLength(7)
        expect(s.kpis.visits.value).toBe(4)
        expect(s.kpis.visitors.value).toBe(2)
        expect(s.kpis.signups.value).toBe(2)
        expect(s.kpis.activeUsers.value).toBe(2)
        expect(s.kpis.matches.value).toBe(1)
        expect(s.kpis.avgDurationMin).toBe(10)
        expect(s.kpis.avgPlayersPerMatch).toBe(1)
        expect(s.totals.users).toBe(2)
        expect(s.series.at(-1).friendly).toBe(1)
        expect(s.recentMatches[0].players).toBe('P0, P1, P2, P3')
        expect(s.hourly).toHaveLength(24)
    })
})
