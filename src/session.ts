import { createContext, useContext, useEffect, useState } from 'react'
import type { Role } from './types'

export interface Session {
  name: string
  role: Role
}

const KEY = 'kickoff.session'
/** The last name and view used on this device, to pre-fill the start screen. */
const LAST_KEY = 'kickoff.lastSession'

function load(key = KEY): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as Session | null
    return s?.name && (s.role === 'presenter' || s.role === 'standard') ? s : null
  } catch {
    return null
  }
}

export const loadLastSession = () => load(LAST_KEY) ?? load()

/** Who is using this device and which view they picked, remembered per device. */
export function useStoredSession() {
  const [session, setSession] = useState<Session | null>(load)
  useEffect(() => {
    try {
      if (session) {
        localStorage.setItem(KEY, JSON.stringify(session))
        localStorage.setItem(LAST_KEY, JSON.stringify(session))
      } else {
        localStorage.removeItem(KEY)
      }
    } catch {
      // Storage unavailable; the session lasts until the page is closed.
    }
  }, [session])
  return [session, setSession] as const
}

export const SessionContext = createContext<Session>({ name: '', role: 'standard' })

export const useSession = () => useContext(SessionContext)
export const useIsPresenter = () => useSession().role === 'presenter'

/** Per-device state that is never shared (e.g. someone's own archetype board). */
export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved == null ? initial : (JSON.parse(saved) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Ignore.
    }
  }, [key, value])
  return [value, setValue] as const
}
