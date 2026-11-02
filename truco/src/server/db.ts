import { DatabaseSync } from 'node:sqlite'
import { ELO_START, updateElo } from './elo'

export interface User {
    id: number
    googleId: string
    email: string
    name: string
    avatar: string | null
    elo: number
    wins: number
    losses: number
}

export interface MatchSeatRecord {
    seat: number
    userId: number | null
    name: string
    isBot: boolean
    botLevel: string | null
}

export class Db {
    private db: DatabaseSync

    constructor(file: string) {
        this.db = new DatabaseSync(file)
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                googleId TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL,
                name TEXT NOT NULL,
                avatar TEXT,
                elo INTEGER NOT NULL DEFAULT ${ELO_START},
                wins INTEGER NOT NULL DEFAULT 0,
                losses INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                ranked INTEGER NOT NULL,
                scoreA INTEGER NOT NULL,
                scoreB INTEGER NOT NULL,
                winnerTeam INTEGER NOT NULL,
                walkover INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS match_players (
                matchId INTEGER NOT NULL REFERENCES matches(id),
                seat INTEGER NOT NULL,
                team INTEGER NOT NULL,
                userId INTEGER REFERENCES users(id),
                name TEXT NOT NULL,
                isBot INTEGER NOT NULL,
                botLevel TEXT,
                eloBefore INTEGER,
                eloAfter INTEGER,
                PRIMARY KEY (matchId, seat)
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL DEFAULT (datetime('now')),
                kind TEXT NOT NULL,
                userId INTEGER,
                visitorId TEXT
            );
            CREATE INDEX IF NOT EXISTS events_ts ON events(ts, kind);
            CREATE INDEX IF NOT EXISTS matches_created ON matches(createdAt);
        `)
        const cols = (this.db.prepare('PRAGMA table_info(matches)').all() as { name: string }[]).map((c) => c.name)
        if (!cols.includes('durationSec')) this.db.exec('ALTER TABLE matches ADD COLUMN durationSec INTEGER')
    }

    /** Registra um evento de uso: 'visit' | 'session' | 'login' | 'signup'. */
    recordEvent(kind: string, userId: number | null, visitorId: string | null = null): void {
        this.db.prepare('INSERT INTO events (kind, userId, visitorId) VALUES (?, ?, ?)').run(kind, userId, visitorId)
    }

    /** Acesso bruto para consultas de estatísticas. */
    get raw(): DatabaseSync {
        return this.db
    }

    upsertUser(p: { googleId: string; email: string; name: string; avatar: string | null }): User {
        const existed = this.db.prepare('SELECT 1 FROM users WHERE googleId = ?').get(p.googleId)
        this.db
            .prepare(
                `INSERT INTO users (googleId, email, name, avatar) VALUES (?, ?, ?, ?)
                 ON CONFLICT(googleId) DO UPDATE SET email = excluded.email, name = excluded.name, avatar = excluded.avatar`
            )
            .run(p.googleId, p.email, p.name, p.avatar)
        const user = this.db.prepare('SELECT * FROM users WHERE googleId = ?').get(p.googleId) as unknown as User
        if (!existed) this.recordEvent('signup', user.id)
        return user
    }

    getUser(id: number): User | undefined {
        return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as User | undefined
    }

    leaderboard(limit = 50): User[] {
        return this.db
            .prepare('SELECT * FROM users WHERE wins + losses > 0 ORDER BY elo DESC, wins DESC LIMIT ?')
            .all(limit) as unknown as User[]
    }

    history(userId: number, limit = 30) {
        const matches = this.db
            .prepare(
                `SELECT m.*, mp.team AS myTeam, mp.eloBefore, mp.eloAfter FROM matches m
                 JOIN match_players mp ON mp.matchId = m.id
                 WHERE mp.userId = ? ORDER BY m.id DESC LIMIT ?`
            )
            .all(userId, limit) as any[]
        const players = this.db.prepare('SELECT seat, team, name, isBot, botLevel FROM match_players WHERE matchId = ? ORDER BY seat')
        return matches.map((m) => ({
            id: m.id,
            kind: m.kind,
            ranked: !!m.ranked,
            score: [m.scoreA, m.scoreB],
            winnerTeam: m.winnerTeam,
            myTeam: m.myTeam,
            won: m.winnerTeam === m.myTeam,
            walkover: !!m.walkover,
            eloBefore: m.eloBefore,
            eloAfter: m.eloAfter,
            createdAt: m.createdAt,
            players: players.all(m.id)
        }))
    }

    /** Grava a partida; se `ranked`, atualiza Elo e vitórias/derrotas. */
    recordMatch(p: {
        kind: string
        ranked: boolean
        scores: [number, number]
        winner: 0 | 1
        walkover: boolean
        seats: MatchSeatRecord[]
        durationSec?: number
    }): number {
        const humans = p.seats.filter((s) => s.userId !== null)
        const before = new Map<number, number>()
        for (const h of humans) before.set(h.userId!, this.getUser(h.userId!)?.elo ?? ELO_START)
        const after = new Map<number, number>()
        if (p.ranked && humans.length === 4) {
            const teamSeats = [p.seats.filter((s) => s.seat % 2 === 0), p.seats.filter((s) => s.seat % 2 === 1)]
            const [na, nb] = updateElo(
                [teamSeats[0].map((s) => before.get(s.userId!)!), teamSeats[1].map((s) => before.get(s.userId!)!)],
                p.winner
            )
            teamSeats[0].forEach((s, i) => after.set(s.userId!, na[i]))
            teamSeats[1].forEach((s, i) => after.set(s.userId!, nb[i]))
        }
        this.db.exec('BEGIN')
        try {
            const res = this.db
                .prepare('INSERT INTO matches (kind, ranked, scoreA, scoreB, winnerTeam, walkover, durationSec) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(p.kind, p.ranked ? 1 : 0, p.scores[0], p.scores[1], p.winner, p.walkover ? 1 : 0, p.durationSec ?? null)
            const matchId = Number(res.lastInsertRowid)
            const ins = this.db.prepare(
                'INSERT INTO match_players (matchId, seat, team, userId, name, isBot, botLevel, eloBefore, eloAfter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )
            for (const s of p.seats) {
                const b = s.userId !== null ? before.get(s.userId) ?? null : null
                const a = s.userId !== null ? after.get(s.userId) ?? b : null
                ins.run(matchId, s.seat, s.seat % 2, s.userId, s.name, s.isBot ? 1 : 0, s.botLevel, b, a)
            }
            if (after.size) {
                const upd = this.db.prepare('UPDATE users SET elo = ?, wins = wins + ?, losses = losses + ? WHERE id = ?')
                for (const s of humans) {
                    const won = s.seat % 2 === p.winner
                    upd.run(after.get(s.userId!)!, won ? 1 : 0, won ? 0 : 1, s.userId!)
                }
            }
            this.db.exec('COMMIT')
            return matchId
        } catch (e) {
            this.db.exec('ROLLBACK')
            throw e
        }
    }
}
