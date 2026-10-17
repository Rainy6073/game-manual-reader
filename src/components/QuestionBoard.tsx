import { DndContext, DragOverlay } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import { useMemo, useState } from 'react'
import type { ManualRef } from '../reader/ManualReader'
import { useIsPresenter, useLocalState, useSession } from '../session'
import { patch, put, remove, useCollection } from '../sync/store'
import { newId, PROTOTYPE_GROUP, type BoardGroup, type Submission } from '../types'
import Composer from './Composer'
import { useLiveSort } from '../liveSort'
import { byRank, cardsFirst, placeSubmission, useCardSensors } from '../reorder'
import { DropList, Sortable } from './Sortable'
import SubmissionCard from './SubmissionCard'
import ConfirmButton from './ConfirmButton'

type GroupBy = 'custom' | 'page' | 'person' | 'status'
type Sort = 'custom' | 'newest' | 'oldest'
type Show = 'all' | 'mine'

interface Group {
  key: string
  title: string
  items: Submission[]
}

const GROUPINGS: { id: GroupBy; label: string }[] = [
  { id: 'custom', label: 'Our groups' },
  { id: 'page', label: 'Manual page' },
  { id: 'person', label: 'Person' },
  { id: 'status', label: 'Status' },
]

const UNGROUPED = 'ungrouped'
/** Groups that always exist and can't be renamed or deleted. */
const isBuiltIn = (key: string) => key === UNGROUPED || key === PROTOTYPE_GROUP

/** The group a submission falls in, and that group's title. */
function groupOf(s: Submission, by: GroupBy, custom: Map<string, BoardGroup>): [key: string, title: string] {
  if (by === 'custom') {
    if (s.groupId === PROTOTYPE_GROUP) return [PROTOTYPE_GROUP, 'Prototype']
    const g = s.groupId ? custom.get(s.groupId) : undefined
    return g ? [g.id, g.name] : [UNGROUPED, 'Not grouped']
  }
  if (by === 'person') return [s.author.toLowerCase(), s.author]
  if (by === 'status') return s.prototype ? ['proto', 'Made into prototypes'] : ['open', 'Not yet a prototype']
  if (s.ref) return [String(s.ref.page).padStart(5, '0'), `Page ${s.ref.page}`]
  return ['~none', 'No reference']
}

function groupSubmissions(list: Submission[], by: GroupBy, custom: Map<string, BoardGroup>): Group[] {
  const groups = new Map<string, Group>()
  for (const s of list) {
    const [key, title] = groupOf(s, by, custom)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, title, items: [] }))
    g.items.push(s)
  }
  const result = [...groups.values()]
  if (by === 'custom') {
    // Every group shows, even empty ones: "Not grouped", then "Prototype", then
    // the groups people made, oldest to newest.
    const ordered = [...custom.values()].sort((a, b) => a.createdAt - b.createdAt)
    return [
      groups.get(UNGROUPED) ?? { key: UNGROUPED, title: 'Not grouped', items: [] },
      groups.get(PROTOTYPE_GROUP) ?? { key: PROTOTYPE_GROUP, title: 'Prototype', items: [] },
      ...ordered.map((g) => groups.get(g.id) ?? { key: g.id, title: g.name, items: [] }),
    ]
  }
  if (by === 'person') return result.sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title))
  // Plain comparison, so zero-padded page numbers sort numerically and "~none" sorts last.
  return result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

interface Props {
  submissions: Submission[]
  reference: ManualRef | null
  onClearReference: () => void
  /** Shows a referenced passage (this leaves the board for the manual). */
  onJump: (ref: ManualRef) => void
  onClose: () => void
}

/** A wide, organized view of every question. */
export default function QuestionBoard({ submissions, reference, onClearReference, onJump, onClose }: Props) {
  const presenter = useIsPresenter()
  const { name } = useSession()
  const [savedGroupBy, setGroupBy] = useLocalState<GroupBy>('kickoff.boardGroup', 'custom')
  const groupBy: GroupBy = GROUPINGS.some((g) => g.id === savedGroupBy) ? savedGroupBy : 'custom'
  const [sort, setSort] = useLocalState<Sort>('kickoff.boardOrder', 'custom')
  const [show, setShow] = useState<Show>('all')
  const [query, setQuery] = useState('')
  const customGroups = useCollection('groups')
  const custom = useMemo(() => new Map(customGroups.map((g) => [g.id, g])), [customGroups])
  const [newGroup, setNewGroup] = useState('')
  const addGroup = () => {
    const n = newGroup.trim()
    if (!n) return
    put('groups', { id: newId(), name: n.slice(0, 60), createdAt: Date.now() })
    setNewGroup('')
  }
  // Its cards go back to "Not grouped".
  const deleteGroup = (g: Group) => {
    for (const s of submissions) if (s.groupId === g.key) patch('submissions', s.id, { groupId: undefined })
    remove('groups', g.key)
  }

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = submissions
      .filter((s) => show === 'all' || s.author === name)
      .filter((s) => !needle || `${s.text} ${s.author} ${[s.ref, ...(s.refs ?? [])].map((r) => r?.quote ?? '').join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort === 'custom' ? byRank(a, b) : sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt))
    return groupSubmissions(list, groupBy, custom)
  }, [submissions, show, name, query, sort, groupBy, custom])

  // Anyone can drag cards into the shared order (in "Custom order"), and between
  // groups (with "Our groups").
  const canReorder = sort === 'custom'
  const ranked = useMemo(() => [...submissions].sort(byRank), [submissions])
  const sensors = useCardSensors()
  const byId = useMemo(() => new Map(submissions.map((s) => [s.id, s])), [submissions])
  // Cards can only move into another column when that changes something: a group.
  const live = useLiveSort({
    lists: Object.fromEntries(groups.map((g) => [g.key, g.items.map((s) => s.id)])),
    canEnter: (_id, from, to) => from === to || groupBy === 'custom',
    onMove: (id, to, before, from) => {
      const extra = from !== to ? { groupId: to === UNGROUPED ? undefined : to } : undefined
      placeSubmission(ranked, id, groups.find((g) => g.key === to)?.items ?? [], before, extra)
    },
  })
  const dragged = live.activeId ? byId.get(live.activeId) : undefined

  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="board">
      <header className="board-head">
        <div className="board-title">
          <h2>Question Board</h2>
          <span className="muted">
            {total} of {submissions.length}
          </span>
        </div>
        <div className="board-controls">
          <input
            type="search"
            className="board-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions"
            aria-label="Search questions"
          />
          <label className="board-select">
            <span className="muted small">Group by</span>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              {GROUPINGS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="board-select">
            <span className="muted small">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="custom">Custom order</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          {sort !== 'custom' && <span className="muted small">Pick “Custom order” to drag cards.</span>}
          <div className="filter-chips">
            <button aria-pressed={show === 'all'} onClick={() => setShow('all')}>
              Everyone
            </button>
            <button aria-pressed={show === 'mine'} onClick={() => setShow('mine')}>
              Mine
            </button>
          </div>
          <button className="primary" onClick={onClose} title="Back to the manual">
            Show manual →
          </button>
        </div>
      </header>

      <details className="board-compose" open={!!reference || undefined}>
        <summary>＋ Ask a question</summary>
        <Composer reference={reference} onClearReference={onClearReference} onJump={onJump} />
      </details>

      <DndContext
        sensors={sensors}
        collisionDetection={cardsFirst}
        {...live.handlers}
      >
      <div className={`board-columns${groups.length <= 3 ? ' wide' : ''}`}>
        {groups.length === 0 && <p className="empty muted">{query ? 'Nothing matches your search.' : 'No questions yet.'}</p>}
        {groups.map((g) => (
          <DropList key={g.key} group={g.key} enabled={canReorder} className={`board-column group-${groupBy} key-${g.key}`}>
            <header>
              {groupBy === 'custom' && !isBuiltIn(g.key) ? (
                <input
                  className="group-name"
                  defaultValue={g.title}
                  key={g.title}
                  aria-label="Group name"
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v && v !== g.title) patch('groups', g.key, { name: v.slice(0, 60) })
                    else e.target.value = g.title
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              ) : (
                <h3>{g.title}</h3>
              )}
              <span className="count-pill">{live.items(g.key).length}</span>
              {groupBy === 'custom' && g.key === PROTOTYPE_GROUP && (
                <a className="group-link small" href="#/prototypes" title="These questions are on the Prototypes tab">
                  Prototypes tab →
                </a>
              )}
              {groupBy === 'custom' && !isBuiltIn(g.key) && (
                <ConfirmButton
                  className="icon ghost"
                  onConfirm={() => deleteGroup(g)}
                  confirmLabel="✕"
                  aria-label={`Delete group ${g.title}`}
                  title="Delete group (its cards go back to Not grouped)"
                >
                  ✕
                </ConfirmButton>
              )}
            </header>
            <div className="board-cards">
              <SortableContext items={live.items(g.key)} strategy={rectSortingStrategy}>
              {live.items(g.key).length === 0 && <p className="muted small empty">{canReorder ? 'Drag cards here.' : 'Nothing here yet.'}</p>}
              {live.items(g.key).map((id) => byId.get(id)!).map((s) => (
                <Sortable key={s.id} id={s.id} enabled={canReorder}>
                  {(grip) => (
                <SubmissionCard
                  submission={s}
                  grip={grip}
                  onJump={onJump}
                  answerable
                  actions={
                    <>
                      {(presenter || s.author === name) && (
                        <ConfirmButton className="link danger" onConfirm={() => remove('submissions', s.id)} confirmLabel="Click again to delete">
                          Delete
                        </ConfirmButton>
                      )}
                    </>
                  }
                />
                  )}
                </Sortable>
              ))}
              </SortableContext>
            </div>
          </DropList>
        ))}
        {groupBy === 'custom' && (
          <form
            className="board-column new-group"
            onSubmit={(e) => {
              e.preventDefault()
              addGroup()
            }}
          >
            <h3>New group</h3>
            <p className="muted small">Collect similar questions together. Everyone sees the same groups.</p>
            <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="e.g. Climbing" aria-label="New group name" />
            <button className="primary" disabled={!newGroup.trim()}>
              + Add group
            </button>
          </form>
        )}
      </div>
        <DragOverlay dropAnimation={null}>{dragged && <div className="sortable-lifted"><SubmissionCard submission={dragged} /></div>}</DragOverlay>
      </DndContext>
    </div>
  )
}
