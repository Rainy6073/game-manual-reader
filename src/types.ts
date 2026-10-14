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

export interface ManualMeta {
  id: 'manual'
  url: string
  name: string
  password?: string
  uploadedBy: string
  uploadedAt: number
}

export interface Collections {
  submissions: Submission
  abilities: Ability
  archetypes: Archetype
  responses: PrototypeResponse
  meta: ManualMeta
}

export type CollectionName = keyof Collections

export const newId = () => crypto.randomUUID()
