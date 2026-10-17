// Shared, hand-arranged order for questions and prototypes. Each submission
// has a rank (its `order`, or minus its creation time when never moved), so new
// submissions still appear first and moving one only rewrites that one record.
import { closestCorners, MouseSensor, pointerWithin, TouchSensor, useSensor, useSensors, type CollisionDetection } from '@dnd-kit/core'
import { LIST } from './liveSort'
import { patch } from './sync/store'
import type { Submission } from './types'

export const rankOf = (s: Submission) => s.order ?? -s.createdAt

export const byRank = (a: Submission, b: Submission) => rankOf(a) - rankOf(b)

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
 * Puts `id` just before `before`, or, with no `before`, right after the last of
 * `group` (the other submissions in the list it was dropped into, in order).
 */
export function placeSubmission(list: Submission[], id: string, group: Submission[], before?: string, extra?: Partial<Submission>) {
  if (before) return moveSubmission(list, id, before, extra)
  const rest = list.filter((s) => s.id !== id)
  const last = group.filter((s) => s.id !== id).at(-1)
  if (last) moveSubmission(list, id, rest[rest.indexOf(last) + 1]?.id, extra)
  else if (extra) patch('submissions', id, extra)
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
  const card = hits.find((h) => !String(h.id).startsWith(LIST))
  if (card) return [card]
  if (hits.length) return hits
  return closestCorners(args)
}
