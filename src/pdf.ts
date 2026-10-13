import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PDFDoc = pdfjs.PDFDocumentProxy

export interface OutlineItem {
  title: string
  page: number | null
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

  const walk = async (items: typeof raw): Promise<OutlineItem[]> =>
    Promise.all(
      items.map(async (item) => ({
        title: item.title,
        page: await resolve(item.dest),
        children: await walk(item.items ?? []),
      })),
    )

  return walk(raw)
}

/** Searchable text for one page; `starts[i]` is where text item i begins in `text`. */
export interface PageText {
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
      return { text: text.toLowerCase(), starts, lengths }
    }),
  )
}

/** A highlighted slice of one text item (span) on a page. */
export interface HighlightSegment {
  item: number
  start: number
  end: number
  selected: boolean
}

export interface SearchMatch {
  page: number
  segments: Omit<HighlightSegment, 'selected'>[]
}

export function search(index: PageText[], query: string): SearchMatch[] {
  const needle = query.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!needle) return []
  const matches: SearchMatch[] = []
  index.forEach(({ text, starts, lengths }, p) => {
    const hay = text.replace(/\s/g, ' ')
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
      const end = at + needle.length
      const segments: SearchMatch['segments'] = []
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i]
        const e = s + lengths[i]
        if (e <= at) continue
        if (s >= end) break
        segments.push({ item: i, start: Math.max(at, s) - s, end: Math.min(end, e) - s })
      }
      matches.push({ page: p + 1, segments })
    }
  })
  return matches
}

export { pdfjs }
