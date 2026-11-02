import { describe, expect, it } from 'vitest'
import { Card, cardStrength, fullDeck, manilhaFromVira } from '../src/engine/cards'
import {
    GameState,
    RuleError,
    Seat,
    applyAction,
    handWinner,
    legalActions,
    newGame,
    resolveTrick,
    startNextHand,
    viewFor
} from '../src/engine/game'

const c = (s: string): Card => ({ rank: s.slice(0, -1) as Card['rank'], suit: s.slice(-1) as Card['suit'] })

/** Monta um estado com mãos e vira conhecidas. */
function rigged(hands: string[][], vira = '4D', patch: Partial<GameState> = {}): GameState {
    const g = newGame(1, 0)
    return {
        ...g,
        hands: hands.map((h) => h.map(c)),
        vira: c(vira),
        manilha: manilhaFromVira(c(vira)),
        phase: 'playing',
        mao11Team: null,
        iron: false,
        value: 1,
        ...patch
    }
}

const play = (s: GameState, seat: number, index = 0, covered = false) => applyAction(s, seat as Seat, { type: 'play', index, covered })

describe('cartas', () => {
    it('baralho tem 40 cartas únicas', () => {
        const d = fullDeck()
        expect(d).toHaveLength(40)
        expect(new Set(d.map((x) => x.rank + x.suit)).size).toBe(40)
    })
    it('manilha é a próxima da vira, 3 volta ao 4', () => {
        expect(manilhaFromVira(c('4D'))).toBe('5')
        expect(manilhaFromVira(c('7C'))).toBe('Q')
        expect(manilhaFromVira(c('3H'))).toBe('4')
    })
    it('ordem das manilhas: zap > copas > espadilha > pica-fumo > 3', () => {
        const m = '5'
        const s = (x: string) => cardStrength(c(x), m)
        expect(s('5C')).toBeGreaterThan(s('5H'))
        expect(s('5H')).toBeGreaterThan(s('5S'))
        expect(s('5S')).toBeGreaterThan(s('5D'))
        expect(s('5D')).toBeGreaterThan(s('3C'))
        expect(s('3C')).toBeGreaterThan(s('2C'))
        expect(s('AC')).toBeGreaterThan(s('KC'))
        expect(s('QC')).toBeGreaterThan(s('7C'))
        expect(s('3C')).toBe(s('3D'))
    })
})

describe('vazas', () => {
    it('cartas comuns iguais de duplas diferentes cangam', () => {
        const r = resolveTrick(
            [
                { seat: 0, card: c('3C'), covered: false },
                { seat: 1, card: c('3D'), covered: false },
                { seat: 2, card: c('4C'), covered: false },
                { seat: 3, card: c('4H'), covered: false }
            ],
            '5'
        )
        expect(r.result).toBe('tie')
    })
    it('mesma dupla com cartas iguais vence', () => {
        const r = resolveTrick(
            [
                { seat: 0, card: c('3C'), covered: false },
                { seat: 1, card: c('2D'), covered: false },
                { seat: 2, card: c('3D'), covered: false },
                { seat: 3, card: c('4H'), covered: false }
            ],
            '5'
        )
        expect(r).toEqual({ result: 0, winnerSeat: 0 })
    })
    it('carta coberta perde para qualquer carta', () => {
        const r = resolveTrick(
            [
                { seat: 0, card: c('5C'), covered: true },
                { seat: 1, card: c('4D'), covered: false },
                { seat: 2, card: c('4S'), covered: true },
                { seat: 3, card: c('4H'), covered: true }
            ],
            '5'
        )
        expect(r).toEqual({ result: 1, winnerSeat: 1 })
    })
})

describe('regras de empate da mão', () => {
    it.each([
        [[0, 0], 0],
        [[0, 'tie'], 0],
        [['tie', 1], 1],
        [[0, 1], undefined],
        [['tie', 'tie'], undefined],
        [[0, 1, 1], 1],
        [[0, 1, 'tie'], 0],
        [['tie', 'tie', 1], 1],
        [['tie', 'tie', 'tie'], null]
    ] as const)('%j -> %s', (results, expected) => {
        expect(handWinner([...results])).toBe(expected)
    })
})

describe('mão completa', () => {
    it('dupla que ganha 2 vazas leva 1 ponto e a próxima mão gira o pé', () => {
        // manilha = 5. Assento 0 tem zap e copas.
        let s = rigged([['5C', '5H', '4D'], ['4C', '4H', '6D'], ['6C', '6H', '7D'], ['7C', '7H', 'QD']])
        for (const seat of [0, 1, 2, 3]) s = play(s, seat, 0) // 5C vence
        expect(s.turn).toBe(0)
        for (const seat of [0, 1, 2, 3]) s = play(s, seat, 0) // 5H vence
        expect(s.phase).toBe('handOver')
        expect(s.scores).toEqual([1, 0])
        const n = startNextHand(s)
        expect(n.pe).toBe(1)
        expect(n.hands.every((h) => h.length === 3)).toBe(true)
    })

    it('não deixa jogar fora da vez nem cobrir na 1ª vaza', () => {
        const s = rigged([['5C', '5H', '4D'], ['4C', '4H', '6D'], ['6C', '6H', '7D'], ['7C', '7H', 'QD']])
        expect(() => play(s, 1)).toThrow(RuleError)
        expect(() => play(s, 0, 0, true)).toThrow(RuleError)
    })
})

describe('truco / seis / nove / doze', () => {
    const base = () => rigged([['5C', '5H', '4D'], ['4C', '4H', '6D'], ['6C', '6H', '7D'], ['7C', '7H', 'QD']])

    it('correr do truco dá o valor anterior a quem pediu', () => {
        let s = applyAction(base(), 0, { type: 'raise' })
        expect(s.pending?.to).toBe(3)
        s = applyAction(s, 1, { type: 'run' })
        expect(s.scores).toEqual([1, 0])
        expect(s.phase).toBe('handOver')
    })

    it('aceitar sobe o valor; mesma dupla não pode aumentar em seguida', () => {
        let s = applyAction(base(), 0, { type: 'raise' })
        s = applyAction(s, 3, { type: 'accept' })
        expect(s.value).toBe(3)
        s = play(s, 0)
        s = play(s, 1)
        s = play(s, 2)
        expect(legalActions(s, 3).some((a) => a.type === 'raise')).toBe(true)
        s = play(s, 3)
        expect(s.turn).toBe(0)
        expect(legalActions(s, 0).some((a) => a.type === 'raise')).toBe(false)
    })

    it('aumentar em resposta: truco -> seis -> nove -> doze; correr do doze dá 9', () => {
        let s = applyAction(base(), 0, { type: 'raise' }) // truco (3)
        s = applyAction(s, 1, { type: 'raise' }) // seis
        expect(s.value).toBe(3)
        expect(s.pending).toMatchObject({ byTeam: 1, to: 6 })
        s = applyAction(s, 2, { type: 'raise' }) // nove
        s = applyAction(s, 3, { type: 'raise' }) // doze
        expect(legalActions(s, 0).some((a) => a.type === 'raise')).toBe(false)
        s = applyAction(s, 0, { type: 'run' })
        expect(s.scores).toEqual([0, 9])
    })

    it('vencer a mão trucada vale 3', () => {
        let s = applyAction(base(), 0, { type: 'raise' })
        s = applyAction(s, 1, { type: 'accept' })
        for (let i = 0; i < 8; i++) s = play(s, s.turn, 0)
        expect(s.scores).toEqual([3, 0])
    })
})

describe('mão de 11 e mão de ferro', () => {
    it('dupla com 11 vê as cartas do parceiro e decide; correr dá 1 ao adversário', () => {
        const g = newGame(42, 0)
        let s = startNextHand({ ...g, scores: [11, 4], phase: 'handOver' })
        expect(s.phase).toBe('mao11')
        expect(s.mao11Team).toBe(0)
        expect(s.value).toBe(3)
        const v = viewFor(s, 0)
        expect(v.partnerHand).toEqual(s.hands[2])
        expect(viewFor(s, 1).partnerHand).toBeNull()
        expect(legalActions(s, 1)).toEqual([])
        s = applyAction(s, 2, { type: 'mao11', play: false })
        expect(s.scores).toEqual([11, 5])
    })

    it('na mão de 11 ninguém pede truco e ela vale 3', () => {
        const g = newGame(42, 0)
        let s = startNextHand({ ...g, scores: [3, 11], phase: 'handOver' })
        s = applyAction(s, 1, { type: 'mao11', play: true })
        expect(s.phase).toBe('playing')
        for (const seat of [0, 1, 2, 3]) expect(legalActions(s, seat as Seat).some((a) => a.type === 'raise')).toBe(false)
        expect(() => applyAction(s, s.turn, { type: 'raise' })).toThrow(RuleError)
    })

    it('mão de ferro: 11 a 11, cartas escondidas inclusive do dono', () => {
        const g = newGame(7, 0)
        const s = startNextHand({ ...g, scores: [11, 11], phase: 'handOver' })
        expect(s.iron).toBe(true)
        expect(s.phase).toBe('playing')
        expect(s.value).toBe(1)
        expect(viewFor(s, 0).hand).toEqual([null, null, null])
        expect(legalActions(s, s.turn).every((a) => a.type === 'play' && !a.covered)).toBe(true)
    })

    it('chegar a 12 encerra a partida', () => {
        let s = rigged([['5C', '5H', '4D'], ['4C', '4H', '6D'], ['6C', '6H', '7D'], ['7C', '7H', 'QD']], '4D', { scores: [10, 0] })
        for (let i = 0; i < 8; i++) s = play(s, s.turn, 0)
        expect(s.phase).toBe('handOver') // 11
        s = rigged([['5C', '5H', '4D'], ['4C', '4H', '6D'], ['6C', '6H', '7D'], ['7C', '7H', 'QD']], '4D', { scores: [11, 0], value: 3 })
        for (let i = 0; i < 8; i++) s = play(s, s.turn, 0)
        expect(s.phase).toBe('gameOver')
        expect(s.winner).toBe(0)
    })
})

describe('visão do jogador', () => {
    it('não vaza cartas dos outros nem cartas cobertas', () => {
        let s = rigged([['5C', '5H', '4D'], ['4C', '4H', '6D'], ['6C', '6H', '7D'], ['7C', '7H', 'QD']])
        for (const seat of [0, 1, 2, 3]) s = play(s, seat, 0)
        s = play(s, 0, 0, true)
        const v1 = viewFor(s, 1)
        expect(v1.current[0]).toEqual({ seat: 0, card: null, covered: true })
        expect(viewFor(s, 0).current[0].card).toEqual(c('5H'))
        expect(v1).not.toHaveProperty('hands')
        expect(v1.handCounts).toEqual([1, 2, 2, 2])
    })
})
