import { useState } from 'react'
import ResetData from '../components/ResetData'
import { loadLastSession, type Session } from '../session'
import type { Role } from '../types'

/**
 * The start screen. Most people join on their own laptop or phone, so the standard
 * view is front and centre; the presenter view sits in a small corner switch.
 */
export default function Welcome({ onStart }: { onStart: (s: Session) => void }) {
  const [last] = useState(loadLastSession)
  const [name, setName] = useState(last?.name ?? '')
  const [role, setRole] = useState<Role>('standard')
  const trimmed = name.trim()
  const presenting = role === 'presenter'

  return (
    <div className="welcome">
      <button
        type="button"
        className={`presenter-switch${presenting ? ' on' : ''}`}
        aria-pressed={presenting}
        onClick={() => setRole(presenting ? 'standard' : 'presenter')}
        title="For the main screen everyone is watching"
      >
        {presenting ? '← Back to standard view' : '🖥 Presenter view'}
      </button>

      <form
        className={`welcome-card${presenting ? ' presenting' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onStart({ name: trimmed, role })
        }}
      >
        <div className="welcome-head">
          <span className="logo-mark big" aria-hidden>
            k.o.
          </span>
          <div>
            <h1>Kick-Office</h1>
            <p className="muted">Game manual, effort/value, archetypes and prototypes, live on every screen.</p>
          </div>
        </div>

        {presenting ? (
          <div className="view-blurb presenter">
            <strong>Presenter view</strong>
            <span className="muted">
              For the main screen everyone is watching. Collects everyone’s questions and runs the shared chart, archetype board and prototypes.
            </span>
          </div>
        ) : (
          <p className="view-blurb">
            Read the manual, ask questions, follow along live on your own laptop or phone, and report prototype results.
          </p>
        )}

        <label className="field">
          <span>Your name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex" maxLength={40} />
          <small className="muted">Shown next to everything you submit. No account needed.</small>
        </label>

        <button className="primary big" disabled={!trimmed}>
          {presenting ? 'Start presenting' : 'Join kickoff'}
        </button>
      </form>
      <ResetData />
    </div>
  )
}
