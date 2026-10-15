import { useMemo, useState } from 'react'
import type { ManualRef } from '../reader/ManualReader'
import { useIsPresenter, useLocalState, useSession } from '../session'
import { patch, remove } from '../sync/store'
import type { Submission } from '../types'
import Composer from './Composer'
import SubmissionCard from './SubmissionCard'

type GroupBy = 'type' | 'page' | 'person' | 'status'
type Sort = 'newest' | 'oldest'
type Show = 'all' | 'mine'

interface Group {
  key: string
  title: string
  items: Submission[]
}

const GROUPINGS: { id: GroupBy; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'page', label: 'Manual page' },
  { id: 'person', label: 'Person' },
  { id: 'status', label: 'Status' },
]

function groupSubmissions(list: Submission[], by: GroupBy): Group[] {
  const groups = new Map<string, Group>()
  const add = (key: string, title: string, s: Submission) => {
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, title, items: [] }))
    g.items.push(s)
  }
  for (const s of list) {
    if (by === 'type') add(s.kind, s.kind === 'question' ? 'Questions' : 'Prototyping ideas', s)
    else if (by === 'person') add(s.author.toLowerCase(), s.author, s)
    else if (by === 'status') add(s.prototype ? 'proto' : 'open', s.prototype ? 'Made into prototypes' : 'Not yet a prototype', s)
    else if (s.ref) add(String(s.ref.page).padStart(5, '0'), `Page ${s.ref.page}`, s)
    else add('~none', 'No reference', s)
  }
  const result = [...groups.values()]
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
  const [sort, setSort] = useLocalState<Sort>('kickoff.boardSort', 'newest')
  const [show, setShow] = useState<Show>('all')
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = submissions
      .filter((s) => show === 'all' || s.author === name)
      .filter((s) => !needle || `${s.text} ${s.author} ${s.ref?.quote ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt))
    return groupSubmissions(list, groupBy)
  }, [submissions, show, name, query, sort, groupBy])

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
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
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

      <div className={`board-columns${groups.length <= 3 ? ' wide' : ''}`}>
        {groups.length === 0 && <p className="empty muted">{query ? 'Nothing matches your search.' : 'No questions or ideas yet.'}</p>}
        {groups.map((g) => (
          <section key={g.key} className={`board-column group-${groupBy} key-${g.key}`}>
            <header>
              <h3>{g.title}</h3>
              <span className="count-pill">{g.items.length}</span>
            </header>
            <div className="board-cards">
              {g.items.length === 0 && <p className="muted small empty">Nothing here yet.</p>}
              {g.items.map((s) => (
                <SubmissionCard
                  key={s.id}
                  submission={s}
                  onJump={onJump}
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
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
