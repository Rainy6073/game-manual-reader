import { useEffect, useState } from 'react'

const CHECK_EVERY = 60_000

/** Offers to reload when a newer version of the site has been deployed. */
export default function UpdatePrompt() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return
    let stopped = false
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const { id } = (await res.json()) as { id?: string }
        if (!stopped && id && id !== __BUILD_ID__) setAvailable(true)
      } catch {
        // Offline or blocked; try again later.
      }
    }
    check()
    const timer = setInterval(check, CHECK_EVERY)
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!available) return null
  return (
    <div className="update-prompt" role="status">
      <span>A new version of Kick-Office is available.</span>
      <button className="primary" onClick={() => window.location.reload()}>
        Update now
      </button>
      <button className="icon ghost" onClick={() => setAvailable(false)} aria-label="Later" title="Later">
        ✕
      </button>
    </div>
  )
}
