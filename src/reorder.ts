// Shared, hand-arranged order for questions, ideas and prototypes. Each submission
// has a rank (its `order`, or minus its creation time when never moved), so new
// submissions still appear first and moving one only rewrites that one record.
import type { DragEndEvent } from '@dnd-kit/core'
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

/** Handles a drop for a list sorted by rank; ignores drops into another group. */
export function reorderOnDrop(list: Submission[], { active, over }: DragEndEvent, groupOf: (s: Submission) => string) {
  const target = over?.data.current as DropTarget | undefined
  const moving = list.find((s) => s.id === active.id)
  if (!target || !moving || target.before === moving.id || groupOf(moving) !== target.group) return
  if (target.before) return moveSubmission(list, moving.id, target.before)
  // Dropping on the end of a group puts it after the group's last card.
  const rest = list.filter((s) => s.id !== moving.id)
  const last = rest.filter((s) => groupOf(s) === target.group).at(-1)
  if (last) moveSubmission(list, moving.id, rest[rest.indexOf(last) + 1]?.id)
}
