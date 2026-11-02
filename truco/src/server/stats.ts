import { Db } from './db'

/** Deslocamento para agrupar por dia no horário de Brasília (SQLite trabalha em UTC). */
const TZ = process.env.STATS_TZ_OFFSET ?? '-3 hours'

export interface LiveStats {
    online: number
    tablesPlaying: number
    playersInGame: number
    queue: number
}

export interface DayRow {
    date: string
    visits: number
    visitors: number
    activeUsers: number
    signups: number
    ranked: number
    friendly: number
    queueBots: number
}

export interface Kpi {
    value: number
    previous: number | null
}

export interface AdminStats {
    days: number
    generatedAt: string
    live: LiveStats
    totals: { users: number; matches: number; rankedPlayers: number }
    kpis: {
        visits: Kpi
        visitors: Kpi
        signups: Kpi
        activeUsers: Kpi
        matches: Kpi
        dau: number
        wau: number
        mau: number
        signupConversion: number | null
        rankedShare: number | null
        walkoverRate: number | null
        avgDurationMin: number | null
        avgPlayersPerMatch: number | null
    }
    series: DayRow[]
    hourly: { hour: number; sessions: number }[]
    topPlayers: { id: number; name: string; elo: number; wins: number; losses: number }[]
    mostActive: { id: number; name: string; matches: number; wins: number }[]
    recentMatches: {
        id: number
        createdAt: string
        kind: string
        ranked: boolean
        score: [number, number]
        walkover: boolean
        durationSec: number | null
        players: string
    }[]
}

const n = (v: unknown) => Number(v ?? 0)

export function computeStats(db: Db, days: number, live: LiveStats): AdminStats {
    const q = db.raw
    const since = `-${days} days`
    const prevSince = `-${days * 2} days`
    const one = (sql: string, ...args: (string | number)[]) => q.prepare(sql).get(...args) as Record<string, unknown>

    const periodCounts = (from: string, to: string | null) => {
        const range = to ? `ts >= datetime('now', ?) AND ts < datetime('now', ?)` : `ts >= datetime('now', ?)`
        const args = to ? [from, to] : [from]
        const ev = one(
            `SELECT
                SUM(kind = 'visit') AS visits,
                COUNT(DISTINCT CASE WHEN kind = 'visit' THEN visitorId END) AS visitors,
                SUM(kind = 'signup') AS signups,
                COUNT(DISTINCT CASE WHEN kind IN ('session', 'login') THEN userId END) AS active
             FROM events WHERE ${range}`,
            ...args
        )
        const m = one(`SELECT COUNT(*) AS matches FROM matches WHERE ${range.replaceAll('ts', 'createdAt')}`, ...args)
        return { visits: n(ev.visits), visitors: n(ev.visitors), signups: n(ev.signups), active: n(ev.active), matches: n(m.matches) }
    }
    const cur = periodCounts(since, null)
    const prev = periodCounts(prevSince, since)
    const kpi = (a: number, b: number): Kpi => ({ value: a, previous: b })

    const activeIn = (d: string) =>
        n(one(`SELECT COUNT(DISTINCT userId) AS c FROM events WHERE kind IN ('session','login') AND ts >= datetime('now', ?)`, d).c)

    const m = one(
        `SELECT COUNT(*) AS total, SUM(ranked) AS ranked, SUM(walkover) AS wo, AVG(durationSec) AS dur
         FROM matches WHERE createdAt >= datetime('now', ?)`,
        since
    )
    const humansPerMatch = one(
        `SELECT AVG(h) AS avg FROM (
            SELECT COUNT(*) AS h FROM match_players mp JOIN matches m ON m.id = mp.matchId
            WHERE mp.isBot = 0 AND m.createdAt >= datetime('now', ?) GROUP BY mp.matchId)`,
        since
    )
    const total = n(m.total)

    // série diária, preenchendo dias vazios
    const byDay = new Map<string, DayRow>()
    for (let i = days - 1; i >= 0; i--) {
        const d = one(`SELECT date('now', ?, ?) AS d`, TZ, `-${i} days`).d as string
        byDay.set(d, { date: d, visits: 0, visitors: 0, activeUsers: 0, signups: 0, ranked: 0, friendly: 0, queueBots: 0 })
    }
    for (const r of q
        .prepare(
            `SELECT date(ts, ?) AS d,
                SUM(kind = 'visit') AS visits,
                COUNT(DISTINCT CASE WHEN kind = 'visit' THEN visitorId END) AS visitors,
                COUNT(DISTINCT CASE WHEN kind IN ('session','login') THEN userId END) AS active,
                SUM(kind = 'signup') AS signups
             FROM events WHERE ts >= datetime('now', ?) GROUP BY d`
        )
        .all(TZ, `-${days + 1} days`) as Record<string, unknown>[]) {
        const row = byDay.get(r.d as string)
        if (!row) continue
        row.visits = n(r.visits)
        row.visitors = n(r.visitors)
        row.activeUsers = n(r.active)
        row.signups = n(r.signups)
    }
    for (const r of q
        .prepare(
            `SELECT date(createdAt, ?) AS d,
                SUM(ranked = 1) AS ranked,
                SUM(ranked = 0 AND kind = 'private') AS friendly,
                SUM(ranked = 0 AND kind = 'queue') AS queueBots
             FROM matches WHERE createdAt >= datetime('now', ?) GROUP BY d`
        )
        .all(TZ, `-${days + 1} days`) as Record<string, unknown>[]) {
        const row = byDay.get(r.d as string)
        if (!row) continue
        row.ranked = n(r.ranked)
        row.friendly = n(r.friendly)
        row.queueBots = n(r.queueBots)
    }

    const hourlyRows = q
        .prepare(
            `SELECT CAST(strftime('%H', ts, ?) AS INTEGER) AS h, COUNT(*) AS c
             FROM events WHERE kind IN ('session','login') AND ts >= datetime('now', ?) GROUP BY h`
        )
        .all(TZ, since) as { h: number; c: number }[]
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, sessions: n(hourlyRows.find((r) => r.h === hour)?.c) }))

    const recent = q
        .prepare(
            `SELECT m.*, (SELECT GROUP_CONCAT(name, ', ') FROM (SELECT name FROM match_players WHERE matchId = m.id ORDER BY seat)) AS players
             FROM matches m ORDER BY m.id DESC LIMIT 15`
        )
        .all() as Record<string, unknown>[]

    return {
        days,
        generatedAt: new Date().toISOString(),
        live,
        totals: {
            users: n(one('SELECT COUNT(*) AS c FROM users').c),
            matches: n(one('SELECT COUNT(*) AS c FROM matches').c),
            rankedPlayers: n(one('SELECT COUNT(*) AS c FROM users WHERE wins + losses > 0').c)
        },
        kpis: {
            visits: kpi(cur.visits, prev.visits),
            visitors: kpi(cur.visitors, prev.visitors),
            signups: kpi(cur.signups, prev.signups),
            activeUsers: kpi(cur.active, prev.active),
            matches: kpi(cur.matches, prev.matches),
            dau: activeIn('-1 days'),
            wau: activeIn('-7 days'),
            mau: activeIn('-30 days'),
            signupConversion: cur.visitors ? cur.signups / cur.visitors : null,
            rankedShare: total ? n(m.ranked) / total : null,
            walkoverRate: total ? n(m.wo) / total : null,
            avgDurationMin: m.dur == null ? null : n(m.dur) / 60,
            avgPlayersPerMatch: humansPerMatch.avg == null ? null : n(humansPerMatch.avg)
        },
        series: [...byDay.values()],
        hourly,
        topPlayers: q
            .prepare('SELECT id, name, elo, wins, losses FROM users WHERE wins + losses > 0 ORDER BY elo DESC LIMIT 10')
            .all() as AdminStats['topPlayers'],
        mostActive: q
            .prepare(
                `SELECT u.id, u.name, COUNT(*) AS matches, SUM(mp.team = m.winnerTeam) AS wins
                 FROM match_players mp JOIN matches m ON m.id = mp.matchId JOIN users u ON u.id = mp.userId
                 WHERE m.createdAt >= datetime('now', ?) GROUP BY u.id ORDER BY matches DESC LIMIT 10`
            )
            .all(since) as AdminStats['mostActive'],
        recentMatches: recent.map((r) => ({
            id: n(r.id),
            createdAt: String(r.createdAt),
            kind: String(r.kind),
            ranked: !!r.ranked,
            score: [n(r.scoreA), n(r.scoreB)],
            walkover: !!r.walkover,
            durationSec: r.durationSec == null ? null : n(r.durationSec),
            players: String(r.players ?? '')
        }))
    }
}
