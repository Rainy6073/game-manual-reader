import { useEffect, useRef } from 'react'

interface Props {
  query: string
  onQueryChange: (q: string) => void
  /** Bumped each time the bar should grab focus (e.g. ⌘F pressed again). */
  focusRequest: number
  ready: boolean
  current: number
  total: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

export default function SearchBar({ query, onQueryChange, focusRequest, ready, current, total, onNext, onPrev, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  let status = ''
  if (!ready) status = 'Indexing…'
  else if (query.trim()) status = total ? `${current} of ${total}` : 'No results'

  return (
    <div className="search-bar" role="search">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          }
        }}
        placeholder="Search manual"
        aria-label="Search manual"
        spellCheck={false}
      />
      <span className={`muted search-status${ready && query.trim() && !total ? ' none' : ''}`}>{status}</span>
      <button className="icon" onClick={onPrev} disabled={!total} title="Previous match (Shift+Enter)" aria-label="Previous match">
        ↑
      </button>
      <button className="icon" onClick={onNext} disabled={!total} title="Next match (Enter)" aria-label="Next match">
        ↓
      </button>
      <button className="icon" onClick={onClose} title="Close (Esc)" aria-label="Close search">
        ✕
      </button>
    </div>
  )
}
