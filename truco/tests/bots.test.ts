import { describe, expect, it } from 'vitest'
import { nextRandom } from '../src/engine/cards'
import { GameState, Seat, applyAction, newGame, seatsToAct, startNextHand, viewFor } from '../src/engine/game'
import { BotLevel, decide } from '../src/bots/bot'

function seededRand(seed: number) {
    let s = seed
    return () => {
        const [ns, v] = nextRandom(s)
        s = ns
        return v
    }
}

function playGame(seed: number, levels: [BotLevel, BotLevel]): GameState {
    const rand = seededRand(seed * 7919)
    let s = newGame(seed, (seed % 4) as Seat)
    let guard = 0
    while (s.phase !== 'gameOver') {
        if (++guard > 5000) throw new Error('partida não terminou')
        if (s.phase === 'handOver') {
            s = startNextHand(s)
            continue
        }
        const seat = seatsToAct(s)[0]
        const action = decide(viewFor(s, seat), levels[seat % 2], { partnerSignals: [] }, rand)
        if (!action) throw new Error('robô sem ação')
        s = applyAction(s, seat, action)
    }
    return s
}

describe('robôs', () => {
    it('200 partidas robô x robô terminam sem violar regras', () => {
        const levels: BotLevel[] = ['facil', 'medio', 'dificil']
        for (let i = 1; i <= 200; i++) {
            const s = playGame(i, [levels[i % 3], levels[(i + 1) % 3]])
            expect(s.winner).not.toBeNull()
            expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(12)
        }
    })

    it('difícil vence fácil na maioria das partidas', () => {
        let wins = 0
        const N = 300
        for (let i = 1; i <= N; i++) {
            const dificilTeam = i % 2
            const levels: [BotLevel, BotLevel] = dificilTeam === 0 ? ['dificil', 'facil'] : ['facil', 'dificil']
            if (playGame(1000 + i, levels).winner === dificilTeam) wins++
        }
        expect(wins / N).toBeGreaterThan(0.55)
    })
})
