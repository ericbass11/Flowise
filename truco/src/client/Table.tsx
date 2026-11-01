import { useEffect, useMemo, useRef, useState } from 'react'
import type { Action, PublicPlay } from '../engine/game'
import { RAISE_NAME, RAISE_STEPS } from '../engine/game'
import { MANILHA_NAME, SUIT_SYMBOL } from '../engine/cards'
import { Card } from './Card'
import { RoomPayload, SignalMsg, emit, getSocket, useNow } from './net'

const SIGNALS: { kind: string; label: string; emoji: string }[] = [
    { kind: 'zap', label: 'Zap', emoji: '😉' },
    { kind: 'copas', label: 'Copas', emoji: '😜' },
    { kind: 'espadilha', label: 'Espadilha', emoji: '🤨' },
    { kind: 'picafumo', label: 'Pica-fumo', emoji: '😗' },
    { kind: 'tres', label: 'Três', emoji: '🫦' },
    { kind: 'nada', label: 'Nada', emoji: '😒' }
]

type Pos = 'bottom' | 'right' | 'top' | 'left'
const POS: Pos[] = ['bottom', 'right', 'top', 'left']

export function Table({ room, onLeave }: { room: RoomPayload; onLeave: () => void }) {
    const v = room.view!
    const me = v.seat
    const myTeam = me % 2
    const now = useNow()
    const [cover, setCover] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [toast, setToast] = useState<SignalMsg | null>(null)
    const [chatOpen, setChatOpen] = useState(false)
    const [unread, setUnread] = useState(0)
    const lastChat = useRef(room.chat.length ? room.chat[room.chat.length - 1].id : 0)

    useEffect(() => {
        const s = getSocket()
        const h = (m: SignalMsg) => {
            setToast(m)
            setTimeout(() => setToast((t) => (t === m ? null : t)), 4000)
        }
        s.on('signal', h)
        return () => {
            s.off('signal', h)
        }
    }, [])

    useEffect(() => {
        const last = room.chat[room.chat.length - 1]
        if (last && last.id !== lastChat.current) {
            if (!chatOpen) setUnread((u) => u + room.chat.filter((c) => c.id > lastChat.current).length)
            lastChat.current = last.id
        }
    }, [room.chat, chatOpen])

    const act = (a: Action) => {
        setError(null)
        emit('game:action', a).catch((e) => setError(e.message))
        setCover(false)
    }

    const legal = v.legal
    const can = (t: Action['type']) => legal.some((a) => a.type === t)
    const canCover = legal.some((a) => a.type === 'play' && a.covered)
    const myTurnToPlay = legal.some((a) => a.type === 'play')
    const seatAt = (pos: Pos) => (me + POS.indexOf(pos)) % 4
    const nameOf = (seat: number) => {
        const s = room.seats[seat]
        return s.kind === 'empty' ? '—' : s.name
    }
    const raiseTo = v.pending ? RAISE_STEPS[v.pending.to] : RAISE_STEPS[v.value]
    const playsBySeat = useMemo(() => {
        const m = new Map<number, PublicPlay>()
        v.current.forEach((p) => m.set(p.seat, p))
        return m
    }, [v.current])

    const timeLeft = room.turnDeadline ? Math.min(30, Math.max(0, Math.ceil((room.turnDeadline - now) / 1000))) : null
    const pauseLeft = room.pauseDeadline ? Math.max(0, Math.ceil((room.pauseDeadline - now) / 1000)) : null
    const actingSeats =
        v.phase === 'mao11' ? [0, 1, 2, 3].filter((s) => s % 2 === v.mao11Team) : v.pending ? [0, 1, 2, 3].filter((s) => s % 2 !== v.pending!.byTeam) : [v.turn]
    const isPartnerSeat = (s: number) => s === (me + 2) % 4

    const trickDots = [0, 1, 2].map((i) => {
        const t = v.tricks[i]
        if (!t) return 'pending'
        return t.result === 'tie' ? 'tie' : t.result === myTeam ? 'win' : 'lose'
    })

    return (
        <div className='game'>
            <header className='scorebar'>
                <div className={`score score--us ${v.scores[myTeam] >= 11 ? 'score--hot' : ''}`}>
                    <span className='score__label'>Nós</span>
                    <span className='score__value'>{v.scores[myTeam]}</span>
                </div>
                <div className='scorebar__mid'>
                    <div className='hand-value'>
                        Mão vale <strong>{v.value}</strong>
                        {v.iron && <span className='tag tag--iron'>ferro</span>}
                        {v.mao11Team !== null && <span className='tag'>mão de 11</span>}
                        {room.ranked && <span className='tag tag--elo'>Elo</span>}
                    </div>
                    <div className='tricks' aria-label='Vazas'>
                        {trickDots.map((d, i) => (
                            <span key={i} className={`trick-dot trick-dot--${d}`} title={d} />
                        ))}
                    </div>
                </div>
                <div className={`score score--them ${v.scores[1 - myTeam] >= 11 ? 'score--hot' : ''}`}>
                    <span className='score__label'>Eles</span>
                    <span className='score__value'>{v.scores[1 - myTeam]}</span>
                </div>
            </header>

            <div className='table-wrap'>
                <div className='table'>
                    {(['top', 'left', 'right'] as Pos[]).map((pos) => {
                        const seat = seatAt(pos)
                        const info = room.seats[seat]
                        return (
                            <div key={pos} className={`player player--${pos} ${actingSeats.includes(seat) && room.status === 'playing' ? 'player--acting' : ''}`}>
                                <div className={`avatar ${seat % 2 === myTeam ? 'avatar--us' : 'avatar--them'}`}>
                                    {info.kind === 'human' && info.avatar ? <img src={info.avatar} alt='' /> : info.kind === 'bot' ? '🤖' : '🙂'}
                                    {info.kind === 'human' && !info.connected && <span className='avatar__off'>📵</span>}
                                </div>
                                <div className='player__name'>
                                    {nameOf(seat)}
                                    {isPartnerSeat(seat) && <span className='player__tag'>parceiro</span>}
                                    {v.pe === seat && <span className='player__tag player__tag--pe'>pé</span>}
                                </div>
                                <div className='player__hand'>
                                    {Array.from({ length: v.handCounts[seat] }).map((_, i) => (
                                        <span key={i} className='mini-back' />
                                    ))}
                                </div>
                            </div>
                        )
                    })}

                    <div className='center'>
                        <div className='vira'>
                            <Card card={v.vira} small />
                            <div className='vira__label'>
                                vira · manilha <strong>{v.manilha}</strong>
                            </div>
                        </div>
                        {POS.map((pos) => {
                            const p = playsBySeat.get(seatAt(pos))
                            return (
                                <div key={pos} className={`slot slot--${pos}`}>
                                    {p && <Card card={p.card} covered={p.covered} manilha={!!p.card && !p.covered && p.card.rank === v.manilha} small />}
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

            <div className='log'>{room.log.slice(-2).map((l, i) => <div key={i + l}>{l}</div>)}</div>

            {v.pending && (
                <div className={`callout ${v.pending.byTeam === myTeam ? 'callout--ours' : 'callout--theirs'}`}>
                    {nameOf(v.pending.bySeat)} pediu <strong>{RAISE_NAME[v.pending.to].toUpperCase()}!</strong>
                    {v.pending.byTeam === myTeam && ' Aguardando resposta…'}
                </div>
            )}

            <div className='me'>
                <div className='me__hand'>
                    {v.hand.map((c, i) => (
                        <Card
                            key={c ? c.rank + c.suit : `h${i}`}
                            card={c}
                            manilha={!!c && c.rank === v.manilha}
                            onClick={myTurnToPlay ? () => act({ type: 'play', index: i, covered: cover }) : undefined}
                            selected={cover}
                            title={c ? `${c.rank}${SUIT_SYMBOL[c.suit]}${c.rank === v.manilha ? ` — manilha (${MANILHA_NAME[c.suit]})` : ''}` : 'Mão de ferro: jogue no escuro'}
                        />
                    ))}
                </div>

                <div className='actions'>
                    {timeLeft !== null && actingSeats.includes(me) && (
                        <div className={`timer ${timeLeft <= 10 ? 'timer--low' : ''}`}>⏱ {timeLeft}s</div>
                    )}
                    {canCover && (
                        <button type='button' className={`btn btn--ghost ${cover ? 'btn--on' : ''}`} onClick={() => setCover((x) => !x)}>
                            {cover ? '🙈 Cobrindo' : '🂠 Cobrir carta'}
                        </button>
                    )}
                    {v.pending && can('accept') && (
                        <>
                            <button type='button' className='btn btn--ok' onClick={() => act({ type: 'accept' })}>
                                Desce! (aceitar)
                            </button>
                            <button type='button' className='btn btn--danger' onClick={() => act({ type: 'run' })}>
                                Correr
                            </button>
                        </>
                    )}
                    {can('raise') && raiseTo && (
                        <button type='button' className='btn btn--truco' onClick={() => act({ type: 'raise' })}>
                            {RAISE_NAME[raiseTo].toUpperCase()}!
                        </button>
                    )}
                </div>
            </div>

            <div className='signals'>
                {SIGNALS.map((s) => (
                    <button
                        key={s.kind}
                        type='button'
                        className='signal'
                        title={`Sinal: ${s.label}`}
                        onClick={() => emit('signal:send', s.kind).catch((e) => setError(e.message))}
                        disabled={room.status !== 'playing'}
                    >
                        <span>{s.emoji}</span>
                        <small>{s.label}</small>
                    </button>
                ))}
                <button
                    type='button'
                    className='signal signal--chat'
                    onClick={() => {
                        setChatOpen(true)
                        setUnread(0)
                    }}
                >
                    <span>💬</span>
                    <small>Chat{unread ? ` (${unread})` : ''}</small>
                </button>
            </div>

            {error && (
                <div className='error' onClick={() => setError(null)}>
                    {error}
                </div>
            )}
            {toast && (
                <div className={`toast ${toast.spotted ? 'toast--spotted' : ''}`}>
                    {toast.spotted ? `👀 Você flagrou ${toast.from} piscando: “${toast.label}”` : `${toast.from} te piscou: “${toast.label}”`}
                </div>
            )}

            {v.phase === 'mao11' && v.mao11Team === myTeam && (
                <div className='modal'>
                    <div className='modal__box'>
                        <h2>Mão de 11!</h2>
                        <p>Olha as cartas do parceiro e decide: jogar vale 3; correr dá 1 ponto pra eles.</p>
                        <div className='mao11'>
                            <div>
                                <small>Suas</small>
                                <div className='row'>
                                    {v.hand.map((c, i) => (
                                        <Card key={i} card={c} small manilha={!!c && c.rank === v.manilha} />
                                    ))}
                                </div>
                            </div>
                            <div>
                                <small>Parceiro</small>
                                <div className='row'>
                                    {(v.partnerHand ?? []).map((c, i) => (
                                        <Card key={i} card={c} small manilha={c.rank === v.manilha} />
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className='row row--center'>
                            <button type='button' className='btn btn--ok' onClick={() => act({ type: 'mao11', play: true })}>
                                Bora jogar
                            </button>
                            <button type='button' className='btn btn--danger' onClick={() => act({ type: 'mao11', play: false })}>
                                Correr
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {room.status === 'paused' && (
                <div className='modal'>
                    <div className='modal__box'>
                        <h2>Partida pausada</h2>
                        <p>
                            {room.pausedBy} caiu. Esperando reconexão… <strong>{pauseLeft}s</strong>
                        </p>
                        <p className='muted'>Se não voltar, é W.O.</p>
                    </div>
                </div>
            )}

            {room.status === 'finished' && room.result && (
                <div className='modal'>
                    <div className='modal__box'>
                        <h2>{room.result.winner === myTeam ? '🍺 Vitória!' : '😵 Derrota!'}</h2>
                        <p className='bigscore'>
                            {room.result.scores[myTeam]} x {room.result.scores[1 - myTeam]}
                        </p>
                        {room.result.walkover && <p>Vitória por W.O.</p>}
                        <p className='muted'>{room.ranked ? 'Partida valeu Elo.' : 'Partida amistosa (sem Elo).'}</p>
                        <button type='button' className='btn btn--ok' onClick={onLeave}>
                            Voltar pro balcão
                        </button>
                    </div>
                </div>
            )}

            {chatOpen && <Chat room={room} onClose={() => setChatOpen(false)} />}
        </div>
    )
}

export function Chat({ room, onClose }: { room: RoomPayload; onClose?: () => void }) {
    const [text, setText] = useState('')
    const listRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    }, [room.chat.length])
    return (
        <div className={onClose ? 'chat chat--drawer' : 'chat'}>
            {onClose && (
                <div className='chat__head'>
                    <strong>Papo de boteco</strong>
                    <button type='button' className='btn btn--ghost' onClick={onClose}>
                        ✕
                    </button>
                </div>
            )}
            <div className='chat__list' ref={listRef}>
                {room.chat.map((m) => (
                    <div key={m.id} className={`msg ${m.system ? 'msg--system' : ''} ${m.bot ? 'msg--bot' : ''}`}>
                        {!m.system && <strong>{m.name}: </strong>}
                        {m.text}
                    </div>
                ))}
            </div>
            <form
                className='chat__form'
                onSubmit={(e) => {
                    e.preventDefault()
                    if (!text.trim()) return
                    emit('chat:send', text).catch(() => {})
                    setText('')
                }}
            >
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder='Manda um recado…' />
                <button type='submit' className='btn'>
                    Enviar
                </button>
            </form>
        </div>
    )
}
