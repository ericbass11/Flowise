export const ELO_K = 32
export const ELO_START = 1000

/** Expectativa de vitória da dupla A contra a dupla B. */
export const expected = (ra: number, rb: number) => 1 / (1 + Math.pow(10, (rb - ra) / 400))

/**
 * Atualiza o Elo dos 4 jogadores usando a média de cada dupla.
 * `teams[t]` são os ratings dos jogadores da dupla t; `winner` é a dupla vencedora.
 */
export function updateElo(teams: [number[], number[]], winner: 0 | 1): [number[], number[]] {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const [a, b] = [avg(teams[0]), avg(teams[1])]
    const deltaA = Math.round(ELO_K * ((winner === 0 ? 1 : 0) - expected(a, b)))
    return [teams[0].map((r) => r + deltaA), teams[1].map((r) => r - deltaA)]
}
