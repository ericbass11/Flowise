import type { Card as CardT } from '../engine/cards'
import { SUIT_SYMBOL } from '../engine/cards'

interface Props {
    card: CardT | null
    covered?: boolean
    manilha?: boolean
    small?: boolean
    onClick?: () => void
    disabled?: boolean
    selected?: boolean
    title?: string
}

const RED = new Set(['H', 'D'])

/** Carta desenhada em CSS/SVG (sem imagens externas). `card = null` mostra o verso. */
export function Card({ card, covered, manilha, small, onClick, disabled, selected, title }: Props) {
    const cls = ['card', small && 'card--small', onClick && !disabled && 'card--playable', selected && 'card--selected', manilha && 'card--manilha']
        .filter(Boolean)
        .join(' ')
    if (!card || covered) {
        return (
            <button type='button' className={`${cls} card--back`} onClick={onClick} disabled={disabled || !onClick} title={title ?? 'Carta virada'}>
                <span className='card__back-pattern' aria-hidden />
                {covered && card && <span className='card__peek'>{card.rank + SUIT_SYMBOL[card.suit]}</span>}
            </button>
        )
    }
    const sym = SUIT_SYMBOL[card.suit]
    return (
        <button
            type='button'
            className={`${cls} ${RED.has(card.suit) ? 'card--red' : 'card--black'}`}
            onClick={onClick}
            disabled={disabled || !onClick}
            title={title ?? `${card.rank}${sym}`}
            aria-label={`${card.rank} de ${sym}`}
        >
            <span className='card__corner'>
                {card.rank}
                <br />
                {sym}
            </span>
            <span className='card__center'>{sym}</span>
            <span className='card__corner card__corner--br'>
                {card.rank}
                <br />
                {sym}
            </span>
            {manilha && <span className='card__badge'>manilha</span>}
        </button>
    )
}
