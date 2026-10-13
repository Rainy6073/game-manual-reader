import { useEffect, useRef, useState } from 'react'
import { pdfjs, type HighlightSegment, type PDFDoc } from './pdf'

interface Props {
  doc: PDFDoc
  pageNumber: number
  scale: number
  /** Unscaled page size, used to reserve space before the page renders. */
  baseSize: { width: number; height: number }
  highlights?: HighlightSegment[]
  /** Bumped by the parent to ask this page to scroll its selected match into view. */
  scrollRequest?: number
}

const EMPTY: HighlightSegment[] = []

export default function PdfPage({ doc, pageNumber, scale, baseSize, highlights = EMPTY, scrollRequest = 0 }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  // Text spans from the TextLayer, plus their original strings, for highlighting.
  const [textDivs, setTextDivs] = useState<{ divs: HTMLElement[]; strs: string[] } | null>(null)
  const handledScrollRef = useRef(0)

  // Only render pages near the viewport so a 150+ page manual stays fast.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '800px 0px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) {
      setTextDivs(null)
      return
    }
    let cancelled = false
    let renderTask: ReturnType<pdfjs.PDFPageProxy['render']> | null = null
    let textLayer: pdfjs.TextLayer | null = null

    const run = async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1

      // Render offscreen, then swap in, so zooming never flashes a blank page.
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      renderTask = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      try {
        await renderTask.promise
      } catch (err) {
        if (err instanceof pdfjs.RenderingCancelledException) return
        throw err
      }
      if (cancelled) return
      canvasHostRef.current?.replaceChildren(canvas)

      const container = document.createElement('div')
      container.className = 'textLayer'
      textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      })
      try {
        await textLayer.render()
      } catch {
        return
      }
      if (cancelled || !textRef.current) return
      textRef.current.replaceChildren(container)
      setTextDivs({ divs: textLayer.textDivs, strs: textLayer.textContentItemsStr })
    }

    // Re-renders caused by zooming are debounced so pinch gestures stay smooth;
    // the existing bitmap is stretched by CSS in the meantime.
    const hasContent = !!canvasHostRef.current?.firstChild
    const timer = setTimeout(run, hasContent ? 150 : 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [doc, pageNumber, scale, visible])

  // Apply search highlights to the text layer spans.
  useEffect(() => {
    if (!textDivs) return
    const { divs, strs } = textDivs
    const byItem = new Map<number, HighlightSegment[]>()
    for (const seg of highlights) {
      if (seg.end <= seg.start) continue
      const list = byItem.get(seg.item) ?? []
      list.push(seg)
      byItem.set(seg.item, list)
    }

    for (const [item, segs] of byItem) {
      const div = divs[item]
      const str = strs[item]
      if (!div || str === undefined) continue
      // Search matches come after element matches, so on overlap the search highlight wins.
      segs.sort((a, b) => a.start - b.start || Number(!!a.element) - Number(!!b.element))
      const nodes: Node[] = []
      let cursor = 0
      for (const seg of segs) {
        const start = Math.max(seg.start, cursor)
        if (seg.end <= start) continue
        if (start > cursor) nodes.push(document.createTextNode(str.slice(cursor, start)))
        const mark = document.createElement('span')
        mark.className = `highlight${seg.element ? ' element' : ''}${seg.selected ? ' selected' : ''}`
        mark.textContent = str.slice(start, seg.end)
        nodes.push(mark)
        cursor = seg.end
      }
      if (cursor < str.length) nodes.push(document.createTextNode(str.slice(cursor)))
      div.replaceChildren(...nodes)
    }

    if (scrollRequest !== handledScrollRef.current) {
      const selected = textRef.current?.querySelector('.highlight.selected')
      if (selected) {
        handledScrollRef.current = scrollRequest
        selected.scrollIntoView({ block: 'center', inline: 'nearest' })
      }
    }

    return () => {
      for (const item of byItem.keys()) {
        if (divs[item]) divs[item].textContent = strs[item]
      }
    }
  }, [textDivs, highlights, scrollRequest])

  const width = baseSize.width * scale
  const height = baseSize.height * scale

  return (
    <div
      ref={wrapperRef}
      className="page"
      data-page={pageNumber}
      style={
        {
          width,
          height,
          '--scale-factor': scale,
          '--user-unit': 1,
          '--total-scale-factor': scale,
        } as React.CSSProperties
      }
    >
      {visible && (
        <>
          <div ref={canvasHostRef} className="canvas-host" />
          <div ref={textRef} className="text-host" />
        </>
      )}
    </div>
  )
}
