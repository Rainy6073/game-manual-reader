import { useEffect, useRef, useState } from 'react'
import type { ManualRef } from '../reader/ManualReader'
import { useSession } from '../session'
import { put } from '../sync/store'
import { newId } from '../types'
import RefChip from './RefChip'

interface Props {
  reference: ManualRef | null
  onClearReference: () => void
  onJump: (ref: ManualRef) => void
}

/** Sends one question, optionally tied to a manual passage. */
export default function Composer({ reference, onClearReference, onJump }: Props) {
  const { name } = useSession()
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
      kind: 'question',
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
        placeholder="What do we need to figure out or try?"
        aria-label="Question"
      />
      <div className="composer-foot">
        <span className="muted" aria-live="polite">
          {sent ? 'Sent ✓' : ''}
        </span>
        <button className="primary" disabled={!text.trim()}>
          Submit question
        </button>
      </div>
    </form>
  )
}
