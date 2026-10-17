import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FIB } from '../fib'
import { useIsPresenter } from '../session'
import type { Ability } from '../types'

interface Props {
  abilities: Ability[]
  highlight: string | null
  onHighlight: (id: string | null) => void
  /** When set, markers, names and unrated abilities can be dragged onto Fibonacci points. */
  onRate?: (ids: string[], effort: number, value: number) => void
  /** A suggested rating, drawn as a dashed point (with an arrow from the current one). */
  proposal?: { abilityId: string; effort: number | null; value: number | null }
  /** When set, clicking the chart or dragging the dashed point moves the suggestion. */
  onPropose?: (effort: number, value: number) => void
  /** Called when someone clicks an ability's point or name. */
  onPick?: (id: string) => void
}

const PROPOSAL = '__proposal'

/** A marker, name or unrated ability being dragged; x/y are relative to the chart box. */
interface Drag {
  ids: string[]
  name: string
  startX: number
  startY: number
  x: number
  y: number
  moved: boolean
}

const TOP = 16
const BOTTOM = 48
const LEFT = 56
const RIGHT = 16
/** Height of one name label, and the gap between stacked labels. */
const ROW = 20
const GAP = 2
const MAX_LABEL = 190

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/** A round axis step giving at most eight intervals up to `max`. */
function niceStep(max: number) {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100]) if (Math.ceil(max / step) <= 8) return step
  return Math.ceil(max / 8)
}

let measureCtx: CanvasRenderingContext2D | null = null
function textWidth(text: string, font: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 8
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/**
 * Effort (x) vs. value (y) on ordinary linear axes. Abilities with the same ratings
 * share one marker with every name listed beside it, and each group of names is
 * placed where it doesn't cover other names or markers (with a leader line when it
 * has to move away from its marker).
 */
export default function ScatterChart({ abilities, highlight, onHighlight, onRate, proposal, onPropose, onPick }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 400 })
  const presenter = useIsPresenter()
  const fontSize = presenter ? 13 : 12

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.max(260, width), height: Math.max(240, height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plotted = abilities.filter((a) => a.effort != null && a.value != null)
  const unplotted = abilities.filter((a) => a.effort == null || a.value == null)
  // Show the scale up to at least 13, or further when something is rated higher.
  // Show the scale one Fibonacci step past the highest rating in use (at least 21),
  // so there is always room to drag a point higher.
  const maxUsed = Math.max(0, ...plotted.flatMap((a) => [a.effort!, a.value!]), ...(proposal ? [proposal.effort ?? 0, proposal.value ?? 0] : []))
  const top = FIB.find((f) => f > maxUsed) ?? FIB[FIB.length - 1]
  const scaleTop = Math.max(21, top)
  const step = niceStep(scaleTop)
  const domain = Math.ceil(scaleTop / step) * step
  const ticks = Array.from({ length: domain / step + 1 }, (_, i) => i * step)

  const plotW = size.width - LEFT - RIGHT
  const plotH = size.height - TOP - BOTTOM
  const x = (v: number) => LEFT + (v / domain) * plotW
  const y = (v: number) => TOP + plotH - (v / domain) * plotH

  // Dragging: anything dropped on the plot snaps to the nearest Fibonacci point.
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const snapValues = FIB.filter((f) => f <= domain)
  const nearest = (v: number) => snapValues.reduce((best, f) => (Math.abs(f - v) < Math.abs(best - v) ? f : best))
  const snapAt = (px: number, py: number) => {
    const inside = px > LEFT - 24 && px < LEFT + plotW + 24 && py > TOP - 24 && py < TOP + plotH + 24
    if (!inside) return null
    return { effort: nearest(((px - LEFT) / plotW) * domain), value: nearest(((TOP + plotH - py) / plotH) * domain) }
  }
  const snap = drag?.moved ? snapAt(drag.x, drag.y) : null

  const startDrag = (e: React.PointerEvent, ids: string[], name: string) => {
    if (e.button !== 0 || (ids[0] === PROPOSAL ? !onPropose : !onRate)) return
    e.preventDefault()
    const box = boxRef.current!.getBoundingClientRect()
    const d = { ids, name, startX: e.clientX - box.left, startY: e.clientY - box.top, x: e.clientX - box.left, y: e.clientY - box.top, moved: false }
    dragRef.current = d
    setDrag(d)
  }

  const dragging = !!drag
  useEffect(() => {
    if (!dragging) return
    const toBox = (e: PointerEvent) => {
      const box = boxRef.current!.getBoundingClientRect()
      return [e.clientX - box.left, e.clientY - box.top]
    }
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const [px, py] = toBox(e)
      const next = { ...d, x: px, y: py, moved: d.moved || Math.hypot(px - d.startX, py - d.startY) > 4 }
      dragRef.current = next
      setDrag(next)
    }
    const up = (e: PointerEvent) => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d?.moved || e.type === 'pointercancel') return
      const [px, py] = toBox(e)
      const target = snapAt(px, py)
      if (!target) return
      if (d.ids[0] === PROPOSAL) onPropose?.(target.effort, target.value)
      else onRate?.(d.ids, target.effort, target.value)
    }
    // Stop the page from scrolling under a finger that is dragging.
    const noScroll = (e: TouchEvent) => e.preventDefault()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('touchmove', noScroll, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('touchmove', noScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, domain, plotW, plotH])

  const groups = useMemo(() => {
    const map = new Map<string, Ability[]>()
    for (const a of plotted) {
      const key = `${a.effort}:${a.value}`
      map.set(key, [...(map.get(key) ?? []), a])
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      effort: items[0].effort!,
      value: items[0].value!,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abilities])

  // Too narrow for names beside the markers (phones): list them under the chart.
  const compact = plotW < 360
  const radius = (n: number) => (n > 1 ? 11 : 7)

  const placements = useMemo(() => {
    if (compact) return new Map<string, Box & { leader: boolean }>()
    const font = `600 ${fontSize}px "Roboto Mono", monospace`
    const bounds: Box = { x: LEFT + 2, y: TOP + 2, w: plotW + RIGHT - 4, h: plotH - 4 }
    const markers: Box[] = groups.map((g) => {
      const r = radius(g.items.length) + 2
      return { x: x(g.effort) - r, y: y(g.value) - r, w: r * 2, h: r * 2 }
    })
    const placed: Box[] = []
    const result = new Map<string, Box & { leader: boolean }>()

    // Place bigger stacks first; they have the fewest good spots.
    const order = [...groups].sort((a, b) => b.items.length - a.items.length || x(a.effort) - x(b.effort))
    for (const g of order) {
      const cx = x(g.effort)
      const cy = y(g.value)
      const r = radius(g.items.length)
      const w = Math.min(MAX_LABEL, Math.max(...g.items.map((a) => textWidth(a.name, font))) + 18)
      const h = g.items.length * ROW + (g.items.length - 1) * GAP

      const candidates: (Box & { penalty: number; leader: boolean })[] = []
      for (let i = 0; i <= 24; i++) {
        // 0, +1, -1, +2, -2 … steps of 8px away from the marker's height.
        const dy = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 8
        const top = cy - h / 2 + dy
        const leader = cy < top + 4 || cy > top + h - 4
        candidates.push({ x: cx + r + 6, y: top, w, h, penalty: Math.abs(dy), leader })
        candidates.push({ x: cx - r - 6 - w, y: top, w, h, penalty: Math.abs(dy) + 6, leader })
      }
      candidates.push({ x: cx - w / 2, y: cy - r - 6 - h, w, h, penalty: 10, leader: false })
      candidates.push({ x: cx - w / 2, y: cy + r + 6, w, h, penalty: 10, leader: false })

      let best = candidates[0]
      let bestCost = Infinity
      for (const c of candidates) {
        const inside = overlap(c, bounds)
        let cost = (c.w * c.h - inside) * 4 + c.penalty
        for (const p of placed) cost += overlap(c, p) * 3
        for (const m of markers) cost += overlap(c, m) * 2
        if (cost < bestCost) {
          best = c
          bestCost = cost
          if (cost === 0) break
        }
      }
      placed.push(best)
      result.set(g.key, { x: best.x, y: best.y, w: best.w, h: best.h, leader: best.leader })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, compact, fontSize, plotW, plotH, domain])

  const midX = LEFT + plotW / 2
  const midY = TOP + plotH / 2

  return (
    <>
      <div className={`chart${onRate ? ' editable' : ''}${onPropose ? ' proposing' : ''}${onPick ? ' pickable' : ''}${drag?.moved ? ' dragging' : ''}`} ref={boxRef}>
        <svg width={size.width} height={size.height} role="img" aria-label="Effort versus value scatter plot">
          {/* Low effort & high value (top left) shades green, high effort & low value
              (bottom right) red, each fading to white toward the middle. */}
          <defs>
            <linearGradient id="ev-good" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#18a058" stopOpacity="0.32" />
              <stop offset="1" stopColor="#18a058" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ev-bad" x1="1" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#d0101b" stopOpacity="0.26" />
              <stop offset="1" stopColor="#d0101b" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect
            className="plot-bg"
            x={LEFT}
            y={TOP}
            width={plotW}
            height={plotH}
            onClick={(e) => {
              // Proposing: a click anywhere puts the suggestion on the nearest point.
              if (!onPropose) return
              const box = boxRef.current!.getBoundingClientRect()
              const target = snapAt(e.clientX - box.left, e.clientY - box.top)
              if (target) onPropose(target.effort, target.value)
            }}
          />
          <rect x={LEFT} y={TOP} width={plotW / 2} height={plotH / 2} fill="url(#ev-good)" pointerEvents="none" />
          <rect x={midX} y={midY} width={plotW / 2} height={plotH / 2} fill="url(#ev-bad)" pointerEvents="none" />

          {/* Grid & ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={x(t)} x2={x(t)} y1={TOP} y2={TOP + plotH} />
              <line className="grid" x1={LEFT} x2={LEFT + plotW} y1={y(t)} y2={y(t)} />
              <text className="tick" x={x(t)} y={TOP + plotH + 18} textAnchor="middle">
                {t}
              </text>
              <text className="tick" x={LEFT - 10} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          <rect className="frame" x={LEFT} y={TOP} width={plotW} height={plotH} />
          <text className="axis-title" x={LEFT + plotW / 2} y={size.height - 6} textAnchor="middle">
            Effort →
          </text>
          <text className="axis-title" transform={`translate(18 ${TOP + plotH / 2}) rotate(-90)`} textAnchor="middle">
            Value →
          </text>

          {/* Leader lines for names that had to move away from their marker */}
          {groups.map((g) => {
            const p = placements.get(g.key)
            if (!p?.leader) return null
            const cx = x(g.effort)
            const cy = y(g.value)
            const tx = Math.min(Math.max(cx, p.x), p.x + p.w)
            const ty = Math.min(Math.max(cy, p.y + ROW / 2), p.y + p.h - ROW / 2)
            return <line key={g.key} className="leader" x1={cx} y1={cy} x2={tx} y2={ty} />
          })}

          {groups.map((g) => (
            <g
              key={g.key}
              className={`marker${g.items.some((a) => a.id === highlight) ? ' hot' : ''}${drag?.moved && g.items.every((a) => drag.ids.includes(a.id)) ? ' lifting' : ''}`}
            >
              <circle
                cx={x(g.effort)}
                cy={y(g.value)}
                r={radius(g.items.length)}
                onPointerEnter={() => onHighlight(g.items[0].id)}
                onPointerLeave={() => onHighlight(null)}
                onClick={() => onPick?.(g.items[0].id)}
              />
              {g.items.length > 1 && (
                <text x={x(g.effort)} y={y(g.value) + 4} textAnchor="middle" className="marker-count">
                  {g.items.length}
                </text>
              )}
              {onRate && (
                // A larger, invisible target so markers are easy to grab with a finger.
                <circle
                  className="grab"
                  cx={x(g.effort)}
                  cy={y(g.value)}
                  r={Math.max(16, radius(g.items.length) + 6)}
                  onPointerEnter={() => onHighlight(g.items[0].id)}
                  onPointerLeave={() => onHighlight(null)}
                  onPointerDown={(e) =>
                    startDrag(
                      e,
                      g.items.map((a) => a.id),
                      g.items.length > 1 ? `${g.items.length} abilities` : g.items[0].name,
                    )
                  }
                >
                  <title>Drag to re-rate {g.items.length > 1 ? 'these abilities' : g.items[0].name}</title>
                </circle>
              )}
            </g>
          ))}

          {/* The suggested rating: dashed, with an arrow from where it is now. */}
          {proposal &&
            proposal.effort != null &&
            proposal.value != null &&
            (() => {
              const current = abilities.find((a) => a.id === proposal.abilityId)
              const px = x(proposal.effort)
              const py = y(proposal.value)
              const fromX = current?.effort != null && current.value != null ? x(current.effort) : null
              const fromY = current?.effort != null && current.value != null ? y(current.value) : null
              return (
                <g className={`proposal${drag?.moved && drag.ids[0] === PROPOSAL ? ' lifting' : ''}`}>
                  <defs>
                    <marker id="proposal-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0 0 10 5 0 10z" className="proposal-arrowhead" />
                    </marker>
                  </defs>
                  {fromX != null && fromY != null && Math.hypot(px - fromX, py - fromY) > 20 && (
                    <line
                      className="proposal-line"
                      x1={fromX}
                      y1={fromY}
                      x2={px - ((px - fromX) / Math.hypot(px - fromX, py - fromY)) * 14}
                      y2={py - ((py - fromY) / Math.hypot(px - fromX, py - fromY)) * 14}
                      markerEnd="url(#proposal-arrow)"
                    />
                  )}
                  <circle className="proposal-dot" cx={px} cy={py} r={10} />
                  {onPropose && (
                    <circle
                      className="grab"
                      cx={px}
                      cy={py}
                      r={18}
                      onPointerDown={(e) => startDrag(e, [PROPOSAL], 'Proposed rating')}
                    >
                      <title>Drag to change the proposed rating</title>
                    </circle>
                  )}
                </g>
              )
            })()}

          {/* While dragging: every point it can land on, and where it will land. */}
          {drag?.moved && (
            <g className="snap-layer">
              {snap && (
                <>
                  <line className="snap-guide" x1={x(snap.effort)} x2={x(snap.effort)} y1={TOP} y2={TOP + plotH} />
                  <line className="snap-guide" x1={LEFT} x2={LEFT + plotW} y1={y(snap.value)} y2={y(snap.value)} />
                </>
              )}
              {snapValues.flatMap((e) =>
                snapValues.map((v) => (
                  <circle
                    key={`${e}:${v}`}
                    className={`snap-dot${snap?.effort === e && snap.value === v ? ' active' : ''}`}
                    cx={x(e)}
                    cy={y(v)}
                    r={snap?.effort === e && snap.value === v ? 9 : 3}
                  />
                )),
              )}
            </g>
          )}
        </svg>

        {drag?.moved && (
          <div className={`drag-ghost${drag.x > size.width - 190 ? ' flip' : ''}`} style={{ left: drag.x, top: Math.max(24, Math.min(size.height - 24, drag.y)) }}>
            <strong>{drag.name}</strong>
            <span>{snap ? `Effort ${snap.effort} · Value ${snap.value}` : 'Drop on the chart'}</span>
          </div>
        )}

        {groups.map((g) => {
          const p = placements.get(g.key)
          if (!p) return null
          return (
            <div key={g.key} className="labels" style={{ left: p.x, top: p.y, width: p.w }}>
              {g.items.map((a) => (
                <span
                  key={a.id}
                  className={`label${a.id === highlight ? ' hot' : ''}${drag?.moved && drag.ids.includes(a.id) ? ' lifting' : ''}`}
                  title={`${a.name} · effort ${a.effort}, value ${a.value}${onRate ? ' · drag to re-rate' : ''}`}
                  onPointerEnter={() => onHighlight(a.id)}
                  onPointerLeave={() => onHighlight(null)}
                  onPointerDown={(e) => startDrag(e, [a.id], a.name)}
                  onClick={() => onPick?.(a.id)}
                >
                  {a.name}
                </span>
              ))}
            </div>
          )
        })}
      </div>
      {compact && groups.length > 0 && (
        <ul className="chart-legend">
          {[...groups]
            .sort((a, b) => b.value - a.value || a.effort - b.effort)
            .map((g) => (
              <li key={g.key} className={g.items.some((a) => a.id === highlight) ? 'hot' : undefined}>
                <span className="legend-point">
                  E{g.effort} · V{g.value}
                </span>
                <span>{g.items.map((a) => a.name).join(', ')}</span>
              </li>
            ))}
        </ul>
      )}
      {unplotted.length > 0 &&
        (onRate ? (
          <div className="unplotted-tray">
            <span className="muted small">Not rated yet. Drag onto the chart:</span>
            {unplotted.map((a) => (
              <span
                key={a.id}
                className={`tray-chip${drag?.moved && drag.ids.includes(a.id) ? ' lifting' : ''}`}
                onPointerDown={(e) => startDrag(e, [a.id], a.name)}
              >
                {a.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted small unplotted">Not plotted yet (needs both ratings): {unplotted.map((a) => a.name).join(', ')}</p>
        ))}
    </>
  )
}
