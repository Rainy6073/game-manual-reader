import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { HTMLAttributes, ReactNode } from 'react'
import type { DropTarget } from '../reorder'

/** Props that make an element (a card's top row) start dragging its card. */
export interface DragGrip {
  ref: (el: HTMLElement | null) => void
  props: HTMLAttributes<HTMLElement>
}

/** A card that can be dragged by its top row, and dropped on to insert before it. */
export function Sortable({
  id,
  group,
  enabled,
  children,
}: {
  id: string
  group: string
  enabled: boolean
  children: (grip: DragGrip | null) => ReactNode
}) {
  const drag = useDraggable({ id, disabled: !enabled })
  const drop = useDroppable({ id: `before:${id}`, data: { group, before: id } satisfies DropTarget, disabled: !enabled })
  const grip: DragGrip | null = enabled
    ? { ref: drag.setActivatorNodeRef, props: { ...drag.listeners, ...drag.attributes, role: undefined, tabIndex: undefined } }
    : null
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      className={`sortable${drag.isDragging ? ' ghost' : ''}${drop.isOver && !drag.isDragging ? ' insert' : ''}`}
    >
      {children(grip)}
    </div>
  )
}

/** A list or column; dropping anywhere on it (not on a card) puts the card at its end. */
export function DropList({
  group,
  enabled,
  className,
  children,
}: {
  group: string
  enabled: boolean
  className?: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `end:${group}`, data: { group } satisfies DropTarget, disabled: !enabled })
  return (
    <section ref={setNodeRef} className={`${className ?? ''}${isOver ? ' drop-over' : ''}`}>
      {children}
    </section>
  )
}
