// Reads a game's scoring rules from the manual's point value table ("Table 6-4
// REBUILT point values", "Table 4-2: Point Values", …). Tables differ every year,
// so this is a best-effort reading that the person can correct afterwards.
import type { PDFDoc } from '../reader/pdf'

export interface ScoreRow {
  id: string
  group: string
  name: string
  /** Points per scoring period (e.g. AUTO, TELEOP); null where the action doesn't score. */
  values: Record<string, number | null>
}

/**
 * What a bonus ranking point is measured on: a checkbox ("manual"), total points,
 * or points/counts from a group or a single row.
 */
export type Metric = 'manual' | 'total' | `points:group:${string}` | `count:group:${string}` | `points:row:${string}` | `count:row:${string}`

export interface RpRule {
  id: string
  name: string
  description: string
  rp: number
  threshold: number | null
  metric: Metric
}

export interface ScoringModel {
  source: string
  periods: string[]
  rows: ScoreRow[]
  bonusRps: RpRule[]
  winRp: number
  tieRp: number
}

interface Token {
  x: number
  /** Horizontal center. */
  cx: number
  str: string
}

interface Line {
  y: number
  tokens: Token[]
  text: string
}

let counter = 0
const uid = (prefix: string) => `${prefix}${++counter}-${Math.random().toString(36).slice(2, 7)}`

async function pageLines(doc: PDFDoc, pageNumber: number): Promise<{ lines: Line[]; height: number }> {
  const page = await doc.getPage(pageNumber)
  const height = page.getViewport({ scale: 1 }).height
  const content = await page.getTextContent()
  const lines: Line[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim() || /^[®™©]+$/.test(item.str.trim())) continue
    const y = item.transform[5]
    let line = lines.find((l) => Math.abs(l.y - y) < 3)
    if (!line) lines.push((line = { y, tokens: [], text: '' }))
    line.tokens.push({ x: item.transform[4], cx: item.transform[4] + item.width / 2, str: item.str.trim() })
  }
  lines.sort((a, b) => b.y - a.y)
  for (const l of lines) {
    l.tokens.sort((a, b) => a.x - b.x)
    l.text = l.tokens.map((t) => t.str).join(' ')
  }
  return { lines, height }
}

// Column headings must match whole cells, so wrapped text like "(… in AUTO)" isn't one.
const PERIODS: [RegExp, string][] = [
  [/^auto(nomous)?$/i, 'AUTO'],
  [/^tele-?op(erated)?$/i, 'TELEOP'],
  [/^end\s?game$/i, 'ENDGAME'],
]
const RP_HEADER = /^(ranking( points?)?|rps?|qual(s|\.|ification)?)$/i
const PLAYOFF_HEADER = /^playoffs?\.?$/i
const POINTS_HEADER = /^(points?|value|match points)$/i

/** A numeric cell: "15", "+1", "1 RP", "1 Ranking", or a dash for "none". */
function cellValue(str: string): number | 'dash' | null {
  if (/^[-–—]$/.test(str)) return 'dash'
  const m = str.match(/^\+?\s*(\d+)(\s*(RP|Ranking|pts?|points?))?$/i)
  return m ? Number(m[1]) : null
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

/** A threshold written in a description, e.g. "at least sixty-five (65)". */
function thresholdIn(text: string): number | null {
  const paren = text.match(/\((\d+)\)/)
  if (paren) return Number(paren[1])
  const atLeast = text.match(/(?:at least|or more|minimum of|≥)\s*(\d+)/i) ?? text.match(/(\d+)\s*or more/i)
  if (atLeast) return Number(atLeast[1])
  const word = text.match(/at least (\w+)/i)?.[1]?.toLowerCase()
  return word && WORD_NUMBERS[word] ? WORD_NUMBERS[word] : null
}

const cleanGroup = (s: string) =>
  s
    .replace(/[*]/g, '')
    .replace(/\b(points?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Parses one table starting at a caption line. */
function parseTable(lines: Line[], captionIndex: number, pageHeight: number, caption: string) {
  // Header: the lines just below the caption that name the columns.
  const columns: { key: string; cx: number }[] = []
  let headerEnd = captionIndex
  for (let i = captionIndex + 1; i < Math.min(lines.length, captionIndex + 8); i++) {
    // Headings are short words; a line of sentence text is already the table body.
    if (lines[i].tokens.some((t) => t.str.length > 22)) continue
    if (lines[i].tokens.some((t) => cellValue(t.str) != null && !/^[-–—]$/.test(t.str))) break
    let found = false
    for (const t of lines[i].tokens) {
      const period = PERIODS.find(([re]) => re.test(t.str))
      let key: string | null = period ? period[1] : RP_HEADER.test(t.str) ? 'RP' : PLAYOFF_HEADER.test(t.str) ? 'PLAYOFF' : null
      // A lone "Points"/"Value" column is the points column for games without periods.
      if (!key && POINTS_HEADER.test(t.str) && i > captionIndex) key = 'POINTS'
      if (key && !columns.some((c) => c.key === key)) {
        columns.push({ key, cx: t.cx })
        found = true
      } else if (key) found = true
    }
    if (found) headerEnd = i
  }
  const periodCols = columns.filter((c) => PERIODS.some(([, p]) => p === c.key))
  // "MATCH Points" over AUTO/TELEOP is a group heading, not its own column.
  const numericCols = periodCols.length ? columns.filter((c) => c.key !== 'POINTS') : columns
  if (!numericCols.some((c) => c.key !== 'RP' && c.key !== 'PLAYOFF')) return null
  const firstNumX = Math.min(...numericCols.map((c) => c.cx)) - 22

  // Table body: until prose resumes, another caption, or the page footer.
  const body: Line[] = []
  let tableLeft = Infinity
  let end = lines.length
  for (let i = headerEnd + 1; i < lines.length; i++) {
    const line = lines[i]
    end = i
    if (line.y < pageHeight * 0.06) break
    if (/^(Table|Figure)\s*\d+[-–.]\d+/i.test(line.text)) break
    const left = line.tokens[0].x
    if (body.length && left < tableLeft - 12 && line.text.length > 45 && line.tokens[0].cx < firstNumX) break
    end = i + 1
    if (line.tokens[0].cx < firstNumX) tableLeft = Math.min(tableLeft, left)
    body.push(line)
  }
  if (!body.length) return null

  // Text columns: a category column on the left, when the labels start at two distinct places.
  const labelStarts = body.flatMap((l) => l.tokens.filter((t) => t.cx < firstNumX).map((t) => t.x))
  const minStart = Math.min(...labelStarts)
  const hasCategory = labelStarts.some((x) => x > minStart + 60) && labelStarts.filter((x) => x < minStart + 30).length < labelStarts.length * 0.8
  const catLimit = minStart + 45

  interface Raw {
    y: number
    category: string[]
    desc: string[]
    values: Record<string, number | 'dash'>
  }
  const split = (line: Line) => {
    const category: string[] = []
    const desc: string[] = []
    const values: Record<string, number | 'dash'> = {}
    for (const t of line.tokens) {
      if (t.cx < firstNumX) {
        if (/^[-–—]$/.test(t.str)) continue
        ;(hasCategory && t.x < catLimit ? category : desc).push(t.str)
        continue
      }
      const v = cellValue(t.str)
      if (v == null) continue
      const col = numericCols.reduce((best, c) => (Math.abs(c.cx - t.cx) < Math.abs(best.cx - t.cx) ? c : best))
      if (Math.abs(col.cx - t.cx) < 50 && values[col.key] == null) values[col.key] = v
    }
    return { y: line.y, category, desc, values }
  }

  const parsed = body.map(split)
  const anchors = parsed.filter((r) => Object.keys(r.values).length)
  // Most tables put the numbers on a row's first line; some center them vertically.
  const topAligned = anchors.filter((a) => a.desc.length || a.category.length).length >= anchors.length * 0.6
  const rows: Raw[] = []
  if (topAligned) {
    let pending: Raw | null = null
    for (const r of parsed) {
      if (Object.keys(r.values).length) {
        const row: Raw = { ...r, category: [...(pending?.category ?? []), ...r.category], desc: [...(pending?.desc ?? []), ...r.desc] }
        pending = null
        rows.push(row)
      } else if (rows.length) {
        const last = rows[rows.length - 1]
        last.category.push(...r.category)
        last.desc.push(...r.desc)
      } else {
        pending = pending ?? { y: r.y, category: [], desc: [], values: {} }
        pending.category.push(...r.category)
        pending.desc.push(...r.desc)
      }
    }
  } else {
    for (const a of anchors) rows.push({ ...a, category: [...a.category], desc: [...a.desc] })
    for (const r of parsed) {
      if (Object.keys(r.values).length || !rows.length) continue
      const nearest = rows.reduce((best, a) => (Math.abs(a.y - r.y) < Math.abs(best.y - r.y) ? a : best))
      nearest.category.push(...r.category)
      nearest.desc.push(...r.desc)
    }
    rows.sort((a, b) => b.y - a.y)
  }

  const periods = periodCols.length ? periodCols.sort((a, b) => a.cx - b.cx).map((c) => c.key) : ['POINTS']
  return { rows, periods, caption, end }
}

/** Turns parsed table rows into a scoring model. */
function toModel(parsed: NonNullable<ReturnType<typeof parseTable>>, source: string, extraLines: Line[]): ScoringModel {
  const model: ScoringModel = { source, periods: parsed.periods, rows: [], bonusRps: [], winRp: 2, tieRp: 1 }
  let group = ''
  for (const r of parsed.rows) {
    const category = r.category.join(' ').replace(/\s+/g, ' ').trim()
    const desc = r.desc.join(' ').replace(/\s+/g, ' ').trim()
    if (category && !/^[*]/.test(category)) group = cleanGroup(category)
    const label = desc || category
    const rp = typeof r.values.RP === 'number' ? r.values.RP : 0
    const values: Record<string, number | null> = {}
    let scores = false
    for (const p of parsed.periods) {
      const v = r.values[p]
      values[p] = typeof v === 'number' ? v : null
      if (typeof v === 'number' && v > 0) scores = true
    }
    const head = `${category} ${desc}`.trim()
    if (/^\W*win\b/i.test(head) || /more (match )?points than/i.test(desc)) {
      if (rp) model.winRp = rp
      continue
    }
    if (/^\W*tie\b/i.test(head) || /same number of (match )?points/i.test(desc)) {
      if (rp) model.tieRp = rp
      continue
    }
    if (rp && !scores) {
      // The RP's name is the capitalized words of its category (not wrapped sentence text).
      const caps = r.category.filter((w) => /^[*]?[A-Z0-9][A-Z0-9 &'’-]*$/.test(w)).join(' ')
      const name = (caps && /[A-Z]{3}/.test(caps) ? caps : label).replace(/[*]/g, '').trim()
      model.bonusRps.push({ id: uid('rp'), name, description: desc, rp, threshold: thresholdIn(desc), metric: 'manual' })
      continue
    }
    if (!scores) continue
    model.rows.push({ id: uid('row'), group: group || cleanGroup(category) || 'Scoring', name: label || group, values })
  }

  // Thresholds listed in a separate table (e.g. "BONUS RP thresholds"): a line starting with the RP's name.
  for (const rule of model.bonusRps) {
    if (rule.threshold != null) continue
    const key = rule.name.replace(/\bRP\b/i, '').trim().toLowerCase()
    const line = extraLines.find((l) => l.text.toLowerCase().startsWith(key) && /\d/.test(l.text.slice(key.length)))
    const n = line?.text.slice(key.length).match(/\d+/)
    if (n) rule.threshold = Number(n[0])
  }

  // Guess what each bonus RP measures from its description.
  const groups = [...new Set(model.rows.map((r) => r.group))]
  for (const rule of model.bonusRps) {
    const text = `${rule.name} ${rule.description}`.toLowerCase()
    const mentioned = groups
      .filter((g) => g && new RegExp(`\\b${g.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))
      .sort((a, b) => b.length - a.length)[0]
    if (!mentioned || rule.threshold == null) continue
    rule.metric = /points/.test(text) ? `points:group:${mentioned}` : `count:group:${mentioned}`
  }
  return model
}

const TABLE_CAPTION = /^(Table\s*\d+[-–.]\d+):?\s*(.*)$/i

/** Finds and reads the point value table. Returns null if none could be read. */
export async function findPointTable(doc: PDFDoc, manualName: string): Promise<ScoringModel | null> {
  let best: { model: ScoringModel; score: number } | null = null
  for (let p = 1; p <= doc.numPages; p++) {
    const { lines, height } = await pageLines(doc, p)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].text.match(TABLE_CAPTION)
      if (!m || !/point values?|rewards|scoring/i.test(m[2]) || /district|regional|penalt|qualification|assignment/i.test(m[2])) continue
      const parsed = parseTable(lines, i, height, `${m[1]} ${m[2]}`.trim())
      if (!parsed) continue
      // Lines after this table, and the next page, may hold a thresholds table.
      const next = p < doc.numPages ? (await pageLines(doc, p + 1)).lines : []
      const model = toModel(parsed, `${manualName}, page ${p} (${parsed.caption.slice(0, 60)})`, [...lines.slice(parsed.end), ...next])
      const score = model.rows.length * 2 + model.bonusRps.length + (model.periods.length > 1 ? 4 : 0)
      if (model.rows.length && (!best || score > best.score)) best = { model, score }
    }
  }
  return best?.model ?? null
}

/** A starting point for games whose manual has no readable table. */
export const blankModel = (source = 'Entered by hand'): ScoringModel => ({
  source,
  periods: ['AUTO', 'TELEOP'],
  rows: [{ id: uid('row'), group: 'Scoring', name: 'New scoring action', values: { AUTO: 0, TELEOP: 0 } }],
  bonusRps: [],
  winRp: 3,
  tieRp: 1,
})

export const newRowId = () => uid('row')
export const newRuleId = () => uid('rp')
