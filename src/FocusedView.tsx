import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { DESCRIPTION_ID, ruleAnchor, sectionAnchor } from './anchors'
import type { GameElement, PDFDoc } from './pdf'
import { blocksText, type Block, type Rule, type Run } from './structure'

export interface FocusData {
  description: Block[]
  rules: Rule[]
}

interface Props {
  doc: PDFDoc
  element: GameElement
  /** Terms that make a rule relevant (and are highlighted). */
  terms: GameElement[]
  data: FocusData | null
  /** Shows a spot in the PDF; `y` is a PDF-space position on the page. */
  onOpenPage: (page: number, y?: number) => void
  /** Reports the id of the description or rule currently at the top of the view. */
  onActiveChange: (id: string) => void
}


export default function FocusedView({ doc, element, terms, data, onOpenPage, onActiveChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Track which section is at the top of the view, for the Contents highlight.
  useEffect(() => {
    const root = rootRef.current
    const scroller = root?.closest('.viewer')
    if (!root || !scroller || !data) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 80
        let current = DESCRIPTION_ID
        for (const el of root.querySelectorAll<HTMLElement>('[data-anchor]')) {
          if (el.getBoundingClientRect().top <= top) current = el.dataset.anchor!
          else break
        }
        onActiveChange(current)
      })
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', update)
      cancelAnimationFrame(frame)
    }
  }, [data, onActiveChange])

  if (!data) return <div className="banner">Building focused view…</div>

  const sections: { title: string; rules: Rule[] }[] = []
  for (const rule of data.rules) {
    const last = sections[sections.length - 1]
    if (last?.title === rule.section) last.rules.push(rule)
    else sections.push({ title: rule.section, rules: [rule] })
  }

  const mentions = (rule: Rule) => {
    const text = blocksText(rule.blocks)
    return terms.filter((t) => new RegExp(t.pattern.source).test(text)).map((t) => t.name)
  }

  const descPages = [...new Set(data.description.map((b) => b.page))]

  return (
    <div className="focused" ref={rootRef}>
      <header className="focused-header">
        <p className="eyebrow">Focused view</p>
        <h1>
          {element.name}
        </h1>
        {terms.length > 1 && (
          <p className="muted">
            Includes rules that mention the FIELD or any of its elements: {terms.filter((t) => t !== element).map((t) => t.name).join(', ')}.
          </p>
        )}
      </header>

      <section className="focused-section" data-anchor={DESCRIPTION_ID} id={DESCRIPTION_ID}>
        <div className="focused-section-head">
          <h2>Description</h2>
          <span className="muted">
            {element.section.title}
            {descPages.length > 0 && (
              <>
                {' · '}
                <PageLink page={descPages[0]} onOpenPage={onOpenPage} />
              </>
            )}
          </span>
        </div>
        {data.description.length ? (
          <Blocks blocks={data.description} doc={doc} />
        ) : (
          <p className="muted">No description text found for this element.</p>
        )}
      </section>

      <section className="focused-section">
        <div className="focused-section-head">
          <h2>Game Rules</h2>
          <span className="muted">
            {data.rules.length} rule{data.rules.length === 1 ? '' : 's'} in Section 7
          </span>
        </div>
        {data.rules.length === 0 && <p className="muted">No game rules mention {element.name}.</p>}
        {sections.map((section) => (
          <Fragment key={section.title}>
            <h3 className="rule-group" id={sectionAnchor(section.title)} data-anchor={sectionAnchor(section.title)}>
              {section.title}
            </h3>
            {section.rules.map((rule) => (
              <article
                className="rule"
                key={rule.id}
                id={ruleAnchor(rule.id)}
                data-anchor={ruleAnchor(rule.id)}
                title="Show this rule in the PDF"
                onClick={(e) => {
                  // Let people select text without being sent to the PDF.
                  if (window.getSelection()?.toString()) return
                  if ((e.target as HTMLElement).closest('button')) return
                  onOpenPage(rule.page, rule.y)
                }}
              >
                <div className="rule-head">
                  <span className="rule-id">{rule.id}</span>
                  {terms.length > 1 && (
                    <span className="rule-mentions">
                      {mentions(rule).map((m) => (
                        <span key={m} className="mention">
                          {m}
                        </span>
                      ))}
                    </span>
                  )}
                  <PageLink page={rule.page} onOpenPage={() => onOpenPage(rule.page, rule.y)} />
                </div>
                <Blocks blocks={rule.blocks} doc={doc} />
              </article>
            ))}
          </Fragment>
        ))}
      </section>
    </div>
  )
}

function PageLink({ page, onOpenPage }: { page: number; onOpenPage: (page: number) => void }) {
  return (
    <button className="page-link" onClick={() => onOpenPage(page)} title="Show this page of the manual">
      p. {page}
    </button>
  )
}

function Blocks({ blocks, doc }: { blocks: Block[]; doc: PDFDoc }) {
  // Consecutive note-box paragraphs share one box, like in the manual.
  const groups: { box: boolean; blocks: Block[] }[] = []
  for (const block of blocks) {
    const box = block.kind === 'para' && block.box
    const last = groups[groups.length - 1]
    if (last && last.box === box && box) last.blocks.push(block)
    else groups.push({ box, blocks: [block] })
  }

  return (
    <>
      {groups.map((group, g) => {
        const content = group.blocks.map((block, i) => <BlockView key={i} block={block} doc={doc} />)
        return group.box ? (
          <div className="note-box" key={g}>
            {content}
          </div>
        ) : (
          <Fragment key={g}>{content}</Fragment>
        )
      })}
    </>
  )
}

function BlockView({ block, doc }: { block: Block; doc: PDFDoc }) {
  if (block.kind === 'heading') return <h4 className="block-heading">{block.text}</h4>
  if (block.kind === 'figure') return <FigureCrop doc={doc} block={block} />

  const text = <Runs runs={block.runs} />
  if (block.marker) {
    return (
      <div className="list-item" style={{ marginLeft: `${block.depth * 1.5}em` }}>
        <span className="list-marker">{block.marker}</span>
        <p>{text}</p>
      </div>
    )
  }
  return <p className={block.violation ? 'violation' : undefined}>{text}</p>
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) => {
        let content: ReactNode = run.text
        if (run.italic) content = <em>{content}</em>
        if (run.bold) content = <strong>{content}</strong>
        return <Fragment key={i}>{content}</Fragment>
      })}
    </>
  )
}

// --- Figures -------------------------------------------------------------------

const RENDER_SCALE = 2.5
const pageImages = new WeakMap<PDFDoc, Map<number, Promise<HTMLCanvasElement>>>()

function renderPageImage(doc: PDFDoc, pageNumber: number): Promise<HTMLCanvasElement> {
  let byPage = pageImages.get(doc)
  if (!byPage) pageImages.set(doc, (byPage = new Map()))
  let image = byPage.get(pageNumber)
  if (!image) {
    image = (async () => {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      return canvas
    })()
    byPage.set(pageNumber, image)
  }
  return image
}

function FigureCrop({ doc, block }: { doc: PDFDoc; block: Extract<Block, { kind: 'figure' }> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '600px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    renderPageImage(doc, block.page).then(async (source) => {
      const page = await doc.getPage(block.page)
      const target = ref.current
      if (cancelled || !target) return
      const [, , width, height] = page.view
      const margin = 24
      // PDF y runs upward from the bottom of the page.
      const sx = margin * RENDER_SCALE
      const sy = (height - block.top) * RENDER_SCALE
      const sw = (width - margin * 2) * RENDER_SCALE
      const sh = Math.max(1, (block.top - block.bottom) * RENDER_SCALE)
      // Trim blank rows, e.g. when a figure is the last thing on its page.
      const scratch = document.createElement('canvas')
      scratch.width = Math.round(sw)
      scratch.height = Math.round(sh)
      const ctx = scratch.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
      const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height)
      const rowHasInk = (y: number) => {
        for (let x = 0; x < scratch.width; x += 2) {
          const i = (y * scratch.width + x) * 4
          if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) return true
        }
        return false
      }
      let y0 = 0
      let y1 = scratch.height - 1
      while (y0 < y1 && !rowHasInk(y0)) y0++
      while (y1 > y0 && !rowHasInk(y1)) y1--
      const pad = 6 * RENDER_SCALE
      y0 = Math.max(0, y0 - pad)
      y1 = Math.min(scratch.height - 1, y1 + pad)

      target.width = scratch.width
      target.height = y1 - y0 + 1
      target.style.aspectRatio = `${target.width} / ${target.height}`
      target.getContext('2d')!.drawImage(scratch, 0, y0, scratch.width, target.height, 0, 0, scratch.width, target.height)
    })
    return () => {
      cancelled = true
    }
  }, [visible, doc, block])

  return (
    <figure className="figure">
      <figcaption>{block.caption}</figcaption>
      <canvas ref={ref} style={{ aspectRatio: `auto ${612 - 48} / ${Math.max(1, block.top - block.bottom)}` }} />
    </figure>
  )
}
