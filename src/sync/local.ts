// Fallback backend for trying the app without Supabase: records live in
// localStorage, files in IndexedDB, and tabs on this device stay in sync through a
// BroadcastChannel. Other devices do not see any of it.
import type { Backend, Change } from './store'

const DOCS_KEY = 'kickoff.local.docs'
const FILE_PREFIX = 'idb:'

type Stored = Record<string, Record<string, unknown>>

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(DOCS_KEY) ?? '{}') as Stored
  } catch {
    return {}
  }
}

function write(stored: Stored) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(stored))
  } catch (err) {
    console.error('Could not save locally', err)
  }
}

function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kickoff-files', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function fileStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openFiles()
  return new Promise((resolve, reject) => {
    const req = run(db.transaction('files', mode).objectStore('files'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function createLocalBackend(): Backend {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kickoff-local') : null
  const objectUrls = new Map<string, string>()

  const save = (change: Change) => {
    const stored = read()
    const docs = (stored[change.collection] ??= {})
    if (change.data == null) delete docs[change.id]
    else docs[change.id] = change.data
    write(stored)
    channel?.postMessage(change)
  }

  return {
    mode: 'local',

    async loadAll() {
      return Object.entries(read()).flatMap(([collection, docs]) =>
        Object.entries(docs).map(([id, data]) => ({ collection, id, data })),
      )
    },

    subscribe(onChange, onStatus) {
      onStatus('local', false)
      // Another tab reset everything: reload from (now empty) storage.
      const listener = (e: MessageEvent<Change | { reset: true }>) =>
        'reset' in e.data ? onStatus('local', true) : onChange(e.data)
      channel?.addEventListener('message', listener)
      return () => channel?.removeEventListener('message', listener)
    },

    async put(collection, id, data) {
      save({ collection, id, data })
    },

    async remove(collection, id) {
      save({ collection, id, data: null })
    },

    async upload(file) {
      const key = crypto.randomUUID()
      await fileStore('readwrite', (s) => s.put(file, key))
      return FILE_PREFIX + key
    },

    async clearAll() {
      write({})
      await fileStore('readwrite', (s) => s.clear())
      channel?.postMessage({ reset: true })
    },

    async resolveUrl(url) {
      if (!url.startsWith(FILE_PREFIX)) return url
      const cached = objectUrls.get(url)
      if (cached) return cached
      const blob = await fileStore<Blob | undefined>('readonly', (s) => s.get(url.slice(FILE_PREFIX.length)))
      if (!blob) throw new Error('File not found on this device')
      const objectUrl = URL.createObjectURL(blob)
      objectUrls.set(url, objectUrl)
      return objectUrl
    },
  }
}
