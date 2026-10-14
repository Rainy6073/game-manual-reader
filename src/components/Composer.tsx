import { useEffect, useRef, useState } from 'react'
import type { ManualRef } from '../reader/ManualReader'
import { useSession } from '../session'
import { put } from '../sync/store'
import { newId, type SubmissionKind } from '../types'
import RefChip from './RefChip'

interface Props {
  reference: ManualRef | null
  onClearReference: () => void
  onJump: (ref: ManualRef) => void
}

/** Sends one question or prototyping idea, optionally tied to a manual passage. */
export default function Composer({ reference, onClearReference, onJump }: Props) {
  const { name } = useSession()
  const [kind, setKind] = useState<SubmissionKind>('question')
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!sent) return
    const t = setTimeout(() => setSent(false), 2500)
    return () => clearTimeout(t)
  }, [sent])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    put('submissions', {
      id: newId(),
      kind,
      text: trimmed,
      author: name,
      createdAt: Date.now(),
      ...(reference ? { ref: reference } : {}),
    })
    setText('')
    onClearReference()
    setSent(true)
    inputRef.current?.focus()
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="segmented" role="radiogroup" aria-label="Type">
        <button type="button" role="radio" aria-checked={kind === 'question'} onClick={() => setKind('question')}>
          Question
        </button>
        <button type="button" role="radio" aria-checked={kind === 'idea'} onClick={() => setKind('idea')}>
          Prototyping idea
        </button>
      </div>

      {reference ? (
        <RefChip reference={reference} onClick={() => onJump(reference)} onRemove={onClearReference} />
      ) : (
        <p className="hint muted">Tip: select text in the manual to attach it as a reference.</p>
      )}

      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
        rows={3}
        placeholder={kind === 'question' ? 'What do we need to figure out?' : 'What should we prototype?'}
        aria-label={kind === 'question' ? 'Question' : 'Prototyping idea'}
      />
      <div className="composer-foot">
        <span className="muted" aria-live="polite">
          {sent ? 'Sent ✓' : ''}
        </span>
        <button className="primary" disabled={!text.trim()}>
          Submit {kind === 'question' ? 'question' : 'idea'}
        </button>
      </div>
    </form>
  )
}
