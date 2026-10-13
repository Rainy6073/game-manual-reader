import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PDFDoc = pdfjs.PDFDocumentProxy

export interface OutlineItem {
  id: string
  title: string
  page: number | null
  /** Last page belonging to this entry (up to where the next entry starts). */
  end: number
  children: OutlineItem[]
}

export function loadPdf(source: string | ArrayBuffer): Promise<PDFDoc> {
  const params = typeof source === 'string' ? { url: source } : { data: source }
  // Font names (e.g. "Roboto-Bold") are needed to rebuild formatting for the Focused View.
  return pdfjs.getDocument({ ...params, fontExtraProperties: true }).promise
}

/** Resolves the PDF's bookmarks into a tree with 1-based page numbers. */
export async function getOutline(doc: PDFDoc): Promise<OutlineItem[]> {
  const raw = await doc.getOutline()

  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(explicit) || explicit.length === 0) return null
      const ref = explicit[0]
      const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref)
      return index + 1
    } catch {
      return null
    }
  }

  const walk = async (items: NonNullable<typeof raw>, prefix: string): Promise<OutlineItem[]> =>
    Promise.all(
      items.map(async (item, i) => ({
        id: `${prefix}${i}`,
        title: item.title,
        page: await resolve(item.dest),
        end: doc.numPages,
        children: await walk(item.items ?? [], `${prefix}${i}.`),
      })),
    )

  // Each entry runs until the next sibling starts (or its parent ends).
  const assignEnds = (items: OutlineItem[], bound: number) => {
    items.forEach((item, i) => {
      const next = items.slice(i + 1).find((n) => n.page != null)?.page
      item.end = next != null ? Math.max(item.page ?? next, next - 1) : bound
      assignEnds(item.children, item.end)
    })
  }

  const tree = raw?.length ? await walk(raw, '') : await outlineFromContentsPage(doc)
  assignEnds(tree, doc.numPages)
  return tree
}

// --- Contents-page fallback ----------------------------------------------------
//
// Some manuals (e.g. 2017) have no PDF bookmarks, only a printed "Contents" page.
// Rebuild the outline from it: each entry is "<number> <title> ....... <page>",
// nesting follows the section number ("10.2.1" sits under "10.2"), and the entry's
// link annotation (when present) gives its real page.

interface TocEntry {
  number: string | null
  title: string
  /** Page number printed in the contents. */
  printed: number
  /** Actual PDF page, from the entry's link; NaN until resolved. */
  page: number
}

const TOC_SCAN_PAGES = 15
const TOC_LINE = /^(?:(\d+(?:\.\d+)*)\.?\s+)?(.*?\S)\s*\.{3,}[.\s]*(\d{1,4})$/

async function outlineFromContentsPage(doc: PDFDoc): Promise<OutlineItem[]> {
  const entries: TocEntry[] = []
  const offsets: number[] = []
  let inToc = false

  for (let p = 1; p <= Math.min(doc.numPages, TOC_SCAN_PAGES); p++) {
    const page = await doc.getPage(p)
    const [content, annotations] = await Promise.all([page.getTextContent(), page.getAnnotations()])

    // Group text into lines, skipping trademark symbols set as superscripts.
    const lines: { y: number; parts: { x: number; str: string }[] }[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim() || /^[®™℠©\s]+$/.test(item.str)) continue
      const y = item.transform[5]
      let line = lines.find((l) => Math.abs(l.y - y) < 3)
      if (!line) lines.push((line = { y, parts: [] }))
      line.parts.push({ x: item.transform[4], str: item.str })
    }
    lines.sort((a, b) => b.y - a.y)
    const texts = lines.map((l) => ({
      y: l.y,
      text: l.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.str)
        .join(' ')
        .replace(/[®™℠]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))

    const isTocPage = inToc || texts.some((t) => /^(table of )?contents\b/i.test(t.text))
    const pageEntries: { number: string | null; title: string; printed: number; y: number }[] = []
    let carry = ''
    for (const { y, text } of texts) {
      const m = TOC_LINE.exec(carry ? `${carry} ${text}` : text)
      if (m) {
        pageEntries.push({ number: m[1] ?? null, title: m[2].replace(/\s+([,.])/g, '$1').trim(), printed: Number(m[3]), y })
        carry = ''
      } else {
        // A long title can wrap onto the next line; only numbered lines start an entry.
        carry = /^\d+(\.\d+)*\.?\s+\S/.test(text) && !carry ? text : ''
      }
    }
    if (!isTocPage || pageEntries.length < 3) {
      if (inToc) break
      continue
    }
    inToc = true

    // Prefer the entry's link target over its printed page number.
    const links = annotations.filter((a) => a.subtype === 'Link' && a.dest)
    for (const entry of pageEntries) {
      const link = links.find((a) => a.rect[1] - 3 <= entry.y && entry.y <= a.rect[3] + 3)
      const target = link ? await destinationPage(doc, link.dest) : null
      if (target != null) offsets.push(target - entry.printed)
      entries.push({ number: entry.number, title: entry.title, printed: entry.printed, page: target ?? NaN })
    }
  }

  // Entries without a link use their printed page shifted by the usual offset.
  const sorted = [...offsets].sort((a, b) => a - b)
  const offset = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  for (const entry of entries) {
    if (Number.isNaN(entry.page)) entry.page = Math.min(doc.numPages, Math.max(1, entry.printed + offset))
  }

  // Nest entries by their section numbers.
  const root: OutlineItem[] = []
  const stack: { depth: number; item: OutlineItem }[] = []
  entries.forEach((entry, i) => {
    const depth = entry.number ? entry.number.split('.').length : 1
    const item: OutlineItem = {
      id: `toc${i}`,
      title: entry.number ? `${entry.number} ${entry.title}` : entry.title,
      page: entry.page,
      end: doc.numPages,
      children: [],
    }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    ;(stack.length ? stack[stack.length - 1].item.children : root).push(item)
    stack.push({ depth, item })
  })
  return root
}

async function destinationPage(doc: PDFDoc, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const ref = explicit[0]
    return (typeof ref === 'number' ? ref : await doc.getPageIndex(ref)) + 1
  } catch {
    return null
  }
}

/** The path of outline entries (outermost first) whose page range contains `page`. */
export function outlinePathAt(items: OutlineItem[], page: number): OutlineItem[] {
  let found: OutlineItem | undefined
  for (const item of items) {
    if (item.page != null && item.page <= page && page <= item.end) found = item
  }
  return found ? [found, ...outlinePathAt(found.children, page)] : []
}

/** Keeps only outline entries whose page range includes at least one of `pages`. */
export function filterOutline(items: OutlineItem[], pages: Set<number>): OutlineItem[] {
  return items.flatMap((item) => {
    if (item.page == null) return []
    let hit = false
    for (let p = item.page; p <= item.end && !hit; p++) hit = pages.has(p)
    return hit ? [{ ...item, children: filterOutline(item.children, pages) }] : []
  })
}

/** Searchable text for one page; `starts[i]` is where text item i begins in `text`. */
export interface PageText {
  /** Page text in its original case. */
  raw: string
  /** Lowercased copy, for case-insensitive search. */
  text: string
  starts: number[]
  lengths: number[]
}

/** Extracts text for every page, in the same item order the TextLayer renders spans. */
export async function buildTextIndex(doc: PDFDoc): Promise<PageText[]> {
  return Promise.all(
    Array.from({ length: doc.numPages }, async (_, i) => {
      const content = await (await doc.getPage(i + 1)).getTextContent()
      let text = ''
      const starts: number[] = []
      const lengths: number[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        starts.push(text.length)
        lengths.push(item.str.length)
        text += item.str
        if (item.hasEOL) text += ' '
      }
      return { raw: text, text: text.toLowerCase(), starts, lengths }
    }),
  )
}

/** A highlighted slice of one text item (span) on a page. */
export interface HighlightSegment {
  item: number
  start: number
  end: number
  selected: boolean
  /** Game-element highlights are styled differently from search matches. */
  element?: boolean
}

export interface SearchMatch {
  page: number
  segments: Omit<HighlightSegment, 'selected'>[]
}

/** Splits the character range [at, end) of a page's text into per-span segments. */
function segmentsFor({ starts, lengths }: PageText, at: number, end: number): SearchMatch['segments'] {
  const segments: SearchMatch['segments'] = []
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]
    const e = s + lengths[i]
    if (e <= at) continue
    if (s >= end) break
    segments.push({ item: i, start: Math.max(at, s) - s, end: Math.min(end, e) - s })
  }
  return segments
}

/** Case-insensitive plain-text search across all pages. */
export function search(index: PageText[], query: string): SearchMatch[] {
  const needle = query.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!needle) return []
  const matches: SearchMatch[] = []
  index.forEach((page, p) => {
    const hay = page.text.replace(/\s/g, ' ')
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
      matches.push({ page: p + 1, segments: segmentsFor(page, at, at + needle.length) })
    }
  })
  return matches
}

// --- Game elements ----------------------------------------------------------

export interface GameElement {
  /** Display name, e.g. "HUB" or "DRIVER STATIONS". */
  name: string
  /** Matches the term in the manual's capitalized form, including plurals. */
  pattern: RegExp
  /** The ARENA subsection that describes this element. */
  section: OutlineItem
}

const stripNumber = (title: string) => title.replace(/^[\d.]+\s*/, '').trim()
const isAllCaps = (s: string) => /[A-Z]/.test(s) && !/[a-z]/.test(s)
const SCORING_HEADING = /SCORING ELEMENTS?|GAME PIECES?/

function elementFor(name: string, section: OutlineItem): GameElement {
  // Match singular and plural forms: "DRIVER STATIONS" also matches "DRIVER STATION",
  // "HUB" matches "HUBS", "HUBs" and "HUB's".
  const singular = /[^S]S$/.test(name) && name.length > 4 ? name.slice(0, -1) : name
  const body = singular
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  return { name, section, pattern: new RegExp(`(?<![A-Za-z])${body}(?:ES|S|es|s|'s|’s)?(?![A-Za-z])`, 'g') }
}

/** Common capitalized terms that are never the scoring element itself. */
const GENERIC_TERMS = new Set(['ROBOT', 'ROBOTS', 'ALLIANCE', 'MATCH', 'FIELD', 'ARENA', 'TEAM', 'DRIVE', 'AUTO', 'TELEOP', 'FIRST', 'FRC'])

/**
 * Finds the game elements described in the manual's ARENA section: every all-caps
 * heading under ARENA, except that the SCORING ELEMENTS heading is replaced by the
 * scoring elements it describes.
 */
export function findGameElements(outline: OutlineItem[], index: PageText[]): GameElement[] {
  const arena = outline.find((item) => /\bARENA\b/.test(item.title))
  if (!arena) return []
  const found = new Map<string, OutlineItem>()
  const add = (name: string, section: OutlineItem) => {
    if (!found.has(name)) found.set(name, section)
  }

  const visit = (items: OutlineItem[]) => {
    for (const item of items) {
      const title = stripNumber(item.title)
      if (SCORING_HEADING.test(title)) {
        const children = item.children.filter((c) => isAllCaps(stripNumber(c.title)))
        if (children.length) children.forEach((c) => add(stripNumber(c.title), c))
        else add(guessScoringElement(item, title, index) ?? title, item)
        continue
      }
      if (isAllCaps(title)) add(title, item)
      visit(item.children)
    }
  }
  visit(arena.children)

  return [...found].map(([name, section]) => elementFor(name, section))
}

/** For a scoring section with no sub-headings, picks its most frequent all-caps term. */
function guessScoringElement(item: OutlineItem, heading: string, index: PageText[]): string | null {
  if (item.page == null) return null
  const text = index
    .slice(item.page - 1, item.end)
    .map((p) => p.raw)
    .join(' ')
  const at = text.indexOf(heading)
  const section = text.slice(at === -1 ? 0 : at + heading.length, (at === -1 ? 0 : at) + 4000)
  const counts = new Map<string, number>()
  for (const [word] of section.matchAll(/(?<![A-Za-z])[A-Z]{3,}(?![a-z])/g)) {
    const singular = word.replace(/S$/, '')
    if (GENERIC_TERMS.has(word) || heading.includes(word)) continue
    counts.set(singular, (counts.get(singular) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [word, n] of counts) if (!best || n > counts.get(best)!) best = word
  return best
}

/** Every occurrence of a game element, grouped as search matches. */
export function findElement(index: PageText[], element: GameElement): SearchMatch[] {
  const matches: SearchMatch[] = []
  index.forEach((page, p) => {
    const hay = page.raw.replace(/\s/g, ' ')
    for (const m of hay.matchAll(element.pattern)) {
      matches.push({ page: p + 1, segments: segmentsFor(page, m.index, m.index + m[0].length) })
    }
  })
  return matches
}

export { pdfjs }
