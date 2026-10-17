import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { HTMLAttributes, ReactNode } from 'react'
import { LIST } from '../liveSort'

/** Props that make an element (e.g. a card's top row) start dragging its card. */
export interface DragGrip {
  ref: (el: HTMLElement | null) => void
  props: HTMLAttributes<HTMLElement>
}

interface SortableProps {
  id: string
  enabled: boolean
  /** Drag by the whole card instead of a grip handed to `children`. */
  whole?: boolean
  className?: string
  /** Shows an insert line when something matching this is held over the card (for copies, which don't slide in). */
  insertFor?: (activeId: string) => boolean
  children: ReactNode | ((grip: DragGrip | null) => ReactNode)
}

/**
 * A card in a list that slides out of the way while another card is dragged over
 * it; the card being dragged leaves a faint placeholder where it will land.
 */
export function Sortable({ id, enabled, whole, className, insertFor, children }: SortableProps) {
  const s = useSortable({ id, disabled: !enabled })
  const grip: DragGrip | null =
    enabled && !whole ? { ref: s.setActivatorNodeRef, props: { ...s.listeners, ...s.attributes, role: undefined, tabIndex: undefined } } : null
  const insert = !!insertFor && s.isOver && !!s.active && insertFor(String(s.active.id))
  return (
    <div
      ref={s.setNodeRef}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
      {...(enabled && whole ? { ...s.listeners, ...s.attributes, role: undefined, tabIndex: undefined } : {})}
      className={`sortable${s.isDragging ? ' placeholder' : ''}${insert ? ' insert' : ''}${className ? ` ${className}` : ''}`}
    >
      {typeof children === 'function' ? children(grip) : children}
    </div>
  )
}

/** A list or column; dragging over its empty space moves the card to its end. */
export function DropList({
  group,
  enabled,
  className,
  as: Tag = 'section',
  children,
}: {
  group: string
  enabled: boolean
  className?: string
  as?: 'section' | 'div' | 'aside'
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${LIST}${group}`, disabled: !enabled })
  return (
    <Tag ref={setNodeRef} className={`${className ?? ''}${isOver ? ' drop-over' : ''}`}>
      {children}
    </Tag>
  )
}
