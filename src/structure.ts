// Rebuilds the logical structure (headings, paragraphs, lists, note boxes, figures,
// rules) of FRC game manual pages from pdf.js text positions and fonts.
//
// FRC manuals use a consistent layout: rule IDs (e.g. "G104") sit at the left
// margin in bold, rule text is indented one step, and the blue "note" boxes are
// indented a further step. Section headings are larger bold numbered lines and
// figure captions are small italic "Figure x-y" lines placed above the figure.

import { pdfjs, type OutlineItem, type PDFDoc } from './pdf'

export interface Run {
  text: string
  bold: boolean
  italic: boolean
}

interface Item extends Run {
  x: number
  width: number
}

interface Line {
  page: number
  x: number
  y: number
  size: number
  items: Item[]
  text: string
  /** Sits inside one of the manual's coloured note boxes. */
  inBox: boolean
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Finds coloured note boxes from the page's drawing operations: either a coloured
 * background fill, or (as in recent manuals) a thin coloured bar down the left edge.
 */
function findBoxes(ops: { fnArray: number[]; argsArray: unknown[] }, pageWidth: number): { bars: Rect[]; fills: Rect[] } {
  const { OPS } = pdfjs
  const bars: Rect[] = []
  const fills: Rect[] = []
  type M = [number, number, number, number, number, number]
  const mul = (a: M, b: M): M => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
  let ctm: M = [1, 0, 0, 1, 0, 0]
  let fill = '#000000'
  const stack: { ctm: M; fill: string }[] = []
  const FILL_OPS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])

  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown[]
    if (fn === OPS.save) stack.push({ ctm, fill })
    else if (fn === OPS.restore) ({ ctm, fill } = stack.pop() ?? { ctm, fill })
    else if (fn === OPS.transform) ctm = mul(ctm, args as M)
    else if (fn === OPS.setFillRGBColor && typeof args[0] === 'string') fill = args[0]
    else if (fn === OPS.constructPath && FILL_OPS.has(args[0] as number)) {
      if (/^#(?:([0-9a-f]{2})\1\1)$/i.test(fill)) return // black, white and greys
      const [minX, minY, maxX, maxY] = Array.from(args[2] as ArrayLike<number>)
      const xs = [minX, maxX].map((x, k) => ctm[0] * x + ctm[2] * [minY, maxY][k] + ctm[4])
      const ys = [minY, maxY].map((y, k) => ctm[1] * [minX, maxX][k] + ctm[3] * y + ctm[5])
      const r = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
      if (r.x1 - r.x0 < 6 && r.y1 - r.y0 > 0.5) bars.push(r)
      else if (r.x1 - r.x0 < pageWidth * 0.95 && r.y1 - r.y0 > 8) fills.push(r)
    }
  })
  return { bars, fills }
}

export type Block =
  | { kind: 'heading'; text: string; page: number }
  | {
      kind: 'para'
      runs: Run[]
      page: number
      /** Inside an indented note box (the manual's blue boxes). */
      box: boolean
      /** List marker such as "A." when this paragraph is a list item. */
      marker?: string
      /** Nesting level of a list item (0 = outermost). */
      depth: number
      violation: boolean
    }
  /** A figure or table, shown as a crop of the page (PDF-space vertical range). */
  | { kind: 'figure'; caption: string; page: number; top: number; bottom: number }

export interface Rule {
  id: string
  /** Subsection heading the rule appears under, e.g. "7.2 Conduct". */
  section: string
  page: number
  blocks: Block[]
}

/** Lines below this are page footers; above PAGE_TOP_MARGIN from the top are headers. */
const FOOTER_Y = 45
const HEADER_GAP = 30

// --- Line extraction ---------------------------------------------------------

const lineCache = new WeakMap<PDFDoc, Map<number, Promise<Line[]>>>()

function pageLines(doc: PDFDoc, pageNumber: number): Promise<Line[]> {
  let byPage = lineCache.get(doc)
  if (!byPage) lineCache.set(doc, (byPage = new Map()))
  let lines = byPage.get(pageNumber)
  if (!lines) byPage.set(pageNumber, (lines = readLines(doc, pageNumber)))
  return lines
}

async function readLines(doc: PDFDoc, pageNumber: number): Promise<Line[]> {
  const page = await doc.getPage(pageNumber)
  // Loading the operator list resolves the page's fonts, which carry their real
  // names (e.g. "Roboto-BoldItalic"); text content alone only has generic families.
  const ops = await page.getOperatorList()
  const content = await page.getTextContent()
  const pageHeight = page.view[3]
  const { bars, fills } = findBoxes(ops, page.view[2])
  const inBox = (x: number, y: number, size: number) =>
    bars.some((b) => b.x1 <= x + 1 && x - b.x1 < 24 && y + size >= b.y0 - 3 && y <= b.y1 + 3) ||
    fills.some((f) => x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1)

  const fontStyle = new Map<string, { bold: boolean; italic: boolean }>()
  const styleOf = (fontName: string) => {
    let style = fontStyle.get(fontName)
    if (!style) {
      let name = ''
      try {
        const font = page.commonObjs.get(fontName) as { name?: string; bold?: boolean; italic?: boolean }
        name = font?.name ?? ''
        style = { bold: !!font?.bold || /bold|black|heavy|semibold/i.test(name), italic: !!font?.italic || /italic|oblique/i.test(name) }
      } catch {
        style = { bold: false, italic: false }
      }
      fontStyle.set(fontName, style)
    }
    return style
  }

  const raw = content.items
    .filter((it): it is Extract<typeof it, { str: string }> => 'str' in it && it.str !== '')
    .map((it) => ({
      text: it.str,
      x: it.transform[4],
      y: it.transform[5],
      size: Math.hypot(it.transform[2], it.transform[3]),
      width: it.width,
      ...styleOf(it.fontName),
    }))
    .filter((it) => it.y > FOOTER_Y && it.y < pageHeight - HEADER_GAP)
    .sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: Line[] = []
  for (const it of raw) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.size * 0.3))
    if (line) {
      line.items.push(it)
      line.size = Math.max(line.size, it.size)
    } else {
      lines.push({ page: pageNumber, x: 0, y: it.y, size: it.size, items: [it], text: '', inBox: false })
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    // Insert a space where pdf.js split words without an explicit space item.
    const items: Item[] = []
    for (const it of line.items) {
      const prev = items[items.length - 1]
      if (prev && !/\s$/.test(prev.text) && !/^\s/.test(it.text) && it.x - (prev.x + prev.width) > line.size * 0.2) {
        items.push({ text: ' ', x: prev.x + prev.width, width: 0, bold: prev.bold, italic: prev.italic })
      }
      items.push(it)
    }
    line.items = items
    line.x = items.find((i) => i.text.trim())?.x ?? items[0].x
    line.text = items.map((i) => i.text).join('').replace(/\s+/g, ' ').trim()
    line.inBox = inBox(line.x, line.y, line.size)
  }
  return lines.filter((l) => l.text).sort((a, b) => b.y - a.y)
}

async function linesFor(doc: PDFDoc, from: number, to: number): Promise<Line[]> {
  const pages = await Promise.all(Array.from({ length: to - from + 1 }, (_, i) => pageLines(doc, from + i)))
  return pages.flat()
}

// --- Block building ----------------------------------------------------------

const allBold = (l: Line) => l.items.every((i) => i.bold || !i.text.trim())
const isHeading = (l: Line) =>
  allBold(l) && (l.size >= 12 ? /^\d+(\.\d+)*\s+\S/.test(l.text) : /^\d+\.\d+(\.\d+)*\s+\S/.test(l.text) && l.x < 60)
const isCaption = (l: Line) => l.size < 10 && /^(Figure|Table)\s+\d/.test(l.text)
const LIST_MARKER = /^(\(?[A-Za-z]\)|[A-Za-z]\.|\d{1,2}[.)]|[ivx]{1,4}\.|[•▪◦●○■□➢\-–−o])$/

function toRuns(items: Item[]): Run[] {
  const runs: Run[] = []
  for (const { text, bold, italic } of items) {
    const prev = runs[runs.length - 1]
    if (prev && prev.bold === bold && prev.italic === italic) prev.text += text
    else runs.push({ text, bold, italic })
  }
  return runs
}

function appendRuns(target: Run[], runs: Run[]) {
  if (target.length && runs.length) {
    const last = target[target.length - 1]
    if (!/[\s-]$/.test(last.text)) last.text += ' '
  }
  for (const run of runs) {
    const prev = target[target.length - 1]
    if (prev && prev.bold === run.bold && prev.italic === run.italic) prev.text += run.text
    else target.push({ ...run })
  }
}

/**
 * Groups lines (in reading order, possibly spanning pages) into blocks.
 * `bodyX` is the indent of ordinary text; anything indented further is a note box.
 */
function buildBlocks(lines: Line[], bodyX: number, allLines: Line[]): Block[] {
  const blocks: Block[] = []
  type ParaState = Extract<Block, { kind: 'para' }> & { contX: number; last: Line }
  let para = null as ParaState | null
  // Indents of list markers seen so far, outermost first, to work out nesting.
  let markerIndents: number[] = []

  const flush = () => {
    if (para) {
      const { contX: _c, last: _l, ...block } = para
      block.runs = block.runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ') }))
      block.runs[0].text = block.runs[0].text.trimStart()
      block.runs[block.runs.length - 1].text = block.runs[block.runs.length - 1].text.trimEnd()
      if (block.runs.some((r) => r.text)) blocks.push(block)
    }
    para = null
  }

  // Text that lines up with the body or note-box indent (or a heading) marks the end
  // of a figure or table; anything else below a caption is part of it (labels, cells).
  // Table cells can happen to line up with an indent, so also require a full-width line.
  const resumesText = (l: Line) => {
    if (isHeading(l) || isCaption(l)) return true
    const last = l.items[l.items.length - 1]
    const wide = last.x + last.width - l.x > 250
    const aligned = l.x < bodyX - 10 || Math.abs(l.x - bodyX) <= 3 || Math.abs(l.x - (bodyX + 36)) <= 3
    return aligned && wide
  }
  let skip: { page: number; bottom: number } | null = null

  for (const line of lines) {
    if (skip && line.page === skip.page && line.y > skip.bottom) continue
    skip = null

    if (isCaption(line)) {
      flush()
      // Figures and tables sit below their caption.
      const below = allLines.find((l) => l.page === line.page && l.y < line.y - 1 && resumesText(l))
      const bottom = below ? below.y + below.size + 2 : FOOTER_Y
      blocks.push({ kind: 'figure', caption: line.text, page: line.page, top: line.y - 2, bottom })
      skip = { page: line.page, bottom }
      continue
    }
    if (line.size < 9.5) continue // labels inside figures
    if (isHeading(line)) {
      flush()
      blocks.push({ kind: 'heading', text: line.text, page: line.page })
      continue
    }

    const box = line.inBox
    const first = line.items.find((i) => i.text.trim())!
    const markerMatch = LIST_MARKER.test(first.text.trim()) ? first : null
    const violation = first.italic && /^Violation\b/.test(line.text)

    // A violation line may wrap onto a second italic line.
    const violationWrap = !!para?.violation && first.italic
    let startNew = !para || para.box !== box || !!markerMatch || violation || (para.violation && !violationWrap)
    if (para && !startNew) {
      const prev: Line = para.last
      if (prev.page === line.page) startNew = prev.y - line.y > prev.size * 1.65
      else startNew = /[.:!?)]$/.test(prev.text) && line.x <= para.contX + 2 && !/^[a-z]/.test(line.text)
      if (line.x < para.contX - 4) startNew = true
    }

    if (startNew) {
      const prevBox = (para as ParaState | null)?.box
      flush()
      let items = line.items
      let marker: string | undefined
      let contX = line.x
      let depth = 0
      if (markerMatch) {
        marker = markerMatch.text.trim()
        items = items.slice(items.indexOf(markerMatch) + 1)
        contX = items.find((i) => i.text.trim())?.x ?? line.x
        markerIndents = markerIndents.filter((x) => x < markerMatch.x - 4)
        depth = markerIndents.length
        markerIndents.push(markerMatch.x)
      } else if (line.x <= bodyX + 2 || box !== prevBox) {
        markerIndents = []
      }
      para = { kind: 'para', runs: toRuns(items), page: line.page, box, marker, depth, violation, contX, last: line }
    } else {
      appendRuns(para!.runs, toRuns(line.items))
      para!.last = line
    }
  }
  flush()
  return blocks
}

// --- Public API -----------------------------------------------------------------

const RULE_ID = /^[A-Z]{1,2}\d{3}[a-z]?$/

const ruleCache = new WeakMap<PDFDoc, Map<string, Promise<Rule[]>>>()

/** Extracts every rule in a section (e.g. "7 Game Rules (G)"), word for word. */
export function extractRules(doc: PDFDoc, section: OutlineItem): Promise<Rule[]> {
  let bySection = ruleCache.get(doc)
  if (!bySection) ruleCache.set(doc, (bySection = new Map()))
  let rules = bySection.get(section.id)
  if (!rules) bySection.set(section.id, (rules = parseRules(doc, section)))
  return rules
}

async function parseRules(doc: PDFDoc, section: OutlineItem): Promise<Rule[]> {
  if (section.page == null) return []
  const lines = await linesFor(doc, section.page, section.end)
  const rules: Rule[] = []
  let current: { rule: Rule; lines: Line[]; bodyX: number } | null = null
  let heading = section.title

  const finish = () => {
    if (current) {
      current.rule.blocks = buildBlocks(current.lines, current.bodyX, lines)
      rules.push(current.rule)
    }
    current = null
  }

  for (const line of lines) {
    const first = line.items.find((i) => i.text.trim())!
    if (isHeading(line)) {
      finish()
      heading = line.text
      continue
    }
    if (first.bold && RULE_ID.test(first.text.trim()) && line.x < 60) {
      finish()
      const rest = line.items.slice(line.items.indexOf(first) + 1)
      const bodyX = rest.find((i) => i.text.trim())?.x ?? line.x + 36
      current = {
        rule: { id: first.text.trim(), section: heading, page: line.page, blocks: [] },
        lines: [{ ...line, items: rest, x: bodyX, text: rest.map((i) => i.text).join('').trim() }],
        bodyX,
      }
      continue
    }
    current?.lines.push(line)
  }
  finish()
  return rules
}

/** Extracts the body of an ARENA subsection (e.g. "5.4 HUB") up to the next heading. */
export async function extractSection(doc: PDFDoc, section: OutlineItem): Promise<Block[]> {
  if (section.page == null) return []
  const lines = await linesFor(doc, section.page, section.end)
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const title = normalize(section.title)
  let start = lines.findIndex((l) => isHeading(l) && normalize(l.text) === title)
  if (start === -1) start = lines.findIndex((l) => isHeading(l) && title.endsWith(normalize(l.text).replace(/^[\d.]+\s*/, '')))
  const body: Line[] = []
  for (const line of lines.slice(start + 1)) {
    if (isHeading(line)) break
    body.push(line)
  }
  const bodyX = start >= 0 ? lines[start].x : Math.min(...body.map((l) => l.x))
  return buildBlocks(body, bodyX, lines)
}

/** Plain text of a block list, for matching terms. */
export function blocksText(blocks: Block[]): string {
  return blocks
    .map((b) => (b.kind === 'para' ? b.runs.map((r) => r.text).join('') : b.kind === 'figure' ? b.caption : b.text))
    .join(' ')
}
