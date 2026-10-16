// Shared, hand-arranged order for questions, ideas and prototypes. Each submission
// has a rank (its `order`, or minus its creation time when never moved), so new
// submissions still appear first and moving one only rewrites that one record.
import {
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { patch } from './sync/store'
import type { Submission } from './types'

export const rankOf = (s: Submission) => s.order ?? -s.createdAt

export const byRank = (a: Submission, b: Submission) => rankOf(a) - rankOf(b)

/** What a submission was dropped on: before a card, or the end of a list. */
export interface DropTarget {
  /** Lists (columns, groups) a card can't be moved out of by dropping. */
  group: string
  before?: string
}

/**
 * Moves `id` to just before `before` (or after the last of `list` when there is no
 * `before`), where `list` is every submission in the order shown.
 */
export function moveSubmission(list: Submission[], id: string, before: string | undefined, extra?: Partial<Submission>) {
  const rest = list.filter((s) => s.id !== id)
  const at = before ? rest.findIndex((s) => s.id === before) : rest.length
  if (at === -1) return
  const prev = rest[at - 1]
  const next = rest[at]
  const order = prev && next ? (rankOf(prev) + rankOf(next)) / 2 : prev ? rankOf(prev) + 1000 : next ? rankOf(next) - 1000 : 0
  patch('submissions', id, { order, ...extra })
}

/**
 * Handles a drop for a list sorted by rank. A drop into another group only counts
 * when `regroup` says what changes for the card to belong there.
 */
export function reorderOnDrop(
  list: Submission[],
  { active, over }: DragEndEvent,
  groupOf: (s: Submission) => string,
  regroup?: (s: Submission, group: string) => Partial<Submission> | null,
) {
  const target = over?.data.current as DropTarget | undefined
  const moving = list.find((s) => s.id === active.id)
  if (!target || !moving || target.before === moving.id) return
  let extra: Partial<Submission> | undefined
  if (groupOf(moving) !== target.group) {
    const change = regroup?.(moving, target.group)
    if (!change) return
    extra = change
  }
  if (target.before) return moveSubmission(list, moving.id, target.before, extra)
  // Dropping on a group (not a card) puts it after the group's last card.
  const rest = list.filter((s) => s.id !== moving.id)
  const last = rest.filter((s) => groupOf(s) === target.group).at(-1)
  if (last) moveSubmission(list, moving.id, rest[rest.indexOf(last) + 1]?.id, extra)
  else if (extra) patch('submissions', moving.id, extra)
}

/**
 * Mouse drags start after a few pixels; touch drags after a short press, so
 * swiping over a card still scrolls the list.
 */
export function useCardSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )
}

/** Prefers the card under the pointer, then the list (column) it is over. */
export const cardsFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const card = hits.find((h) => String(h.id).startsWith('before:'))
  if (card) return [card]
  if (hits.length) return hits
  return rectIntersection(args)
}
