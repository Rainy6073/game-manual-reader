import type { ManualRef } from './reader/ManualReader'

export type Role = 'presenter' | 'standard'

export type SubmissionKind = 'question' | 'idea'

export type PrototypeStatus = 'todo' | 'active' | 'done'

/** A question or prototyping idea sent from the Game Manual page. */
export interface Submission {
  id: string
  kind: SubmissionKind
  text: string
  author: string
  createdAt: number
  /** The manual passage it was asked about, if any. */
  ref?: ManualRef
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
  meta: ManualMeta
  priorities: Priorities
}

export type CollectionName = keyof Collections

export const newId = () => crypto.randomUUID()
