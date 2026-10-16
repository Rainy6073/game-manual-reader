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

export function loadPdf(source: string | ArrayBuffer, password?: string): Promise<PDFDoc> {
  const params = typeof source === 'string' ? { url: source } : { data: source }
  // Font names (e.g. "Roboto-Bold") are needed to rebuild formatting for the Focused View.
  return pdfjs.getDocument({
    ...params,
    password,
    fontExtraProperties: true,
    // Decoders and font data, copied into public/ by scripts/copy-pdfjs-assets.mjs.
    wasmUrl: '/pdfjs/wasm/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    iccUrl: '/pdfjs/iccs/',
  }).promise
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

  const usable = raw?.length && !looksLikeFileNames(raw.map((i) => i.title))
  const tree = usable ? await walk(raw, '') : await outlineFromPageText(doc)
  assignEnds(tree, doc.numPages)
  return tree
}

// --- Fallback when a manual has no usable bookmarks -----------------------------
//
// Some manuals have no PDF bookmarks (2017) or only bookmarks named after the files
// that were merged into the PDF (2016). Their structure is still printed in the
// text: a "Contents" page or one contents page per chapter, with entries like
// "3.12 GAME PIECES ........ 37". Nesting follows the section number ("10.2.1"
// sits under "10.2"), and each entry's link annotation, when present, gives its
// real page (printed numbers may restart in every chapter).

interface TocEntry {
  number: string | null
  title: string
  page: number
}

const TOC_LINE = /^(?:(\d+(?:\.\d+)*)\.?\s+)?(.*?\S)\s*\.{3,}[.\s]*(\d{1,4})$/
// Section numbers have at most two digits per level, so "2016 FIRST ..." isn't one.
const NUMBERED_HEADING = /^(\d{1,2}(?:\.\d{1,2})*)\.?\s+(\S.*)$/

/** True when bookmarks are just file names, e.g. "FRC-2016-game-manual-02". */
const looksLikeFileNames = (titles: string[]) => titles.length > 0 && titles.every((t) => !/\s/.test(t.trim()))

interface TextLine {
  y: number
  size: number
  text: string
}

async function pageTextLines(doc: PDFDoc, pageNumber: number) {
  const page = await doc.getPage(pageNumber)
  const [content, annotations] = await Promise.all([page.getTextContent(), page.getAnnotations()])
  // Group text into lines, skipping trademark symbols set as superscripts.
  const groups: { y: number; size: number; parts: { x: number; width: number; str: string }[] }[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim() || /^[®™℠©\s]+$/.test(item.str)) continue
    const y = item.transform[5]
    const size = Math.hypot(item.transform[2], item.transform[3])
    let line = groups.find((l) => Math.abs(l.y - y) < 3)
    if (!line) groups.push((line = { y, size, parts: [] }))
    line.size = Math.max(line.size, size)
    line.parts.push({ x: item.transform[4], width: item.width, str: item.str })
  }
  const lines: TextLine[] = groups
    .sort((a, b) => b.y - a.y)
    .map((g) => {
      let text = ''
      let right = -Infinity
      for (const part of g.parts.sort((a, b) => a.x - b.x)) {
        // Small-caps titles are split into touching pieces ("Aren" + "A"): no space.
        text += part.x - right > g.size * 0.15 && text ? ` ${part.str}` : part.str
        right = part.x + part.width
      }
      return { y: g.y, size: g.size, text: text.replace(/[®™℠]/g, '').replace(/\s+/g, ' ').trim() }
    })
  return { lines, links: annotations.filter((a) => a.subtype === 'Link' && a.dest) }
}

/** Fixes small-caps words that come out as "ArenA" or "IntroductIon". */
const cleanTitle = (title: string) =>
  title.replace(/\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b/g, (w) => (/^[A-Z][a-z]+[A-Z][a-z]+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))

/** A page's title: its largest line that isn't just a number or a contents entry. */
function pageTitle(lines: TextLine[]): string | null {
  const candidates = lines.filter((l) => /[A-Za-z]{3}/.test(l.text) && !TOC_LINE.test(l.text) && !/©|rights reserved|\|\|/i.test(l.text))
  const best = candidates.sort((a, b) => b.size - a.size)[0]
  return best ? cleanTitle(best.text.replace(NUMBERED_HEADING, '$2')) : null
}

async function outlineFromPageText(doc: PDFDoc): Promise<OutlineItem[]> {
  const entries: TocEntry[] = []
  const chapters = new Set<string>()
  let firstTocPage = Infinity

  for (let p = 1; p <= doc.numPages; p++) {
    const { lines, links } = await pageTextLines(doc, p)
    const found: (TocEntry & { y: number; printed: number })[] = []
    let carry = ''
    for (const { y, text } of lines) {
      const m = TOC_LINE.exec(carry ? `${carry} ${text}` : text)
      if (m) {
        found.push({ number: m[1] ?? null, title: m[2].replace(/\s+([,.])/g, '$1').trim(), printed: Number(m[3]), page: NaN, y })
        carry = ''
      } else {
        // A long title can wrap onto the next line; only numbered lines start an entry.
        carry = /^\d+(\.\d+)*\.?\s+\S/.test(text) && !carry ? text : ''
      }
    }
    if (found.length < 3) continue
    firstTocPage = Math.min(firstTocPage, p)

    // Prefer the entry's link target over its printed page number.
    const offsets: number[] = []
    for (const entry of found) {
      const link = links.find((a) => a.rect[1] - 3 <= entry.y && entry.y <= a.rect[3] + 3)
      const target = link ? await destinationPage(doc, link.dest) : null
      if (target != null) {
        entry.page = target
        offsets.push(target - entry.printed)
      }
    }
    const offset = offsets.length ? offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)] : 0
    for (const entry of found) if (Number.isNaN(entry.page)) entry.page = Math.min(doc.numPages, Math.max(1, entry.printed + offset))

    // A chapter's own contents page lists only its subsections ("2.1", "2.2", ...);
    // the chapter itself is titled on that page.
    const chapter = found.find((e) => e.number)?.number?.split('.')[0]
    if (chapter && !found.some((e) => e.number === chapter) && !chapters.has(chapter)) {
      entries.push({ number: chapter, title: pageTitle(lines.filter((l) => l.y > found[0].y)) ?? `Section ${chapter}`, page: p })
    }
    for (const entry of found) {
      if (entry.number && !entry.number.includes('.')) chapters.add(entry.number)
      entries.push({ number: entry.number, title: entry.title, page: entry.page })
    }
    if (chapter) chapters.add(chapter)
  }

  // Pages before the first contents page (e.g. an Introduction chapter with no
  // contents page of its own): use their large numbered headings.
  const front: TocEntry[] = []
  const firstPage = Math.min(firstTocPage, ...entries.map((e) => e.page))
  for (let p = 1; p < Math.min(firstPage, doc.numPages + 1); p++) {
    const { lines } = await pageTextLines(doc, p)
    const sizes = lines.map((l) => l.size).sort((a, b) => a - b)
    const body = sizes[Math.floor(sizes.length / 2)] ?? 0
    for (const line of lines) {
      const m = NUMBERED_HEADING.exec(line.text)
      if (!m || line.size < body * 1.35 || TOC_LINE.test(line.text) || m[2].length > 80) continue
      const chapter = m[1].split('.')[0]
      if (m[1].includes('.') && !chapters.has(chapter)) {
        front.push({ number: chapter, title: pageTitle(lines.filter((l) => l.y > line.y)) ?? `Section ${chapter}`, page: p })
        chapters.add(chapter)
      }
      if (!m[1].includes('.')) chapters.add(chapter)
      front.push({ number: m[1], title: cleanTitle(m[2]), page: p })
    }
  }

  return nestEntries([...front, ...entries], doc.numPages)
}

/**
 * The section holding the game rules: "Game Rules" in most manuals; in older ones
 * (e.g. 2016) a "Rules" subsection of the "Game" chapter, or that chapter itself.
 */
export function findRulesSection(outline: OutlineItem[]): OutlineItem | undefined {
  const all: OutlineItem[] = []
  const walk = (items: OutlineItem[]) => items.forEach((i) => (all.push(i), walk(i.children)))
  walk(outline)
  const game = outline.find((i) => /^\d+\s+Game$/i.test(i.title.trim()))
  return (
    all.find((i) => /Game Rules/i.test(i.title)) ??
    game?.children.find((i) => /^[\d.]+\s+Rules$/i.test(i.title.trim())) ??
    game
  )
}

/** Nests contents entries by their section numbers. */
function nestEntries(entries: TocEntry[], numPages: number): OutlineItem[] {
  const root: OutlineItem[] = []
  const stack: { depth: number; item: OutlineItem }[] = []
  entries.forEach((entry, i) => {
    const depth = entry.number ? entry.number.split('.').length : 1
    const item: OutlineItem = {
      id: `toc${i}`,
      title: entry.number ? `${entry.number} ${entry.title}` : entry.title,
      page: entry.page,
      end: numPages,
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
  /** Someone's own highlight or note on this passage. */
  note?: { id: string; hasText: boolean }
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

/**
 * Finds a passage someone selected on a page. Selected text and extracted text
 * differ in spacing, so they are compared with all whitespace removed.
 */
export function findQuote(page: PageText, quote: string): SearchMatch['segments'] | null {
  const chars: string[] = []
  const at: number[] = []
  for (let i = 0; i < page.text.length; i++) {
    if (/\s/.test(page.text[i])) continue
    chars.push(page.text[i])
    at.push(i)
  }
  const needle = quote.toLowerCase().replace(/\s+/g, '')
  if (!needle) return null
  const found = chars.join('').indexOf(needle)
  if (found === -1) return null
  return segmentsFor(page, at[found], at[found + needle.length - 1] + 1)
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
  const arena = outline.find((item) => /\bARENA\b/i.test(item.title))
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

/** True when a PDF failed to open because it needs a (different) password. */
export const isPasswordError = (err: unknown) => err instanceof pdfjs.PasswordException || (err as Error)?.name === 'PasswordException'

export { pdfjs }
