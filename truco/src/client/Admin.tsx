import { useCallback, useEffect, useState } from 'react'
import type { AdminStats, Kpi } from '../server/stats'
import { Chart, Series } from './Charts'
import { api } from './net'

// Paleta categórica validada (modo escuro, superfície #24160d): azul, laranja, verde-água.
const C1 = '#3987e5'
const C2 = '#d95926'
const C3 = '#199e70'

const fmt = (v: number) => v.toLocaleString('pt-BR')
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const dec = (v: number | null, unit = '') => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unit}`)

function Delta({ k }: { k: Kpi }) {
    if (k.previous === null) return null
    if (k.previous === 0) return <span className='kpi__delta'>{k.value ? 'novo no período' : 'sem variação'}</span>
    const d = (k.value - k.previous) / k.previous
    const up = d > 0
    return (
        <span className={`kpi__delta ${d === 0 ? '' : up ? 'kpi__delta--up' : 'kpi__delta--down'}`}>
            {d === 0 ? '＝' : up ? '▲' : '▼'} {d >= 9 ? `${(d + 1).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}× o` : pct(Math.abs(d))} vs período anterior
        </span>
    )
}

function Tile({ label, value, sub, k, live }: { label: string; value: string; sub?: string; k?: Kpi; live?: boolean }) {
    return (
        <div className='kpi'>
            <span className='kpi__label'>
                {live && <span className='live-dot' aria-label='ao vivo' />}
                {label}
            </span>
            <span className='kpi__value'>{value}</span>
            {k && <Delta k={k} />}
            {sub && <span className='kpi__sub'>{sub}</span>}
        </div>
    )
}

const ACCESS: Series[] = [
    { key: 'visits', label: 'Visitas', color: C1 },
    { key: 'visitors', label: 'Visitantes únicos', color: C2 }
]
const MATCHES: Series[] = [
    { key: 'ranked', label: 'Valendo Elo', color: C1 },
    { key: 'friendly', label: 'Salas privadas', color: C2 },
    { key: 'queueBots', label: 'Fila com robôs', color: C3 }
]

export function AdminDashboard() {
    const [days, setDays] = useState(30)
    const [data, setData] = useState<AdminStats | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(() => {
        api<AdminStats>(`/api/admin/stats?days=${days}`)
            .then((d) => {
                setData(d)
                setError(null)
            })
            .catch((e: Error) => setError(e.message === '403' ? 'Sua conta não tem acesso ao painel.' : e.message === '401' ? 'Faça login para ver o painel.' : 'Falha ao carregar.'))
    }, [days])

    useEffect(() => {
        load()
        const t = setInterval(load, 15_000)
        return () => clearInterval(t)
    }, [load])

    if (error)
        return (
            <div className='admin'>
                <div className='panel'>
                    <h2>Painel</h2>
                    <p>{error}</p>
                    <a className='btn' href='/'>
                        Voltar ao jogo
                    </a>
                </div>
            </div>
        )
    if (!data) return <div className='splash'>Somando a comanda…</div>

    const k = data.kpis
    const periodLabel = `últimos ${days} dias`

    return (
        <div className='admin'>
            <header className='admin__head'>
                <div>
                    <div className='brand'>📊 Painel do Boteco</div>
                    <small className='muted'>
                        {fmt(data.totals.users)} contas · {fmt(data.totals.matches)} partidas no total · atualizado{' '}
                        {new Date(data.generatedAt).toLocaleTimeString('pt-BR')}
                    </small>
                </div>
                <div className='row'>
                    <div className='seg' role='group' aria-label='Período'>
                        {[7, 30, 90].map((d) => (
                            <button key={d} type='button' className={`seg__btn ${days === d ? 'seg__btn--on' : ''}`} onClick={() => setDays(d)}>
                                {d} dias
                            </button>
                        ))}
                    </div>
                    <a className='btn btn--ghost btn--sm' href='/'>
                        Jogo
                    </a>
                </div>
            </header>

            <section>
                <h3 className='admin__section'>Agora</h3>
                <div className='kpis kpis--4'>
                    <Tile live label='Pessoas online' value={fmt(data.live.online)} />
                    <Tile live label='Mesas em jogo' value={fmt(data.live.tablesPlaying)} />
                    <Tile live label='Jogando agora' value={fmt(data.live.playersInGame)} sub='humanos em partidas' />
                    <Tile live label='Na fila' value={fmt(data.live.queue)} />
                </div>
            </section>

            <section>
                <h3 className='admin__section'>Acessos e contas · {periodLabel}</h3>
                <div className='kpis'>
                    <Tile label='Visitas' value={fmt(k.visits.value)} k={k.visits} />
                    <Tile label='Visitantes únicos' value={fmt(k.visitors.value)} k={k.visitors} />
                    <Tile label='Contas novas' value={fmt(k.signups.value)} k={k.signups} sub={`conversão ${pct(k.signupConversion)} dos visitantes`} />
                    <Tile label='Pessoas ativas' value={fmt(k.activeUsers.value)} k={k.activeUsers} sub='entraram e jogaram/navegaram logadas' />
                </div>
                <div className='charts'>
                    <div className='panel chart-card'>
                        <h4>Acessos por dia</h4>
                        <Chart rows={data.series as any} xKey='date' series={ACCESS} type='line' ariaLabel='Visitas e visitantes únicos por dia' />
                    </div>
                    <div className='panel chart-card'>
                        <h4>Contas novas por dia</h4>
                        <Chart rows={data.series as any} xKey='date' series={[{ key: 'signups', label: 'Contas novas', color: C1 }]} type='bar' ariaLabel='Contas novas por dia' />
                    </div>
                </div>
            </section>

            <section>
                <h3 className='admin__section'>Pessoas</h3>
                <div className='kpis'>
                    <Tile label='Ativos hoje (24h)' value={fmt(k.dau)} />
                    <Tile label='Ativos na semana' value={fmt(k.wau)} />
                    <Tile label='Ativos no mês' value={fmt(k.mau)} />
                    <Tile label='Fidelidade (diário/mensal)' value={k.mau ? pct(k.dau / k.mau) : '—'} sub='quanto da base mensal volta todo dia' />
                </div>
                <div className='charts'>
                    <div className='panel chart-card'>
                        <h4>Pessoas ativas por dia</h4>
                        <Chart rows={data.series as any} xKey='date' series={[{ key: 'activeUsers', label: 'Pessoas ativas', color: C1 }]} type='line' ariaLabel='Pessoas ativas por dia' />
                    </div>
                    <div className='panel chart-card'>
                        <h4>Horário de pico · {periodLabel}</h4>
                        <Chart
                            rows={data.hourly as any}
                            xKey='hour'
                            series={[{ key: 'sessions', label: 'Entradas', color: C1 }]}
                            type='bar'
                            formatX={(h) => `${h}h`}
                            ariaLabel='Entradas por hora do dia'
                        />
                    </div>
                </div>
            </section>

            <section>
                <h3 className='admin__section'>Jogos · {periodLabel}</h3>
                <div className='kpis'>
                    <Tile label='Partidas' value={fmt(k.matches.value)} k={k.matches} />
                    <Tile label='Valendo Elo' value={pct(k.rankedShare)} sub='das partidas do período' />
                    <Tile label='Duração média' value={dec(k.avgDurationMin, ' min')} />
                    <Tile label='Humanos por mesa' value={dec(k.avgPlayersPerMatch)} sub={`W.O. em ${pct(k.walkoverRate)} das partidas`} />
                </div>
                <div className='panel chart-card'>
                    <h4>Partidas por dia, por tipo</h4>
                    <Chart rows={data.series as any} xKey='date' series={MATCHES} type='stacked' height={240} ariaLabel='Partidas por dia por tipo' />
                </div>
            </section>

            <section className='charts'>
                <div className='panel'>
                    <h4>Top Elo</h4>
                    <table className='admin-table'>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Jogador</th>
                                <th>Elo</th>
                                <th>V/D</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.topPlayers.map((p, i) => (
                                <tr key={p.id}>
                                    <td>{i + 1}</td>
                                    <td>{p.name}</td>
                                    <td>{p.elo}</td>
                                    <td>
                                        {p.wins}/{p.losses}
                                    </td>
                                </tr>
                            ))}
                            {!data.topPlayers.length && (
                                <tr>
                                    <td colSpan={4} className='muted'>
                                        Ninguém jogou valendo Elo ainda.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className='panel'>
                    <h4>Mais ativos · {periodLabel}</h4>
                    <table className='admin-table'>
                        <thead>
                            <tr>
                                <th>Jogador</th>
                                <th>Partidas</th>
                                <th>Vitórias</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.mostActive.map((p) => (
                                <tr key={p.id}>
                                    <td>{p.name}</td>
                                    <td>{p.matches}</td>
                                    <td>{pct(p.matches ? p.wins / p.matches : null)}</td>
                                </tr>
                            ))}
                            {!data.mostActive.length && (
                                <tr>
                                    <td colSpan={3} className='muted'>
                                        Sem partidas no período.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className='panel'>
                <h4>Partidas recentes</h4>
                <div className='table-scroll'>
                    <table className='admin-table'>
                        <thead>
                            <tr>
                                <th>Quando</th>
                                <th>Tipo</th>
                                <th>Placar</th>
                                <th>Duração</th>
                                <th>Mesa (lugares 1–4)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.recentMatches.map((m) => (
                                <tr key={m.id}>
                                    <td>{new Date(m.createdAt.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                                    <td>
                                        {m.ranked ? 'Elo' : m.kind === 'private' ? 'Sala privada' : 'Fila c/ robôs'}
                                        {m.walkover && <span className='tag'>W.O.</span>}
                                    </td>
                                    <td>
                                        {m.score[0]} x {m.score[1]}
                                    </td>
                                    <td>{m.durationSec === null ? '—' : `${Math.round(m.durationSec / 60)} min`}</td>
                                    <td className='muted'>{m.players}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    )
}
