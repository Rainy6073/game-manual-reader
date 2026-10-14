import { useCallback, useMemo, useRef, useState } from 'react'
import Composer from '../components/Composer'
import SubmissionCard from '../components/SubmissionCard'
import ManualReader, { type ManualRef, type ManualSource } from '../reader/ManualReader'
import { isPasswordError, loadPdf } from '../reader/pdf'
import { useIsPresenter, useSession } from '../session'
import { patch, put, remove, uploadFile, useCollection, useDoc, useFileUrl } from '../sync/store'
import type { SubmissionKind } from '../types'

const SAMPLE = { url: '/manuals/2026GameManual.pdf', name: '2026 FRC Game Manual (REBUILT)' }

type Filter = 'all' | SubmissionKind | 'mine'

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
  const [reference, setReference] = useState<ManualRef | null>(null)
  const [jump, setJump] = useState<(ManualRef & { token: number }) | undefined>()
  const [filter, setFilter] = useState<Filter>(presenter ? 'all' : 'mine')
  // On narrow screens only one side is shown at a time.
  const [pane, setPane] = useState<'side' | 'manual'>('manual')
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
  }, [])

  const addReference = useCallback((ref: ManualRef) => {
    setReference(ref)
    setPane('side')
  }, [])

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

  const sorted = useMemo(() => [...submissions].sort((a, b) => b.createdAt - a.createdAt), [submissions])
  const shown = sorted.filter((s) => (filter === 'all' ? true : filter === 'mine' ? s.author === name : s.kind === filter))
  const counts = {
    all: sorted.length,
    question: sorted.filter((s) => s.kind === 'question').length,
    idea: sorted.filter((s) => s.kind === 'idea').length,
    mine: sorted.filter((s) => s.author === name).length,
  }
  const filters: { id: Filter; label: string }[] = presenter
    ? [
        { id: 'all', label: 'All' },
        { id: 'question', label: 'Questions' },
        { id: 'idea', label: 'Ideas' },
      ]
    : [
        { id: 'mine', label: 'Mine' },
        { id: 'all', label: 'Everyone' },
      ]

  const uploadButton = presenter && (
    <>
      <button className="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : manual ? 'Replace manual' : 'Upload manual'}
      </button>
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
    <div className={`manual-page show-${pane}`}>
      <div className="pane-switch" role="tablist">
        <button role="tab" aria-selected={pane === 'side'} onClick={() => setPane('side')}>
          {presenter ? `Submissions (${counts.all})` : 'Ask / Suggest'}
        </button>
        <button role="tab" aria-selected={pane === 'manual'} onClick={() => setPane('manual')}>
          Manual
        </button>
      </div>

      <section className="side-panel">
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
        <div className="feed">
          {shown.length === 0 && (
            <p className="empty muted">
              {filter === 'mine' ? 'Nothing sent yet. Your questions and ideas will show up here.' : 'No submissions yet.'}
            </p>
          )}
          {shown.map((s) => (
            <SubmissionCard
              key={s.id}
              submission={s}
              onJump={jumpTo}
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
          ))}
        </div>
      </section>

      <section className="manual-panel">
        <ManualReader
          source={source}
          actions={uploadButton}
          onReference={addReference}
          jump={jump}
          onPassword={savePassword}
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
