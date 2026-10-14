import { useEffect, useState } from 'react'
import { FIB, isFib, stepFib } from '../fib'

interface Props {
  value: number | null
  onChange: (value: number | null) => void
  label: string
}

/** A number box that only accepts Fibonacci-scale values (arrow keys step through them). */
export default function FibInput({ value, onChange, label }: Props) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  useEffect(() => setDraft(value == null ? '' : String(value)), [value])

  const trimmed = draft.trim()
  const invalid = trimmed !== '' && !isFib(Number(trimmed))

  const set = (text: string) => {
    setDraft(text)
    const t = text.trim()
    if (t === '') onChange(null)
    else if (isFib(Number(t))) onChange(Number(t))
  }

  const step = (dir: 1 | -1) => set(String(stepFib(isFib(Number(trimmed)) && trimmed ? Number(trimmed) : value, dir)))

  return (
    <span className={`fib-input${invalid ? ' invalid' : ''}`}>
      <button type="button" tabIndex={-1} onClick={() => step(-1)} aria-label={`Lower ${label}`}>
        −
      </button>
      <input
        value={draft}
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid}
        title={invalid ? `Use a Fibonacci number: ${FIB.join(', ')}` : label}
        onChange={(e) => set(e.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            step(e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        // Leaving an invalid number puts back the last valid one.
        onBlur={() => invalid && setDraft(value == null ? '' : String(value))}
        placeholder="–"
      />
      <button type="button" tabIndex={-1} onClick={() => step(1)} aria-label={`Raise ${label}`}>
        +
      </button>
    </span>
  )
}
