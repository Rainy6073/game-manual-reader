import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import { useIsPresenter, useLocalState } from '../session'
import { put, useCollection, useDoc } from '../sync/store'
import type { Ability, Priorities, PriorityTier } from '../types'

const TIERS: { id: PriorityTier; label: string; hint: string }[] = [
  { id: 'needs', label: 'Needs', hint: 'The robot must do these.' },
  { id: 'wants', label: 'Wants', hint: 'Worth doing if we can.' },
  { id: 'nice', label: 'Nice to Haves', hint: 'Only if there’s time.' },
]

const empty = (id: string): Priorities => ({ id, needs: [], wants: [], nice: [] })

/** Where a card can be dropped: a tier (optionally before a card in it), or back to the unsorted list. */
type Target = { tier: PriorityTier | 'unsorted'; before?: string }

/**
 * Sort the season's robot abilities into Needs, Wants and Nice to Haves. Unlike
 * Archetypes, each ability sits in exactly one place: dragging moves it.
 */
export default function NwhPage() {
  const presenter = useIsPresenter()
  const abilities = useCollection('abilities')
  const master = useDoc('priorities', 'master')
  const [mine, setMine] = useLocalState<Priorities>('kickoff.myPriorities', empty('mine'))
  const [view, setView] = useLocalState<'master' | 'mine'>('kickoff.nwhView', 'master')
  const showingMine = !presenter && view === 'mine'
  const editable = presenter || showingMine
  const board = showingMine ? mine : (master ?? empty('master'))
  const save = (p: Priorities) => (showingMine ? setMine(p) : put('priorities', p))

  const byId = useMemo(() => new Map(abilities.map((a) => [a.id, a])), [abilities])
  const sorted = useMemo(() => [...abilities].sort((a, b) => a.createdAt - b.createdAt), [abilities])
  // Abilities deleted on the Effort / Value page simply drop out.
  const tierIds = (t: PriorityTier) => board[t].filter((id) => byId.has(id))
  const placed = new Set(TIERS.flatMap((t) => tierIds(t.id)))
  const unsorted = sorted.filter((a) => !placed.has(a.id))

  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  const move = (abilityId: string, target: Target) => {
    const next: Priorities = { ...board, needs: [...board.needs], wants: [...board.wants], nice: [...board.nice] }
    for (const t of TIERS) next[t.id] = next[t.id].filter((id) => id !== abilityId)
    if (target.tier !== 'unsorted') {
      const list = next[target.tier]
      const at = target.before ? list.indexOf(target.before) : -1
      list.splice(at === -1 ? list.length : at, 0, abilityId)
    }
    save(next)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    if (!over) return
    const target = over.data.current as Target
    if (target.before === active.id) return
    move(String(active.id), target)
  }

  const copyMaster = () => {
    if ((mine.needs.length || mine.wants.length || mine.nice.length) && !confirm('Replace your board with a copy of the master board?')) return
    setMine({ ...(master ?? empty('mine')), id: 'mine' })
  }

  const dragged = dragging ? byId.get(dragging) : undefined

  return (
    <div className="nwh-page">
      <header className="arch-toolbar">
        <div>
          <h2>Needs, Wants &amp; Nice to Haves</h2>
          <p className="muted small">
            {editable
              ? 'Drag each ability into one column. Dragging moves it; drag it back to the list to unsort it.'
              : 'The master board, updated live by the presenter.'}
          </p>
        </div>
        <div className="row">
          {!presenter && (
            <div className="segmented" role="radiogroup" aria-label="Board">
              <button role="radio" aria-checked={view === 'master'} onClick={() => setView('master')}>
                Master board
              </button>
              <button role="radio" aria-checked={view === 'mine'} onClick={() => setView('mine')}>
                My board
              </button>
            </div>
          )}
          {showingMine && <button onClick={copyMaster}>Copy master</button>}
        </div>
      </header>

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="arch-body">
          {editable && (
            <Zone target={{ tier: 'unsorted' }} className="palette">
              <h3>
                Unsorted <span className="count-pill">{unsorted.length}</span>
              </h3>
              {abilities.length === 0 && <p className="muted small">Add abilities on the Effort / Value page first.</p>}
              {abilities.length > 0 && unsorted.length === 0 && <p className="muted small">Everything is sorted.</p>}
              {unsorted.map((a) => (
                <Card key={a.id} ability={a} editable />
              ))}
            </Zone>
          )}
          <div className="columns nwh-columns">
            {TIERS.map((t) => {
              const ids = tierIds(t.id)
              const items = ids.map((id) => byId.get(id)!)
              return (
                <Zone key={t.id} target={{ tier: t.id }} className={`column nwh-column tier-${t.id}`}>
                  <header className="column-head">
                    <h3>{t.label}</h3>
                    <span className="count-pill">{items.length}</span>
                  </header>
                  <div className="column-totals muted small">
                    <span>{t.hint}</span>
                  </div>
                  <div className="column-totals muted small">
                    <span>
                      Effort <strong>{items.reduce((s, a) => s + (a.effort ?? 0), 0)}</strong>
                    </span>
                    <span>
                      Value <strong>{items.reduce((s, a) => s + (a.value ?? 0), 0)}</strong>
                    </span>
                  </div>
                  <div className="column-cards">
                    {items.map((a) => (
                      <Card key={a.id} ability={a} editable={editable} tier={t.id} onRemove={editable ? () => move(a.id, { tier: 'unsorted' }) : undefined} />
                    ))}
                    {items.length === 0 && <p className="drop-hint muted small">{editable ? 'Drop abilities here' : 'Empty'}</p>}
                  </div>
                  {editable && unsorted.length > 0 && (
                    <select
                      className="add-select"
                      value=""
                      aria-label={`Add an ability to ${t.label}`}
                      onChange={(e) => e.target.value && move(e.target.value, { tier: t.id })}
                    >
                      <option value="">+ Add ability…</option>
                      {unsorted.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Zone>
              )
            })}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{dragged && <CardFace ability={dragged} lifted />}</DragOverlay>
      </DndContext>
    </div>
  )
}

function Zone({ target, className, children }: { target: Target; className: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${target.tier}`, data: target })
  return (
    <section ref={setNodeRef} className={`${className}${isOver ? ' over' : ''}`}>
      {children}
    </section>
  )
}

function Card({ ability, editable, tier, onRemove }: { ability: Ability; editable: boolean; tier?: PriorityTier; onRemove?: () => void }) {
  const drag = useDraggable({ id: ability.id, disabled: !editable })
  // Cards in a column are also drop targets, so dropping on one inserts before it.
  const drop = useDroppable({ id: `before:${ability.id}`, data: { tier: tier ?? 'unsorted', before: tier ? ability.id : undefined }, disabled: !editable || !tier })
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      {...drag.listeners}
      {...drag.attributes}
      className={`drag-src${drag.isDragging ? ' ghost' : ''}${drop.isOver && !drag.isDragging ? ' insert' : ''}${editable ? '' : ' static'}`}
    >
      <CardFace ability={ability} onRemove={onRemove} />
    </div>
  )
}

function CardFace({ ability, lifted, onRemove }: { ability: Ability; lifted?: boolean; onRemove?: () => void }) {
  return (
    <div className={`card${lifted ? ' lifted' : ''}`}>
      <span className="card-name">{ability.name}</span>
      <span className="ev-badges">
        <span title="Effort">E {ability.effort ?? '–'}</span>
        <span title="Value">V {ability.value ?? '–'}</span>
      </span>
      {onRemove && (
        <button className="card-remove" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} aria-label={`Move ${ability.name} back to unsorted`}>
          ✕
        </button>
      )}
    </div>
  )
}
