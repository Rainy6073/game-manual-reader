import { useEffect, useRef, useState } from 'react'
import { pdfjs, type PDFDoc } from './pdf'

interface Props {
  doc: PDFDoc
  pageNumber: number
  scale: number
  /** Unscaled page size, used to reserve space before the page renders. */
  baseSize: { width: number; height: number }
}

export default function PdfPage({ doc, pageNumber, scale, baseSize }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  // Only render pages near the viewport so a 150+ page manual stays fast.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '800px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let renderTask: ReturnType<pdfjs.PDFPageProxy['render']> | null = null
    let textLayer: pdfjs.TextLayer | null = null

    ;(async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

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

      const container = textRef.current!
      container.replaceChildren()
      textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      })
      await textLayer.render().catch(() => {})
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [doc, pageNumber, scale, visible])

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
          <canvas ref={canvasRef} />
          <div ref={textRef} className="textLayer" />
        </>
      )}
    </div>
  )
}
