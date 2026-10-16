import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import type { DropTarget } from '../reorder'

/** A card that can be dragged by its handle, and dropped on to insert before it. */
export function Sortable({
  id,
  group,
  enabled,
  children,
}: {
  id: string
  group: string
  enabled: boolean
  children: (handle: ReactNode) => ReactNode
}) {
  const drag = useDraggable({ id, disabled: !enabled })
  const drop = useDroppable({ id: `before:${id}`, data: { group, before: id } satisfies DropTarget, disabled: !enabled })
  const handle = enabled ? (
    <button
      type="button"
      ref={drag.setActivatorNodeRef}
      {...drag.listeners}
      {...drag.attributes}
      className="drag-handle"
      aria-label="Drag to reorder"
      title="Drag to reorder"
    >
      ⠿
    </button>
  ) : null
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      className={`sortable${drag.isDragging ? ' ghost' : ''}${drop.isOver && !drag.isDragging ? ' insert' : ''}`}
    >
      {children(handle)}
    </div>
  )
}

/** The space after a list's last card, for dropping something at the end. */
export function ListEnd({ group, enabled }: { group: string; enabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `end:${group}`, data: { group } satisfies DropTarget, disabled: !enabled })
  if (!enabled) return null
  return <div ref={setNodeRef} className={`list-end${isOver ? ' insert' : ''}`} />
}
