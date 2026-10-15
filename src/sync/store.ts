// Shared, live-synced state. Every record lives in a named collection; changes are
// applied locally right away and pushed to the backend, and changes from other
// devices stream in. Without Supabase settings the app falls back to a backend that
// only syncs between tabs on this device.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CollectionName, Collections } from '../types'
import { createLocalBackend } from './local'
import { createSupabaseBackend } from './supabase'

export type SyncStatus = 'connecting' | 'live' | 'offline' | 'local'

export interface Change {
  collection: string
  id: string
  /** null when the record was deleted. */
  data: unknown | null
}

export interface Backend {
  readonly mode: 'supabase' | 'local'
  /** Every record, for the first load and after reconnecting. */
  loadAll(): Promise<Change[]>
  /** Streams changes made on other devices; returns an unsubscribe function. */
  subscribe(onChange: (change: Change) => void, onStatus: (status: SyncStatus, resynced: boolean) => void): () => void
  put(collection: string, id: string, data: unknown): Promise<void>
  remove(collection: string, id: string): Promise<void>
  /** Uploads a file and returns a URL for it (resolve it with useFileUrl). */
  upload(file: Blob, name: string): Promise<string>
  /** Turns a stored URL into one the browser can load. */
  resolveUrl(url: string): Promise<string>
  /** Deletes every shared record (and, where allowed, uploaded file). */
  clearAll(): Promise<void>
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const backend: Backend = url && key ? createSupabaseBackend(url, key) : createLocalBackend()

type Docs = Map<string, unknown>
const data = new Map<string, Docs>()
const snapshots = new Map<string, unknown[]>()
const listeners = new Set<() => void>()
let status: SyncStatus = backend.mode === 'local' ? 'local' : 'connecting'
let error: string | null = null

function emit(collections: Iterable<string>) {
  for (const c of collections) snapshots.delete(c)
  for (const l of listeners) l()
}

function apply(changes: Change[], replace = false) {
  const touched = new Set<string>(replace ? data.keys() : [])
  if (replace) data.clear()
  for (const { collection, id, data: value } of changes) {
    touched.add(collection)
    let docs = data.get(collection)
    if (!docs) data.set(collection, (docs = new Map()))
    if (value == null) docs.delete(id)
    else docs.set(id, value)
  }
  emit(touched)
}

async function resync() {
  try {
    apply(await backend.loadAll(), true)
    error = null
  } catch (err) {
    console.error(err)
    error = 'Could not load shared data.'
    emit([])
  }
}

resync()
backend.subscribe(
  (change) => apply([change]),
  (next, resynced) => {
    status = next
    if (resynced) resync()
    else emit([])
  },
)
// Phones drop connections while asleep; catch up when the page is shown again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resync()
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot<C extends CollectionName>(collection: C): Collections[C][] {
  let list = snapshots.get(collection)
  if (!list) {
    list = [...(data.get(collection)?.values() ?? [])]
    snapshots.set(collection, list)
  }
  return list as Collections[C][]
}

/** All records in a collection, kept live. Order is unspecified; sort as needed. */
export function useCollection<C extends CollectionName>(collection: C): Collections[C][] {
  return useSyncExternalStore(subscribe, () => snapshot(collection))
}

export function useDoc<C extends CollectionName>(collection: C, id: string): Collections[C] | undefined {
  return useSyncExternalStore(subscribe, () => data.get(collection)?.get(id) as Collections[C] | undefined)
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribe, () => `${status}|${error ?? ''}`).split('|') as [SyncStatus, string]
}

function report(err: unknown) {
  console.error(err)
  error = 'A change could not be saved. Check your connection.'
  emit([])
}

export function put<C extends CollectionName>(collection: C, doc: Collections[C]) {
  apply([{ collection, id: doc.id, data: doc }])
  backend.put(collection, doc.id, doc).catch(report)
}

/** Merges fields into a record (using the latest local copy). */
export function patch<C extends CollectionName>(collection: C, id: string, fields: Partial<Collections[C]>) {
  const current = data.get(collection)?.get(id) as Collections[C] | undefined
  if (current) put(collection, { ...current, ...fields })
}

export function remove(collection: CollectionName, id: string) {
  apply([{ collection, id, data: null }])
  backend.remove(collection, id).catch(report)
}

/**
 * Deletes all shared data for everyone, plus this device's own boards and
 * settings (the remembered name is kept).
 */
export async function resetAllData() {
  await backend.clearAll()
  apply([], true)
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('kickoff.') && key !== 'kickoff.lastSession') localStorage.removeItem(key)
    }
    indexedDB.deleteDatabase('kickoff-tool-files')
  } catch {
    // Storage unavailable.
  }
}

export const uploadFile = (file: Blob, name: string) => backend.upload(file, name)
export const resolveFileUrl = (url: string) => backend.resolveUrl(url)
export const syncMode = backend.mode

/** A loadable URL for a stored file (local files are kept in IndexedDB). */
export function useFileUrl(url: string | undefined) {
  const [resolved, setResolved] = useState<string | null>(null)
  useEffect(() => {
    if (!url) {
      setResolved(null)
      return
    }
    let cancelled = false
    backend.resolveUrl(url).then(
      (u) => !cancelled && setResolved(u),
      () => !cancelled && setResolved(null),
    )
    return () => {
      cancelled = true
    }
  }, [url])
  return resolved
}
