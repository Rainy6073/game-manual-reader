import { useCallback, useEffect, useRef, useState } from 'react'
import { getOutline, loadPdf, type OutlineItem, type PDFDoc } from './pdf'
import PdfPage from './PdfPage'
import './App.css'

const SAMPLE = { url: '/manuals/2026GameManual.pdf', name: '2026 FRC Game Manual (REBUILT)' }
const MIN_SCALE = 0.4
const MAX_SCALE = 4

interface Loaded {
  doc: PDFDoc
  name: string
  outline: OutlineItem[]
  sizes: { width: number; height: number }[]
}

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1.25)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 800)
  const [dragging, setDragging] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const open = useCallback(async (source: string | ArrayBuffer, name: string) => {
    setLoading(true)
    setError(null)
    try {
      const doc = await loadPdf(source)
      const [outline, sizes] = await Promise.all([
        getOutline(doc),
        Promise.all(
          Array.from({ length: doc.numPages }, async (_, i) => {
            const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 })
            return { width: vp.width, height: vp.height }
          }),
        ),
      ])
      setLoaded((prev) => {
        prev?.doc.loadingTask.destroy()
        return { doc, name, outline, sizes }
      })
      setCurrentPage(1)
      setPageInput('1')
      viewerRef.current?.scrollTo({ top: 0 })
      document.title = `${name} · Game Manual Reader`
    } catch (err) {
      console.error(err)
      setError('Could not open that file. Make sure it is a valid PDF.')
    } finally {
      setLoading(false)
    }
  }, [])

  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setError('Please choose a PDF file.')
        return
      }
      open(await file.arrayBuffer(), file.name.replace(/\.pdf$/i, ''))
    },
    [open],
  )

  useEffect(() => {
    open(SAMPLE.url, SAMPLE.name)
  }, [open])

  // Fit the page width to the viewer once a document loads.
  useEffect(() => {
    if (!loaded || !viewerRef.current) return
    const available = viewerRef.current.clientWidth - 48
    const widest = Math.max(...loaded.sizes.map((s) => s.width))
    setScale(Math.min(1.5, Math.max(MIN_SCALE, available / widest)))
  }, [loaded])

  const scrollToPage = useCallback((page: number) => {
    const el = viewerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)
    if (el) viewerRef.current!.scrollTo({ top: el.offsetTop - 16 })
  }, [])

  // Keep the current page in sync with scroll position.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !loaded) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const mid = viewer.scrollTop + viewer.clientHeight / 3
        const pages = viewer.querySelectorAll<HTMLElement>('[data-page]')
        let page = 1
        for (const el of pages) {
          if (el.offsetTop <= mid) page = Number(el.dataset.page)
          else break
        }
        setCurrentPage(page)
        setPageInput(String(page))
      })
    }
    viewer.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      viewer.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [loaded])

  // Preserve the reading position when zooming.
  const zoom = (next: number) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(next * 100) / 100))
    const page = currentPage
    setScale(clamped)
    requestAnimationFrame(() => scrollToPage(page))
  }

  const total = loaded?.doc.numPages ?? 0

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        openFile(e.dataTransfer.files[0])
      }}
    >
      <header className="toolbar">
        <button className="icon" onClick={() => setSidebarOpen((o) => !o)} title="Toggle contents">
          ☰
        </button>
        <div className="brand">
          <strong>Game Manual Reader</strong>
          {loaded && <span className="doc-name">{loaded.name}</span>}
        </div>

        {loaded && (
          <div className="controls">
            <form
              className="page-nav"
              onSubmit={(e) => {
                e.preventDefault()
                const n = Math.min(total, Math.max(1, parseInt(pageInput, 10) || 1))
                scrollToPage(n)
              }}
            >
              <button type="button" className="icon" disabled={currentPage <= 1} onClick={() => scrollToPage(currentPage - 1)} title="Previous page">
                ‹
              </button>
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                inputMode="numeric"
                aria-label="Page number"
              />
              <span className="muted">/ {total}</span>
              <button type="button" className="icon" disabled={currentPage >= total} onClick={() => scrollToPage(currentPage + 1)} title="Next page">
                ›
              </button>
            </form>
            <div className="zoom">
              <button className="icon" onClick={() => zoom(scale - 0.15)} title="Zoom out">−</button>
              <span className="muted zoom-label">{Math.round(scale * 100)}%</span>
              <button className="icon" onClick={() => zoom(scale + 0.15)} title="Zoom in">+</button>
            </div>
          </div>
        )}

        <div className="actions">
          <button onClick={() => open(SAMPLE.url, SAMPLE.name)} disabled={loading}>
            2026 Manual
          </button>
          <button className="primary" onClick={() => fileInputRef.current?.click()} disabled={loading}>
            Upload PDF
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              openFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </header>

      <div className="body">
        {sidebarOpen && loaded && (
          <aside className="sidebar">
            <h2>Contents</h2>
            {loaded.outline.length > 0 ? (
              <Outline items={loaded.outline} onSelect={scrollToPage} />
            ) : (
              <p className="muted">This PDF has no bookmarks.</p>
            )}
          </aside>
        )}

        <main className="viewer" ref={viewerRef}>
          {error && <div className="banner error">{error}</div>}
          {loading && <div className="banner">Loading manual…</div>}
          {loaded &&
            loaded.sizes.map((size, i) => (
              <PdfPage key={`${loaded.name}-${i}`} doc={loaded.doc} pageNumber={i + 1} scale={scale} baseSize={size} />
            ))}
        </main>
      </div>

      {dragging && <div className="drop-overlay">Drop a game manual PDF to open it</div>}
    </div>
  )
}

function Outline({ items, onSelect }: { items: OutlineItem[]; onSelect: (page: number) => void }) {
  return (
    <ul className="outline">
      {items.map((item, i) => (
        <OutlineNode key={i} item={item} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function OutlineNode({ item, onSelect }: { item: OutlineItem; onSelect: (page: number) => void }) {
  const [expanded, setExpanded] = useState(false)
  const hasChildren = item.children.length > 0
  return (
    <li>
      <div className="outline-row">
        {hasChildren ? (
          <button className="twisty" onClick={() => setExpanded((e) => !e)} aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <button className="outline-link" disabled={item.page == null} onClick={() => item.page && onSelect(item.page)}>
          <span>{item.title}</span>
          {item.page != null && <span className="muted">{item.page}</span>}
        </button>
      </div>
      {hasChildren && expanded && <Outline items={item.children} onSelect={onSelect} />}
    </li>
  )
}
