import { useMemo, useState, type ReactNode } from 'react'
import { clockTime } from '../nav'
import type { ManualRef } from '../reader/ManualReader'
import { useIsPresenter, useSession } from '../session'
import { put, remove, useCollection } from '../sync/store'
import { newId, type Submission } from '../types'
import RefChip from './RefChip'
import type { DragGrip } from './Sortable'

interface Props {
  submission: Submission
  onJump?: (ref: ManualRef) => void
  actions?: ReactNode
  /** Questions show their answers, and clicking one opens a box to answer it. */
  answerable?: boolean
  /** Makes the card's top row drag the card. */
  grip?: DragGrip | null
}

export default function SubmissionCard({ submission: s, onJump, actions, answerable, grip }: Props) {
  const canAnswer = answerable && s.kind === 'question'
  const [answering, setAnswering] = useState(false)

  return (
    <article
      className={`submission ${s.kind}${canAnswer ? ' answerable' : ''}${answering ? ' answering' : ''}`}
      onClick={(e) => {
        // Clicking anywhere on a question (but not its buttons, links or fields) opens the answer box.
        if (!canAnswer || answering || (e.target as HTMLElement).closest('button, a, input, textarea, select, .ref-chip')) return
        setAnswering(true)
      }}
    >
      <header ref={grip?.ref} {...grip?.props} className={grip ? 'grip' : undefined} title={grip ? 'Drag to move' : undefined}>
        {grip && (
          <span className="grip-dots" aria-hidden>
            ⠿
          </span>
        )}
        <span className={`kind-badge ${s.kind}`}>{s.kind === 'question' ? 'Question' : 'Idea'}</span>
        {s.prototype && <span className="kind-badge proto">Prototype</span>}
        <span className="muted byline">
          {s.author} · {clockTime(s.createdAt)}
        </span>
      </header>
      <p className="submission-text">{s.text}</p>
      {[...(s.ref ? [s.ref] : []), ...(s.refs ?? [])].map((r, i) => (
        <RefChip key={i} reference={r} onClick={onJump && (() => onJump(r))} />
      ))}
      {canAnswer && <Answers submissionId={s.id} answering={answering} onDone={() => setAnswering(false)} />}
      {(actions || (canAnswer && !answering)) && (
        <footer className="submission-actions">
          {canAnswer && !answering && (
            <button className="link answer-link" onClick={() => setAnswering(true)}>
              Answer
            </button>
          )}
          {actions}
        </footer>
      )}
    </article>
  )
}

function Answers({ submissionId, answering, onDone }: { submissionId: string; answering: boolean; onDone: () => void }) {
  const presenter = useIsPresenter()
  const { name } = useSession()
  const all = useCollection('answers')
  const answers = useMemo(
    () => all.filter((a) => a.submissionId === submissionId).sort((a, b) => a.createdAt - b.createdAt),
    [all, submissionId],
  )
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    put('answers', { id: newId(), submissionId, author: name, text: trimmed, createdAt: Date.now() })
    setText('')
    onDone()
  }

  return (
    <>
      {answers.length > 0 && (
        <ul className="answers">
          {answers.map((a) => (
            <li key={a.id}>
              <span className="answer-head">
                <strong>{a.author}</strong>
                <span className="muted">{clockTime(a.createdAt)}</span>
                {(presenter || a.author === name) && (
                  <button className="link danger small" onClick={() => confirm('Delete this answer?') && remove('answers', a.id)}>
                    Delete
                  </button>
                )}
              </span>
              <span className="answer-text">{a.text}</span>
            </li>
          ))}
        </ul>
      )}
      {answering && (
        <form
          className="answer-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter posts (it's the keyboard's Send key on phones); Shift+Enter adds a line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape') onDone()
            }}
            rows={2}
            enterKeyHint="send"
            placeholder="Type your answer…"
            aria-label="Answer"
          />
          <div className="answer-form-foot">
            <button
              type="button"
              className="link"
              onClick={() => {
                setText('')
                onDone()
              }}
            >
              Cancel
            </button>
            <button className="primary small" disabled={!text.trim()}>
              Post answer
            </button>
          </div>
        </form>
      )}
    </>
  )
}
