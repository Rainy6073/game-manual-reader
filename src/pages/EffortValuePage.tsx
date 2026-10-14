import { useMemo, useState } from 'react'
import FibInput from '../components/FibInput'
import ScatterChart from '../components/ScatterChart'
import { FIB } from '../fib'
import { useIsPresenter } from '../session'
import { patch, put, remove, useCollection } from '../sync/store'
import { newId } from '../types'

export default function EffortValuePage() {
  const presenter = useIsPresenter()
  const abilities = useCollection('abilities')
  const [name, setName] = useState('')
  const [highlight, setHighlight] = useState<string | null>(null)
  const sorted = useMemo(() => [...abilities].sort((a, b) => a.createdAt - b.createdAt), [abilities])
  const unplotted = sorted.filter((a) => a.effort == null || a.value == null)

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    put('abilities', { id: newId(), name: trimmed, effort: null, value: null, createdAt: Date.now() })
    setName('')
  }

  return (
    <div className="ev-page">
      <section className="ev-list">
        <header className="section-head">
          <h2>Robot abilities</h2>
          <span className="muted">{sorted.length} total</span>
        </header>
        <p className="muted small">
          Rate effort and value on the Fibonacci scale ({FIB.slice(0, 7).join(', ')}…).
          {!presenter && ' The presenter edits this list; it updates here live.'}
        </p>

        {presenter && (
          <form
            className="add-row"
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Climb L2 tower" aria-label="New ability" />
            <button className="primary" disabled={!name.trim()}>
              Add
            </button>
          </form>
        )}

        <div className="ability-table" role="table">
          <div className="ability-row head" role="row">
            <span role="columnheader">Ability</span>
            <span role="columnheader">Effort</span>
            <span role="columnheader">Value</span>
            {presenter && <span />}
          </div>
          {sorted.length === 0 && (
            <p className="empty muted">
              {presenter ? 'Add everything a robot could do this season.' : 'No abilities yet.'}
            </p>
          )}
          {sorted.map((a) => (
            <div
              key={a.id}
              role="row"
              className={`ability-row${highlight === a.id ? ' hot' : ''}`}
              onPointerEnter={() => setHighlight(a.id)}
              onPointerLeave={() => setHighlight(null)}
            >
              {presenter ? (
                <>
                  <input
                    className="ability-name"
                    defaultValue={a.name}
                    key={a.name}
                    aria-label="Ability name"
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v && v !== a.name) patch('abilities', a.id, { name: v })
                      else e.target.value = a.name
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                  <FibInput label="Effort" value={a.effort} onChange={(effort) => patch('abilities', a.id, { effort })} />
                  <FibInput label="Value" value={a.value} onChange={(value) => patch('abilities', a.id, { value })} />
                  <button
                    className="icon ghost"
                    aria-label={`Delete ${a.name}`}
                    onClick={() => confirm(`Delete “${a.name}”? It will also be removed from archetypes.`) && remove('abilities', a.id)}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span className="ability-name" role="cell">
                    {a.name}
                  </span>
                  <span className="score" role="cell">
                    {a.effort ?? '–'}
                  </span>
                  <span className="score" role="cell">
                    {a.value ?? '–'}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="ev-chart">
        <ScatterChart abilities={sorted} highlight={highlight} onHighlight={setHighlight} />
        {unplotted.length > 0 && (
          <p className="muted small unplotted">
            Not plotted yet (needs both ratings): {unplotted.map((a) => a.name).join(', ')}
          </p>
        )}
      </section>
    </div>
  )
}
