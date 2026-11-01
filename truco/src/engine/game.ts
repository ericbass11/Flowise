import { Card, COVERED_STRENGTH, Rank, cardStrength, fullDeck, manilhaFromVira, shuffle } from './cards'

// Assentos 0..3. Dupla = seat % 2 (0: assentos 0 e 2; 1: assentos 1 e 3).
// Ordem de jogo: seat -> seat + 1 (sentido anti-horário).

export type Seat = 0 | 1 | 2 | 3
export type Team = 0 | 1
export const SEATS: Seat[] = [0, 1, 2, 3]
export const WIN_SCORE = 12

export const teamOf = (seat: number): Team => (seat % 2) as Team
export const nextSeat = (seat: number): Seat => ((seat + 1) % 4) as Seat
export const partnerOf = (seat: number): Seat => ((seat + 2) % 4) as Seat

export const RAISE_STEPS: Record<number, number> = { 1: 3, 3: 6, 6: 9, 9: 12 }
export const RAISE_NAME: Record<number, string> = { 3: 'truco', 6: 'seis', 9: 'nove', 12: 'doze' }

export interface Play {
    seat: Seat
    card: Card
    covered: boolean
}

export type TrickResult = Team | 'tie'

export interface PendingRaise {
    bySeat: Seat
    byTeam: Team
    /** Valor proposto. */
    to: number
}

export type Phase = 'mao11' | 'playing' | 'handOver' | 'gameOver'

export type GameEvent =
    | { type: 'newHand'; pe: Seat; vira: Card; mao11Team: Team | null; iron: boolean }
    | { type: 'play'; seat: Seat; card: Card | null; covered: boolean }
    | { type: 'trick'; result: TrickResult; winnerSeat: Seat | null }
    | { type: 'raise'; seat: Seat; to: number }
    | { type: 'accept'; seat: Seat; value: number }
    | { type: 'run'; seat: Seat; team: Team }
    | { type: 'mao11'; seat: Seat; play: boolean }
    | { type: 'handOver'; winner: Team | null; points: number; reason: 'tricks' | 'run' | 'mao11Run' }
    | { type: 'gameOver'; winner: Team }

export interface GameState {
    seed: number
    scores: [number, number]
    phase: Phase
    /** Quem começa a mão ("pé" / mão). */
    pe: Seat
    handNumber: number
    vira: Card
    manilha: Rank
    hands: Card[][]
    /** Vazas concluídas. */
    tricks: { plays: Play[]; result: TrickResult; winnerSeat: Seat | null }[]
    current: Play[]
    turn: Seat
    /** Valor aceito da mão. */
    value: number
    pending: PendingRaise | null
    lastRaiserTeam: Team | null
    mao11Team: Team | null
    iron: boolean
    winner: Team | null
    lastHand: { winner: Team | null; points: number; reason: 'tricks' | 'run' | 'mao11Run' } | null
    /** Eventos desde o início da mão atual (para animações/narração). */
    events: GameEvent[]
    eventSeq: number
}

export type Action =
    | { type: 'play'; index: number; covered?: boolean }
    | { type: 'raise' }
    | { type: 'accept' }
    | { type: 'run' }
    | { type: 'mao11'; play: boolean }

export class RuleError extends Error {}

// ---------------- criação / distribuição ----------------

export function newGame(seed: number, pe: Seat = 0): GameState {
    const base: GameState = {
        seed,
        scores: [0, 0],
        phase: 'playing',
        pe,
        handNumber: 0,
        vira: { rank: '4', suit: 'D' },
        manilha: '5',
        hands: [[], [], [], []],
        tricks: [],
        current: [],
        turn: pe,
        value: 1,
        pending: null,
        lastRaiserTeam: null,
        mao11Team: null,
        iron: false,
        winner: null,
        lastHand: null,
        events: [],
        eventSeq: 0
    }
    return deal(base, pe)
}

function deal(prev: GameState, pe: Seat): GameState {
    const [deck, seed] = shuffle(fullDeck(), prev.seed)
    const hands: Card[][] = [[], [], [], []]
    let k = 0
    for (let round = 0; round < 3; round++) for (const s of SEATS) hands[(pe + s) % 4].push(deck[k++])
    const vira = deck[k]
    const [a, b] = prev.scores
    const iron = a === WIN_SCORE - 1 && b === WIN_SCORE - 1
    const mao11Team: Team | null = iron ? null : a === WIN_SCORE - 1 ? 0 : b === WIN_SCORE - 1 ? 1 : null
    const state: GameState = {
        ...prev,
        seed,
        phase: mao11Team !== null ? 'mao11' : 'playing',
        pe,
        handNumber: prev.handNumber + 1,
        vira,
        manilha: manilhaFromVira(vira),
        hands,
        tricks: [],
        current: [],
        turn: pe,
        value: mao11Team !== null ? 3 : 1,
        pending: null,
        lastRaiserTeam: null,
        mao11Team,
        iron,
        events: []
    }
    return emit(state, { type: 'newHand', pe, vira, mao11Team, iron })
}

/** Inicia a próxima mão após `handOver`. */
export function startNextHand(state: GameState): GameState {
    if (state.phase !== 'handOver') throw new RuleError('A mão ainda não terminou')
    return deal(state, nextSeat(state.pe))
}

function emit(state: GameState, ev: GameEvent): GameState {
    return { ...state, events: [...state.events, ev], eventSeq: state.eventSeq + 1 }
}

// ---------------- regras auxiliares ----------------

export function playStrength(p: Play, manilha: Rank): number {
    return p.covered ? COVERED_STRENGTH : cardStrength(p.card, manilha)
}

export function resolveTrick(plays: Play[], manilha: Rank): { result: TrickResult; winnerSeat: Seat | null } {
    let best = -Infinity
    let bestPlays: Play[] = []
    for (const p of plays) {
        const s = playStrength(p, manilha)
        if (s > best) {
            best = s
            bestPlays = [p]
        } else if (s === best) bestPlays.push(p)
    }
    const teams = new Set(bestPlays.map((p) => teamOf(p.seat)))
    if (teams.size > 1) return { result: 'tie', winnerSeat: null }
    return { result: teamOf(bestPlays[0].seat), winnerSeat: bestPlays[0].seat }
}

/** Decide o vencedor da mão a partir das vazas. `undefined` = mão continua; `null` = ninguém pontua. */
export function handWinner(results: TrickResult[]): Team | null | undefined {
    const [r1, r2, r3] = results
    if (results.length < 2) return undefined
    if (results.length === 2) {
        if (r1 !== 'tie' && r2 === 'tie') return r1
        if (r1 === 'tie' && r2 !== 'tie') return r2
        if (r1 !== 'tie' && r1 === r2) return r1
        return undefined
    }
    if (r3 !== 'tie') return r3
    if (r1 !== 'tie') return r1
    if (r2 !== 'tie') return r2
    return null
}

function canRaise(state: GameState, seat: Seat): boolean {
    return (
        state.phase === 'playing' &&
        state.mao11Team === null &&
        !state.iron &&
        state.pending === null &&
        state.turn === seat &&
        state.value < WIN_SCORE &&
        state.lastRaiserTeam !== teamOf(seat)
    )
}

export function legalActions(state: GameState, seat: Seat): Action[] {
    const actions: Action[] = []
    if (state.phase === 'mao11') {
        if (teamOf(seat) === state.mao11Team) actions.push({ type: 'mao11', play: true }, { type: 'mao11', play: false })
        return actions
    }
    if (state.phase !== 'playing') return actions
    if (state.pending) {
        if (teamOf(seat) !== state.pending.byTeam) {
            actions.push({ type: 'accept' }, { type: 'run' })
            if (state.pending.to < WIN_SCORE) actions.push({ type: 'raise' })
        }
        return actions
    }
    if (state.turn !== seat) return actions
    const allowCover = state.tricks.length >= 1 && !state.iron
    state.hands[seat].forEach((_, index) => {
        actions.push({ type: 'play', index })
        if (allowCover) actions.push({ type: 'play', index, covered: true })
    })
    if (canRaise(state, seat)) actions.push({ type: 'raise' })
    return actions
}

// ---------------- aplicação de ações ----------------

export function applyAction(state: GameState, seat: Seat, action: Action): GameState {
    switch (action.type) {
        case 'mao11':
            return applyMao11(state, seat, action.play)
        case 'play':
            return applyPlay(state, seat, action.index, !!action.covered)
        case 'raise':
            return applyRaise(state, seat)
        case 'accept':
            return applyAccept(state, seat)
        case 'run':
            return applyRun(state, seat)
        default:
            throw new RuleError('Ação desconhecida')
    }
}

function applyMao11(state: GameState, seat: Seat, play: boolean): GameState {
    if (state.phase !== 'mao11') throw new RuleError('Não é mão de 11')
    if (teamOf(seat) !== state.mao11Team) throw new RuleError('Só a dupla com 11 decide')
    let s = emit(state, { type: 'mao11', seat, play })
    if (play) return { ...s, phase: 'playing' }
    const other = (1 - state.mao11Team) as Team
    return finishHand(s, other, 1, 'mao11Run')
}

function applyPlay(state: GameState, seat: Seat, index: number, covered: boolean): GameState {
    if (state.phase !== 'playing') throw new RuleError('Não é hora de jogar carta')
    if (state.pending) throw new RuleError('Responda o pedido primeiro')
    if (state.turn !== seat) throw new RuleError('Não é sua vez')
    const hand = state.hands[seat]
    if (!Number.isInteger(index) || index < 0 || index >= hand.length) throw new RuleError('Carta inválida')
    if (covered && (state.tricks.length === 0 || state.iron)) throw new RuleError('Só pode cobrir a partir da 2ª vaza')
    const card = hand[index]
    const hands = state.hands.map((h, i) => (i === seat ? h.filter((_, j) => j !== index) : h))
    const play: Play = { seat, card, covered }
    let s: GameState = { ...state, hands, current: [...state.current, play] }
    s = emit(s, { type: 'play', seat, card: covered ? null : card, covered })
    if (s.current.length < 4) return { ...s, turn: nextSeat(seat) }

    const { result, winnerSeat } = resolveTrick(s.current, s.manilha)
    const starter = s.current[0].seat
    s = { ...s, tricks: [...s.tricks, { plays: s.current, result, winnerSeat }], current: [] }
    s = emit(s, { type: 'trick', result, winnerSeat })
    const hw = handWinner(s.tricks.map((t) => t.result))
    if (hw === undefined) return { ...s, turn: winnerSeat ?? starter }
    return finishHand(s, hw, hw === null ? 0 : s.value, 'tricks')
}

function applyRaise(state: GameState, seat: Seat): GameState {
    if (state.pending) {
        // aumento em resposta (implica aceitar o valor anterior)
        if (teamOf(seat) === state.pending.byTeam) throw new RuleError('Aguarde a resposta')
        const accepted = state.pending.to
        if (accepted >= WIN_SCORE) throw new RuleError('Não dá para aumentar mais')
        const to = RAISE_STEPS[accepted]
        const s: GameState = { ...state, value: accepted, pending: { bySeat: seat, byTeam: teamOf(seat), to } }
        return emit(s, { type: 'raise', seat, to })
    }
    if (!canRaise(state, seat)) throw new RuleError('Não pode pedir agora')
    const to = RAISE_STEPS[state.value]
    return emit({ ...state, pending: { bySeat: seat, byTeam: teamOf(seat), to } }, { type: 'raise', seat, to })
}

function applyAccept(state: GameState, seat: Seat): GameState {
    const p = state.pending
    if (!p || teamOf(seat) === p.byTeam) throw new RuleError('Nada para aceitar')
    const s: GameState = { ...state, value: p.to, pending: null, lastRaiserTeam: p.byTeam }
    return emit(s, { type: 'accept', seat, value: p.to })
}

function applyRun(state: GameState, seat: Seat): GameState {
    const p = state.pending
    if (!p || teamOf(seat) === p.byTeam) throw new RuleError('Nada para correr')
    const s = emit({ ...state, pending: null }, { type: 'run', seat, team: teamOf(seat) })
    return finishHand(s, p.byTeam, state.value, 'run')
}

function finishHand(state: GameState, winner: Team | null, points: number, reason: 'tricks' | 'run' | 'mao11Run'): GameState {
    const scores: [number, number] = [...state.scores]
    if (winner !== null) scores[winner] += points
    let s: GameState = { ...state, scores, pending: null, lastHand: { winner, points, reason } }
    s = emit(s, { type: 'handOver', winner, points, reason })
    if (winner !== null && scores[winner] >= WIN_SCORE) {
        s = emit({ ...s, phase: 'gameOver', winner }, { type: 'gameOver', winner })
        return s
    }
    return { ...s, phase: 'handOver' }
}

/** Encerra a partida por W.O. (dupla `loser` perdeu). */
export function walkover(state: GameState, loser: Team): GameState {
    const winner = (1 - loser) as Team
    return emit({ ...state, phase: 'gameOver', winner, pending: null }, { type: 'gameOver', winner })
}

// ---------------- visão por jogador ----------------

export interface PublicPlay {
    seat: Seat
    card: Card | null
    covered: boolean
}

export interface PlayerView {
    seat: Seat
    phase: Phase
    scores: [number, number]
    pe: Seat
    handNumber: number
    vira: Card
    manilha: Rank
    /** Minhas cartas (null = escondida na mão de ferro). */
    hand: (Card | null)[]
    /** Cartas do parceiro, só na decisão da mão de 11. */
    partnerHand: Card[] | null
    handCounts: number[]
    tricks: { plays: PublicPlay[]; result: TrickResult; winnerSeat: Seat | null }[]
    current: PublicPlay[]
    turn: Seat
    value: number
    pending: PendingRaise | null
    lastRaiserTeam: Team | null
    mao11Team: Team | null
    iron: boolean
    winner: Team | null
    lastHand: GameState['lastHand']
    legal: Action[]
}

function publicPlay(p: Play, viewer: Seat): PublicPlay {
    return { seat: p.seat, covered: p.covered, card: p.covered && p.seat !== viewer ? null : p.card }
}

export function viewFor(state: GameState, seat: Seat): PlayerView {
    const showPartner = state.phase === 'mao11' && teamOf(seat) === state.mao11Team
    // Ao fim da mão, revela as cartas que sobraram? Não: cartas não jogadas ficam ocultas.
    return {
        seat,
        phase: state.phase,
        scores: state.scores,
        pe: state.pe,
        handNumber: state.handNumber,
        vira: state.vira,
        manilha: state.manilha,
        hand: state.iron ? state.hands[seat].map(() => null) : state.hands[seat],
        partnerHand: showPartner ? state.hands[partnerOf(seat)] : null,
        handCounts: state.hands.map((h) => h.length),
        tricks: state.tricks.map((t) => ({ ...t, plays: t.plays.map((p) => publicPlay(p, seat)) })),
        current: state.current.map((p) => publicPlay(p, seat)),
        turn: state.turn,
        value: state.value,
        pending: state.pending,
        lastRaiserTeam: state.lastRaiserTeam,
        mao11Team: state.mao11Team,
        iron: state.iron,
        winner: state.winner,
        lastHand: state.lastHand,
        legal: legalActions(state, seat)
    }
}

/** Quem precisa agir agora (para timers e robôs). */
export function seatsToAct(state: GameState): Seat[] {
    if (state.phase === 'mao11') return SEATS.filter((s) => teamOf(s) === state.mao11Team)
    if (state.phase !== 'playing') return []
    if (state.pending) return SEATS.filter((s) => teamOf(s) !== state.pending!.byTeam)
    return [state.turn]
}
