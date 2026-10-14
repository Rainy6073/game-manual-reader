import type { ReactNode } from 'react'
import { clockTime } from '../nav'
import type { ManualRef } from '../reader/ManualReader'
import type { Submission } from '../types'
import RefChip from './RefChip'

interface Props {
  submission: Submission
  onJump?: (ref: ManualRef) => void
  actions?: ReactNode
}

export default function SubmissionCard({ submission: s, onJump, actions }: Props) {
  return (
    <article className={`submission ${s.kind}`}>
      <header>
        <span className={`kind-badge ${s.kind}`}>{s.kind === 'question' ? 'Question' : 'Idea'}</span>
        {s.prototype && <span className="kind-badge proto">Prototype</span>}
        <span className="muted byline">
          {s.author} · {clockTime(s.createdAt)}
        </span>
      </header>
      <p className="submission-text">{s.text}</p>
      {s.ref && <RefChip reference={s.ref} onClick={onJump && (() => onJump(s.ref!))} />}
      {actions && <footer className="submission-actions">{actions}</footer>}
    </article>
  )
}
