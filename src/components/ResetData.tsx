import { useState } from 'react'
import { resetAllData } from '../sync/store'

// A guard against accidental resets, not real security: it ships with the page.
const ACCESS_CODE = '4904'

/** A small corner button that wipes all shared data after entering the access code. */
export default function ResetData() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [state, setState] = useState<'idle' | 'wrong' | 'working' | 'done' | 'failed'>('idle')

  const close = () => {
    setOpen(false)
    setCode('')
    setState('idle')
  }

  const reset = async () => {
    if (code !== ACCESS_CODE) {
      setState('wrong')
      return
    }
    setState('working')
    try {
      await resetAllData()
      setState('done')
    } catch (err) {
      console.error(err)
      setState('failed')
    }
  }

  return (
    <>
      <button type="button" className="reset-link" onClick={() => setOpen(true)}>
        Reset data
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => state !== 'working' && close()}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              if (state === 'done') close()
              else reset()
            }}
          >
            <h3>Reset all data</h3>
            {state === 'done' ? (
              <p>Everything has been cleared. Kick-Office is ready for a fresh kickoff.</p>
            ) : (
              <>
                <p className="muted">
                  Permanently deletes every question, ability, archetype, prototype, update and the shared manual, for everyone. This
                  can’t be undone.
                </p>
                <input
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    if (state === 'wrong') setState('idle')
                  }}
                  placeholder="Access code"
                  aria-label="Access code"
                />
                {state === 'wrong' && <p className="error-text">That access code isn’t right.</p>}
                {state === 'failed' && <p className="error-text">Couldn’t reset. Check your connection and try again.</p>}
              </>
            )}
            <div className="row end">
              {state !== 'done' && (
                <button type="button" onClick={close} disabled={state === 'working'}>
                  Cancel
                </button>
              )}
              {state === 'done' ? (
                <button className="primary">Done</button>
              ) : (
                <button className="primary danger-fill" disabled={!code || state === 'working'}>
                  {state === 'working' ? 'Resetting…' : 'Delete everything'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  )
}
