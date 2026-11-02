import { ReactNode, useEffect, useRef, useState } from 'react'

export interface Series {
    key: string
    label: string
    color: string
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
    const ref = useRef<T>(null)
    const [w, setW] = useState(600)
    useEffect(() => {
        if (!ref.current) return
        const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))))
        ro.observe(ref.current)
        return () => ro.disconnect()
    }, [])
    return [ref, w]
}

/** Escala "bonita": máximo arredondado e 3–4 marcas. */
function niceTicks(max: number): number[] {
    if (max <= 0) return [0, 1]
    const raw = max / 3
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
    const s = Math.max(1, step)
    const top = Math.ceil(max / s) * s
    const out: number[] = []
    for (let v = 0; v <= top + 1e-9; v += s) out.push(Math.round(v))
    return out
}

const fmt = (v: number) => v.toLocaleString('pt-BR')
const shortDate = (d: string) => {
    const [, m, day] = d.split('-')
    return `${day}/${m}`
}

interface ChartProps<R> {
    rows: R[]
    xKey: keyof R & string
    series: Series[]
    type: 'line' | 'stacked' | 'bar'
    height?: number
    formatX?: (v: string | number) => string
    ariaLabel: string
}

/** Gráfico temporal de um eixo só, com crosshair/tooltip e tabela acessível. */
export function Chart<R extends Record<string, string | number>>({ rows, xKey, series, type, height = 220, formatX, ariaLabel }: ChartProps<R>) {
    const [ref, width] = useWidth<HTMLDivElement>()
    const [hover, setHover] = useState<number | null>(null)
    const fx = formatX ?? ((v: string | number) => (typeof v === 'string' && /^\d{4}-/.test(v) ? shortDate(v) : String(v)))
    const direct = type === 'line' && series.length > 1 && width >= 480
    const pad = { l: 36, r: direct ? 118 : 12, t: 10, b: 24 }
    const iw = width - pad.l - pad.r
    const ih = height - pad.t - pad.b
    const totals = rows.map((r) => (type === 'stacked' ? series.reduce((a, s) => a + Number(r[s.key]), 0) : Math.max(...series.map((s) => Number(r[s.key])))))
    const ticks = niceTicks(Math.max(0, ...totals))
    const top = ticks[ticks.length - 1] || 1
    const y = (v: number) => pad.t + ih - (v / top) * ih
    const n = rows.length
    const band = iw / Math.max(1, n)
    const xc = (i: number) => pad.l + band * i + band / 2
    const barW = Math.max(2, Math.min(28, band - 2))
    const labelEvery = Math.ceil(n / Math.max(2, Math.floor(iw / 56)))

    // rótulos diretos no último ponto, afastados para não encavalar
    const lastRow = rows[n - 1]
    const labelY = new Map<string, number>()
    if (direct && lastRow) {
        const items = series.map((s) => ({ key: s.key, y: y(Number(lastRow[s.key])) })).sort((a, b) => a.y - b.y)
        for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 13) items[i].y = items[i - 1].y + 13
        items.forEach((it) => labelY.set(it.key, it.y))
    }

    const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const i = Math.floor((e.clientX - rect.left - pad.l) / band)
        setHover(i >= 0 && i < n ? i : null)
    }

    const tooltip: ReactNode =
        hover !== null ? (
            <div className='viz-tip' style={{ left: Math.min(Math.max(xc(hover), 70), width - 70), top: 0 }}>
                <strong>{fx(rows[hover][xKey])}</strong>
                {[...series].reverse().map((s) => (
                    <div key={s.key} className='viz-tip__row'>
                        <span className='viz-swatch' style={{ background: s.color }} />
                        <span>{s.label}</span>
                        <b>{fmt(Number(rows[hover][s.key]))}</b>
                    </div>
                ))}
                {type === 'stacked' && (
                    <div className='viz-tip__row viz-tip__total'>
                        <span />
                        <span>Total</span>
                        <b>{fmt(totals[hover])}</b>
                    </div>
                )}
            </div>
        ) : null

    return (
        <div className='viz'>
            {series.length > 1 && (
                <div className='viz-legend'>
                    {series.map((s) => (
                        <span key={s.key}>
                            <span className={`viz-swatch ${type === 'line' ? 'viz-swatch--line' : ''}`} style={{ background: s.color }} />
                            {s.label}
                        </span>
                    ))}
                </div>
            )}
            <div className='viz-plot' ref={ref}>
                <svg width={width} height={height} role='img' aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
                    {ticks.map((t) => (
                        <g key={t}>
                            <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
                            <text x={pad.l - 6} y={y(t)} dy='0.32em' textAnchor='end' className='viz-axis'>
                                {fmt(t)}
                            </text>
                        </g>
                    ))}
                    {rows.map((r, i) =>
                        i % labelEvery === 0 ? (
                            <text key={i} x={xc(i)} y={height - 6} textAnchor='middle' className='viz-axis'>
                                {fx(r[xKey])}
                            </text>
                        ) : null
                    )}
                    {hover !== null && type === 'line' && <line x1={xc(hover)} x2={xc(hover)} y1={pad.t} y2={pad.t + ih} className='viz-cross' />}
                    {hover !== null && type !== 'line' && <rect x={pad.l + band * hover} y={pad.t} width={band} height={ih} className='viz-hoverband' />}

                    {type === 'line' &&
                        series.map((s) => {
                            const pts = rows.map((r, i) => `${xc(i)},${y(Number(r[s.key]))}`).join(' ')
                            const last = rows[n - 1]
                            return (
                                <g key={s.key}>
                                    <polyline points={pts} fill='none' stroke={s.color} strokeWidth={2} strokeLinejoin='round' strokeLinecap='round' />
                                    {hover !== null && <circle cx={xc(hover)} cy={y(Number(rows[hover][s.key]))} r={4.5} fill={s.color} className='viz-dot' />}
                                    {direct && last && (
                                        <text x={xc(n - 1) + 8} y={labelY.get(s.key)} dy='0.32em' className='viz-direct'>
                                            {s.label}
                                        </text>
                                    )}
                                </g>
                            )
                        })}

                    {type !== 'line' &&
                        rows.map((r, i) => {
                            let acc = 0
                            return (
                                <g key={i}>
                                    {series.map((s, si) => {
                                        const v = Number(r[s.key])
                                        if (!v) return null
                                        const y0 = y(acc)
                                        acc += v
                                        const y1 = y(acc)
                                        const isTop = series.slice(si + 1).every((x) => !Number(r[x.key]))
                                        const h = Math.max(1, y0 - y1 - (isTop ? 0 : 2))
                                        const rad = isTop ? Math.min(4, h / 2, barW / 2) : 0
                                        const x0 = xc(i) - barW / 2
                                        const yTop = isTop ? y1 : y1 + 2
                                        return (
                                            <path
                                                key={s.key}
                                                fill={s.color}
                                                d={`M${x0},${yTop + h} V${yTop + rad} Q${x0},${yTop} ${x0 + rad},${yTop} H${x0 + barW - rad} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + rad} V${yTop + h} Z`}
                                            />
                                        )
                                    })}
                                </g>
                            )
                        })}
                </svg>
                {tooltip}
            </div>
            <details className='viz-table'>
                <summary>Ver dados em tabela</summary>
                <table>
                    <thead>
                        <tr>
                            <th />
                            {series.map((s) => (
                                <th key={s.key}>{s.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={i}>
                                <td>{fx(r[xKey])}</td>
                                {series.map((s) => (
                                    <td key={s.key}>{fmt(Number(r[s.key]))}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>
        </div>
    )
}
