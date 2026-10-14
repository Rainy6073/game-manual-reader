import type { ManualRef } from '../reader/ManualReader'

interface Props {
  reference: ManualRef
  onClick?: () => void
  onRemove?: () => void
}

/** A quoted manual passage; clicking it shows the passage in the manual. */
export default function RefChip({ reference, onClick, onRemove }: Props) {
  return (
    <div className="ref-chip">
      <button type="button" className="ref-body" onClick={onClick} disabled={!onClick} title="Show in the manual">
        <span className="ref-page">p. {reference.page}</span>
        <q>{reference.quote}</q>
      </button>
      {onRemove && (
        <button type="button" className="ref-remove" onClick={onRemove} aria-label="Remove reference">
          ✕
        </button>
      )}
    </div>
  )
}
