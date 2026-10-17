// Live rearranging for drag-and-drop lists: while something is dragged, the lists
// are shown as they would be if it were dropped where it is now, so other cards
// slide out of the way instead of a marker showing where it would go.
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useRef, useState } from 'react'

/** Droppable ids of whole lists (columns) start with this; everything else is an item. */
export const LIST = 'list:'

type Lists = Record<string, string[]>

interface Options {
  /** Each list's item ids, in the order shown. */
  lists: Lists
  /** Whether `id` (from list `from`, or null when it comes from outside every list) may go into `to`. */
  canEnter?: (id: string, from: string | null, to: string) => boolean
  /** The item was dropped into `to`, just before `before` (or at the end). */
  onMove: (id: string, to: string, before: string | undefined, from: string | null) => void
  /** The item was dropped on something that isn't a list or an item (e.g. a palette). */
  onDropElsewhere?: (id: string, overId: string, from: string | null) => void
}

export function useLiveSort({ lists, canEnter = () => true, onMove, onDropElsewhere }: Options) {
  const [preview, setPreviewState] = useState<Lists | null>(null)
  const previewRef = useRef<Lists | null>(null)
  const setPreview = (next: Lists | null) => {
    previewRef.current = next
    setPreviewState(next)
  }
  const [activeId, setActiveId] = useState<string | null>(null)
  const originRef = useRef<string | null>(null)

  const listOf = (id: string, map: Lists): string | null => {
    if (id.startsWith(LIST)) {
      const key = id.slice(LIST.length)
      return key in map ? key : null
    }
    return Object.keys(map).find((k) => map[k].includes(id)) ?? null
  }

  const end = () => {
    setPreview(null)
    setActiveId(null)
  }

  return {
    activeId,
    /** A list's items as currently shown (rearranged while dragging). */
    items: (key: string) => (preview ?? lists)[key] ?? [],
    handlers: {
      onDragStart: ({ active }: DragStartEvent) => {
        const id = String(active.id)
        setActiveId(id)
        originRef.current = listOf(id, lists)
        setPreview(Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, [...v]])))
      },
      // Moving into another list happens here, while dragging; moves within a list
      // are animated by the sortable list itself and applied on drop.
      onDragOver: ({ active, over }: DragOverEvent) => {
        const prev = previewRef.current
        // Items from outside every list are copies; they are placed on drop, not previewed.
        if (!prev || !over || originRef.current === null) return
        const id = String(active.id)
        const overId = String(over.id)
        const from = listOf(id, prev)
        const to = listOf(overId, prev)
        if (!to || from === to || !canEnter(id, originRef.current, to)) return
        const target = prev[to].filter((x) => x !== id)
        const overIndex = target.indexOf(overId)
        const dragged = active.rect.current.translated
        const below = overIndex >= 0 && !!dragged && dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2
        target.splice(overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length, 0, id)
        const next = { ...prev, [to]: target }
        if (from) next[from] = prev[from].filter((x) => x !== id)
        setPreview(next)
      },
      onDragEnd: ({ active, over }: DragEndEvent) => {
        const final = previewRef.current
        const id = String(active.id)
        const origin = originRef.current
        end()
        if (!final || !over) return
        const overId = String(over.id)
        if (overId !== id && !listOf(overId, final)) {
          onDropElsewhere?.(id, overId, origin)
          return
        }
        const to = listOf(id, final)
        if (!to) {
          // From outside every list (e.g. copied from a palette): goes before the item it was dropped on.
          const into = listOf(overId, final)
          if (into && canEnter(id, origin, into)) onMove(id, into, overId.startsWith(LIST) ? undefined : overId, origin)
          return
        }
        let items = final[to]
        if (overId !== id && items.includes(overId)) items = arrayMove(items, items.indexOf(id), items.indexOf(overId))
        const unchanged = to === origin && items.length === lists[to].length && items.every((x, i) => x === lists[to][i])
        if (unchanged) return
        onMove(id, to, items[items.indexOf(id) + 1], origin)
      },
      onDragCancel: end,
    },
  }
}
