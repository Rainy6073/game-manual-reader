// Finds the top-down FIELD drawing in a game manual. Since 2016 manuals have a
// figure captioned "Zones and Markings" (or, in 2026, "FIELD boundary") that shows
// the whole field from above; older manuals vary, so candidates are ranked and the
// person confirms (and can re-crop) the one to use.
import { pdfjs, type PDFDoc } from '../reader/pdf'

/** A rectangle in page coordinates at scale 1, origin top-left. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface FieldCandidate {
  page: number
  caption: string
  score: number
  /** The figure's image on the page, when one could be found. */
  box: Box | null
}

const CAPTION = /(?:Figure|FIGURE)\s*\d+[-–.]\d+:?\s*([^.]{0,80})/g

/** How likely a figure caption is to describe a top-down view of the whole field. */
function scoreCaption(caption: string): number {
  const c = caption.toLowerCase()
  let score = 0
  if (/zones?\s*(&|and)\s*markings?/.test(c)) score += 10
  if (/\bfield\b/.test(c)) score += 3
  if (/boundary|layout|top[- ]?down|overhead|plan view|overview/.test(c)) score += 3
  if (/\barena\b|playing (area|field)/.test(c)) score += 2
  // Close-ups of one part of the field, or unrelated diagrams.
  if (/robot|electrical|bracket|driver station|bumper|game piece|anatomy|staging|vision|connection|panel|dimensions/.test(c)) score -= 4
  // Captions naming a specific element in capitals (e.g. "HUB", "TOWER"), other than the field itself.
  const named = caption.match(/\b[A-Z]{3,}\b/g)?.filter((w) => !/^(FIELD|ARENA|ALLIANCE|ZONES?|MARKINGS|FIRST|FIGURE)$/.test(w)) ?? []
  if (named.length && !/zones?\s*(&|and)\s*markings?/.test(c)) score -= 2
  return score
}

const pageText = async (doc: PDFDoc, p: number) =>
  (await (await doc.getPage(p)).getTextContent()).items
    .map((i) => ('str' in i ? i.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')

const mul = (a: number[], b: number[]) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

/** The largest image drawn on a page, ignoring header and footer banners. */
async function largestImage(doc: PDFDoc, pageNumber: number): Promise<Box | null> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const ops = await page.getOperatorList()
  const { OPS } = pdfjs
  let ctm = viewport.transform as number[]
  const stack: number[][] = []
  let best: Box | null = null
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i] as number[])
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      // An image fills the unit square of the current transform.
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]]
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]]
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
      const banner = box.h < viewport.height * 0.15 && (box.y < viewport.height * 0.15 || box.y + box.h > viewport.height * 0.85)
      if (banner || box.w < viewport.width * 0.3) continue
      if (!best || box.w * box.h > best.w * best.h) best = box
    }
  }
  return best
}

/** Pages likely to hold the top-down field drawing, best first. */
export async function findFieldCandidates(doc: PDFDoc, limit = 6): Promise<FieldCandidate[]> {
  // Field drawings are in the first part of every manual (the ARENA section).
  const last = Math.min(doc.numPages, Math.max(40, Math.ceil(doc.numPages * 0.5)))
  const texts: string[] = []
  const found: FieldCandidate[] = []
  for (let p = 1; p <= last; p++) {
    const text = await pageText(doc, p)
    texts[p] = text
    let best: { caption: string; score: number } | null = null
    for (const m of text.matchAll(CAPTION)) {
      const score = scoreCaption(m[0].replace(/^(?:Figure|FIGURE)\s*\d+[-–.]\d+:?\s*/, ''))
      if (!best || score > best.score) best = { caption: m[0].trim(), score }
    }
    // Some years caption the drawing with the game's name, under a "Zones and Markings" heading.
    if (best && /zones?\s*(&|and)\s*markings?/i.test(text)) best.score += 5
    if (best && best.score > 0) found.push({ page: p, caption: best.caption, score: best.score, box: null })
  }
  found.sort((a, b) => b.score - a.score || a.page - b.page)
  const top = found.slice(0, limit)
  for (const c of top) {
    c.box = await largestImage(doc, c.page)
    // A real figure image is a strong sign; a page with only text is not a drawing.
    if (c.box) c.score += 2
  }

  // Older manuals don't caption figures: rank pages with a large image by how much
  // they talk about the field.
  if (!top.some((c) => c.score >= 7)) {
    for (let p = 1; p <= last; p++) {
      if (top.some((c) => c.page === p)) continue
      const mentions = texts[p].match(/\b(field|arena|court|playing surface)\b/gi)?.length ?? 0
      if (!mentions) continue
      const box = await largestImage(doc, p)
      if (!box) continue
      const heading = /^\W*(\d+(\.\d+)*\s+)?(the\s+)?(arena|field|court)\b/i.test(texts[p].replace(/^.*?(section\s*\d+\s*[-–]\s*)/i, ''))
      top.push({ page: p, caption: `Page ${p}`, score: Math.min(5, mentions) + (heading ? 2 : 0), box })
    }
  }
  return top.sort((a, b) => b.score - a.score || a.page - b.page).slice(0, limit)
}

/** Renders part of a page (in scale-1 page units) to a PNG. */
export async function renderRegion(doc: PDFDoc, pageNumber: number, box: Box | null, maxWidth = 2000): Promise<Blob> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const region = box ?? { x: 0, y: 0, w: base.width, h: base.height }
  const scale = Math.min(6, maxWidth / region.w)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(region.w * scale)
  canvas.height = Math.round(region.h * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({
    canvas,
    viewport,
    transform: [1, 0, 0, 1, -region.x * scale, -region.y * scale],
  }).promise
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Render failed'))), 'image/png'))
}

/** Renders a whole page small, for picking. */
export async function renderThumb(doc: PDFDoc, pageNumber: number, width = 360): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvas, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.8)
}
