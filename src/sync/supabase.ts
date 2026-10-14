import { createClient } from '@supabase/supabase-js'
import type { Backend, Change } from './store'

const TABLE = 'kickoff_docs'
const BUCKET = 'kickoff'

interface Row {
  collection: string
  id: string
  data: unknown
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const client = createClient(url, key, { auth: { persistSession: false } })

  return {
    mode: 'supabase',

    async loadAll() {
      const changes: Change[] = []
      // Supabase returns at most 1000 rows per request.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client.from(TABLE).select('collection,id,data').range(from, from + 999)
        if (error) throw error
        changes.push(...(data as Row[]))
        if (data.length < 1000) return changes
      }
    },

    subscribe(onChange, onStatus) {
      let connectedBefore = false
      const channel = client
        .channel('kickoff-docs')
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<Row>
            if (old.collection && old.id) onChange({ collection: old.collection, id: old.id, data: null })
          } else {
            const row = payload.new as Row
            onChange({ collection: row.collection, id: row.id, data: row.data })
          }
        })
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') {
            // Anything missed while disconnected is picked up by reloading.
            onStatus('live', connectedBefore)
            connectedBefore = true
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            onStatus('offline', false)
          }
        })
      return () => {
        client.removeChannel(channel)
      }
    },

    async put(collection, id, data) {
      const { error } = await client.from(TABLE).upsert({ collection, id, data, updated_at: new Date().toISOString() })
      if (error) throw error
    },

    async remove(collection, id) {
      const { error } = await client.from(TABLE).delete().match({ collection, id })
      if (error) throw error
    },

    async upload(file, name) {
      const path = `${crypto.randomUUID()}/${name.replace(/[^\w.-]+/g, '_')}`
      const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
      if (error) throw error
      return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    },

    async resolveUrl(url) {
      return url
    },
  }
}
