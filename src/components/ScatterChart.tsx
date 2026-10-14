import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsPresenter } from '../session'
import type { Ability } from '../types'

interface Props {
  abilities: Ability[]
  highlight: string | null
  onHighlight: (id: string | null) => void
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
export default function ScatterChart({ abilities, highlight, onHighlight }: Props) {
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
  // Show the scale up to at least 13, or further when something is rated higher.
  const maxUsed = Math.max(13, ...plotted.flatMap((a) => [a.effort!, a.value!]))
  const step = niceStep(maxUsed)
  const domain = Math.ceil(maxUsed / step) * step
  const ticks = Array.from({ length: domain / step + 1 }, (_, i) => i * step)

  const plotW = size.width - LEFT - RIGHT
  const plotH = size.height - TOP - BOTTOM
  const x = (v: number) => LEFT + (v / domain) * plotW
  const y = (v: number) => TOP + plotH - (v / domain) * plotH

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
      <div className="chart" ref={boxRef}>
        <svg width={size.width} height={size.height} role="img" aria-label="Effort versus value scatter plot">
          {/* Quadrants */}
          <rect className="quad win" x={LEFT} y={TOP} width={plotW / 2} height={plotH / 2} />
          <rect className="quad bet" x={midX} y={TOP} width={plotW / 2} height={plotH / 2} />
          <rect className="quad easy" x={LEFT} y={midY} width={plotW / 2} height={plotH / 2} />
          <rect className="quad avoid" x={midX} y={midY} width={plotW / 2} height={plotH / 2} />
          <text className="quad-label" x={LEFT + 8} y={TOP + 20}>
            Quick wins
          </text>
          <text className="quad-label" x={LEFT + plotW - 8} y={TOP + 20} textAnchor="end">
            Big bets
          </text>
          <text className="quad-label" x={LEFT + 8} y={TOP + plotH - 8}>
            Nice extras
          </text>
          <text className="quad-label" x={LEFT + plotW - 8} y={TOP + plotH - 8} textAnchor="end">
            Money pits
          </text>

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
            <g key={g.key} className={g.items.some((a) => a.id === highlight) ? 'marker hot' : 'marker'}>
              <circle
                cx={x(g.effort)}
                cy={y(g.value)}
                r={radius(g.items.length)}
                onPointerEnter={() => onHighlight(g.items[0].id)}
                onPointerLeave={() => onHighlight(null)}
              />
              {g.items.length > 1 && (
                <text x={x(g.effort)} y={y(g.value) + 4} textAnchor="middle" className="marker-count">
                  {g.items.length}
                </text>
              )}
            </g>
          ))}
        </svg>

        {groups.map((g) => {
          const p = placements.get(g.key)
          if (!p) return null
          return (
            <div key={g.key} className="labels" style={{ left: p.x, top: p.y, width: p.w }}>
              {g.items.map((a) => (
                <span
                  key={a.id}
                  className={`label${a.id === highlight ? ' hot' : ''}`}
                  title={`${a.name} · effort ${a.effort}, value ${a.value}`}
                  onPointerEnter={() => onHighlight(a.id)}
                  onPointerLeave={() => onHighlight(null)}
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
    </>
  )
}
