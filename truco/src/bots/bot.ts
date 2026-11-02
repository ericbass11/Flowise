import { Card, Rank, cardStrength } from '../engine/cards'
import { Action, PlayerView, PublicPlay, Seat, Team, partnerOf, teamOf } from '../engine/game'

export type BotLevel = 'facil' | 'medio' | 'dificil'
export const BOT_LEVELS: BotLevel[] = ['facil', 'medio', 'dificil']

export type SignalKind = 'zap' | 'copas' | 'espadilha' | 'picafumo' | 'tres' | 'nada'

interface Profile {
    /** Chance de pedir truco com a mão forte (p > raiseAt). */
    raiseAt: number
    acceptAt: number
    reraiseAt: number
    bluff: number
    mao11At: number
    smartPlay: boolean
    usesSignals: boolean
}

const PROFILES: Record<BotLevel, Profile> = {
    facil: { raiseAt: 0.8, acceptAt: 0.35, reraiseAt: 0.9, bluff: 0.03, mao11At: 0.4, smartPlay: false, usesSignals: false },
    medio: { raiseAt: 0.66, acceptAt: 0.45, reraiseAt: 0.8, bluff: 0.08, mao11At: 0.5, smartPlay: true, usesSignals: true },
    dificil: { raiseAt: 0.6, acceptAt: 0.5, reraiseAt: 0.74, bluff: 0.14, mao11At: 0.52, smartPlay: true, usesSignals: true }
}

export interface BotMemory {
    /** Sinais recebidos do parceiro nesta mão. */
    partnerSignals: SignalKind[]
}

const strength = (c: Card | null, m: Rank) => (c ? cardStrength(c, m) : -1)
const playStrength = (p: PublicPlay, m: Rank) => (p.covered || !p.card ? -1 : cardStrength(p.card, m))

/** Estimativa (0..1) de a dupla do robô ganhar a mão. */
export function estimateWin(view: PlayerView, memory: BotMemory, level: BotLevel): number {
    const m = view.manilha
    const myTeam = teamOf(view.seat)
    let p = 0.5
    const cards = view.hand.filter((c): c is Card => c !== null)
    for (const c of cards) {
        const s = cardStrength(c, m)
        p += s >= 10 ? 0.12 + (s - 10) * 0.03 : (s - 5.5) * 0.02
    }
    for (const t of view.tricks) {
        if (t.result === myTeam) p += view.tricks.length === 1 ? 0.22 : 0.3
        else if (t.result !== 'tie') p -= view.tricks.length === 1 ? 0.22 : 0.3
    }
    // vaza em andamento
    if (view.current.length) {
        const best = Math.max(...view.current.map((x) => playStrength(x, m)))
        const leader = view.current.find((x) => playStrength(x, m) === best)!
        const myBest = Math.max(-1, ...cards.map((c) => cardStrength(c, m)))
        if (teamOf(leader.seat) === myTeam) p += 0.08
        else if (myBest > best) p += 0.04
        else p -= 0.1
    }
    if (level === 'dificil' || level === 'medio') {
        for (const sig of memory.partnerSignals) p += sig === 'zap' ? 0.12 : sig === 'nada' ? -0.08 : sig === 'tres' ? 0.04 : 0.08
    }
    return Math.max(0, Math.min(1, p))
}

/** Força combinada das duas mãos (para a decisão de mão de 11). */
function mao11Estimate(view: PlayerView): number {
    const all = [...view.hand, ...(view.partnerHand ?? [])].filter((c): c is Card => c !== null)
    let p = 0.2
    for (const c of all) {
        const s = cardStrength(c, view.manilha)
        p += s >= 10 ? 0.16 : s >= 8 ? 0.07 : s >= 6 ? 0.03 : 0
    }
    return Math.min(1, p)
}

function lowestIndex(hand: (Card | null)[], m: Rank): number {
    let idx = 0
    hand.forEach((c, i) => {
        if (strength(c, m) < strength(hand[idx], m)) idx = i
    })
    return idx
}

function highestIndex(hand: (Card | null)[], m: Rank): number {
    let idx = 0
    hand.forEach((c, i) => {
        if (strength(c, m) > strength(hand[idx], m)) idx = i
    })
    return idx
}

function choosePlay(view: PlayerView, level: BotLevel, rand: () => number): Action {
    const m = view.manilha
    const hand = view.hand
    if (view.iron) return { type: 'play', index: Math.floor(rand() * hand.length) }
    const prof = PROFILES[level]
    const canCover = view.legal.some((a) => a.type === 'play' && a.covered)

    if (!prof.smartPlay) {
        // fácil: joga a mais alta metade das vezes, senão aleatória
        const index = rand() < 0.5 ? highestIndex(hand, m) : Math.floor(rand() * hand.length)
        return { type: 'play', index }
    }

    const myTeam = teamOf(view.seat)
    if (view.current.length === 0) {
        // abrindo a vaza
        if (view.tricks.length === 0) {
            const sorted = hand.map((c, i) => [strength(c, m), i] as const).sort((a, b) => b[0] - a[0])
            // com duas cartas fortes, segura a maior e abre com a segunda
            if (sorted[1] && sorted[1][0] >= 8) return { type: 'play', index: sorted[1][1] }
            return { type: 'play', index: sorted[0][1] }
        }
        return { type: 'play', index: highestIndex(hand, m) }
    }

    const best = Math.max(...view.current.map((x) => playStrength(x, m)))
    const leader = view.current.find((x) => playStrength(x, m) === best)!
    const partnerWinning = teamOf(leader.seat) === myTeam && leader.seat === partnerOf(view.seat)
    const lastToPlay = view.current.length === 3
    const low = lowestIndex(hand, m)

    if (partnerWinning && (lastToPlay || best >= 9)) {
        // parceiro já leva: descarta a menor (dificil cobre para esconder informação)
        if (canCover && level === 'dificil') return { type: 'play', index: low, covered: true }
        return { type: 'play', index: low }
    }
    // menor carta que vence
    let winIdx = -1
    hand.forEach((c, i) => {
        const s = strength(c, m)
        if (s > best && (winIdx < 0 || s < strength(hand[winIdx], m))) winIdx = i
    })
    if (winIdx >= 0) return { type: 'play', index: winIdx }
    // empata (canga) se a dupla ganhou a primeira
    const tieIdx = hand.findIndex((c) => strength(c, m) === best && best < 10)
    if (tieIdx >= 0 && view.tricks[0]?.result === myTeam) return { type: 'play', index: tieIdx }
    if (canCover && level === 'dificil') return { type: 'play', index: low, covered: true }
    return { type: 'play', index: low }
}

/** Decide a ação do robô a partir da sua visão (sem trapaça). */
export function decide(view: PlayerView, level: BotLevel, memory: BotMemory, rand: () => number = Math.random): Action | null {
    if (!view.legal.length) return null
    const prof = PROFILES[level]
    const has = (t: Action['type']) => view.legal.some((a) => a.type === t)

    if (view.phase === 'mao11') return { type: 'mao11', play: mao11Estimate(view) >= prof.mao11At }

    const p = estimateWin(view, memory, level)
    if (view.pending) {
        if (has('raise') && (p >= prof.reraiseAt || rand() < prof.bluff / 2)) return { type: 'raise' }
        if (p >= prof.acceptAt || rand() < prof.bluff) return { type: 'accept' }
        return { type: 'run' }
    }
    if (has('raise') && (p >= prof.raiseAt || rand() < prof.bluff)) return { type: 'raise' }
    return choosePlay(view, level, rand)
}

/** Sinal que o robô manda ao parceiro no início da mão (ou null). */
export function chooseSignal(view: PlayerView, level: BotLevel, rand: () => number = Math.random): SignalKind | null {
    if (!PROFILES[level].usesSignals || view.iron || view.handNumber === 0) return null
    if (rand() < 0.3) return null
    const m = view.manilha
    const cards = view.hand.filter((c): c is Card => c !== null)
    const manilhas = cards.filter((c) => c.rank === m).sort((a, b) => cardStrength(b, m) - cardStrength(a, m))
    if (manilhas.length) {
        const suit = manilhas[0].suit
        return suit === 'C' ? 'zap' : suit === 'H' ? 'copas' : suit === 'S' ? 'espadilha' : 'picafumo'
    }
    if (cards.some((c) => c.rank === '3')) return 'tres'
    return 'nada'
}

// ------------- falas de boteco -------------

const LINES = {
    truco: ['TRUCO, ladrão!', 'TRUCO! Vai correr, marreco?', 'Truco nessa budega!', 'TRUUUCO!'],
    seis: ['SEIS, pato!', 'Seis! Desce se for homem!', 'Seis e não se fala mais nisso!'],
    nove: ['NOVE! Agora o bicho pega!', 'Nove, freguês!', 'Nove pra você aprender!'],
    doze: ['DOZE! Vale a cerveja!', 'Doze, e a saideira é minha!'],
    accept: ['Desce!', 'Vem que tem!', 'Cai dentro!', 'Manda que eu pago!'],
    run: ['Corro, tá louco...', 'Essa não dá, segue o jogo.', 'Hoje não, compadre.', 'Fui!'],
    winHand: ['Toma!', 'Chora não!', 'É o rei do boteco!', 'Vai buscar mais uma, garçom!'],
    loseHand: ['Sorte de principiante...', 'Tava armado isso aí.', 'Deixa estar...']
}

export function botLine(kind: keyof typeof LINES, rand: () => number = Math.random): string {
    const l = LINES[kind]
    return l[Math.floor(rand() * l.length)]
}

export function raiseLine(to: number, rand: () => number = Math.random): string {
    return botLine(to === 3 ? 'truco' : to === 6 ? 'seis' : to === 9 ? 'nove' : 'doze', rand)
}

export const SIGNAL_LABEL: Record<SignalKind, string> = {
    zap: 'Tenho o zap 😉',
    copas: 'Tenho copas 😜',
    espadilha: 'Tenho espadilha 🤨',
    picafumo: 'Tenho pica-fumo 😗',
    tres: 'Tenho três 🫦',
    nada: 'Não tenho nada 😒'
}

export type { Seat, Team }
