import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useMemo, useRef, useState } from 'react'
import RefChip from '../components/RefChip'
import SubmissionCard from '../components/SubmissionCard'
import { clockTime, navigate } from '../nav'
import { useIsPresenter, useSession } from '../session'
import { patch, put, remove, uploadFile, useCollection, useFileUrl } from '../sync/store'
import { newId, type PrototypeStatus, type Submission } from '../types'

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
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const prototypes = useMemo(
    () => submissions.filter((s) => s.prototype).sort((a, b) => a.prototype!.createdAt - b.prototype!.createdAt),
    [submissions],
  )
  const inbox = useMemo(() => submissions.filter((s) => !s.prototype).sort((a, b) => b.createdAt - a.createdAt), [submissions])
  const responseCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of responses) m.set(r.submissionId, (m.get(r.submissionId) ?? 0) + 1)
    return m
  }, [responses])

  const open = openId ? submissions.find((s) => s.id === openId) : undefined
  if (openId && open?.prototype) return <PrototypeDetail submission={open} />

  const shown = prototypes.filter((p) => filter === 'all' || isAssigned(p, name))
  const promote = (s: Submission, status: PrototypeStatus = 'todo') =>
    patch('submissions', s.id, { prototype: { assignees: [], status, createdAt: Date.now() } })
  const canMove = (s: Submission) => presenter || (!!s.prototype && isAssigned(s, name))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    const status = over?.id as PrototypeStatus | undefined
    const s = submissions.find((x) => x.id === active.id)
    if (!s || !status) return
    if (!s.prototype) promote(s, status)
    else if (s.prototype.status !== status) patch('submissions', s.id, { prototype: { ...s.prototype, status } })
  }
  const dragged = dragging ? submissions.find((x) => x.id === dragging) : undefined

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className={`proto-page${presenter ? ' with-inbox' : ''}`}>
        {presenter && (
          <aside className="inbox">
            <header className="section-head">
              <h2>From brainstorming</h2>
              <span className="muted">{inbox.length}</span>
            </header>
            <p className="muted small">Turn questions and ideas into prototype tasks (or drag them into a column), then assign people to them.</p>
            <div className="feed">
              {inbox.length === 0 && <p className="empty muted">Everything submitted is already a prototype.</p>}
              {inbox.map((s) => (
                <Draggable key={s.id} id={s.id} enabled>
                  <SubmissionCard
                    submission={s}
                    actions={
                      <button className="small primary" onPointerDown={(e) => e.stopPropagation()} onClick={() => promote(s)}>
                        Make prototype →
                      </button>
                    }
                  />
                </Draggable>
              ))}
            </div>
          </aside>
        )}

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
                ? 'Pick questions and ideas from the left to make them official prototypes.'
                : 'No prototypes yet. The presenter will create them from the team’s questions and ideas.'}
            </p>
          )}

          <div className="proto-columns">
            {STATUS.map((st) => {
              const items = shown.filter((p) => p.prototype!.status === st.id)
              return (
                <StatusColumn key={st.id} status={st.id}>
                  <header className="column-head">
                    <h3>{st.label}</h3>
                    <span className="count-pill">{items.length}</span>
                  </header>
                  <div className="column-cards">
                    {items.map((p) => (
                      <Draggable key={p.id} id={p.id} enabled={canMove(p)}>
                        <ProtoCard p={p} updates={responseCount.get(p.id) ?? 0} />
                      </Draggable>
                    ))}
                    {items.length === 0 && <p className="drop-hint muted small">{filter === 'mine' ? 'Nothing of yours here' : 'Drop cards here'}</p>}
                  </div>
                </StatusColumn>
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

function StatusColumn({ status, children }: { status: PrototypeStatus; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section ref={setNodeRef} className={`column proto-column status-${status}${isOver ? ' over' : ''}`}>
      {children}
    </section>
  )
}

function Draggable({ id, enabled, children }: { id: string; enabled: boolean; children: React.ReactNode }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id, disabled: !enabled })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} role={undefined} tabIndex={undefined} className={`drag-src${isDragging ? ' ghost' : ''}${enabled ? '' : ' static'}`}>
      {children}
    </div>
  )
}

function ProtoCard({ p, updates }: { p: Submission; updates: number }) {
  const { name } = useSession()
  return (
    <button className={`proto-card status-${p.prototype!.status}`} onClick={() => navigate(`prototypes/${p.id}`)}>
      <span className="proto-card-top">
        <span className={`kind-badge ${p.kind}`}>{p.kind === 'question' ? 'Question' : 'Idea'}</span>
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
          <button
            className="link danger"
            onClick={() => {
              if (!confirm('Remove this from prototypes? The question/idea and its updates are kept.')) return
              patch('submissions', s.id, { prototype: undefined })
              navigate('prototypes')
            }}
          >
            Remove from prototypes
          </button>
        )}
      </div>

      <section className="detail-card">
        <div className="row">
          <span className={`kind-badge ${s.kind}`}>{s.kind === 'question' ? 'Question' : 'Idea'}</span>
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
                <button className="link danger small" onClick={() => confirm('Delete this update?') && remove('responses', r.id)}>
                  Delete
                </button>
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
