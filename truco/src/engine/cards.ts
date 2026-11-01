// Baralho do Truco Paulista: 40 cartas (sem 8, 9 e 10).

export const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'] as const
/** Naipes em ordem crescente de força como manilha: ouros (pica-fumo) < espadas (espadilha) < copas < paus (zap). */
export const SUITS = ['D', 'S', 'H', 'C'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]

export interface Card {
    rank: Rank
    suit: Suit
}

export const SUIT_SYMBOL: Record<Suit, string> = { D: '♦', S: '♠', H: '♥', C: '♣' }
export const MANILHA_NAME: Record<Suit, string> = { D: 'pica-fumo', S: 'espadilha', H: 'copas', C: 'zap' }

export const cardId = (c: Card): string => `${c.rank}${c.suit}`
export const cardLabel = (c: Card): string => `${c.rank}${SUIT_SYMBOL[c.suit]}`

export function fullDeck(): Card[] {
    const deck: Card[] = []
    for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit })
    return deck
}

/** A manilha é a carta seguinte à vira (depois do 3 volta ao 4). */
export function manilhaFromVira(vira: Card): Rank {
    return RANKS[(RANKS.indexOf(vira.rank) + 1) % RANKS.length]
}

/**
 * Força da carta: comuns 0..9 (ordem de RANKS), manilhas 10..13 (ordem de SUITS).
 * Cartas comuns de mesmo valor têm a mesma força (cangam).
 */
export function cardStrength(card: Card, manilha: Rank): number {
    if (card.rank === manilha) return 10 + SUITS.indexOf(card.suit)
    return RANKS.indexOf(card.rank)
}

/** Força de carta coberta: abaixo de qualquer carta. */
export const COVERED_STRENGTH = -1

// ---------- RNG determinístico (mulberry32) ----------

/** Avança o estado do RNG e devolve [novoEstado, valor em 0..1). */
export function nextRandom(seed: number): [number, number] {
    const s = (seed + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    return [s, value]
}

export function shuffle<T>(items: T[], seed: number): [T[], number] {
    const arr = items.slice()
    let s = seed
    for (let i = arr.length - 1; i > 0; i--) {
        const [ns, r] = nextRandom(s)
        s = ns
        const j = Math.floor(r * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return [arr, s]
}
