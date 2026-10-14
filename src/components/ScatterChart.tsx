import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FIB } from '../fib'
import type { Ability } from '../types'

interface Props {
  abilities: Ability[]
  highlight: string | null
  onHighlight: (id: string | null) => void
}

const TOP = 16
const BOTTOM = 48
const LEFT = 56
/** Approximate height of one name label (they wrap to two lines at most). */
const ROW = 24

/**
 * Effort (x) vs. value (y). Fibonacci values are spaced evenly so small ratings
 * aren't crushed together. Abilities with the same ratings share one marker, with
 * every name listed beside it.
 */
export default function ScatterChart({ abilities, highlight, onHighlight }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 400 })
  const [expanded, setExpanded] = useState<string | null>(null)

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
  // Show the scale up to 13, or further when something is rated higher.
  const maxUsed = Math.max(13, ...plotted.flatMap((a) => [a.effort!, a.value!]))
  const ticks = FIB.slice(0, FIB.indexOf(maxUsed) + 1)

  // Names sit to the right of each marker and may use up to one column's width,
  // so half a column is reserved to the right of the plot for the last column.
  const plotW = (size.width - LEFT - 8) / (1 + 1 / (2 * ticks.length))
  const plotH = size.height - TOP - BOTTOM
  const stepX = plotW / ticks.length
  const stepY = plotH / ticks.length
  const labelWidth = Math.max(70, stepX - 22)
  const MARGIN = { top: TOP, left: LEFT }
  const x = (v: number) => MARGIN.left + (ticks.indexOf(v) + 0.5) * stepX
  const y = (v: number) => MARGIN.top + plotH - (ticks.indexOf(v) + 0.5) * stepY

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
  const compact = stepX < 88
  const midX = MARGIN.left + plotW / 2
  const midY = MARGIN.top + plotH / 2
  // How many names fit beside a marker before the rest collapse into "+N more".
  const fits = Math.max(1, Math.floor((stepY * 0.95) / ROW))

  return (
    <>
    <div className="chart" ref={boxRef}>
      <svg width={size.width} height={size.height} role="img" aria-label="Effort versus value scatter plot">
        {/* Quadrants */}
        <rect className="quad win" x={MARGIN.left} y={MARGIN.top} width={plotW / 2} height={plotH / 2} />
        <rect className="quad bet" x={midX} y={MARGIN.top} width={plotW / 2} height={plotH / 2} />
        <rect className="quad easy" x={MARGIN.left} y={midY} width={plotW / 2} height={plotH / 2} />
        <rect className="quad avoid" x={midX} y={midY} width={plotW / 2} height={plotH / 2} />
        <text className="quad-label" x={MARGIN.left + 8} y={MARGIN.top + 18}>
          Quick wins
        </text>
        <text className="quad-label" x={MARGIN.left + plotW - 8} y={MARGIN.top + 18} textAnchor="end">
          Big bets
        </text>
        <text className="quad-label" x={MARGIN.left + 8} y={MARGIN.top + plotH - 8}>
          Nice extras
        </text>
        <text className="quad-label" x={MARGIN.left + plotW - 8} y={MARGIN.top + plotH - 8} textAnchor="end">
          Money pits
        </text>

        {/* Grid & ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={x(t)} x2={x(t)} y1={MARGIN.top} y2={MARGIN.top + plotH} />
            <line className="grid" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} />
            <text className="tick" x={x(t)} y={MARGIN.top + plotH + 18} textAnchor="middle">
              {t}
            </text>
            <text className="tick" x={MARGIN.left - 10} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <rect className="frame" x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH} />
        <text className="axis-title" x={MARGIN.left + plotW / 2} y={size.height - 8} textAnchor="middle">
          Effort →
        </text>
        <text
          className="axis-title"
          transform={`translate(16 ${MARGIN.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Value →
        </text>

        {groups.map((g) => (
          <g key={g.key} className={g.items.some((a) => a.id === highlight) ? 'marker hot' : 'marker'}>
            <circle
              cx={x(g.effort)}
              cy={y(g.value)}
              r={g.items.length > 1 ? 11 : 7}
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

      {!compact && groups.map((g) => {
        const cx = x(g.effort)
        const cy = y(g.value)
        const open = expanded === g.key
        const shown = open || g.items.length <= fits ? g.items : g.items.slice(0, Math.max(1, fits - 1))
        const hidden = g.items.length - shown.length
        return (
          <div
            key={g.key}
            className={`labels${open ? ' open' : ''}`}
            style={{ left: cx + 15, top: cy, width: open ? Math.max(labelWidth, 220) : labelWidth }}
          >
            {shown.map((a) => (
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
            {hidden > 0 && (
              <button className="label more" onClick={() => setExpanded(g.key)}>
                +{hidden} more
              </button>
            )}
            {open && (
              <button className="label more" onClick={() => setExpanded(null)}>
                Show less
              </button>
            )}
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