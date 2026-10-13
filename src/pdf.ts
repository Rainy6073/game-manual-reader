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

export { pdfjs }
