// Value ÷ effort: how much value each unit of effort buys (higher is a better deal).

/** The ratio, or null until both are known (and effort isn't 0). */
export const valuePerEffort = (effort: number | null | undefined, value: number | null | undefined) =>
  effort == null || value == null || effort === 0 ? null : value / effort

/** e.g. "2.6", "12", or "–" when unknown. */
export const formatRatio = (r: number | null) => (r == null ? '–' : r >= 10 ? String(Math.round(r)) : r.toFixed(1).replace(/\.0$/, ''))

/** "good" (2 or more), "poor" (under 0.75) or "" for colouring. */
export const ratioTone = (r: number | null) => (r == null ? '' : r >= 2 ? 'good' : r < 0.75 ? 'poor' : '')
