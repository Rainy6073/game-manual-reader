import { useEffect, useRef, useState } from 'react'
import { loadPdf } from '../reader/pdf'
import { useLocalState } from '../session'
import { resolveFileUrl, useDoc } from '../sync/store'
import { newId, type Alliance, type BoardRobot, type BoardStroke, type FieldBoard as Board, type FieldImage } from '../types'
import { findFieldCandidates, renderRegion } from './fieldExtract'
import FieldPicker, { type PickedField } from './FieldPicker'
import { saveLocalFile, useLocalFileUrl } from './localFiles'
import ConfirmButton from '../components/ConfirmButton'

type Tool = 'move' | 'pen' | 'line' | 'erase'

const COLORS = [
  { value: '#d0101b', name: 'Red' },
  { value: '#1d6fa8', name: 'Blue' },
  { value: '#f5c400', name: 'Yellow' },
  { value: '#18a058', name: 'Green' },
  { value: '#ffffff', name: 'White' },
  { value: '#111111', name: 'Black' },
]
const WIDTHS = [
  { value: 0.003, name: 'Thin' },
  { value: 0.006, name: 'Medium' },
  { value: 0.011, name: 'Thick' },
]
const ALLIANCE_FILL: Record<Alliance, string> = { red: '#d0101b', blue: '#1d6fa8', neutral: '#555' }
/** Width of the drawing in SVG units; height follows the field image. */
const VW = 1000
const UNDO_LIMIT = 50

const emptyBoard = (): Board => ({ robots: [], strokes: [], robotSize: 0.055 })

/** A named board kept on this device. */
interface SavedBoard {
  id: string
  name: string
  board: Board
  updatedAt: number
}

/** Distance from point p to segment ab. */
function segDist(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/**
 * A whiteboard over the field. Everything here belongs to this device only: each
 * screen has its own field image, robots and drawings.
 */
export default function FieldBoard() {
  const manual = useDoc('meta', 'manual')
  const [field, setField] = useLocalState<FieldImage | null>('kickoff.fieldImage', null)
  const fieldUrl = useLocalFileUrl(field?.key)
  // Boards from before there could be several live under the old key.
  const [legacy] = useLocalState<Board>('kickoff.fieldBoard', emptyBoard())
  const [savedBoards, setSavedBoards] = useLocalState<SavedBoard[]>('kickoff.fieldBoards', [])
  const [currentId, setCurrentId] = useLocalState('kickoff.fieldBoardCurrent', '')
  const withDefault = (list: SavedBoard[]) => (list.length ? list : [{ id: 'board-1', name: 'Board 1', board: legacy, updatedAt: 0 }])
  const boards = withDefault(savedBoards)
  const current = boards.find((b) => b.id === currentId) ?? boards[0]
  const stored = current.board
  const updateBoards = (fn: (list: SavedBoard[]) => SavedBoard[]) => setSavedBoards((prev) => fn(withDefault(prev)))
  const setStored = (b: Board) => updateBoards((list) => list.map((x) => (x.id === current.id ? { ...x, board: b, updatedAt: Date.now() } : x)))
  const [copied, setCopied] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)

  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[2].value)
  const [width, setWidth] = useState(WIDTHS[1].value)
  const [arrow, setArrow] = useState(true)
  const [picking, setPicking] = useState(false)
  // In-progress changes (a robot being dragged, a stroke being drawn) shown before saving.
  const [draft, setDraftState] = useState<Board | null>(null)
  const [pending, setPendingState] = useState<BoardStroke | null>(null)
  // Mirrors of the above, so pointer handlers never act on a stale render.
  const draftRef = useRef<Board | null>(null)
  const pendingRef = useRef<BoardStroke | null>(null)
  const setDraft = (b: Board | null) => {
    draftRef.current = b
    setDraftState(b)
  }
  const setPending = (st: BoardStroke | null) => {
    pendingRef.current = st
    setPendingState(st)
  }
  const historyRef = useRef<Board[]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<{ kind: 'robot'; id: string; dx: number; dy: number } | { kind: 'draw' } | { kind: 'erase' } | null>(null)

  const board = draft ?? stored
  const aspect = field ? field.height / field.width : 0.5
  const VH = VW * aspect
  const robotPx = board.robotSize * VW

  const save = setStored
  /** Saves a change that can be undone. */
  const commit = (b: Board) => {
    historyRef.current = [...historyRef.current.slice(-UNDO_LIMIT + 1), stored]
    save(b)
  }
  const undo = () => {
    const prev = historyRef.current.pop()
    if (prev) save(prev)
  }

  const applyField = async (picked: PickedField) => {
    const key = `field-${newId()}`
    await saveLocalFile(key, picked.blob)
    setField({ key, width: picked.width, height: picked.height, source: picked.source })
  }

  // The first time, find the field in the shared manual automatically.
  useEffect(() => {
    if (field || !manual) return
    let cancelled = false
    setFinding(true)
    ;(async () => {
      try {
        const doc = await loadPdf(await resolveFileUrl(manual.url), manual.password)
        const [best] = await findFieldCandidates(doc, 3)
        if (!best || cancelled) return
        const blob = await renderRegion(doc, best.page, best.box)
        const bitmap = await createImageBitmap(blob)
        if (!cancelled) await applyField({ blob, width: bitmap.width, height: bitmap.height, source: `${manual.name}, page ${best.page}` })
      } catch (err) {
        console.warn('Could not find the field automatically', err)
      } finally {
        if (!cancelled) setFinding(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, manual?.url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** The pointer position in SVG units. */
  const toSvg = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const svg = svgRef.current!
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
    return [Math.max(0, Math.min(VW, pt.x)), Math.max(0, Math.min(VH, pt.y))]
  }
  const norm = ([x, y]: [number, number]): [number, number] => [x / VW, y / VH]
  const px = ([x, y]: [number, number]): [number, number] => [x * VW, y * VH]

  const robotAt = (p: [number, number], robots = board.robots) =>
    [...robots].reverse().find((r) => {
      const [cx, cy] = px([r.x, r.y])
      return Math.abs(p[0] - cx) <= robotPx / 2 && Math.abs(p[1] - cy) <= robotPx / 2
    })

  /** Removes whatever is under the pointer (robots first, then the top-most line). */
  const eraseAt = (p: [number, number], b: Board): Board => {
    const robot = robotAt(p, b.robots)
    if (robot) return { ...b, robots: b.robots.filter((r) => r !== robot) }
    for (let i = b.strokes.length - 1; i >= 0; i--) {
      const s = b.strokes[i]
      const pts = s.points.map(px)
      const reach = Math.max(10, (s.width * VW) / 2 + 6)
      const hit = pts.length === 1 ? Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < reach : pts.some((q, j) => j > 0 && segDist(p, pts[j - 1], q) < reach)
      if (hit) return { ...b, strokes: b.strokes.filter((_, j) => j !== i) }
    }
    return b
  }

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!field || e.button !== 0) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is best-effort; drawing still works without it.
    }
    const p = toSvg(e)
    if (tool === 'move') {
      const robot = robotAt(p)
      if (!robot) return
      const [cx, cy] = px([robot.x, robot.y])
      gesture.current = { kind: 'robot', id: robot.id, dx: p[0] - cx, dy: p[1] - cy }
      historyRef.current = [...historyRef.current.slice(-UNDO_LIMIT + 1), stored]
      setDraft(stored)
    } else if (tool === 'erase') {
      gesture.current = { kind: 'erase' }
      historyRef.current = [...historyRef.current.slice(-UNDO_LIMIT + 1), stored]
      setDraft(eraseAt(p, stored))
    } else {
      gesture.current = { kind: 'draw' }
      setPending({ id: newId(), kind: tool, points: [norm(p), norm(p)], color, width, arrow })
    }
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g) return
    const p = toSvg(e)
    if (g.kind === 'robot') {
      const current = draftRef.current ?? stored
      const next = { ...current, robots: current.robots.map((r) => (r.id === g.id ? { ...r, ...xy(norm([p[0] - g.dx, p[1] - g.dy])) } : r)) }
      setDraft(next)
    } else if (g.kind === 'erase') {
      setDraft(eraseAt(p, draftRef.current ?? stored))
    } else if (pendingRef.current) {
      const pending = pendingRef.current
      const q = norm(p)
      if (pending.kind === 'line') setPending({ ...pending, points: [pending.points[0], q] })
      else {
        const last = px(pending.points[pending.points.length - 1])
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 3) setPending({ ...pending, points: [...pending.points, q] })
      }
    }
  }

  const onUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.kind === 'draw') {
      const stroke = pendingRef.current
      if (stroke) commit({ ...stored, strokes: [...stored.strokes, stroke] })
      setPending(null)
    } else if (draftRef.current) {
      save(draftRef.current)
      setDraft(null)
    }
  }

  const xy = ([x, y]: [number, number]) => ({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) })

  const addRobot = (alliance: Alliance) => {
    const same = stored.robots.filter((r) => r.alliance === alliance)
    const prefix = alliance === 'red' ? 'R' : alliance === 'blue' ? 'B' : 'N'
    const slot = same.length % 3
    const robot: BoardRobot = {
      id: newId(),
      alliance,
      label: `${prefix}${same.length + 1}`,
      x: alliance === 'red' ? 0.12 : alliance === 'blue' ? 0.88 : 0.5,
      y: 0.3 + slot * 0.2,
    }
    commit({ ...stored, robots: [...stored.robots, robot] })
    setTool('move')
  }

  const rename = (e: React.MouseEvent) => {
    const robot = robotAt(toSvg(e))
    if (!robot) return
    const label = prompt('Robot label (e.g. team number)', robot.label)?.trim()
    if (label) commit({ ...stored, robots: stored.robots.map((r) => (r.id === robot.id ? { ...r, label: label.slice(0, 8) } : r)) })
  }

  const switchTo = (id: string) => {
    historyRef.current = []
    setCurrentId(id)
  }
  const nextName = (base: string) => {
    let n = 1
    while (boards.some((b) => b.name === `${base} ${n}`)) n++
    return `${base} ${n}`
  }
  const newBoard = (copyOf?: SavedBoard) => {
    const name = prompt('Name this board', copyOf ? `${copyOf.name} copy` : nextName('Board'))?.trim()
    if (!name) return
    const id = newId()
    const board: Board = copyOf ? structuredClone(copyOf.board) : { ...emptyBoard(), robotSize: stored.robotSize }
    updateBoards((list) => [...list, { id, name: name.slice(0, 40), board, updatedAt: Date.now() }])
    switchTo(id)
  }
  const renameBoard = () => {
    const name = prompt('Rename this board', current.name)?.trim()
    if (name) updateBoards((list) => list.map((x) => (x.id === current.id ? { ...x, name: name.slice(0, 40) } : x)))
  }
  const deleteBoard = () => {
    const rest = boards.filter((b) => b.id !== current.id)
    updateBoards(() => (rest.length ? rest : [{ id: newId(), name: 'Board 1', board: emptyBoard(), updatedAt: Date.now() }]))
    switchTo(rest[0]?.id ?? '')
  }

  /** Draws the field with the board on top, as a PNG. */
  const renderImage = async (): Promise<Blob> => {
    const svg = svgRef.current
    if (!svg || !fieldUrl || !field) throw new Error('No board to render')
    const scale = Math.min(2, 2400 / field.width) * (field.width / VW)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(VW * scale)
    canvas.height = Math.round(VH * scale)
    const ctx = canvas.getContext('2d')!
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
      })
    ctx.drawImage(await load(fieldUrl), 0, 0, canvas.width, canvas.height)
    // The drawings and robots, without the field image (an SVG drawn as an image can't load it).
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.querySelector('image')?.remove()
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(canvas.width))
    clone.setAttribute('height', String(canvas.height))
    for (const t of clone.querySelectorAll('text')) {
      t.setAttribute('fill', '#fff')
      t.setAttribute('font-family', 'Helvetica, Arial, sans-serif')
      t.setAttribute('font-weight', '700')
    }
    const overlay = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`)
    ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height)
    // Name the board in the corner, so copies are easy to tell apart.
    const fs = Math.round(canvas.width * 0.022)
    ctx.font = `700 ${fs}px Helvetica, Arial, sans-serif`
    const pad = fs * 0.5
    const w = ctx.measureText(current.name).width
    ctx.fillStyle = 'rgb(0 0 0 / 0.6)'
    ctx.fillRect(pad, pad, w + pad * 2, fs + pad * 1.4)
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    ctx.fillText(current.name, pad * 2, pad * 1.7)
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render'))), 'image/png'))
  }

  const flash = (message: string) => {
    setCopied(message)
    setTimeout(() => setCopied(null), 2200)
  }
  const fileName = () => `${current.name.replace(/[^\w -]+/g, '').trim() || 'field-board'}.png`
  const downloadImage = async (blob?: Blob) => {
    const url = URL.createObjectURL(blob ?? (await renderImage()))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName()
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const copyImage = async () => {
    const blob = renderImage()
    try {
      // Passing the promise keeps Safari's "user gesture" intact while the image renders.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      flash('Image copied ✓')
    } catch {
      try {
        const file = new File([await blob], fileName(), { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: current.name })
        else await downloadImage(await blob)
        flash('Saved image ✓')
      } catch (err) {
        if ((err as Error).name !== 'AbortError') flash('Could not copy the image')
      }
    }
  }

  const strokes = pending ? [...board.strokes, pending] : board.strokes

  return (
    <div className="field-board">
      {field && (
        <div className="fb-toolbar fb-boards">
          <select value={current.id} onChange={(e) => switchTo(e.target.value)} aria-label="Board" className="fb-board-select">
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button onClick={() => newBoard()}>+ New</button>
          <button onClick={() => newBoard(current)} title="Make a copy of this board">
            ⧉ Duplicate
          </button>
          <button onClick={renameBoard}>Rename</button>
          <ConfirmButton className="danger" onConfirm={deleteBoard} confirmLabel="Click again to delete">
            Delete
          </ConfirmButton>
          <span style={{ flex: 1 }} />
          <span className="muted small" aria-live="polite">
            {copied ?? `${boards.length} ${boards.length === 1 ? 'board' : 'boards'} saved on this device`}
          </span>
          <button onClick={copyImage} disabled={!fieldUrl} title="Copy this board as an image to paste anywhere">
            Copy image
          </button>
          <button onClick={() => downloadImage().catch(() => flash('Could not save the image'))} disabled={!fieldUrl}>
            Save PNG
          </button>
        </div>
      )}
      <div className="fb-toolbar">
        {field && (
          <>
            <div className="segmented" role="radiogroup" aria-label="Tool">
              {(
                [
                  ['move', '✋ Move'],
                  ['pen', '✎ Draw'],
                  ['line', '╱ Line'],
                  ['erase', '⌫ Erase'],
                ] as [Tool, string][]
              ).map(([t, label]) => (
                <button key={t} role="radio" aria-checked={tool === t} onClick={() => setTool(t)}>
                  {label}
                </button>
              ))}
            </div>
            {(tool === 'pen' || tool === 'line') && (
              <>
                <div className="swatches" role="radiogroup" aria-label="Color">
                  {COLORS.map((c) => (
                    <button
                      key={c.value}
                      role="radio"
                      aria-checked={color === c.value}
                      aria-label={c.name}
                      title={c.name}
                      className="swatch"
                      style={{ background: c.value }}
                      onClick={() => setColor(c.value)}
                    />
                  ))}
                </div>
                <select value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Line width">
                  {WIDTHS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <label className="check">
                  <input type="checkbox" checked={arrow} onChange={(e) => setArrow(e.target.checked)} /> Arrow
                </label>
              </>
            )}
            <span className="fb-sep" />
            <button className="robot-btn red" onClick={() => addRobot('red')}>
              + Red robot
            </button>
            <button className="robot-btn blue" onClick={() => addRobot('blue')}>
              + Blue robot
            </button>
            <label className="size">
              <span className="muted small">Robot size</span>
              <input
                type="range"
                min={0.02}
                max={0.12}
                step={0.005}
                value={stored.robotSize}
                onChange={(e) => save({ ...stored, robotSize: Number(e.target.value) })}
              />
            </label>
            <span className="fb-sep" />
            <button onClick={undo} title="Undo (⌘Z / Ctrl+Z)">
              ↶ Undo
            </button>
            <ConfirmButton onConfirm={() => commit({ ...stored, strokes: [] })} disabled={!stored.strokes.length} confirmLabel="Clear all lines?">
              Clear lines
            </ConfirmButton>
            <ConfirmButton onConfirm={() => commit({ ...stored, robots: [] })} disabled={!stored.robots.length} confirmLabel="Clear all robots?">
              Clear robots
            </ConfirmButton>
          </>
        )}
        <span style={{ flex: 1 }} />
        {field && <span className="muted small fb-source">Field: {field.source}</span>}
        <button onClick={() => setPicking(true)}>{field ? 'Change field' : 'Choose field'}</button>
      </div>

      <div className="fb-stage">
        {!field ? (
          <div className="empty-manual">
            <h3>{finding ? 'Finding the field in the manual…' : 'Set up the field'}</h3>
            <p className="muted">
              {finding
                ? 'This takes a few seconds.'
                : manual
                  ? 'Pick the top-down field drawing from the game manual, or upload your own image or PDF.'
                  : 'Once the game manual is shared, the field is found automatically. You can also upload a field image or PDF.'}
            </p>
            {!finding && (
              <button className="primary" onClick={() => setPicking(true)}>
                Choose field
              </button>
            )}
          </div>
        ) : (
          <svg
            ref={svgRef}
            className={`fb-svg tool-${tool}`}
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={rename}
          >
            {fieldUrl && <image href={fieldUrl} x={0} y={0} width={VW} height={VH} preserveAspectRatio="none" />}
            {strokes.map((s) => (
              <StrokeView key={s.id} stroke={s} px={px} />
            ))}
            {board.robots.map((r) => {
              const [cx, cy] = px([r.x, r.y])
              return (
                <g key={r.id} className="fb-robot" transform={`translate(${cx} ${cy})`}>
                  <rect
                    x={-robotPx / 2}
                    y={-robotPx / 2}
                    width={robotPx}
                    height={robotPx}
                    rx={robotPx * 0.18}
                    fill={ALLIANCE_FILL[r.alliance]}
                    stroke="#fff"
                    strokeWidth={Math.max(1.5, robotPx * 0.06)}
                  />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(9, robotPx * (r.label.length > 3 ? 0.3 : 0.4))}>
                    {r.label}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
      {field && (
        <p className="muted small fb-hint">
          {tool === 'move' && 'Drag robots to move them. Double-click a robot to rename it (e.g. a team number).'}
          {tool === 'pen' && 'Draw paths freehand.'}
          {tool === 'line' && 'Drag to draw a straight line.'}
          {tool === 'erase' && 'Click or drag over lines and robots to erase them.'}
        </p>
      )}

      {picking && <FieldPicker onClose={() => setPicking(false)} onPick={applyField} />}
    </div>
  )
}

function StrokeView({ stroke: s, px }: { stroke: BoardStroke; px: (p: [number, number]) => [number, number] }) {
  const pts = s.points.map(px)
  const w = s.width * VW
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  let head: string | null = null
  if (s.arrow && pts.length > 1) {
    // Aim the head along the last few points, so a shaky finish doesn't skew it.
    const tip = pts[pts.length - 1]
    let from = pts[pts.length - 2]
    for (let i = pts.length - 2; i >= 0; i--) {
      from = pts[i]
      if (Math.hypot(tip[0] - from[0], tip[1] - from[1]) > w * 4 + 8) break
    }
    const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0])
    const len = w * 3 + 10
    const spread = 0.45
    const a = [tip[0] - len * Math.cos(angle - spread), tip[1] - len * Math.sin(angle - spread)]
    const b = [tip[0] - len * Math.cos(angle + spread), tip[1] - len * Math.sin(angle + spread)]
    head = `${tip[0]},${tip[1]} ${a[0]},${a[1]} ${b[0]},${b[1]}`
  }
  const outline = s.color === '#ffffff' ? 'rgb(0 0 0 / 0.45)' : 'rgb(255 255 255 / 0.7)'
  return (
    <g className="fb-stroke">
      {/* A faint outline keeps lines visible on any part of the field. */}
      <path d={d} fill="none" stroke={outline} strokeWidth={w + 3} strokeLinecap="round" strokeLinejoin="round" />
      {head && <polygon points={head} fill={outline} stroke={outline} strokeWidth={3} strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={s.color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      {head && <polygon points={head} fill={s.color} />}
    </g>
  )
}
