import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMemo, useRef, useState } from 'react'
import Composer from '../components/Composer'
import RefChip from '../components/RefChip'
import { DropList, Sortable } from '../components/Sortable'
import { useLiveSort } from '../liveSort'
import { byRank, cardsFirst, placeSubmission, useCardSensors } from '../reorder'
import SubmissionCard from '../components/SubmissionCard'
import { clockTime, navigate } from '../nav'
import { useIsPresenter, useSession } from '../session'
import { patch, put, remove, uploadFile, useCollection, useFileUrl } from '../sync/store'
import { newId, PROTOTYPE_GROUP, type PrototypeStatus, type Submission } from '../types'
import ConfirmButton from '../components/ConfirmButton'

const STATUS: { id: PrototypeStatus; label: string }[] = [
  { id: 'todo', label: 'Not started' },
  { id: 'active', label: 'In progress' },
  { id: 'done', label: 'Done' },
]
const statusLabel = (s: PrototypeStatus) => STATUS.find((x) => x.id === s)!.label

type Filter = 'all' | 'mine'

const isAssigned = (s: Submission, name: string) =>
  !!s.prototype?.assignees.some((a) => a.trim().toLowerCase() === name.trim().toLowerCase())

export default function PrototypesPage({ openId }: { openId?: string }) {
  const presenter = useIsPresenter()
  const { name } = useSession()
  const submissions = useCollection('submissions')
  const responses = useCollection('responses')
  const [filter, setFilter] = useState<Filter>('all')
  const sensors = useCardSensors()

  // Only questions in the Question Board's "Prototype" group show here: those not
  // started yet on the left, the rest in the status columns.
  const inGroup = useMemo(() => submissions.filter((s) => s.groupId === PROTOTYPE_GROUP), [submissions])
  const prototypes = useMemo(() => inGroup.filter((s) => s.prototype).sort(byRank), [inGroup])
  const inbox = useMemo(() => inGroup.filter((s) => !s.prototype).sort(byRank), [inGroup])
  const responseCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of responses) m.set(r.submissionId, (m.get(r.submissionId) ?? 0) + 1)
    return m
  }, [responses])

  const shown = prototypes.filter((p) => filter === 'all' || isAssigned(p, name))
  const byId = new Map(submissions.map((s) => [s.id, s]))
  const promote = (s: Submission, status: PrototypeStatus = 'todo') =>
    patch('submissions', s.id, { prototype: { assignees: [], status, createdAt: Date.now(), grouped: true } })
  const canMove = (s: Submission) => presenter || (!!s.prototype && isAssigned(s, name))

  // Cards slide between and within the status columns while dragged; questions from
  // the inbox can be dragged into a column (but nothing goes back into the inbox).
  const live = useLiveSort({
    lists: {
      inbox: inbox.map((s) => s.id),
      ...Object.fromEntries(STATUS.map((st) => [st.id, shown.filter((p) => p.prototype!.status === st.id).map((p) => p.id)])),
    },
    canEnter: (_id, from, to) => to !== 'inbox' || from === 'inbox',
    onMove: (id, to, before) => {
      const s = byId.get(id)
      if (!s || to === 'inbox') return
      const status = to as PrototypeStatus
      const prototype = s.prototype ? { ...s.prototype, status } : { assignees: [], status, createdAt: Date.now(), grouped: true }
      placeSubmission(prototypes, id, shown.filter((p) => p.prototype!.status === status), before, { prototype })
    },
  })
  const dragged = live.activeId ? byId.get(live.activeId) : undefined

  const open = openId ? submissions.find((s) => s.id === openId) : undefined
  if (openId && open?.prototype) return <PrototypeDetail submission={open} />

  return (
    <DndContext sensors={sensors} collisionDetection={cardsFirst} {...live.handlers}>
      <div className="proto-page with-inbox">
        <aside className="inbox">
            <header className="section-head">
              <h2>Prototype group</h2>
              <span className="muted">{inbox.length}</span>
            </header>
            <p className="muted small">
              {presenter
                ? 'Questions in the Prototype group on the Question Board. Make them prototype tasks (or drag them into a column), then assign people.'
                : 'Questions in the Prototype group on the Question Board. The presenter turns them into prototype tasks.'}
            </p>
            {/* Written here, a question goes straight into the Question Board's Prototype group. */}
            <Composer groupId={PROTOTYPE_GROUP} placeholder="What should we prototype or test?" hint={null} />
            <div className="feed">
              {inbox.length === 0 && <p className="empty muted">
                  {inGroup.length
                    ? 'Everything in the Prototype group is already a prototype.'
                    : 'Nothing here yet. Write one above, or drag questions into the Prototype group on the Question Board.'}
                </p>}
              {/* The inbox keeps its own order: nothing shifts in it while dragging. */}
              <SortableContext items={live.items('inbox')} strategy={() => null}>
              {live.items('inbox').map((id) => byId.get(id)!).map((s) => (
                <Sortable key={s.id} id={s.id} enabled={presenter} whole className={presenter ? 'drag-src' : undefined}>
                  <SubmissionCard
                    submission={s}
                    actions={
                      presenter && (
                        <button className="small primary" onPointerDown={(e) => e.stopPropagation()} onClick={() => promote(s)}>
                          Make prototype →
                        </button>
                      )
                    }
                  />
                </Sortable>
              ))}
              </SortableContext>
            </div>
        </aside>

        <section className="proto-main">
          <header className="section-head wrap">
            <h2>Prototypes</h2>
            <div className="filter-chips">
              {(
                [
                  { id: 'all', label: 'All', n: prototypes.length },
                  { id: 'mine', label: 'Assigned to me', n: prototypes.filter((p) => isAssigned(p, name)).length },
                ] as { id: Filter; label: string; n: number }[]
              ).map((f) => (
                <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label} <span className="count">{f.n}</span>
                </button>
              ))}
            </div>
          </header>
          <p className="muted small proto-hint">
            {presenter
              ? 'Drag cards between columns to change their status.'
              : 'Drag prototypes assigned to you between columns to update their status. Tap a card to open it.'}
          </p>

          {prototypes.length === 0 && (
            <p className="empty muted">
              {presenter
                ? 'Drag questions into the Prototype group on the Question Board, then make them prototypes from the left.'
                : 'No prototypes yet. The presenter will create them from the team’s questions.'}
            </p>
          )}

          <div className="proto-columns">
            {STATUS.map((st) => {
              const items = live.items(st.id).map((id) => byId.get(id)!)
              return (
                <DropList key={st.id} group={st.id} enabled className={`column proto-column status-${st.id}`}>
                  <header className="column-head">
                    <h3>{st.label}</h3>
                    <span className="count-pill">{items.length}</span>
                  </header>
                  <div className="column-cards">
                    <SortableContext items={live.items(st.id)} strategy={verticalListSortingStrategy}>
                    {items.map((p) => (
                      <Sortable key={p.id} id={p.id} enabled={canMove(p)} whole className={canMove(p) ? 'drag-src' : 'drag-src static'}>
                        {p.prototype ? <ProtoCard p={p} updates={responseCount.get(p.id) ?? 0} /> : <SubmissionCard submission={p} />}
                      </Sortable>
                    ))}
                    </SortableContext>
                    {items.length === 0 && <p className="drop-hint muted small">{filter === 'mine' ? 'Nothing of yours here' : 'Drop cards here'}</p>}
                  </div>
                </DropList>
              )
            })}
          </div>
        </section>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className="proto-lifted">
            {dragged.prototype ? <ProtoCard p={dragged} updates={responseCount.get(dragged.id) ?? 0} /> : <SubmissionCard submission={dragged} />}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function ProtoCard({ p, updates }: { p: Submission; updates: number }) {
  const { name } = useSession()
  return (
    <button className={`proto-card status-${p.prototype!.status}`} onClick={() => navigate(`prototypes/${p.id}`)}>
      <span className="proto-card-top">
        <span className="muted small">{p.author}</span>
        <span className={`status-pill ${p.prototype!.status}`}>{statusLabel(p.prototype!.status)}</span>
      </span>
      <span className="proto-title">{p.text}</span>
      <span className="assignees">
        {p.prototype!.assignees.length ? (
          p.prototype!.assignees.map((a) => (
            <span key={a} className={`person${a.trim().toLowerCase() === name.trim().toLowerCase() ? ' me' : ''}`}>
              {a}
            </span>
          ))
        ) : (
          <span className="muted small">Unassigned</span>
        )}
      </span>
      <span className="muted small">
        {updates} {updates === 1 ? 'update' : 'updates'}
      </span>
    </button>
  )
}

function PrototypeDetail({ submission: s }: { submission: Submission }) {
  const presenter = useIsPresenter()
  const { name } = useSession()
  const proto = s.prototype!
  const submissions = useCollection('submissions')
  const allResponses = useCollection('responses')
  const responses = useMemo(
    () => allResponses.filter((r) => r.submissionId === s.id).sort((a, b) => a.createdAt - b.createdAt),
    [allResponses, s.id],
  )
  const [person, setPerson] = useState('')
  const canEdit = presenter
  const canSetStatus = presenter || isAssigned(s, name)

  // Names people have used, to suggest when assigning.
  const knownNames = useMemo(
    () => [...new Set([...submissions.map((x) => x.author), ...submissions.flatMap((x) => x.prototype?.assignees ?? [])])].sort(),
    [submissions],
  )

  const setProto = (fields: Partial<typeof proto>) => patch('submissions', s.id, { prototype: { ...proto, ...fields } })
  const addPerson = () => {
    const p = person.trim()
    if (p && !proto.assignees.some((a) => a.toLowerCase() === p.toLowerCase())) setProto({ assignees: [...proto.assignees, p] })
    // Cleared after the browser finishes applying a picked suggestion.
    setTimeout(() => setPerson(''))
  }

  return (
    <div className="proto-detail">
      <div className="detail-top">
        <button onClick={() => navigate('prototypes')}>← All prototypes</button>
        {canEdit && (
          <ConfirmButton
            className="link danger"
            title="The question and its updates are kept"
            confirmLabel="Click again to remove"
            onConfirm={() => {
              patch('submissions', s.id, { prototype: undefined })
              navigate('prototypes')
            }}
          >
            Remove from prototypes
          </ConfirmButton>
        )}
      </div>

      <section className="detail-card">
        <div className="row">
          <span className="muted small">
            from {s.author} · {clockTime(s.createdAt)}
          </span>
        </div>
        {canEdit ? (
          <textarea
            key={s.text}
            className="detail-title-edit"
            defaultValue={s.text}
            rows={2}
            aria-label="Prototype question"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== s.text) patch('submissions', s.id, { text: v })
              else e.target.value = s.text
            }}
          />
        ) : (
          <h2 className="detail-title">{s.text}</h2>
        )}
        {canEdit && <p className="muted small">Edits here also update the original on the Game Manual page.</p>}
        {s.ref && <RefChip reference={s.ref} />}

        <div className="detail-meta">
          <div>
            <h4>Status</h4>
            {canSetStatus ? (
              <div className="segmented">
                {STATUS.map((st) => (
                  <button key={st.id} role="radio" aria-checked={proto.status === st.id} onClick={() => setProto({ status: st.id })}>
                    {st.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className={`status-pill ${proto.status}`}>{statusLabel(proto.status)}</span>
            )}
          </div>
          <div>
            <h4>Assigned to</h4>
            <div className="assignees">
              {proto.assignees.map((a) => (
                <span key={a} className={`person${a.toLowerCase() === name.trim().toLowerCase() ? ' me' : ''}`}>
                  {a}
                  {canEdit && (
                    <button aria-label={`Unassign ${a}`} onClick={() => setProto({ assignees: proto.assignees.filter((x) => x !== a) })}>
                      ✕
                    </button>
                  )}
                </span>
              ))}
              {!proto.assignees.length && !canEdit && <span className="muted small">Nobody yet</span>}
              {canEdit && (
                <form
                  className="assign-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    addPerson()
                  }}
                >
                  <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Add a name" list="known-names" aria-label="Assign a person" />
                  <datalist id="known-names">
                    {knownNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                  <button disabled={!person.trim()}>Assign</button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="updates">
        <h3>Results &amp; notes</h3>
        {responses.length === 0 && <p className="empty muted">No updates yet. Post what you tried, what you measured and photos of the prototype.</p>}
        {responses.map((r) => (
          <article key={r.id} className="update">
            <header>
              <strong>{r.author}</strong>
              <span className="muted small">{clockTime(r.createdAt)}</span>
              {(presenter || r.author === name) && (
                <ConfirmButton className="link danger small" onConfirm={() => remove('responses', r.id)} confirmLabel="Click again to delete">
                  Delete
                </ConfirmButton>
              )}
            </header>
            {r.text && <p className="update-text">{r.text}</p>}
            {r.images.length > 0 && (
              <div className="photos">
                {r.images.map((url) => (
                  <Photo key={url} url={url} />
                ))}
              </div>
            )}
          </article>
        ))}
        <ResponseForm submissionId={s.id} />
      </section>
    </div>
  )
}

function Photo({ url }: { url: string }) {
  const src = useFileUrl(url)
  if (!src) return <span className="photo loading" />
  return (
    <a className="photo" href={src} target="_blank" rel="noreferrer">
      <img src={src} alt="Prototype photo" loading="lazy" />
    </a>
  )
}

/** Shrinks a photo to at most 1600px on its long side, as JPEG, before uploading. */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

function ResponseForm({ submissionId }: { submissionId: string }) {
  const { name } = useSession()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])

  const submit = async () => {
    if (!text.trim() && files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const images = await Promise.all(files.map(async (f) => uploadFile(await compress(f), f.name.replace(/\.\w+$/, '.jpg'))))
      put('responses', { id: newId(), submissionId, author: name, text: text.trim(), images, createdAt: Date.now() })
      setText('')
      setFiles([])
    } catch (err) {
      console.error(err)
      setError('Could not upload the photos. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="response-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="What did you try? What worked, what didn’t, measurements, next steps…"
        aria-label="Update"
      />
      {files.length > 0 && (
        <div className="photos">
          {previews.map((src, i) => (
            <span key={src} className="photo">
              <img src={src} alt="" />
              <button type="button" aria-label="Remove photo" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <div className="composer-foot">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
          📷 Add photos
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])]
            setFiles((fs) => [...fs, ...picked])
            e.target.value = ''
          }}
        />
        <button className="primary" disabled={busy || (!text.trim() && files.length === 0)}>
          {busy ? 'Posting…' : 'Post update'}
        </button>
      </div>
    </form>
  )
}
