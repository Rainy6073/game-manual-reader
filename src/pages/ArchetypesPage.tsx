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
import { put, remove, useCollection } from '../sync/store'
import { newId, type Ability, type Archetype } from '../types'
import ConfirmButton from '../components/ConfirmButton'

/** Where archetypes are read from and saved to: the shared board or this device's own. */
interface Board {
  archetypes: Archetype[]
  editable: boolean
  save: (a: Archetype) => void
  remove: (id: string) => void
}

type DragData = { type: 'palette'; abilityId: string } | { type: 'card'; archetypeId: string; key: string; abilityId: string }

export default function ArchetypesPage() {
  const presenter = useIsPresenter()
  const abilities = useCollection('abilities')
  const master = useCollection('archetypes')
  const [mine, setMine] = useLocalState<Archetype[]>('kickoff.myArchetypes', [])
  const [view, setView] = useLocalState<'master' | 'mine'>('kickoff.archetypeView', 'master')
  const showingMine = !presenter && view === 'mine'

  const board: Board = showingMine
    ? {
        archetypes: mine,
        editable: true,
        save: (a) => setMine((list) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a])),
        remove: (id) => setMine((list) => list.filter((x) => x.id !== id)),
      }
    : {
        archetypes: master,
        editable: presenter,
        save: (a) => put('archetypes', a),
        remove: (id) => remove('archetypes', id),
      }

  const byId = useMemo(() => new Map(abilities.map((a) => [a.id, a])), [abilities])
  const sortedAbilities = useMemo(() => [...abilities].sort((a, b) => a.createdAt - b.createdAt), [abilities])
  const columns = useMemo(() => [...board.archetypes].sort((a, b) => a.createdAt - b.createdAt), [board.archetypes])

  const [dragging, setDragging] = useState<DragData | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  const findArch = (id: string) => board.archetypes.find((a) => a.id === id)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    const data = active.data.current as DragData | undefined
    if (!data || !over) return
    const target = over.data.current as { type: 'column'; archetypeId: string } | { type: 'slot'; archetypeId: string; key: string } | { type: 'palette' }

    // Dropping a card back on the list removes it from its archetype.
    if (target.type === 'palette') {
      if (data.type === 'card') {
        const from = findArch(data.archetypeId)
        if (from) board.save({ ...from, items: from.items.filter((i) => i.key !== data.key) })
      }
      return
    }

    const card = data.type === 'card' ? { key: data.key, abilityId: data.abilityId } : { key: newId(), abilityId: data.abilityId }
    const updates = new Map<string, Archetype>()
    if (data.type === 'card') {
      const from = findArch(data.archetypeId)
      if (from) updates.set(from.id, { ...from, items: from.items.filter((i) => i.key !== data.key) })
    }
    const to = updates.get(target.archetypeId) ?? findArch(target.archetypeId)
    if (!to) return
    const items = [...to.items]
    const at = target.type === 'slot' ? items.findIndex((i) => i.key === target.key) : -1
    items.splice(at === -1 ? items.length : at, 0, card)
    updates.set(to.id, { ...to, items })
    for (const a of updates.values()) board.save(a)
  }

  const addArchetype = () =>
    board.save({ id: newId(), name: `Archetype ${board.archetypes.length + 1}`, items: [], createdAt: Date.now() })

  // Replaces your board, so it asks for a second click when there is something on it.
  const copyMaster = () => {
    setMine(master.map((a) => ({ ...a, id: newId(), items: a.items.map((i) => ({ ...i, key: newId() })) })))
  }

  const dragAbility = dragging ? byId.get(dragging.abilityId) : undefined

  return (
    <div className="arch-page">
      <header className="arch-toolbar">
        <div>
          <h2>Robot archetypes</h2>
          <p className="muted small">
            {board.editable
              ? 'Drag abilities onto an archetype. Each ability can be used on as many robots as you like. Drag a card back to the list to remove it.'
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
          {showingMine && (
            <ConfirmButton onConfirm={copyMaster} needsConfirm={mine.length > 0} confirmLabel="Replace your board?">
              Copy master
            </ConfirmButton>
          )}
          {board.editable && (
            <button className="primary" onClick={addArchetype}>
              + Archetype
            </button>
          )}
        </div>
      </header>

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => setDragging(e.active.data.current as DragData)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="arch-body">
          {board.editable && <Palette abilities={sortedAbilities} editable />}
          <div className="columns">
            {columns.map((a) => (
              <Column key={a.id} archetype={a} byId={byId} abilities={sortedAbilities} board={board} />
            ))}
            {columns.length === 0 && (
              <div className="empty-board muted">
                {board.editable ? 'Create an archetype to start combining abilities.' : 'No archetypes yet.'}
              </div>
            )}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{dragAbility && <CardFace ability={dragAbility} lifted />}</DragOverlay>
      </DndContext>
    </div>
  )
}

function Palette({ abilities, editable }: { abilities: Ability[]; editable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'palette', data: { type: 'palette' }, disabled: !editable })
  return (
    <aside ref={setNodeRef} className={`palette${isOver ? ' over' : ''}`}>
      <h3>Abilities</h3>
      {abilities.length === 0 && <p className="muted small">Add abilities on the Effort / Value page first.</p>}
      {abilities.map((a) => (
        <PaletteItem key={a.id} ability={a} editable={editable} />
      ))}
    </aside>
  )
}

function PaletteItem({ ability, editable }: { ability: Ability; editable: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `pal:${ability.id}`,
    data: { type: 'palette', abilityId: ability.id },
    disabled: !editable,
  })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`drag-src${isDragging ? ' ghost' : ''}${editable ? '' : ' static'}`}>
      <CardFace ability={ability} />
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
        <button
          className="card-remove"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`Remove ${ability.name}`}
        >
          ✕
        </button>
      )}
    </div>
  )
}

interface ColumnProps {
  archetype: Archetype
  byId: Map<string, Ability>
  abilities: Ability[]
  board: Board
}

function Column({ archetype, byId, abilities, board }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${archetype.id}`,
    data: { type: 'column', archetypeId: archetype.id },
    disabled: !board.editable,
  })
  const items = archetype.items.filter((i) => byId.has(i.abilityId))
  const total = (k: 'effort' | 'value') => items.reduce((sum, i) => sum + (byId.get(i.abilityId)?.[k] ?? 0), 0)

  return (
    <section ref={setNodeRef} className={`column${isOver ? ' over' : ''}`}>
      <header className="column-head">
        {board.editable ? (
          <input
            key={archetype.name}
            defaultValue={archetype.name}
            aria-label="Archetype name"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== archetype.name) board.save({ ...archetype, name: v })
              else e.target.value = archetype.name
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        ) : (
          <h3>{archetype.name}</h3>
        )}
        {board.editable && (
          <ConfirmButton className="icon ghost" aria-label={`Delete ${archetype.name}`} onConfirm={() => board.remove(archetype.id)} confirmLabel="✕">
            ✕
          </ConfirmButton>
        )}
      </header>
      <div className="column-totals muted small">
        <span>{items.length} abilities</span>
        <span>
          Effort <strong>{total('effort')}</strong>
        </span>
        <span>
          Value <strong>{total('value')}</strong>
        </span>
      </div>
      <div className="column-cards">
        {items.map((item) => (
          <ColumnCard key={item.key} archetype={archetype} itemKey={item.key} ability={byId.get(item.abilityId)!} board={board} />
        ))}
        {items.length === 0 && <p className="drop-hint muted small">{board.editable ? 'Drop abilities here' : 'Empty'}</p>}
      </div>
      {board.editable && abilities.length > 0 && (
        <select
          className="add-select"
          value=""
          aria-label={`Add an ability to ${archetype.name}`}
          onChange={(e) => {
            if (!e.target.value) return
            board.save({ ...archetype, items: [...archetype.items, { key: newId(), abilityId: e.target.value }] })
          }}
        >
          <option value="">+ Add ability…</option>
          {abilities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </section>
  )
}

function ColumnCard({ archetype, itemKey, ability, board }: { archetype: Archetype; itemKey: string; ability: Ability; board: Board }) {
  const drag = useDraggable({
    id: `card:${itemKey}`,
    data: { type: 'card', archetypeId: archetype.id, key: itemKey, abilityId: ability.id },
    disabled: !board.editable,
  })
  // Each card is also a drop target, so dropping on it inserts before it.
  const drop = useDroppable({
    id: `slot:${itemKey}`,
    data: { type: 'slot', archetypeId: archetype.id, key: itemKey },
    disabled: !board.editable,
  })
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      {...drag.listeners}
      {...drag.attributes}
      className={`drag-src${drag.isDragging ? ' ghost' : ''}${drop.isOver && !drag.isDragging ? ' insert' : ''}${board.editable ? '' : ' static'}`}
    >
      <CardFace
        ability={ability}
        onRemove={board.editable ? () => board.save({ ...archetype, items: archetype.items.filter((i) => i.key !== itemKey) }) : undefined}
      />
    </div>
  )
}
