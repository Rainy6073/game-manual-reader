import { useMemo, useState } from 'react'
import type { ManualRef, ScreenPoint } from '../reader/ManualReader'
import { patch, put, remove } from '../sync/store'
import { newId, type ManualNoteDoc, type Submission } from '../types'
import { byRank } from '../reorder'
import RefChip from './RefChip'
import ConfirmButton from './ConfirmButton'

/** A note being written or edited, shown next to its passage. */
export type NoteDraft = { at: ScreenPoint } & ({ ref: ManualRef; note?: undefined } | { note: ManualNoteDoc; ref?: undefined })

/** Writes or edits a note on a passage (an empty note is just a highlight). */
export function NoteEditor({ draft, author, onClose, onAsk }: { draft: NoteDraft; author: string; onClose: () => void; onAsk: (ref: ManualRef) => void }) {
  const [text, setText] = useState(draft.note?.text ?? '')
  const ref: ManualRef = draft.note ? { page: draft.note.page, quote: draft.note.quote } : draft.ref!
  const save = () => {
    if (draft.note) patch('notes', draft.note.id, { text: text.trim() })
    else put('notes', { id: newId(), author, page: ref.page, quote: ref.quote, text: text.trim(), createdAt: Date.now() })
    onClose()
  }
  // Kept on screen, below (or, near the bottom, above) the passage.
  const half = Math.min(170, window.innerWidth / 2 - 8) + 8
  const left = Math.min(Math.max(draft.at.x, half), window.innerWidth - half)
  const below = draft.at.y < window.innerHeight - 260
  return (
    <>
      <div className="note-scrim" onClick={onClose} />
      <form
        className="note-pop"
        style={{ left, ...(below ? { top: draft.at.y } : { bottom: window.innerHeight - draft.at.y + 40 }) }}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <q className="note-quote">
          <span className="ref-page">p. {ref.page}</span> {ref.quote}
        </q>
        <textarea
          autoFocus
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') onClose()
          }}
          placeholder={draft.note && !draft.note.text ? 'Add a note to this highlight…' : 'Your note…'}
          aria-label="Note"
          style={{ fontSize: 16 }}
        />
        <div className="note-pop-foot">
          {draft.note && (
            <button
              type="button"
              className="link danger"
              onClick={() => {
                remove('notes', draft.note!.id)
                onClose()
              }}
            >
              {draft.note.text ? 'Delete' : 'Remove highlight'}
            </button>
          )}
          <button
            type="button"
            className="link"
            onClick={() => {
              onAsk(ref)
              onClose()
            }}
            title="Start a question with this passage attached"
          >
            Ask about it
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save</button>
        </div>
      </form>
    </>
  )
}

/** Picks a question to attach a passage to. */
export function AttachPicker({ reference, submissions, onClose }: { reference: ManualRef; submissions: Submission[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...submissions].sort(byRank).filter((s) => !needle || `${s.text} ${s.author}`.toLowerCase().includes(needle))
  }, [submissions, query])
  const attach = (s: Submission) => {
    const same = (r?: ManualRef) => r?.page === reference.page && r.quote === reference.quote
    if (!same(s.ref) && !s.refs?.some(same)) {
      if (s.ref) patch('submissions', s.id, { refs: [...(s.refs ?? []), reference] })
      else patch('submissions', s.id, { ref: reference })
    }
    onClose()
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal attach-picker" onClick={(e) => e.stopPropagation()}>
        <h3>Add this passage to…</h3>
        <RefChip reference={reference} />
        <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions" aria-label="Search questions" />
        <div className="attach-list">
          {list.length === 0 && <p className="muted small">{submissions.length ? 'Nothing matches.' : 'No questions yet.'}</p>}
          {list.map((s) => (
            <button key={s.id} className="attach-item" onClick={() => attach(s)}>
              {s.prototype && <span className="kind-badge proto">Prototype</span>}
              <span className="attach-text">{s.text}</span>
              <span className="muted small">{s.author}</span>
            </button>
          ))}
        </div>
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/** This person's highlights and notes, newest first. */
export function NotesList({ notes, onJump, onEdit }: { notes: ManualNoteDoc[]; onJump: (ref: ManualRef) => void; onEdit: (note: ManualNoteDoc, at: ScreenPoint) => void }) {
  if (notes.length === 0)
    return <p className="empty muted">Select text in the manual to highlight it or add a note. Your notes and highlights show up here.</p>
  return (
    <>
      {notes.map((n) => (
        <article key={n.id} className={`submission note-card${n.text ? '' : ' just-highlight'}`}>
          <RefChip reference={n} onClick={() => onJump(n)} />
          {n.text ? <p className="submission-text">{n.text}</p> : <p className="muted small">Highlight</p>}
          <footer className="submission-actions">
            <button
              className="link"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                onEdit(n, { x: r.left, y: r.bottom + 8 })
              }}
            >
              {n.text ? 'Edit' : 'Add note'}
            </button>
            <ConfirmButton className="link danger" onConfirm={() => remove('notes', n.id)} confirmLabel="Click again to delete">
              Delete
            </ConfirmButton>
          </footer>
        </article>
      ))}
    </>
  )
}
