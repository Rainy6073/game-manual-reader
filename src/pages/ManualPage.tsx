import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Composer from '../components/Composer'
import { AttachPicker, NoteEditor, NotesList, type NoteDraft } from '../components/ManualNotes'
import QuestionBoard from '../components/QuestionBoard'
import { ListEnd, Sortable } from '../components/Sortable'
import { byRank, reorderOnDrop } from '../reorder'
import SubmissionCard from '../components/SubmissionCard'
import ManualReader, { type ManualRef, type ManualSource } from '../reader/ManualReader'
import { isPasswordError, loadPdf } from '../reader/pdf'
import { useIsPresenter, useLocalState, useSession } from '../session'
import { patch, put, remove, uploadFile, useCollection, useDoc, useFileUrl } from '../sync/store'
import { newId, type SubmissionKind } from '../types'

const SAMPLE = { url: '/manuals/2026GameManual.pdf', name: '2026 FRC Game Manual (REBUILT)' }

type Filter = 'all' | SubmissionKind | 'mine' | 'notes'

const MIN_SIDE = 260
/** Dragging the panel narrower than this collapses it. */
const COLLAPSE_AT = 170
/** Dragging the divider this close to the right edge opens the Question Board. */
const BOARD_AT = 140
const maxSide = () => Math.max(MIN_SIDE, Math.round(window.innerWidth * 0.7))

const WIDE = '(min-width: 901px)'
/** True on screens wide enough for side-by-side panels. */
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

/** An encrypted PDF waiting for its passcode before it is uploaded. */
interface PendingUpload {
  file: File
  wrong: boolean
}

export default function ManualPage() {
  const presenter = useIsPresenter()
  const { name } = useSession()
  const manual = useDoc('meta', 'manual')
  const manualUrl = useFileUrl(manual?.url)
  const submissions = useCollection('submissions')
  const allNotes = useCollection('notes')
  // Highlights and notes are each person's own.
  const myNotes = useMemo(
    () => allNotes.filter((n) => n.author === name).sort((a, b) => b.createdAt - a.createdAt),
    [allNotes, name],
  )
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [attaching, setAttaching] = useState<ManualRef | null>(null)
  const openNote = useCallback(
    (id: string, at: { x: number; y: number }) => {
      const note = myNotes.find((n) => n.id === id)
      if (note) setNoteDraft({ note, at })
    },
    [myNotes],
  )
  const highlight = useCallback(
    (ref: ManualRef) => put('notes', { id: newId(), author: name, page: ref.page, quote: ref.quote, text: '', createdAt: Date.now() }),
    [name],
  )
  const [reference, setReference] = useState<ManualRef | null>(null)
  const [jump, setJump] = useState<(ManualRef & { token: number }) | undefined>()
  const [filter, setFilter] = useState<Filter>(presenter ? 'all' : 'mine')
  // On narrow screens only one side is shown at a time.
  const [pane, setPane] = useState<'side' | 'manual'>('manual')
  // On wider screens the side panel is resizable and can collapse to a thin rail.
  const [sideWidth, setSideWidth] = useLocalState(
    `kickoff.sideWidth.${presenter ? 'presenter' : 'standard'}`,
    presenter ? Math.max(380, Math.round(window.innerWidth * 0.34)) : 380,
  )
  const [sideCollapsed, setSideCollapsed] = useLocalState('kickoff.sideCollapsed', false)
  // Dragging the divider all the way right swaps the manual for the Question Board.
  const [boardOpen, setBoardOpen] = useLocalState('kickoff.questionBoard', false)
  const wide = useWide()
  const board = boardOpen && wide
  const pageRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [passcode, setPasscode] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const source = useMemo<ManualSource | null>(
    () => (manual && manualUrl ? { url: manualUrl, name: manual.name, password: manual.password } : null),
    [manual, manualUrl],
  )

  const jumpTo = useCallback((ref: ManualRef) => {
    setJump({ ...ref, token: Date.now() })
    setPane('manual')
    setBoardOpen(false)
  }, [setBoardOpen])

  const addReference = useCallback((ref: ManualRef) => {
    setReference(ref)
    setPane('side')
    setSideCollapsed(false)
  }, [setSideCollapsed])

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const { left, right } = pageRef.current!.getBoundingClientRect()
    document.body.classList.add('resizing')
    // Collapsing by dragging keeps the width the panel had before, for reopening.
    const startWidth = sideWidth
    const move = (ev: PointerEvent) => {
      const width = ev.clientX - left
      if (width < COLLAPSE_AT) {
        setSideCollapsed(true)
        setBoardOpen(false)
        setSideWidth(startWidth)
      } else if (ev.clientX > right - BOARD_AT) {
        setSideCollapsed(false)
        setBoardOpen(true)
        setSideWidth(startWidth)
      } else {
        setSideCollapsed(false)
        setBoardOpen(false)
        setSideWidth(Math.min(maxSide(), Math.max(MIN_SIDE, Math.round(width))))
      }
    }
    const up = () => {
      document.body.classList.remove('resizing')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  // Remember the passcode for everyone once someone has unlocked the shared manual.
  const savePassword = useCallback(
    (password: string) => {
      if (manual && manual.password !== password) patch('meta', 'manual', { password })
    },
    [manual],
  )

  /** Checks the file opens (with the passcode, if encrypted), then shares it. */
  const upload = async (file: File, password?: string) => {
    setUploadError(null)
    setUploading(true)
    try {
      try {
        const doc = await loadPdf(await file.arrayBuffer(), password)
        doc.loadingTask.destroy()
      } catch (err) {
        if (isPasswordError(err)) {
          setPending({ file, wrong: !!password })
          return
        }
        throw err
      }
      const url = await uploadFile(file, file.name)
      put('meta', {
        id: 'manual',
        url,
        name: file.name.replace(/\.pdf$/i, ''),
        ...(password ? { password } : {}),
        uploadedBy: name,
        uploadedAt: Date.now(),
      })
      setPending(null)
      setPasscode('')
    } catch (err) {
      console.error(err)
      setUploadError('Could not upload that file. Make sure it is a valid PDF.')
    } finally {
      setUploading(false)
    }
  }

  const shareSample = () =>
    put('meta', { id: 'manual', url: SAMPLE.url, name: SAMPLE.name, uploadedBy: name, uploadedAt: Date.now() })

  // Newest first, unless the presenter has dragged things into another order.
  const sorted = useMemo(() => [...submissions].sort(byRank), [submissions])
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  )
  const dragged = dragging ? submissions.find((s) => s.id === dragging) : undefined
  const shown = filter === 'notes' ? [] : sorted.filter((s) => (filter === 'all' ? true : filter === 'mine' ? s.author === name : s.kind === filter))
  const counts = {
    all: sorted.length,
    question: sorted.filter((s) => s.kind === 'question').length,
    idea: sorted.filter((s) => s.kind === 'idea').length,
    mine: sorted.filter((s) => s.author === name).length,
    notes: myNotes.length,
  }
  const filters: { id: Filter; label: string }[] = presenter
    ? [
        { id: 'all', label: 'All' },
        { id: 'question', label: 'Questions' },
        { id: 'idea', label: 'Ideas' },
        { id: 'notes', label: 'My notes' },
      ]
    : [
        { id: 'mine', label: 'Mine' },
        { id: 'all', label: 'Everyone' },
        { id: 'notes', label: 'My notes' },
      ]

  const uploadButton = presenter && (
    <>
      <button className="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : manual ? 'Replace manual' : 'Upload manual'}
      </button>
      {manual && manual.url !== SAMPLE.url && (
        <button
          onClick={() => confirm('Switch everyone back to the bundled 2026 manual?') && shareSample()}
          disabled={uploading}
          title="Switch back to the bundled 2026 manual"
        >
          Use 2026 manual
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
          e.target.value = ''
        }}
      />
    </>
  )

  return (
    <div
      ref={pageRef}
      className={`manual-page show-${pane}${sideCollapsed && !board ? ' side-collapsed' : ''}${board ? ' board-open' : ''}`}
    >
      <div className="pane-switch" role="tablist">
        <button role="tab" aria-selected={pane === 'side'} onClick={() => setPane('side')}>
          {presenter ? `Submissions (${counts.all})` : 'Ask / Suggest'}
        </button>
        <button role="tab" aria-selected={pane === 'manual'} onClick={() => setPane('manual')}>
          Manual
        </button>
      </div>

      <button className="side-rail" onClick={() => setSideCollapsed(false)} title="Show the side panel" aria-label="Show the side panel">
        <span aria-hidden>»</span>
        <span className="rail-label">{presenter ? `Submissions · ${counts.all}` : 'Ask / Suggest'}</span>
      </button>

      <section className="side-panel" style={board ? undefined : { width: Math.min(sideWidth, maxSide()) }}>
        {board ? (
          <QuestionBoard
            submissions={submissions}
            reference={reference}
            onClearReference={() => setReference(null)}
            onJump={jumpTo}
            onClose={() => setBoardOpen(false)}
          />
        ) : (
          <>
            <div className="side-tools">
              <button
                className="icon ghost"
                onClick={() => setBoardOpen(true)}
                title="Open the Question Board (or drag the divider all the way right)"
                aria-label="Open the Question Board"
              >
                ⤢
              </button>
              <button
                className="icon ghost"
                onClick={() => setSideCollapsed(true)}
                title="Collapse this panel"
                aria-label="Collapse the side panel"
              >
                «
              </button>
            </div>
            <Composer reference={reference} onClearReference={() => setReference(null)} onJump={jumpTo} />

            <div className="feed-head">
              <h2>{presenter ? 'Submitted by the team' : 'Submissions'}</h2>
              <div className="filter-chips">
                {filters.map((f) => (
                  <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label} <span className="count">{counts[f.id]}</span>
                  </button>
                ))}
              </div>
            </div>
            <DndContext
              sensors={sensors}
              onDragStart={(e) => setDragging(String(e.active.id))}
              onDragCancel={() => setDragging(null)}
              onDragEnd={(e) => {
                setDragging(null)
                reorderOnDrop(sorted, e, () => 'feed')
              }}
            >
            <div className="feed">
              {filter === 'notes' && <NotesList notes={myNotes} onJump={jumpTo} onEdit={(note, at) => setNoteDraft({ note, at })} />}
              {filter !== 'notes' && shown.length === 0 && (
                <p className="empty muted">
                  {filter === 'mine' ? 'Nothing sent yet. Your questions and ideas will show up here.' : 'No submissions yet.'}
                </p>
              )}
              {shown.map((s) => (
                <Sortable key={s.id} id={s.id} group="feed" enabled={presenter}>
                  {(handle) => (
                <SubmissionCard
                  submission={s}
                  handle={handle}
                  onJump={jumpTo}
                  answerable
                  actions={
                    (presenter || s.author === name) && (
                      <button
                        className="link danger"
                        onClick={() => {
                          if (confirm('Delete this submission?')) remove('submissions', s.id)
                        }}
                      >
                        Delete
                      </button>
                    )
                  }
                />
                  )}
                </Sortable>
              ))}
              <ListEnd group="feed" enabled={presenter && shown.length > 0} />
            </div>
              <DragOverlay dropAnimation={null}>{dragged && <div className="sortable-lifted"><SubmissionCard submission={dragged} /></div>}</DragOverlay>
            </DndContext>
          </>
        )}
      </section>

      <div
        className="side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side panel"
        aria-valuenow={sideWidth}
        tabIndex={0}
        title="Drag to resize · all the way left collapses · all the way right opens the Question Board"
        onPointerDown={startResize}
        onDoubleClick={() => setSideCollapsed(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setSideWidth((w) => Math.max(MIN_SIDE, w - 24))
          else if (e.key === 'ArrowRight') setSideWidth((w) => Math.min(maxSide(), w + 24))
        }}
      />

      <button className="manual-rail" onClick={() => setBoardOpen(false)} title="Show the manual" aria-label="Show the manual">
        <span aria-hidden>«</span>
        <span className="rail-label">Game manual</span>
      </button>

      <section className="manual-panel">
        <ManualReader
          source={source}
          actions={uploadButton}
          onReference={addReference}
          jump={jump}
          onPassword={savePassword}
          notes={myNotes}
          onNote={(ref, at) => setNoteDraft({ ref, at })}
          onHighlight={highlight}
          onAttach={setAttaching}
          onOpenNote={openNote}
          empty={
            <div className="empty-manual">
              {manual && !manualUrl ? (
                <p className="muted">Loading the manual…</p>
              ) : presenter ? (
                <>
                  <h3>Upload this year’s game manual</h3>
                  <p className="muted">Encrypted PDFs are fine; you’ll be asked for the passcode. Everyone’s screen opens it automatically.</p>
                  <div className="row">
                    {uploadButton}
                    <button onClick={shareSample}>Use 2026 manual</button>
                  </div>
                  {uploadError && <p className="error-text">{uploadError}</p>}
                </>
              ) : (
                <>
                  <h3>Waiting for the manual</h3>
                  <p className="muted">It will appear here as soon as the presenter uploads it. You can already send questions and ideas.</p>
                </>
              )}
            </div>
          }
        />
        {uploadError && manual && <div className="toast error-text">{uploadError}</div>}
      </section>

      {noteDraft && <NoteEditor key={noteDraft.note?.id ?? 'new'} draft={noteDraft} author={name} onClose={() => setNoteDraft(null)} onAsk={addReference} />}
      {attaching && <AttachPicker reference={attaching} submissions={submissions} onClose={() => setAttaching(null)} />}

      {pending && (
        <div className="modal-backdrop" onClick={() => !uploading && setPending(null)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              if (passcode) upload(pending.file, passcode)
            }}
          >
            <h3>Enter the manual passcode</h3>
            <p className="muted">
              <strong>{pending.file.name}</strong> is encrypted. The passcode is saved with the manual so every screen opens it.
            </p>
            <input type="password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Passcode" />
            {pending.wrong && <p className="error-text">That passcode didn’t work.</p>}
            <div className="row end">
              <button type="button" onClick={() => setPending(null)} disabled={uploading}>
                Cancel
              </button>
              <button className="primary" disabled={!passcode || uploading}>
                {uploading ? 'Uploading…' : 'Unlock & share'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
