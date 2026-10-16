import { DndContext, DragOverlay } from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import type { ManualRef } from '../reader/ManualReader'
import { useIsPresenter, useLocalState, useSession } from '../session'
import { patch, put, remove, useCollection } from '../sync/store'
import { newId, type BoardGroup, type Submission, type SubmissionKind } from '../types'
import Composer from './Composer'
import { byRank, cardsFirst, reorderOnDrop, useCardSensors } from '../reorder'
import { DropList, Sortable } from './Sortable'
import SubmissionCard from './SubmissionCard'

type GroupBy = 'type' | 'custom' | 'page' | 'person' | 'status'
type Sort = 'custom' | 'newest' | 'oldest'
type Show = 'all' | 'mine'

interface Group {
  key: string
  title: string
  items: Submission[]
}

const GROUPINGS: { id: GroupBy; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'custom', label: 'Our groups' },
  { id: 'page', label: 'Manual page' },
  { id: 'person', label: 'Person' },
  { id: 'status', label: 'Status' },
]

const UNGROUPED = 'ungrouped'

/** The group a submission falls in, and that group's title. */
function groupOf(s: Submission, by: GroupBy, custom: Map<string, BoardGroup>): [key: string, title: string] {
  if (by === 'custom') {
    const g = s.groupId ? custom.get(s.groupId) : undefined
    return g ? [g.id, g.name] : [UNGROUPED, 'Not grouped']
  }
  if (by === 'type') return [s.kind, s.kind === 'question' ? 'Questions' : 'Prototyping ideas']
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
    // Every group shows, even empty ones: "Not grouped" first, then oldest to newest.
    const ordered = [...custom.values()].sort((a, b) => a.createdAt - b.createdAt)
    return [
      groups.get(UNGROUPED) ?? { key: UNGROUPED, title: 'Not grouped', items: [] },
      ...ordered.map((g) => groups.get(g.id) ?? { key: g.id, title: g.name, items: [] }),
    ]
  }
  if (by === 'type') {
    // Always show both columns, even when one is empty.
    for (const [key, title] of [
      ['question', 'Questions'],
      ['idea', 'Prototyping ideas'],
    ] as const) {
      if (!groups.has(key)) result.push({ key, title, items: [] })
    }
    return result.sort((a, b) => (a.key === 'question' ? -1 : b.key === 'question' ? 1 : 0))
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

/** A wide, organized view of every question and prototyping idea. */
export default function QuestionBoard({ submissions, reference, onClearReference, onJump, onClose }: Props) {
  const presenter = useIsPresenter()
  const { name } = useSession()
  const [groupBy, setGroupBy] = useLocalState<GroupBy>('kickoff.boardGroup', 'type')
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
  const deleteGroup = (g: Group) => {
    if (!confirm(`Delete the group “${g.title}”? Its ${g.items.length} cards go back to Not grouped.`)) return
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
  // columns where that means something: Questions ↔ Ideas, or into a group.
  const canReorder = sort === 'custom'
  const ranked = useMemo(() => [...submissions].sort(byRank), [submissions])
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useCardSensors()
  const regroup = (_: Submission, key: string): Partial<Submission> | null => {
    if (groupBy === 'type') return { kind: key as SubmissionKind }
    if (groupBy === 'custom') return { groupId: key === UNGROUPED ? undefined : key }
    return null
  }
  const dragged = dragging ? submissions.find((s) => s.id === dragging) : undefined

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
            placeholder="Search questions & ideas"
            aria-label="Search questions and ideas"
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
        <summary>＋ Ask a question or suggest an idea</summary>
        <Composer reference={reference} onClearReference={onClearReference} onJump={onJump} />
      </details>

      <DndContext
        sensors={sensors}
        collisionDetection={cardsFirst}
        onDragStart={(e) => setDragging(String(e.active.id))}
        onDragCancel={() => setDragging(null)}
        onDragEnd={(e) => {
          setDragging(null)
          reorderOnDrop(ranked, e, (s) => groupOf(s, groupBy, custom)[0], regroup)
        }}
      >
      <div className={`board-columns${groups.length <= 3 ? ' wide' : ''}`}>
        {groups.length === 0 && <p className="empty muted">{query ? 'Nothing matches your search.' : 'No questions or ideas yet.'}</p>}
        {groups.map((g) => (
          <DropList key={g.key} group={g.key} enabled={canReorder} className={`board-column group-${groupBy} key-${g.key}`}>
            <header>
              {groupBy === 'custom' && g.key !== UNGROUPED ? (
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
              <span className="count-pill">{g.items.length}</span>
              {groupBy === 'custom' && g.key !== UNGROUPED && (
                <button className="icon ghost" onClick={() => deleteGroup(g)} aria-label={`Delete group ${g.title}`} title="Delete group">
                  ✕
                </button>
              )}
            </header>
            <div className="board-cards">
              {g.items.length === 0 && <p className="muted small empty">{canReorder ? 'Drag cards here.' : 'Nothing here yet.'}</p>}
              {g.items.map((s) => (
                <Sortable key={s.id} id={s.id} group={g.key} enabled={canReorder}>
                  {(grip) => (
                <SubmissionCard
                  submission={s}
                  grip={grip}
                  onJump={onJump}
                  answerable
                  actions={
                    <>
                      {presenter && !s.prototype && (
                        <button
                          className="small"
                          onClick={() => patch('submissions', s.id, { prototype: { assignees: [], status: 'todo', createdAt: Date.now() } })}
                        >
                          Make prototype
                        </button>
                      )}
                      {(presenter || s.author === name) && (
                        <button className="link danger" onClick={() => confirm('Delete this submission?') && remove('submissions', s.id)}>
                          Delete
                        </button>
                      )}
                    </>
                  }
                />
                  )}
                </Sortable>
              ))}
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
            <p className="muted small">Collect similar questions and ideas together. Everyone sees the same groups.</p>
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
