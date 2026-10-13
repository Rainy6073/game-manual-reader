import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  buildTextIndex,
  getOutline,
  loadPdf,
  search,
  type HighlightSegment,
  type OutlineItem,
  type PageText,
  type PDFDoc,
} from './pdf'
import PdfPage from './PdfPage'
import SearchBar from './SearchBar'
import './App.css'

const SAMPLE = { url: '/manuals/2026GameManual.pdf', name: '2026 FRC Game Manual (REBUILT)' }
const MIN_SCALE = 0.4
const MAX_SCALE = 4
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

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
  const scaleRef = useRef(scale)
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)
  const [query, setQuery] = useState('')
  const [textIndex, setTextIndex] = useState<{ doc: PDFDoc; pages: PageText[] } | null>(null)
  const [matchIndex, setMatchIndex] = useState(0)
  const [scrollRequest, setScrollRequest] = useState(0)

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

  // --- Zoom -------------------------------------------------------------

  // The point (in viewer coordinates) that should stay put across a zoom,
  // recorded as a fraction of the page it lies on.
  const anchorRef = useRef<{ page: number; fx: number; fy: number; x: number; y: number } | null>(null)

  /** Zooms to `next`, keeping the content under (clientX, clientY) fixed. Defaults to the viewer center. */
  const zoomTo = useCallback((next: number, clientX?: number, clientY?: number) => {
    const viewer = viewerRef.current
    const clamped = clampScale(next)
    if (!viewer || clamped === scaleRef.current) return
    const rect = viewer.getBoundingClientRect()
    const x = (clientX ?? rect.left + rect.width / 2) - rect.left
    const y = (clientY ?? rect.top + rect.height / 2) - rect.top
    const contentY = viewer.scrollTop + y
    let target: HTMLElement | null = null
    for (const el of viewer.querySelectorAll<HTMLElement>('[data-page]')) {
      if (!target || el.offsetTop <= contentY) target = el
      else break
    }
    if (target) {
      anchorRef.current = {
        page: Number(target.dataset.page),
        fx: (viewer.scrollLeft + x - target.offsetLeft) / target.offsetWidth,
        fy: (contentY - target.offsetTop) / target.offsetHeight,
        x,
        y,
      }
    }
    scaleRef.current = clamped
    setScale(clamped)
  }, [])

  useLayoutEffect(() => {
    scaleRef.current = scale
    const anchor = anchorRef.current
    const viewer = viewerRef.current
    anchorRef.current = null
    if (!anchor || !viewer) return
    const el = viewer.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`)
    if (!el) return
    viewer.scrollTop = el.offsetTop + anchor.fy * el.offsetHeight - anchor.y
    viewer.scrollLeft = el.offsetLeft + anchor.fx * el.offsetWidth - anchor.x
  }, [scale])

  // Pinch to zoom: trackpads (ctrl+wheel, or Safari gesture events) and touchscreens.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !loaded) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1)
      const step = Math.max(-25, Math.min(25, delta))
      zoomTo(scaleRef.current * Math.exp(-step * 0.01), e.clientX, e.clientY)
    }

    // Safari (macOS trackpad and iOS) reports pinches as non-standard gesture events.
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number }
    let gestureStart = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureStart = scaleRef.current
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureEvent
      zoomTo(gestureStart * g.scale, g.clientX, g.clientY)
    }

    let pinch: { dist: number; scale: number } | null = null
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: distance(e.touches), scale: scaleRef.current }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const [a, b] = [e.touches[0], e.touches[1]]
      zoomTo(pinch.scale * (distance(e.touches) / pinch.dist), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null
    }

    viewer.addEventListener('wheel', onWheel, { passive: false })
    viewer.addEventListener('gesturestart', onGestureStart)
    viewer.addEventListener('gesturechange', onGestureChange)
    viewer.addEventListener('touchstart', onTouchStart, { passive: true })
    viewer.addEventListener('touchmove', onTouchMove, { passive: false })
    viewer.addEventListener('touchend', onTouchEnd)
    viewer.addEventListener('touchcancel', onTouchEnd)
    return () => {
      viewer.removeEventListener('wheel', onWheel)
      viewer.removeEventListener('gesturestart', onGestureStart)
      viewer.removeEventListener('gesturechange', onGestureChange)
      viewer.removeEventListener('touchstart', onTouchStart)
      viewer.removeEventListener('touchmove', onTouchMove)
      viewer.removeEventListener('touchend', onTouchEnd)
      viewer.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [loaded, zoomTo])

  // --- Search ------------------------------------------------------------

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setSearchFocus((n) => n + 1)
  }, [])

  // Extract the document's text the first time search is opened.
  useEffect(() => {
    if (!searchOpen || !loaded || textIndex?.doc === loaded.doc) return
    let cancelled = false
    buildTextIndex(loaded.doc).then((pages) => {
      if (!cancelled) setTextIndex({ doc: loaded.doc, pages })
    })
    return () => {
      cancelled = true
    }
  }, [searchOpen, loaded, textIndex])

  const indexReady = !!loaded && textIndex?.doc === loaded.doc
  const matches = useMemo(
    () => (searchOpen && indexReady ? search(textIndex!.pages, query) : []),
    [searchOpen, indexReady, textIndex, query],
  )

  const goToMatch = useCallback(
    (i: number) => {
      const match = matches[i]
      if (!match) return
      setMatchIndex(i)
      setScrollRequest((n) => n + 1)
      // If the page isn't rendered yet, bring it into range; it scrolls to the match once drawn.
      const pageEl = viewerRef.current?.querySelector(`[data-page="${match.page}"]`)
      if (!pageEl?.querySelector('.textLayer')) scrollToPage(match.page)
    },
    [matches, scrollToPage],
  )

  // When the results change, jump to the first match at or after the current page.
  useEffect(() => {
    if (matches.length === 0) return
    const from = matches.findIndex((m) => m.page >= currentPageRef.current)
    goToMatch(from === -1 ? 0 : from)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])

  const step = (dir: 1 | -1) => {
    if (matches.length === 0) return
    goToMatch((matchIndex + dir + matches.length) % matches.length)
  }

  const highlightsByPage = useMemo(() => {
    const map = new Map<number, HighlightSegment[]>()
    matches.forEach((m, i) => {
      const list = map.get(m.page) ?? []
      for (const seg of m.segments) list.push({ ...seg, selected: i === matchIndex })
      map.set(m.page, list)
    })
    return map
  }, [matches, matchIndex])

  // --- Keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
      } else if (mod && e.key.toLowerCase() === 'g' && searchOpen) {
        e.preventDefault()
        step(e.shiftKey ? -1 : 1)
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomTo(scaleRef.current * 1.15)
      } else if (mod && e.key === '-') {
        e.preventDefault()
        zoomTo(scaleRef.current / 1.15)
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
              <button className="icon" onClick={() => zoomTo(scale / 1.15)} title="Zoom out">−</button>
              <span className="muted zoom-label">{Math.round(scale * 100)}%</span>
              <button className="icon" onClick={() => zoomTo(scale * 1.15)} title="Zoom in">+</button>
            </div>
            <button className="icon" onClick={openSearch} title="Search (⌘F / Ctrl+F)" aria-label="Search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
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

        {searchOpen && loaded && (
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            focusRequest={searchFocus}
            ready={indexReady}
            current={matches.length ? matchIndex + 1 : 0}
            total={matches.length}
            onNext={() => step(1)}
            onPrev={() => step(-1)}
            onClose={() => setSearchOpen(false)}
          />
        )}

        <main className="viewer" ref={viewerRef}>
          {error && <div className="banner error">{error}</div>}
          {loading && <div className="banner">Loading manual…</div>}
          {loaded &&
            loaded.sizes.map((size, i) => (
              <PdfPage
                key={`${loaded.name}-${i}`}
                doc={loaded.doc}
                pageNumber={i + 1}
                scale={scale}
                baseSize={size}
                highlights={highlightsByPage.get(i + 1)}
                scrollRequest={matches[matchIndex]?.page === i + 1 ? scrollRequest : undefined}
              />
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
