import { useCallback, useEffect, useState } from 'react'
import { AdminDashboard } from './Admin'
import { Chat, Table } from './Table'
import { Me, QueueInfo, RoomPayload, api, emit, getSocket, useNow } from './net'

type Tab = 'jogar' | 'ranking' | 'historico' | 'regras'
const LEVELS = [
    { id: 'facil', label: 'Fácil' },
    { id: 'medio', label: 'Médio' },
    { id: 'dificil', label: 'Difícil' }
]

export function App() {
    const [me, setMe] = useState<Me | null | undefined>(undefined)
    const refreshMe = useCallback(() => {
        api<Me>('/api/me')
            .then(setMe)
            .catch(() => setMe(null))
    }, [])
    useEffect(refreshMe, [refreshMe])
    useEffect(() => {
        fetch('/api/track', { method: 'POST', credentials: 'include' }).catch(() => {})
    }, [])

    if (me === undefined) return <div className='splash'>Abrindo o boteco…</div>
    if (me === null) return <Login onLogin={refreshMe} />
    if (location.pathname.startsWith('/admin')) return <AdminDashboard />
    return <Home me={me} refreshMe={refreshMe} />
}

function Login({ onLogin }: { onLogin: () => void }) {
    const [cfg, setCfg] = useState<{ google: boolean; devLogin: boolean } | null>(null)
    const [name, setName] = useState('')
    const [err, setErr] = useState('')
    useEffect(() => {
        api<{ google: boolean; devLogin: boolean }>('/auth/config').then(setCfg).catch(() => setCfg({ google: false, devLogin: false }))
    }, [])
    return (
        <div className='login'>
            <div className='sign'>
                <div className='sign__top'>Bar & Mercearia</div>
                <h1 className='sign__title'>Truco do Boteco</h1>
                <div className='sign__sub'>Paulista · em duplas · com robôs folgados</div>
            </div>
            <div className='panel login__panel'>
                {cfg?.google ? (
                    <a className='btn btn--google' href='/auth/google'>
                        <svg width='18' height='18' viewBox='0 0 48 48' aria-hidden>
                            <path fill='#FFC107' d='M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z' />
                            <path fill='#FF3D00' d='m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z' />
                            <path fill='#4CAF50' d='M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z' />
                            <path fill='#1976D2' d='M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z' />
                        </svg>
                        Entrar com Google
                    </a>
                ) : (
                    <p className='muted'>Login com Google ainda não configurado no servidor (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).</p>
                )}
                {cfg?.devLogin && (
                    <form
                        className='dev-login'
                        onSubmit={async (e) => {
                            e.preventDefault()
                            setErr('')
                            const r = await fetch('/auth/dev', {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ name })
                            })
                            if (r.ok) onLogin()
                            else setErr('Não deu para entrar')
                        }}
                    >
                        <small className='muted'>Modo desenvolvimento</small>
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Seu apelido de teste' maxLength={24} />
                        <button className='btn' type='submit' disabled={!name.trim()}>
                            Entrar como teste
                        </button>
                        {err && <div className='error-inline'>{err}</div>}
                    </form>
                )}
            </div>
        </div>
    )
}

function Home({ me, refreshMe }: { me: Me; refreshMe: () => void }) {
    const [room, setRoom] = useState<RoomPayload | null>(null)
    const [queue, setQueue] = useState<QueueInfo | null>(null)
    const [tab, setTab] = useState<Tab>('jogar')
    const [err, setErr] = useState('')
    const [connected, setConnected] = useState(false)

    useEffect(() => {
        const s = getSocket()
        const onRoom = (p: RoomPayload) => setRoom(p)
        const onQueue = (q: QueueInfo) => setQueue(q.waiting ? q : null)
        s.on('connect', () => setConnected(true))
        s.on('disconnect', () => setConnected(false))
        s.on('room', onRoom)
        s.on('queue', onQueue)
        if (s.connected) setConnected(true)
        const code = new URLSearchParams(location.search).get('sala')
        if (code) {
            emit('room:join', code).catch((e) => setErr(e.message))
            history.replaceState(null, '', '/')
        }
        return () => {
            s.off('room', onRoom)
            s.off('queue', onQueue)
        }
    }, [])

    const run = (p: Promise<unknown>) => {
        setErr('')
        p.catch((e) => setErr(e.message))
    }

    const leave = () => {
        emit('room:leave').finally(() => {
            setRoom(null)
            refreshMe()
        })
    }

    if (room && room.status !== 'lobby' && room.view) return <Table room={room} onLeave={leave} />

    return (
        <div className='home'>
            <header className='topbar'>
                <div className='brand'>🃏 Truco do Boteco</div>
                <div className='me-chip'>
                    {me.avatar ? <img src={me.avatar} alt='' /> : <span>🙂</span>}
                    <div>
                        <strong>{me.name}</strong>
                        <small>
                            Elo {me.elo} · {me.wins}V {me.losses}D
                        </small>
                    </div>
                    {me.isAdmin && (
                        <a className='btn btn--sm' href='/admin'>
                            Painel
                        </a>
                    )}
                    <button
                        type='button'
                        className='btn btn--ghost btn--sm'
                        onClick={() => fetch('/auth/logout', { method: 'POST', credentials: 'include' }).then(() => location.reload())}
                    >
                        Sair
                    </button>
                </div>
            </header>
            {!connected && <div className='banner'>Conectando ao servidor…</div>}
            {err && (
                <div className='banner banner--err' onClick={() => setErr('')}>
                    {err}
                </div>
            )}

            {room ? (
                <RoomLobby room={room} me={me} run={run} onLeave={leave} />
            ) : (
                <>
                    <nav className='tabs'>
                        {(
                            [
                                ['jogar', 'Jogar'],
                                ['ranking', 'Ranking'],
                                ['historico', 'Histórico'],
                                ['regras', 'Regras']
                            ] as [Tab, string][]
                        ).map(([id, label]) => (
                            <button key={id} type='button' className={`tab ${tab === id ? 'tab--on' : ''}`} onClick={() => setTab(id)}>
                                {label}
                            </button>
                        ))}
                    </nav>
                    {tab === 'jogar' && <PlayMenu queue={queue} run={run} />}
                    {tab === 'ranking' && <Ranking meId={me.id} />}
                    {tab === 'historico' && <History />}
                    {tab === 'regras' && <Rules />}
                </>
            )}
        </div>
    )
}

function PlayMenu({ queue, run }: { queue: QueueInfo | null; run: (p: Promise<unknown>) => void }) {
    const [level, setLevel] = useState('medio')
    const [code, setCode] = useState('')
    const now = useNow(1000)
    const waited = queue?.since ? Math.floor((now - queue.since) / 1000) : 0

    return (
        <div className='menu'>
            <section className='panel'>
                <h2>🤖 Contra os robôs</h2>
                <p className='muted'>Você + 1 robô parceiro contra 2 robôs.</p>
                <div className='seg'>
                    {LEVELS.map((l) => (
                        <button key={l.id} type='button' className={`seg__btn ${level === l.id ? 'seg__btn--on' : ''}`} onClick={() => setLevel(l.id)}>
                            {l.label}
                        </button>
                    ))}
                </div>
                <button
                    type='button'
                    className='btn btn--big'
                    onClick={() =>
                        run(
                            (async () => {
                                await emit('room:create')
                                await emit('room:fillBots', level)
                                await emit('room:start')
                            })()
                        )
                    }
                >
                    Sentar e jogar
                </button>
            </section>

            <section className='panel'>
                <h2>🍻 Com os amigos</h2>
                <p className='muted'>Crie uma sala e mande o código. Vaga sobrando vira robô.</p>
                <button type='button' className='btn btn--big' onClick={() => run(emit('room:create'))}>
                    Criar sala
                </button>
                <form
                    className='row'
                    onSubmit={(e) => {
                        e.preventDefault()
                        run(emit('room:join', code))
                    }}
                >
                    <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder='CÓDIGO' maxLength={5} className='code-input' />
                    <button type='submit' className='btn' disabled={code.length < 5}>
                        Entrar
                    </button>
                </form>
            </section>

            <section className='panel'>
                <h2>🏆 Fila valendo Elo</h2>
                {queue ? (
                    <>
                        <p>
                            Procurando parceiros… <strong>{waited}s</strong> ({queue.size} na fila)
                        </p>
                        <p className='muted'>{waited >= 50 ? 'Já já os robôs completam a mesa (aí não vale Elo).' : 'Com 4 humanos a partida vale Elo.'}</p>
                        <button type='button' className='btn btn--ghost' onClick={() => run(emit('queue:leave'))}>
                            Sair da fila
                        </button>
                    </>
                ) : (
                    <>
                        <p className='muted'>Se em 60s não juntar 4 pessoas, robôs completam e a partida não vale Elo.</p>
                        <button type='button' className='btn btn--big' onClick={() => run(emit('queue:join'))}>
                            Entrar na fila
                        </button>
                    </>
                )}
            </section>
        </div>
    )
}

function RoomLobby({ room, me, run, onLeave }: { room: RoomPayload; me: Me; run: (p: Promise<unknown>) => void; onLeave: () => void }) {
    const [level, setLevel] = useState('medio')
    const [copied, setCopied] = useState(false)
    const isHost = room.hostId === me.id
    const link = `${location.origin}/?sala=${room.code}`
    const full = room.seats.every((s) => s.kind !== 'empty')

    return (
        <div className='room-lobby'>
            <section className='panel'>
                <div className='room-code'>
                    <small>Código da sala</small>
                    <strong>{room.code}</strong>
                    <button
                        type='button'
                        className='btn btn--sm'
                        onClick={() => {
                            navigator.clipboard?.writeText(link).then(() => {
                                setCopied(true)
                                setTimeout(() => setCopied(false), 1500)
                            })
                        }}
                    >
                        {copied ? 'Copiado!' : 'Copiar convite'}
                    </button>
                </div>
                <div className='seats'>
                    {room.seats.map((s, i) => (
                        <div key={i} className={`seat seat--team${i % 2} ${room.mySeat === i ? 'seat--me' : ''}`}>
                            <small>
                                Lugar {i + 1} · Dupla {i % 2 === 0 ? 'A' : 'B'}
                            </small>
                            {s.kind === 'empty' ? (
                                <div className='seat__empty'>
                                    <span className='muted'>Vago</span>
                                    <button type='button' className='btn btn--sm btn--ghost' onClick={() => run(emit('room:seat', i))}>
                                        Sentar aqui
                                    </button>
                                    {isHost && (
                                        <button type='button' className='btn btn--sm' onClick={() => run(emit('room:addBot', { seat: i, level }))}>
                                            + Robô
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className='seat__who'>
                                    <span>
                                        {s.kind === 'bot' ? '🤖' : '🙂'} {s.name}
                                    </span>
                                    {s.kind === 'bot' && <small className='muted'>{LEVELS.find((l) => l.id === s.level)?.label}</small>}
                                    {s.kind === 'bot' && isHost && (
                                        <button type='button' className='btn btn--sm btn--ghost' onClick={() => run(emit('room:removeBot', i))}>
                                            Tirar
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <p className='muted'>Lugares 1 e 3 jogam juntos contra 2 e 4.</p>
                {isHost ? (
                    <div className='row row--wrap'>
                        <div className='seg'>
                            {LEVELS.map((l) => (
                                <button key={l.id} type='button' className={`seg__btn ${level === l.id ? 'seg__btn--on' : ''}`} onClick={() => setLevel(l.id)}>
                                    {l.label}
                                </button>
                            ))}
                        </div>
                        <button type='button' className='btn' onClick={() => run(emit('room:fillBots', level))} disabled={full}>
                            Completar com robôs
                        </button>
                        <button type='button' className='btn btn--big' onClick={() => run(emit('room:start'))} disabled={!full}>
                            Começar!
                        </button>
                    </div>
                ) : (
                    <p>Esperando o dono da sala começar…</p>
                )}
                <button type='button' className='btn btn--ghost' onClick={onLeave}>
                    Sair da sala
                </button>
            </section>
            <section className='panel'>
                <Chat room={room} />
            </section>
        </div>
    )
}

interface RankRow {
    id: number
    name: string
    avatar: string | null
    elo: number
    wins: number
    losses: number
}

function Ranking({ meId }: { meId: number }) {
    const [rows, setRows] = useState<RankRow[] | null>(null)
    useEffect(() => {
        api<RankRow[]>('/api/ranking').then(setRows)
    }, [])
    if (!rows) return <div className='panel'>Carregando…</div>
    return (
        <div className='panel'>
            <h2>Ranking (Elo)</h2>
            {rows.length === 0 && <p className='muted'>Ninguém jogou valendo Elo ainda. Entra na fila!</p>}
            <ol className='ranking'>
                {rows.map((r, i) => (
                    <li key={r.id} className={r.id === meId ? 'ranking--me' : ''}>
                        <span className='ranking__pos'>{i + 1}º</span>
                        <span className='ranking__name'>{r.name}</span>
                        <span className='ranking__elo'>{r.elo}</span>
                        <small className='muted'>
                            {r.wins}V {r.losses}D
                        </small>
                    </li>
                ))}
            </ol>
        </div>
    )
}

interface HistRow {
    id: number
    ranked: boolean
    score: [number, number]
    myTeam: number
    won: boolean
    walkover: boolean
    eloBefore: number | null
    eloAfter: number | null
    createdAt: string
    players: { seat: number; team: number; name: string; isBot: number }[]
}

function History() {
    const [rows, setRows] = useState<HistRow[] | null>(null)
    useEffect(() => {
        api<HistRow[]>('/api/history').then(setRows)
    }, [])
    if (!rows) return <div className='panel'>Carregando…</div>
    return (
        <div className='panel'>
            <h2>Suas partidas</h2>
            {rows.length === 0 && <p className='muted'>Nenhuma partida ainda.</p>}
            <ul className='history'>
                {rows.map((r) => {
                    const delta = r.ranked && r.eloAfter !== null && r.eloBefore !== null ? r.eloAfter - r.eloBefore : null
                    return (
                        <li key={r.id} className={r.won ? 'history--win' : 'history--loss'}>
                            <div>
                                <strong>{r.won ? 'Vitória' : 'Derrota'}</strong> {r.score[r.myTeam]} x {r.score[1 - r.myTeam]}
                                {r.walkover && <span className='tag'>W.O.</span>}
                                {r.ranked ? <span className='tag tag--elo'>Elo {delta !== null && (delta >= 0 ? `+${delta}` : delta)}</span> : <span className='tag'>amistosa</span>}
                            </div>
                            <small className='muted'>
                                Com {r.players.filter((p) => p.team === r.myTeam).map((p) => p.name).join(' & ')} contra{' '}
                                {r.players.filter((p) => p.team !== r.myTeam).map((p) => p.name).join(' & ')} ·{' '}
                                {new Date(r.createdAt.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}
                            </small>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

function Rules() {
    return (
        <div className='panel rules'>
            <h2>Regras do Truco Paulista</h2>
            <ul>
                <li>Duplas: lugares 1 e 3 contra 2 e 4. Baralho de 40 cartas (sem 8, 9 e 10).</li>
                <li>
                    Força: 4 &lt; 5 &lt; 6 &lt; 7 &lt; Q &lt; J &lt; K &lt; A &lt; 2 &lt; 3 &lt; <strong>manilhas</strong>.
                </li>
                <li>A manilha é a carta seguinte à vira. Entre manilhas: ♦ pica-fumo &lt; ♠ espadilha &lt; ♥ copas &lt; ♣ zap.</li>
                <li>Cada mão tem até 3 vazas; quem fizer 2 leva. Cartas iguais de duplas diferentes cangam (empatam).</li>
                <li>Empate na 1ª: quem ganhar a 2ª leva. Ganhou a 1ª e empatou a 2ª ou a 3ª: leva quem ganhou a 1ª.</li>
                <li>Truco (3) → seis (6) → nove (9) → doze (12). Pode aceitar, correr ou aumentar.</li>
                <li>Mão de 11: a dupla com 11 vê as cartas do parceiro e decide se joga (vale 3) ou corre (eles ganham 1). Sem truco.</li>
                <li>Mão de ferro: 11 a 11, todo mundo joga no escuro.</li>
                <li>A partir da 2ª vaza dá para jogar carta coberta (não vale nada).</li>
                <li>Sinais: só seu parceiro deveria ver… mas os adversários flagram 20% das vezes.</li>
                <li>Tempo: 30s por jogada. Caiu? A partida pausa até 2 min; depois é W.O.</li>
                <li>Quem fizer 12 pontos primeiro ganha.</li>
            </ul>
        </div>
    )
}
