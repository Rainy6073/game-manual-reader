import FieldBoard from '../tools/FieldBoard'

const TOOLS = [{ id: 'field', label: 'Field Board', description: 'Place robots and draw paths on the field.' }] as const

/** Strategy tools. Only the Field Board for now; more can be added to the list. */
export default function ToolsPage({ toolId }: { toolId?: string }) {
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]
  return (
    <div className="tools-page">
      <nav className="tool-list" aria-label="Tools">
        <h3>Tools</h3>
        {TOOLS.map((t) => (
          <a key={t.id} href={`#/tools/${t.id}`} className="tool-link" aria-current={t === tool ? 'page' : undefined}>
            <strong>{t.label}</strong>
            <span className="muted small">{t.description}</span>
          </a>
        ))}
        <p className="muted small more-tools">More tools coming later.</p>
      </nav>
      <section className="tool-main">{tool.id === 'field' && <FieldBoard />}</section>
    </div>
  )
}
