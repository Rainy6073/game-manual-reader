import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onConfirm: () => void
  /** Shown after the first click, until the second (e.g. "Click again to delete"). */
  confirmLabel?: ReactNode
  /** Skip the second click when there is nothing to lose. */
  needsConfirm?: boolean
}

/**
 * A button for anything destructive: the first click turns it red and asks for a
 * second click in the same place; it resets after a few seconds or when focus moves.
 */
export default function ConfirmButton({ onConfirm, confirmLabel = 'Click again', needsConfirm = true, children, className, onBlur, ...rest }: Props) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <button
      type="button"
      {...rest}
      className={`${className ?? ''}${armed ? ' armed' : ''}`}
      aria-live="polite"
      title={armed ? 'Click again to confirm' : rest.title}
      onClick={(e) => {
        e.stopPropagation()
        if (armed || !needsConfirm) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
      onBlur={(e) => {
        setArmed(false)
        onBlur?.(e)
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  )
}
