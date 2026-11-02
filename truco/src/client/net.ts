import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import type { RoomPayload } from '../server/rooms'

export type { RoomPayload }

export interface Me {
    id: number
    name: string
    email: string
    avatar: string | null
    elo: number
    wins: number
    losses: number
    isAdmin?: boolean
}

export interface QueueInfo {
    waiting: boolean
    since?: number
    size?: number
    matched?: string
    ranked?: boolean
}

export interface SignalMsg {
    from: string
    seat: number
    kind: string
    label: string
    spotted: boolean
}

let socket: Socket | null = null

export function getSocket(): Socket {
    if (!socket) socket = io({ withCredentials: true, transports: ['websocket', 'polling'] })
    return socket
}

export function emit<T = unknown>(event: string, arg?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
        getSocket().emit(event, arg, (r: { ok: boolean; error?: string; data?: T }) =>
            r?.ok ? resolve(r.data as T) : reject(new Error(r?.error ?? 'Erro'))
        )
    })
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { credentials: 'include', ...init })
    if (!res.ok) throw new Error(String(res.status))
    return res.json()
}

export function useNow(intervalMs = 250): number {
    const [now, setNow] = useState(Date.now())
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(t)
    }, [intervalMs])
    return now
}
