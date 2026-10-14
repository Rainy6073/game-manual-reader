import { useState } from 'react'
import { loadLastSession, type Session } from '../session'
import type { Role } from '../types'

const VIEWS: { role: Role; title: string; text: string }[] = [
  {
    role: 'presenter',
    title: 'Presenter',
    text: 'For the main screen everyone is watching. Collects everyone’s questions and runs the shared chart, archetype board and prototypes.',
  },
  {
    role: 'standard',
    title: 'Standard',
    text: 'For your own laptop or phone. Read the manual, send questions and ideas, follow along live, and report prototype results.',
  },
]

export default function Welcome({ onStart }: { onStart: (s: Session) => void }) {
  const [last] = useState(loadLastSession)
  const [name, setName] = useState(last?.name ?? '')
  const [role, setRole] = useState<Role>(last?.role ?? 'standard')
  const trimmed = name.trim()

  return (
    <div className="welcome">
      <form
        className="welcome-card"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onStart({ name: trimmed, role })
        }}
      >
        <div className="welcome-head">
          <span className="logo-mark big" aria-hidden>
            K
          </span>
          <div>
            <h1>Kick-Office</h1>
            <p className="muted">Game manual, effort/value, archetypes and prototypes, live on every screen.</p>
          </div>
        </div>

        <label className="field">
          <span>Your name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex" maxLength={40} />
          <small className="muted">Shown next to everything you submit. No account needed.</small>
        </label>

        <fieldset className="view-pick">
          <legend>Choose your view</legend>
          {VIEWS.map((v) => (
            <label key={v.role} className={`view-option${role === v.role ? ' selected' : ''}`}>
              <input type="radio" name="role" value={v.role} checked={role === v.role} onChange={() => setRole(v.role)} />
              <strong>{v.title}</strong>
              <span className="muted">{v.text}</span>
            </label>
          ))}
        </fieldset>

        <button className="primary big" disabled={!trimmed}>
          Start kickoff
        </button>
      </form>
    </div>
  )
}
