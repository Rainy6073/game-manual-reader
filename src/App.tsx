import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  buildTextIndex,
  filterOutline,
  findElement,
  findGameElements,
  getOutline,
  loadPdf,
  outlinePathAt,
  search,
  type GameElement,
  type HighlightSegment,
  type OutlineItem,
  type PageText,
  type PDFDoc,
  type SearchMatch,
} from './pdf'
import { DESCRIPTION_ID, ruleAnchor, sectionAnchor } from './anchors'
import FocusedView, { type FocusData } from './FocusedView'
import PdfPage from './PdfPage'
import SearchBar from './SearchBar'
import Sidebar from './Sidebar'
import { blocksText, extractRules, extractSection } from './structure'
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
  const [element, setElement] = useState<GameElement | null>(null)
  const [focused, setFocused] = useState(false)
  const [focusData, setFocusData] = useState<{ doc: PDFDoc; name: string; data: FocusData } | null>(null)
  const [focusActive, setFocusActive] = useState(DESCRIPTION_ID)
  const pendingPageRef = useRef<number | null>(null)

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
      setElement(null)
      setFocused(false)
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

  // --- Text index & game elements -----------------------------------------

  // Extract the document's text in the background; search and game elements use it.
  useEffect(() => {
    if (!loaded || textIndex?.doc === loaded.doc) return
    let cancelled = false
    buildTextIndex(loaded.doc)
      .then((pages) => {
        if (!cancelled) setTextIndex({ doc: loaded.doc, pages })
      })
      .catch(() => {}) // the document was closed (e.g. another one was opened)
    return () => {
      cancelled = true
    }
  }, [loaded, textIndex])

  const indexReady = !!loaded && textIndex?.doc === loaded.doc
  const pagesText = indexReady ? textIndex!.pages : null

  const gameElements = useMemo(
    () => (loaded && pagesText ? findGameElements(loaded.outline, pagesText) : null),
    [loaded, pagesText],
  )

  const elementResults = useMemo(() => {
    const results = new Map<string, SearchMatch[]>()
    if (!loaded || !gameElements || !pagesText) return results
    // Skip front matter (cover, table of contents) before the first bookmarked section.
    const firstSection = Math.min(...loaded.outline.map((i) => i.page ?? Infinity))
    const from = Number.isFinite(firstSection) ? firstSection : 1
    for (const el of gameElements) results.set(el.name, findElement(pagesText, el).filter((m) => m.page >= from))
    return results
  }, [loaded, gameElements, pagesText])

  const elementPageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [name, ms] of elementResults) counts.set(name, new Set(ms.map((m) => m.page)).size)
    return counts
  }, [elementResults])

  const elementMatches = useMemo(() => (element ? elementResults.get(element.name) ?? [] : []), [element, elementResults])

  /** Pages currently shown: every page, or only those mentioning the selected game element. */
  const visiblePages = useMemo(() => {
    if (!loaded) return []
    if (element) return [...new Set(elementMatches.map((m) => m.page))].sort((a, b) => a - b)
    return loaded.sizes.map((_, i) => i + 1)
  }, [loaded, element, elementMatches])
  const visibleSet = useMemo(() => new Set(visiblePages), [visiblePages])

  const shownOutline = useMemo(
    () => (!loaded ? [] : element ? filterOutline(loaded.outline, visibleSet) : loaded.outline),
    [loaded, element, visibleSet],
  )
  const activePath = useMemo(
    () => (loaded ? outlinePathAt(loaded.outline, currentPage).map((i) => i.id) : []),
    [loaded, currentPage],
  )

  // Start a newly filtered (or unfiltered) view from the top, or at a page
  // requested from the Focused View.
  useLayoutEffect(() => {
    const pending = pendingPageRef.current
    pendingPageRef.current = null
    const viewer = viewerRef.current
    if (!viewer) return
    const target = pending != null ? visiblePages.find((p) => p >= pending) ?? visiblePages[visiblePages.length - 1] : null
    const el = target != null && !focused ? viewer.querySelector<HTMLElement>(`[data-page="${target}"]`) : null
    viewer.scrollTo({ top: el ? el.offsetTop - 16 : 0 })
    const page = target ?? visiblePages[0]
    if (page != null) {
      setCurrentPage(page)
      setPageInput(String(page))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, focused])

  // --- Focused View ----------------------------------------------------------

  const selectElement = useCallback((el: GameElement | null) => {
    setElement(el)
    if (!el) setFocused(false)
  }, [])

  // FIELD elements include every part of the ARENA, so the FIELD view also covers
  // rules that mention any of them (but not FIELD STAFF, who are people).
  const focusTerms = useMemo(() => {
    if (!element) return []
    if (element.name !== 'FIELD' || !gameElements) return [element]
    return [element, ...gameElements.filter((e) => e !== element && !/\bSTAFF\b/.test(e.name))]
  }, [element, gameElements])

  useEffect(() => {
    if (!focused || !element || !loaded) return
    if (focusData?.doc === loaded.doc && focusData.name === element.name) return
    let cancelled = false
    const rulesSection = loaded.outline.find((i) => /Game Rules/i.test(i.title))
    Promise.all([extractSection(loaded.doc, element.section), rulesSection ? extractRules(loaded.doc, rulesSection) : []]).then(
      ([description, rules]) => {
        if (cancelled) return
        const pattern = new RegExp(focusTerms.map((t) => t.pattern.source).join('|'))
        const relevant = rules.filter((r) => pattern.test(blocksText(r.blocks)))
        setFocusData({ doc: loaded.doc, name: element.name, data: { description, rules: relevant } })
        setFocusActive(DESCRIPTION_ID)
      },
      () => {}, // the document was closed while extracting
    )
    return () => {
      cancelled = true
    }
  }, [focused, element, loaded, focusTerms, focusData])

  const currentFocus = focused && element && focusData?.doc === loaded?.doc && focusData?.name === element.name ? focusData.data : null

  /** Contents for the Focused View: the description, then rules grouped by subsection. */
  const focusOutline = useMemo((): OutlineItem[] => {
    if (!currentFocus || !element) return []
    const descPage = currentFocus.description[0]?.page ?? element.section.page
    const items: OutlineItem[] = [{ id: DESCRIPTION_ID, title: `Description: ${element.section.title}`, page: descPage, end: descPage ?? 0, children: [] }]
    for (const rule of currentFocus.rules) {
      let group = items.find((i) => i.id === sectionAnchor(rule.section))
      if (!group) items.push((group = { id: sectionAnchor(rule.section), title: rule.section, page: rule.page, end: rule.page, children: [] }))
      // Short label for Contents: the rule's bold summary, without the leading asterisk.
      const first = rule.blocks.find((b) => b.kind === 'para')
      const title = first?.kind === 'para' ? first.runs.filter((r) => r.bold).map((r) => r.text).join('').replace(/^\*/, '').trim() : ''
      group.children.push({ id: ruleAnchor(rule.id), title: `${rule.id} ${title}`.trim(), page: rule.page, end: rule.page, children: [] })
    }
    return items
  }, [currentFocus, element])

  const focusActivePath = useMemo(() => {
    const group = focusOutline.find((g) => g.id === focusActive || g.children.some((c) => c.id === focusActive))
    return group ? [group.id, ...(group.id === focusActive ? [] : [focusActive])] : []
  }, [focusOutline, focusActive])

  const openPageFromFocus = useCallback((page: number) => {
    pendingPageRef.current = page
    setFocused(false)
  }, [])

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
        if (pages.length === 0) return
        let page = Number(pages[0].dataset.page)
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
  // The Focused View is plain text, so it keeps the browser's own zoom.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !loaded || focused) return

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
  }, [loaded, focused, zoomTo])

  // --- Search ------------------------------------------------------------

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setSearchFocus((n) => n + 1)
  }, [])

  // Search only the pages currently shown.
  const matches = useMemo(
    () => (searchOpen && pagesText ? search(pagesText, query).filter((m) => visibleSet.has(m.page)) : []),
    [searchOpen, pagesText, query, visibleSet],
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
    const add = (page: number, segs: HighlightSegment[]) => map.set(page, [...(map.get(page) ?? []), ...segs])
    for (const m of elementMatches) add(m.page, m.segments.map((seg) => ({ ...seg, selected: false, element: true })))
    matches.forEach((m, i) => add(m.page, m.segments.map((seg) => ({ ...seg, selected: i === matchIndex }))))
    return map
  }, [elementMatches, matches, matchIndex])

  // --- Keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      // The Focused View is ordinary text, so the browser's own find and zoom apply.
      if (focused) return
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
  const pos = visiblePages.indexOf(currentPage)
  const prevPage = pos > 0 ? visiblePages[pos - 1] : null
  const nextPage = pos !== -1 && pos < visiblePages.length - 1 ? visiblePages[pos + 1] : null

  /** Jumps to the first shown page at or after `page` (or the last shown page). */
  const goToPage = (page: number) => {
    const target = visiblePages.find((p) => p >= page) ?? visiblePages[visiblePages.length - 1]
    if (target != null) scrollToPage(target)
  }

  const selectOutline = (item: OutlineItem) => {
    if (focused) {
      document.getElementById(item.id)?.scrollIntoView({ block: 'start' })
      return
    }
    if (item.page == null) return
    const inRange = visiblePages.find((p) => p >= item.page! && p <= item.end)
    goToPage(inRange ?? item.page)
  }

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

        {loaded && !focused && (
          <div className="controls">
            <form
              className="page-nav"
              onSubmit={(e) => {
                e.preventDefault()
                const n = Math.min(total, Math.max(1, parseInt(pageInput, 10) || 1))
                goToPage(n)
              }}
            >
              <button type="button" className="icon" disabled={prevPage == null} onClick={() => prevPage != null && scrollToPage(prevPage)} title="Previous page">
                ‹
              </button>
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                inputMode="numeric"
                aria-label="Page number"
              />
              <span className="muted">/ {total}</span>
              <button type="button" className="icon" disabled={nextPage == null} onClick={() => nextPage != null && scrollToPage(nextPage)} title="Next page">
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
          <Sidebar
            outline={focused ? focusOutline : shownOutline}
            activePath={focused ? focusActivePath : activePath}
            expandAll={focused}
            onSelectOutline={selectOutline}
            elements={gameElements}
            elementPageCounts={elementPageCounts}
            selectedElement={element?.name ?? null}
            onSelectElement={selectElement}
          />
        )}

        {searchOpen && loaded && !focused && (
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
          {element && (
            <div className="filter-banner">
              <div className="view-toggle" role="group" aria-label="View">
                <button aria-pressed={!focused} onClick={() => setFocused(false)}>
                  Pages
                </button>
                <button aria-pressed={focused} onClick={() => setFocused(true)}>
                  Focused View
                </button>
              </div>
              <span className="filter-summary">
                {focused ? (
                  <>
                    Description and {currentFocus ? currentFocus.rules.length : '…'} game rules for{' '}
                  </>
                ) : (
                  <>
                    <strong>{visiblePages.length}</strong> of {total} pages mention{' '}
                  </>
                )}
                <mark className="element-chip">{element.name}</mark>
              </span>
              <button onClick={() => selectElement(null)}>Show full manual</button>
            </div>
          )}
          {loaded && focused && element && (
            <FocusedView
              doc={loaded.doc}
              element={element}
              terms={focusTerms}
              data={currentFocus}
              onOpenPage={openPageFromFocus}
              onActiveChange={setFocusActive}
            />
          )}
          {loaded &&
            !focused &&
            visiblePages.map((page) => (
              <PdfPage
                key={`${loaded.name}-${page}`}
                doc={loaded.doc}
                pageNumber={page}
                scale={scale}
                baseSize={loaded.sizes[page - 1]}
                highlights={highlightsByPage.get(page)}
                scrollRequest={matches[matchIndex]?.page === page ? scrollRequest : undefined}
              />
            ))}
        </main>
      </div>

      {dragging && <div className="drop-overlay">Drop a game manual PDF to open it</div>}
    </div>
  )
}
