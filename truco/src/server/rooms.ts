import crypto from 'node:crypto'
import type { Server } from 'socket.io'
import { cardLabel } from '../engine/cards'
import {
    Action,
    GameEvent,
    GameState,
    PlayerView,
    RAISE_NAME,
    RuleError,
    SEATS,
    Seat,
    Team,
    applyAction,
    newGame,
    partnerOf,
    seatsToAct,
    startNextHand,
    teamOf,
    viewFor,
    walkover
} from '../engine/game'
import { BotLevel, BotMemory, SIGNAL_LABEL, SignalKind, botLine, chooseSignal, decide, raiseLine } from '../bots/bot'
import { Db } from './db'

export interface Timing {
    turnMs: number
    pauseMs: number
    queueBotMs: number
    botDelay: [number, number]
    handOverMs: number
}

export const DEFAULT_TIMING: Timing = {
    turnMs: 30_000,
    pauseMs: 120_000,
    queueBotMs: 60_000,
    botDelay: [600, 1600],
    handOverMs: 2800
}

export const SIGNAL_SPOT_CHANCE = 0.2

export type SeatInfo =
    | { kind: 'empty' }
    | { kind: 'bot'; name: string; level: BotLevel }
    | { kind: 'human'; userId: number; name: string; avatar: string | null; connected: boolean }

export interface ChatMsg {
    id: number
    seat: number | null
    name: string
    text: string
    bot?: boolean
    system?: boolean
}

export type RoomStatus = 'lobby' | 'playing' | 'paused' | 'finished'

export interface RoomPayload {
    code: string
    kind: 'private' | 'queue'
    ranked: boolean
    status: RoomStatus
    hostId: number | null
    seats: SeatInfo[]
    mySeat: number | null
    view: PlayerView | null
    chat: ChatMsg[]
    log: string[]
    turnDeadline: number | null
    pauseDeadline: number | null
    pausedBy: string | null
    result: { winner: Team; scores: [number, number]; walkover: boolean } | null
}

const BOT_NAMES = ['Zé do Bar', 'Tião Gaveta', 'Dona Cida', 'Chicão', 'Nenê Baiano', 'Seu Lunga', 'Jurema', 'Toninho Trambique']
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface UserLite {
    id: number
    name: string
    avatar: string | null
}

export class Room {
    seats: SeatInfo[] = [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }]
    status: RoomStatus = 'lobby'
    state: GameState | null = null
    chat: ChatMsg[] = []
    log: string[] = []
    ranked = false
    hostId: number | null
    turnDeadline: number | null = null
    pauseDeadline: number | null = null
    pausedBy: string | null = null
    result: RoomPayload['result'] = null
    private memories: BotMemory[] = SEATS.map(() => ({ partnerSignals: [] }))
    private timer: NodeJS.Timeout | null = null
    private pauseTimer: NodeJS.Timeout | null = null
    private chatSeq = 0
    private rand: () => number

    constructor(
        readonly code: string,
        readonly kind: 'private' | 'queue',
        hostId: number | null,
        private mgr: RoomManager
    ) {
        this.hostId = hostId
        this.rand = mgr.rand
    }

    // ---------- assentos ----------

    seatOf(userId: number): number {
        return this.seats.findIndex((s) => s.kind === 'human' && s.userId === userId)
    }

    humans(): Extract<SeatInfo, { kind: 'human' }>[] {
        return this.seats.filter((s): s is Extract<SeatInfo, { kind: 'human' }> => s.kind === 'human')
    }

    seatName(seat: number): string {
        const s = this.seats[seat]
        return s.kind === 'empty' ? `Lugar ${seat + 1}` : s.name
    }

    sit(user: UserLite, seat?: number): void {
        if (this.status !== 'lobby') throw new RuleError('A partida já começou')
        const current = this.seatOf(user.id)
        const target = seat ?? this.seats.findIndex((s) => s.kind === 'empty')
        if (target < 0) throw new RuleError('Sala cheia')
        if (target === current) return
        if (this.seats[target].kind !== 'empty') throw new RuleError('Lugar ocupado')
        if (current >= 0) this.seats[current] = { kind: 'empty' }
        this.seats[target] = { kind: 'human', userId: user.id, name: user.name, avatar: user.avatar, connected: true }
    }

    addBot(seat: number, level: BotLevel): void {
        if (this.status !== 'lobby') throw new RuleError('A partida já começou')
        if (this.seats[seat]?.kind !== 'empty') throw new RuleError('Lugar ocupado')
        const used = new Set(this.seats.map((s) => (s.kind === 'bot' ? s.name : '')))
        const free = BOT_NAMES.filter((n) => !used.has(n))
        const name = free[Math.floor(this.rand() * free.length)] ?? 'Robô'
        this.seats[seat] = { kind: 'bot', name, level }
    }

    clearSeat(seat: number): void {
        if (this.status !== 'lobby') throw new RuleError('A partida já começou')
        if (this.seats[seat]?.kind !== 'bot') throw new RuleError('Só dá para tirar robôs')
        this.seats[seat] = { kind: 'empty' }
    }

    // ---------- ciclo da partida ----------

    start(ranked: boolean): void {
        if (this.status !== 'lobby') throw new RuleError('Partida já iniciada')
        if (this.seats.some((s) => s.kind === 'empty')) throw new RuleError('Preencha os 4 lugares (chame robôs!)')
        this.ranked = ranked
        this.status = 'playing'
        const seed = crypto.randomInt(0, 2 ** 31)
        this.state = newGame(seed, crypto.randomInt(0, 4) as Seat)
        this.pushLog(this.describe(this.state.events))
        this.say(null, ranked ? 'Partida valendo Elo! Boa sorte.' : 'Partida amistosa (não vale Elo).', { system: true })
        this.onNewHand()
        this.step()
    }

    act(userId: number, action: Action): void {
        if (this.status !== 'playing' || !this.state) throw new RuleError('Partida não está em andamento')
        const seat = this.seatOf(userId)
        if (seat < 0) throw new RuleError('Você não está na mesa')
        this.apply(seat as Seat, action)
    }

    private apply(seat: Seat, action: Action): void {
        const prev = this.state!
        const next = applyAction(prev, seat, action)
        this.state = next
        const fresh = next.events.slice(next.events.length - (next.eventSeq - prev.eventSeq))
        this.pushLog(this.describe(fresh))
        this.botBanter(fresh)
        this.step()
    }

    /** Agenda o próximo passo: robô, timer de humano, próxima mão ou fim. */
    private step(): void {
        this.clearTimer()
        this.turnDeadline = null
        const s = this.state
        if (!s || this.status !== 'playing') return this.broadcast()
        if (s.phase === 'gameOver') return this.finish(false)
        if (s.phase === 'handOver') {
            this.timer = setTimeout(() => {
                this.state = startNextHand(this.state!)
                this.pushLog(this.describe(this.state.events))
                this.onNewHand()
                this.step()
            }, this.mgr.timing.handOverMs)
            return this.broadcast()
        }
        const actors = seatsToAct(s)
        const humanActors = actors.filter((a) => this.seats[a].kind === 'human')
        if (humanActors.length === 0) {
            // robô: no pedido de truco responde quem está à direita de quem pediu
            const seat = s.pending ? (actors.find((a) => a === (s.pending!.bySeat + 1) % 4) ?? actors[0]) : actors[0]
            const [lo, hi] = this.mgr.timing.botDelay
            this.timer = setTimeout(() => this.botAct(seat), lo + this.rand() * (hi - lo))
        } else {
            this.turnDeadline = Date.now() + this.mgr.timing.turnMs
            this.timer = setTimeout(() => this.autoAct(humanActors[0]), this.mgr.timing.turnMs)
        }
        this.broadcast()
    }

    private botAct(seat: Seat): void {
        if (!this.state || this.status !== 'playing') return
        const seatInfo = this.seats[seat]
        const level: BotLevel = seatInfo.kind === 'bot' ? seatInfo.level : 'medio'
        const action = decide(viewFor(this.state, seat), level, this.memories[seat], this.rand)
        if (!action) return this.step()
        this.apply(seat, action)
    }

    /** Humano estourou os 30 s: o robô médio joga por ele. */
    private autoAct(seat: Seat): void {
        if (!this.state || this.status !== 'playing') return
        this.say(null, `${this.seatName(seat)} demorou demais — jogada automática.`, { system: true })
        const action = decide(viewFor(this.state, seat), 'medio', this.memories[seat], this.rand)
        if (action) this.apply(seat, action)
    }

    private onNewHand(): void {
        this.memories = SEATS.map(() => ({ partnerSignals: [] }))
        const s = this.state!
        SEATS.forEach((seat) => {
            const info = this.seats[seat]
            if (info.kind !== 'bot') return
            const sig = chooseSignal(viewFor(s, seat), info.level, this.rand)
            if (sig) this.signal(seat, sig)
        })
    }

    private finish(isWalkover: boolean): void {
        this.clearTimer()
        const s = this.state!
        this.status = 'finished'
        this.turnDeadline = null
        this.result = { winner: s.winner!, scores: s.scores, walkover: isWalkover }
        this.say(null, `Fim de jogo! Vitória de ${this.teamNames(s.winner!)} (${s.scores[0]} x ${s.scores[1]}).`, { system: true })
        if (this.humans().length > 0) {
            try {
                this.mgr.db.recordMatch({
                    kind: this.kind,
                    ranked: this.ranked,
                    scores: s.scores,
                    winner: s.winner!,
                    walkover: isWalkover,
                    seats: this.seats.map((info, seat) => ({
                        seat,
                        userId: info.kind === 'human' ? info.userId : null,
                        name: info.kind === 'empty' ? '?' : info.name,
                        isBot: info.kind === 'bot',
                        botLevel: info.kind === 'bot' ? info.level : null
                    }))
                })
            } catch (e) {
                console.error('Falha ao gravar partida', e)
            }
        }
        this.broadcast()
    }

    // ---------- conexão / pausa / abandono ----------

    setConnected(userId: number, connected: boolean): void {
        const seat = this.seatOf(userId)
        if (seat < 0) return
        const info = this.seats[seat] as Extract<SeatInfo, { kind: 'human' }>
        info.connected = connected
        if (this.status === 'lobby') {
            if (!connected) this.leave(userId)
            else this.broadcast()
            return
        }
        if (!connected && this.status === 'playing') {
            this.status = 'paused'
            this.clearTimer()
            this.turnDeadline = null
            this.pausedBy = info.name
            this.pauseDeadline = Date.now() + this.mgr.timing.pauseMs
            this.say(null, `${info.name} caiu. Aguardando reconexão por até 2 minutos...`, { system: true })
            this.pauseTimer = setTimeout(() => this.forfeit(seat), this.mgr.timing.pauseMs)
        } else if (connected && this.status === 'paused' && this.humans().every((h) => h.connected)) {
            this.resume()
            return
        }
        this.broadcast()
    }

    private resume(): void {
        if (this.pauseTimer) clearTimeout(this.pauseTimer)
        this.pauseTimer = null
        this.pauseDeadline = null
        this.pausedBy = null
        this.status = 'playing'
        this.say(null, 'Todos de volta. Segue o jogo!', { system: true })
        this.step()
    }

    private forfeit(seat: number): void {
        if (!this.state || (this.status !== 'paused' && this.status !== 'playing')) return
        if (this.pauseTimer) clearTimeout(this.pauseTimer)
        this.pauseTimer = null
        this.pauseDeadline = null
        this.say(null, `W.O.! ${this.seatName(seat)} abandonou a mesa.`, { system: true })
        this.state = walkover(this.state, teamOf(seat))
        this.finish(true)
    }

    leave(userId: number): void {
        const seat = this.seatOf(userId)
        if (seat < 0) return
        if (this.status === 'playing' || this.status === 'paused') return this.forfeit(seat)
        if (this.status === 'lobby') {
            this.seats[seat] = { kind: 'empty' }
            if (this.hostId === userId) this.hostId = this.humans()[0]?.userId ?? null
        }
        this.mgr.detach(userId, this)
        this.broadcast()
    }

    // ---------- chat e sinais ----------

    chatFrom(userId: number, text: string): void {
        const seat = this.seatOf(userId)
        if (seat < 0) throw new RuleError('Você não está na mesa')
        const clean = text.replace(/\s+/g, ' ').trim().slice(0, 200)
        if (clean) this.say(seat, clean)
        this.broadcast()
    }

    signalFrom(userId: number, kind: SignalKind): void {
        if (this.status !== 'playing' && this.status !== 'paused') throw new RuleError('Sem partida')
        const seat = this.seatOf(userId)
        if (seat < 0) throw new RuleError('Você não está na mesa')
        if (!(kind in SIGNAL_LABEL)) throw new RuleError('Sinal inválido')
        this.signal(seat as Seat, kind)
    }

    /** Envia sinal ao parceiro; cada adversário humano tem 20% de chance de flagrar. */
    private signal(seat: Seat, kind: SignalKind): void {
        const partner = partnerOf(seat)
        const pInfo = this.seats[partner]
        const from = this.seatName(seat)
        if (pInfo.kind === 'bot') this.memories[partner].partnerSignals.push(kind)
        if (pInfo.kind === 'human') this.mgr.toUser(pInfo.userId, 'signal', { from, seat, kind, label: SIGNAL_LABEL[kind], spotted: false })
        for (const opp of [(seat + 1) % 4, (seat + 3) % 4]) {
            const o = this.seats[opp]
            if (o.kind === 'human' && this.rand() < SIGNAL_SPOT_CHANCE) {
                this.mgr.toUser(o.userId, 'signal', { from, seat, kind, label: SIGNAL_LABEL[kind], spotted: true })
            }
        }
    }

    private say(seat: number | null, text: string, opts: { bot?: boolean; system?: boolean } = {}): void {
        this.chat.push({ id: ++this.chatSeq, seat, name: seat === null ? 'Garçom' : this.seatName(seat), text, ...opts })
        if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60)
    }

    private botBanter(events: GameEvent[]): void {
        for (const ev of events) {
            if (ev.type === 'raise' && this.seats[ev.seat].kind === 'bot') this.say(ev.seat, raiseLine(ev.to, this.rand), { bot: true })
            if (ev.type === 'accept' && this.seats[ev.seat].kind === 'bot') this.say(ev.seat, botLine('accept', this.rand), { bot: true })
            if (ev.type === 'run' && this.seats[ev.seat].kind === 'bot') this.say(ev.seat, botLine('run', this.rand), { bot: true })
            if (ev.type === 'handOver' && ev.winner !== null && this.rand() < 0.45) {
                const talker = SEATS.find((x) => teamOf(x) === ev.winner && this.seats[x].kind === 'bot')
                if (talker !== undefined) this.say(talker, botLine('winHand', this.rand), { bot: true })
            }
        }
    }

    // ---------- narração ----------

    private teamNames(team: Team): string {
        return SEATS.filter((s) => teamOf(s) === team)
            .map((s) => this.seatName(s))
            .join(' & ')
    }

    describe(events: GameEvent[]): string[] {
        return events.map((ev) => {
            switch (ev.type) {
                case 'newHand':
                    return ev.iron
                        ? `Mão de ferro! Vira ${cardLabel(ev.vira)} — todo mundo no escuro.`
                        : ev.mao11Team !== null
                          ? `Mão de 11 para ${this.teamNames(ev.mao11Team)}. Vira ${cardLabel(ev.vira)}.`
                          : `Nova mão. Vira ${cardLabel(ev.vira)}; ${this.seatName(ev.pe)} é o pé.`
                case 'play':
                    return `${this.seatName(ev.seat)} jogou ${ev.covered ? 'uma carta coberta' : cardLabel(ev.card!)}`
                case 'trick':
                    return ev.result === 'tie' ? 'Cangou! Vaza empatada.' : `${this.seatName(ev.winnerSeat!)} levou a vaza.`
                case 'raise':
                    return `${this.seatName(ev.seat)} pediu ${RAISE_NAME[ev.to].toUpperCase()}!`
                case 'accept':
                    return `${this.seatName(ev.seat)} aceitou. Mão valendo ${ev.value}.`
                case 'run':
                    return `${this.seatName(ev.seat)} correu.`
                case 'mao11':
                    return `${this.seatName(ev.seat)} ${ev.play ? 'topou jogar a mão de 11' : 'correu da mão de 11'}.`
                case 'handOver':
                    return ev.winner === null
                        ? 'Mão empatada, ninguém pontua.'
                        : `${this.teamNames(ev.winner)} ganharam ${ev.points} ponto${ev.points > 1 ? 's' : ''}.`
                case 'gameOver':
                    return `Fim de jogo: ${this.teamNames(ev.winner)} venceram!`
            }
        })
    }

    private pushLog(lines: string[]): void {
        this.log.push(...lines)
        if (this.log.length > 40) this.log.splice(0, this.log.length - 40)
    }

    // ---------- envio ----------

    payloadFor(userId: number): RoomPayload {
        const seat = this.seatOf(userId)
        return {
            code: this.code,
            kind: this.kind,
            ranked: this.ranked,
            status: this.status,
            hostId: this.hostId,
            seats: this.seats,
            mySeat: seat >= 0 ? seat : null,
            view: this.state && seat >= 0 ? viewFor(this.state, seat as Seat) : null,
            chat: this.chat,
            log: this.log,
            turnDeadline: this.turnDeadline,
            pauseDeadline: this.pauseDeadline,
            pausedBy: this.pausedBy,
            result: this.result
        }
    }

    broadcast(): void {
        for (const h of this.humans()) this.mgr.toUser(h.userId, 'room', this.payloadFor(h.userId))
    }

    private clearTimer(): void {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
    }

    dispose(): void {
        this.clearTimer()
        if (this.pauseTimer) clearTimeout(this.pauseTimer)
    }
}

interface QueueEntry {
    user: UserLite
    since: number
}

export class RoomManager {
    rooms = new Map<string, Room>()
    /** Sala ativa de cada usuário. */
    userRoom = new Map<number, Room>()
    queue: QueueEntry[] = []
    private queueTimer: NodeJS.Timeout

    constructor(
        readonly io: Server,
        readonly db: Db,
        readonly timing: Timing = DEFAULT_TIMING,
        readonly rand: () => number = Math.random
    ) {
        this.queueTimer = setInterval(() => this.checkQueue(), 1000)
    }

    toUser(userId: number, event: string, payload: unknown): void {
        this.io.to(`u:${userId}`).emit(event, payload)
    }

    private newCode(): string {
        let code = ''
        do {
            code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)]).join('')
        } while (this.rooms.has(code))
        return code
    }

    private ensureFree(userId: number): void {
        const r = this.userRoom.get(userId)
        if (r && r.status !== 'finished') throw new RuleError('Você já está em uma sala. Saia dela primeiro.')
        if (r) this.detach(userId, r)
        this.leaveQueue(userId)
    }

    detach(userId: number, room: Room): void {
        if (this.userRoom.get(userId) === room) this.userRoom.delete(userId)
        if (room.humans().every((h) => this.userRoom.get(h.userId) !== room)) {
            room.dispose()
            this.rooms.delete(room.code)
        }
    }

    createRoom(user: UserLite): Room {
        this.ensureFree(user.id)
        const room = new Room(this.newCode(), 'private', user.id, this)
        this.rooms.set(room.code, room)
        room.sit(user, 0)
        this.userRoom.set(user.id, room)
        room.broadcast()
        return room
    }

    joinRoom(user: UserLite, code: string): Room {
        const room = this.rooms.get(code.toUpperCase().trim())
        if (!room) throw new RuleError('Sala não encontrada')
        if (room.seatOf(user.id) >= 0) {
            room.setConnected(user.id, true)
            return room
        }
        this.ensureFree(user.id)
        room.sit(user)
        this.userRoom.set(user.id, room)
        room.broadcast()
        return room
    }

    leaveRoom(userId: number): void {
        const room = this.userRoom.get(userId)
        if (!room) return
        if (room.status === 'finished') {
            this.detach(userId, room)
            return
        }
        room.leave(userId)
        this.detach(userId, room)
    }

    joinQueue(user: UserLite): void {
        this.ensureFree(user.id)
        this.queue.push({ user, since: Date.now() })
        this.broadcastQueue()
        this.checkQueue()
    }

    leaveQueue(userId: number): void {
        const before = this.queue.length
        this.queue = this.queue.filter((q) => q.user.id !== userId)
        if (this.queue.length !== before) this.broadcastQueue()
    }

    private broadcastQueue(): void {
        this.queue.forEach((q) => this.toUser(q.user.id, 'queue', { waiting: true, since: q.since, size: this.queue.length }))
    }

    private checkQueue(): void {
        while (this.queue.length >= 4) this.matchFromQueue(this.queue.splice(0, 4), true)
        if (this.queue.length && Date.now() - this.queue[0].since >= this.timing.queueBotMs) {
            this.matchFromQueue(this.queue.splice(0, this.queue.length), false)
        }
    }

    private matchFromQueue(entries: QueueEntry[], ranked: boolean): void {
        const room = new Room(this.newCode(), 'queue', null, this)
        this.rooms.set(room.code, room)
        entries.forEach((e, i) => {
            room.sit(e.user, i)
            this.userRoom.set(e.user.id, room)
            this.toUser(e.user.id, 'queue', { waiting: false, matched: room.code, ranked })
        })
        for (const seat of SEATS) if (room.seats[seat].kind === 'empty') room.addBot(seat, 'medio')
        room.start(ranked)
        this.broadcastQueue()
    }

    onConnect(user: UserLite): void {
        const room = this.userRoom.get(user.id)
        if (room) room.setConnected(user.id, true)
        const q = this.queue.find((x) => x.user.id === user.id)
        if (q) this.toUser(user.id, 'queue', { waiting: true, since: q.since, size: this.queue.length })
    }

    onDisconnect(userId: number): void {
        this.leaveQueue(userId)
        const room = this.userRoom.get(userId)
        if (!room) return
        room.setConnected(userId, false)
        if (room.status === 'lobby' && room.seatOf(userId) < 0) this.detach(userId, room)
    }

    close(): void {
        clearInterval(this.queueTimer)
        for (const r of this.rooms.values()) r.dispose()
    }
}
