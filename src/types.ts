import type { ManualRef } from './reader/ManualReader'

export type Role = 'presenter' | 'standard'

/** Everything is a question now; 'idea' only appears on older records. */
export type SubmissionKind = 'question' | 'idea'

export type PrototypeStatus = 'todo' | 'active' | 'done'

/** A question sent from the Game Manual page (it can become a prototype). */
export interface Submission {
  id: string
  kind: SubmissionKind
  text: string
  author: string
  createdAt: number
  /** The manual passage it was asked about, if any. */
  ref?: ManualRef
  /** More passages attached later from the manual. */
  refs?: ManualRef[]
  /** Position in the hand-arranged order (see reorder.ts). */
  order?: number
  /** The Question Board group it was sorted into, if any. */
  groupId?: string
  /** Set once the presenter turns it into an official prototype task. */
  prototype?: {
    assignees: string[]
    status: PrototypeStatus
    createdAt: number
  }
}

/** Something a robot could do, rated on the Fibonacci scale. */
export interface Ability {
  id: string
  name: string
  effort: number | null
  value: number | null
  createdAt: number
  /** Position in the presenter's list; unset keeps creation order. */
  order?: number
}

/** A rating someone suggests for an ability, waiting for the presenter to review. */
export interface Proposal {
  id: string
  abilityId: string
  author: string
  effort: number
  value: number
  createdAt: number
}

export interface ArchetypeItem {
  /** Unique per card, since the same ability can appear many times. */
  key: string
  abilityId: string
}

export interface Archetype {
  id: string
  name: string
  items: ArchetypeItem[]
  createdAt: number
}

/** Results someone reports back on a prototype. */
export interface PrototypeResponse {
  id: string
  submissionId: string
  author: string
  text: string
  /** Uploaded photo URLs. */
  images: string[]
  createdAt: number
}

/** An answer someone posted to a question. */
export interface Answer {
  id: string
  submissionId: string
  author: string
  text: string
  createdAt: number
}

/** Someone's own highlight (no text) or note on a passage of the manual. */
export interface ManualNoteDoc {
  id: string
  author: string
  page: number
  quote: string
  text: string
  createdAt: number
}

/** A group people made on the Question Board to collect similar questions and ideas. */
export interface BoardGroup {
  id: string
  name: string
  createdAt: number
}

export interface ManualMeta {
  id: 'manual'
  url: string
  name: string
  password?: string
  uploadedBy: string
  uploadedAt: number
}

/** The top-down field image used by this device's Field Board. */
export interface FieldImage {
  /** Where the image is kept on this device (see tools/localFiles.ts). */
  key: string
  width: number
  height: number
  /** Where it came from, e.g. "2026 manual, page 18". */
  source: string
}

export type Alliance = 'red' | 'blue' | 'neutral'

/** A robot token; x/y are its center as fractions of the field image's width/height. */
export interface BoardRobot {
  id: string
  x: number
  y: number
  alliance: Alliance
  label: string
  /** Which way it faces, in degrees clockwise from facing up. */
  angle?: number
}

/** A drawn line or path; points are fractions of the image's width/height. */
export interface BoardStroke {
  id: string
  kind: 'pen' | 'line'
  points: [number, number][]
  color: string
  /** Line width as a fraction of the image width. */
  width: number
  arrow: boolean
}

export interface FieldBoard {
  robots: BoardRobot[]
  strokes: BoardStroke[]
  /** Robot size as a fraction of the image width. */
  robotSize: number
}

export type PriorityTier = 'needs' | 'wants' | 'nice'

/** Abilities sorted into Needs / Wants / Nice to Haves; each ability is in at most one tier. */
export interface Priorities {
  id: string
  needs: string[]
  wants: string[]
  nice: string[]
}

export interface Collections {
  submissions: Submission
  abilities: Ability
  archetypes: Archetype
  responses: PrototypeResponse
  answers: Answer
  notes: ManualNoteDoc
  groups: BoardGroup
  proposals: Proposal
  meta: ManualMeta
  priorities: Priorities
}

export type CollectionName = keyof Collections

export const newId = () => crypto.randomUUID()
