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
  return pdfjs.getDocument(params).promise
}

/** Resolves the PDF's bookmarks into a tree with 1-based page numbers. */
export async function getOutline(doc: PDFDoc): Promise<OutlineItem[]> {
  const raw = await doc.getOutline()
  if (!raw) return []

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

  const walk = async (items: typeof raw, prefix: string): Promise<OutlineItem[]> =>
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

  const tree = await walk(raw, '')
  assignEnds(tree, doc.numPages)
  return tree
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
}

const stripNumber = (title: string) => title.replace(/^[\d.]+\s*/, '').trim()
const isAllCaps = (s: string) => /[A-Z]/.test(s) && !/[a-z]/.test(s)
const SCORING_HEADING = /SCORING ELEMENTS?|GAME PIECES?/

function elementFor(name: string): GameElement {
  // Match singular and plural forms: "DRIVER STATIONS" also matches "DRIVER STATION",
  // "HUB" matches "HUBS", "HUBs" and "HUB's".
  const singular = /[^S]S$/.test(name) && name.length > 4 ? name.slice(0, -1) : name
  const body = singular
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  return { name, pattern: new RegExp(`(?<![A-Za-z])${body}(?:ES|S|es|s|'s|’s)?(?![A-Za-z])`, 'g') }
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
  const names: string[] = []

  const visit = (items: OutlineItem[]) => {
    for (const item of items) {
      const title = stripNumber(item.title)
      if (SCORING_HEADING.test(title)) {
        const children = item.children.map((c) => stripNumber(c.title)).filter(isAllCaps)
        if (children.length) names.push(...children)
        else {
          const guess = guessScoringElement(item, title, index)
          names.push(guess ?? title)
        }
        continue
      }
      if (isAllCaps(title)) names.push(title)
      visit(item.children)
    }
  }
  visit(arena.children)

  return [...new Set(names)].map(elementFor)
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
