import { useEffect, useMemo, useState } from 'react'
import { loadPdf } from '../reader/pdf'
import { useLocalState } from '../session'
import { resolveFileUrl, useDoc } from '../sync/store'
import { blankModel, findPointTable, newRowId, newRuleId, type Metric, type RpRule, type ScoreRow, type ScoringModel } from './pointTable'

interface Team {
  id: string
  name: string
  color: 'red' | 'blue' | 'gray'
  /** counts[rowId][period] */
  counts: Record<string, Record<string, number>>
  /** Bonus RPs measured by a checkbox. */
  checked: Record<string, boolean>
}

const defaultTeams = (): Team[] => [
  { id: 'red', name: 'Red alliance', color: 'red', counts: {}, checked: {} },
  { id: 'blue', name: 'Blue alliance', color: 'blue', counts: {}, checked: {} },
]

const count = (t: Team, row: ScoreRow, period: string) => t.counts[row.id]?.[period] ?? 0

/** Points, per-metric values and ranking points for one team. */
function evaluate(model: ScoringModel, team: Team) {
  const byPeriod: Record<string, number> = {}
  const rowPoints = new Map<string, number>()
  const rowCounts = new Map<string, number>()
  for (const p of model.periods) byPeriod[p] = 0
  for (const row of model.rows) {
    let pts = 0
    let n = 0
    for (const p of model.periods) {
      const v = row.values[p]
      if (v == null) continue
      const c = count(team, row, p)
      n += c
      pts += c * v
      byPeriod[p] += c * v
    }
    rowPoints.set(row.id, pts)
    rowCounts.set(row.id, n)
  }
  const total = Object.values(byPeriod).reduce((a, b) => a + b, 0)
  const metricValue = (m: Metric): number | null => {
    if (m === 'manual') return null
    if (m === 'total') return total
    const [kind, scope, ...rest] = m.split(':')
    const key = rest.join(':')
    const rows = scope === 'group' ? model.rows.filter((r) => r.group === key) : model.rows.filter((r) => r.id === key)
    const map = kind === 'points' ? rowPoints : rowCounts
    return rows.reduce((sum, r) => sum + (map.get(r.id) ?? 0), 0)
  }
  const bonus = model.bonusRps.map((rule) => {
    const value = metricValue(rule.metric)
    const earned = value == null ? !!team.checked[rule.id] : rule.threshold != null && value >= rule.threshold
    return { rule, value, earned }
  })
  return { byPeriod, total, bonus, bonusRp: bonus.reduce((s, b) => s + (b.earned ? b.rule.rp : 0), 0) }
}

function metricLabel(m: Metric, model: ScoringModel) {
  if (m === 'manual') return 'Checkbox'
  if (m === 'total') return 'Total MATCH points'
  const [kind, scope, ...rest] = m.split(':')
  const key = rest.join(':')
  const name = scope === 'group' ? key : (model.rows.find((r) => r.id === key)?.name ?? '?')
  return `${kind === 'points' ? 'Points from' : 'Count of'} ${name}`
}

function metricOptions(model: ScoringModel): Metric[] {
  const groups = [...new Set(model.rows.map((r) => r.group))]
  return [
    'manual',
    'total',
    ...groups.flatMap((g) => [`points:group:${g}`, `count:group:${g}`] as Metric[]),
    ...model.rows.flatMap((r) => [`points:row:${r.id}`, `count:row:${r.id}`] as Metric[]),
  ]
}

/**
 * Try out different scores: counts of each scoring action per alliance or team,
 * with points and ranking points worked out from the game's point value table.
 * Everything here stays on this device.
 */
export default function ScoreCalculator() {
  const manual = useDoc('meta', 'manual')
  const [model, setModel] = useLocalState<ScoringModel | null>('kickoff.scoreModel', null)
  const [teams, setTeams] = useLocalState<Team[]>('kickoff.scoreTeams', defaultTeams())
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const readManual = async () => {
    if (!manual) return
    setReading(true)
    setStatus('Reading the point value table from the manual…')
    try {
      const doc = await loadPdf(await resolveFileUrl(manual.url), manual.password)
      const found = await findPointTable(doc, manual.name)
      if (found) {
        setModel(found)
        setStatus(null)
      } else {
        setModel(blankModel(`${manual.name} (no point value table found)`))
        setStatus('No point value table could be read from this manual, so enter the scoring by hand.')
        setEditing(true)
      }
    } catch (err) {
      console.error(err)
      setStatus('Could not open the manual. You can enter the scoring by hand.')
      setModel((m) => m ?? blankModel())
    } finally {
      setReading(false)
    }
  }

  // The first time, read the table from the shared manual.
  useEffect(() => {
    if (!model && manual && !reading) readManual()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual?.url])

  const results = useMemo(() => (model ? teams.map((t) => evaluate(model, t)) : []), [model, teams])
  const totals = results.map((r) => r.total)
  const outcome = (i: number) => {
    if (teams.length < 2) return null
    const others = totals.filter((_, j) => j !== i)
    const best = Math.max(...others)
    return totals[i] > best ? 'win' : totals[i] === best ? 'tie' : 'loss'
  }

  const updateTeam = (id: string, fn: (t: Team) => Team) => setTeams((ts) => ts.map((t) => (t.id === id ? fn(t) : t)))
  const setCount = (team: Team, row: ScoreRow, period: string, value: number) =>
    updateTeam(team.id, (t) => ({ ...t, counts: { ...t.counts, [row.id]: { ...t.counts[row.id], [period]: Math.max(0, value) } } }))

  if (!model) {
    return (
      <div className="calc">
        <div className="empty-manual">
          <h3>{reading ? 'Reading the point value table…' : 'Score Calculator'}</h3>
          <p className="muted">
            {reading
              ? 'This takes a few seconds.'
              : manual
                ? 'Read the scoring from the game manual’s point value table, or enter it by hand.'
                : 'Once the game manual is shared, its point value table is read automatically. You can also enter the scoring by hand.'}
          </p>
          {!reading && (
            <div className="row">
              {manual && (
                <button className="primary" onClick={readManual}>
                  Read from manual
                </button>
              )}
              <button
                onClick={() => {
                  setModel(blankModel())
                  setEditing(true)
                }}
              >
                Enter by hand
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const groups = [...new Set(model.rows.map((r) => r.group))]
  // Every team cell lays its period inputs on the same fixed grid, so columns line up.
  const periodGrid = { gridTemplateColumns: `repeat(${model.periods.length}, var(--counter-w))` }
  const patchModel = (fields: Partial<ScoringModel>) => setModel({ ...model, ...fields })
  const patchRow = (id: string, fields: Partial<ScoreRow>) => patchModel({ rows: model.rows.map((r) => (r.id === id ? { ...r, ...fields } : r)) })
  const patchRule = (id: string, fields: Partial<RpRule>) => patchModel({ bonusRps: model.bonusRps.map((r) => (r.id === id ? { ...r, ...fields } : r)) })

  return (
    <div className="calc">
      <header className="calc-head">
        <div>
          <h2>Score Calculator</h2>
          <p className="muted small">Scoring from {model.source}</p>
        </div>
        <div className="row">
          <button aria-pressed={editing} className={editing ? 'primary' : undefined} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done editing' : 'Edit scoring'}
          </button>
          {manual && (
            <button onClick={() => confirm('Replace the scoring table with a fresh reading of the manual?') && readManual()} disabled={reading}>
              {reading ? 'Reading…' : 'Re-read manual'}
            </button>
          )}
          <button onClick={() => setTeams((ts) => ts.map((t) => ({ ...t, counts: {}, checked: {} })))}>Clear counts</button>
          {defaultTeams()
            .filter((d) => !teams.some((t) => t.color === d.color))
            .map((d) => (
              // Red and blue come back in their usual place: red first, blue after it.
              <button
                key={d.id}
                className={`robot-btn ${d.color}`}
                onClick={() =>
                  setTeams((ts) => (d.color === 'red' ? [{ ...d, id: newRowId() }, ...ts] : [...ts.filter((t) => t.color === 'red'), { ...d, id: newRowId() }, ...ts.filter((t) => t.color !== 'red')]))
                }
              >
                + {d.name}
              </button>
            ))}
          <button
            onClick={() =>
              setTeams((ts) => [...ts, { id: newRowId(), name: `Team ${ts.filter((t) => t.color === 'gray').length + 1}`, color: 'gray', counts: {}, checked: {} }])
            }
          >
            + Team
          </button>
        </div>
      </header>
      {status && <p className="calc-status muted">{status}</p>}

      <div className="calc-scroll">
        <table className="calc-table">
          <thead>
            <tr>
              <th className="action-col">Action</th>
              <th className="pts-col">Points ({model.periods.map((p) => p.slice(0, 4)).join(' / ')})</th>
              {teams.map((t) => (
                <th key={t.id} className={`team-col team-${t.color}`}>
                  <div className="team-head">
                    <input
                      value={t.name}
                      onChange={(e) => updateTeam(t.id, (x) => ({ ...x, name: e.target.value }))}
                      aria-label="Team or alliance name"
                    />
                    {teams.length > 1 && (
                      <button className="icon ghost" onClick={() => setTeams((ts) => ts.filter((x) => x.id !== t.id))} aria-label={`Remove ${t.name}`}>
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="period-heads" style={periodGrid}>
                    {model.periods.map((p) => (
                      <span key={p}>{p}</span>
                    ))}
                  </div>
                </th>
              ))}
              {editing && <th />}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g} group={g}>
                {model.rows
                  .filter((r) => r.group === g)
                  .map((row) => (
                    <tr key={row.id}>
                      <td className="action-col">
                        {editing ? (
                          <div className="edit-action">
                            <input value={row.group} onChange={(e) => patchRow(row.id, { group: e.target.value })} aria-label="Group" className="edit-group" />
                            <input value={row.name} onChange={(e) => patchRow(row.id, { name: e.target.value })} aria-label="Action" />
                          </div>
                        ) : (
                          row.name
                        )}
                      </td>
                      <td className="pts-col">
                        {editing ? (
                          <div className="edit-values">
                            {model.periods.map((p) => (
                              <input
                                key={p}
                                type="number"
                                min={0}
                                value={row.values[p] ?? ''}
                                placeholder="–"
                                aria-label={`${p} points`}
                                onChange={(e) =>
                                  patchRow(row.id, { values: { ...row.values, [p]: e.target.value === '' ? null : Number(e.target.value) } })
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          model.periods.map((p) => row.values[p] ?? '–').join(' / ')
                        )}
                      </td>
                      {teams.map((t) => (
                        <td key={t.id} className={`team-col team-${t.color}`}>
                          <div className="counts" style={periodGrid}>
                            {model.periods.map((p) =>
                              row.values[p] == null ? (
                                <span key={p} className="no-count" />
                              ) : (
                                <Counter key={p} value={count(t, row, p)} onChange={(v) => setCount(t, row, p, v)} label={`${t.name} ${row.name} ${p}`} />
                              ),
                            )}
                          </div>
                        </td>
                      ))}
                      {editing && (
                        <td>
                          <button className="icon ghost" onClick={() => patchModel({ rows: model.rows.filter((r) => r.id !== row.id) })} aria-label="Delete row">
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
              </GroupRows>
            ))}
            {editing && (
              <tr>
                <td colSpan={2 + teams.length + 1}>
                  <button
                    className="small"
                    onClick={() =>
                      patchModel({
                        rows: [
                          ...model.rows,
                          { id: newRowId(), group: groups[groups.length - 1] ?? 'Scoring', name: 'New action', values: Object.fromEntries(model.periods.map((p) => [p, 0])) },
                        ],
                      })
                    }
                  >
                    + Scoring action
                  </button>
                </td>
              </tr>
            )}
          </tbody>

          <tbody className="calc-results">
            {model.periods.map((p) => (
              <tr key={p}>
                <th colSpan={2}>{p} points</th>
                {results.map((r, i) => (
                  <td key={teams[i].id} className={`team-col team-${teams[i].color} num`}>
                    {r.byPeriod[p]}
                  </td>
                ))}
                {editing && <td />}
              </tr>
            ))}
            <tr className="total-row">
              <th colSpan={2}>Total MATCH points</th>
              {results.map((r, i) => (
                <td key={teams[i].id} className={`team-col team-${teams[i].color} num`}>
                  {r.total}
                  {outcome(i) === 'win' && <span className="badge win">Win</span>}
                  {outcome(i) === 'tie' && <span className="badge tie">Tie</span>}
                </td>
              ))}
              {editing && <td />}
            </tr>

            {model.bonusRps.map((rule) => (
              <tr key={rule.id}>
                <th colSpan={2} className="rp-rule">
                  {editing ? (
                    <div className="edit-rule">
                      <input value={rule.name} onChange={(e) => patchRule(rule.id, { name: e.target.value })} aria-label="Bonus RP name" />
                      <label>
                        +<input type="number" min={0} value={rule.rp} onChange={(e) => patchRule(rule.id, { rp: Number(e.target.value) })} aria-label="RP" /> RP
                        when
                      </label>
                      <select value={rule.metric} onChange={(e) => patchRule(rule.id, { metric: e.target.value as Metric })} aria-label="Measured on">
                        {metricOptions(model).map((m) => (
                          <option key={m} value={m}>
                            {metricLabel(m, model)}
                          </option>
                        ))}
                      </select>
                      {rule.metric !== 'manual' && (
                        <label>
                          ≥
                          <input
                            type="number"
                            min={0}
                            value={rule.threshold ?? ''}
                            onChange={(e) => patchRule(rule.id, { threshold: e.target.value === '' ? null : Number(e.target.value) })}
                            aria-label="Threshold"
                          />
                        </label>
                      )}
                    </div>
                  ) : (
                    <>
                      {rule.name} <span className="muted small">+{rule.rp} RP</span>
                      <span className="muted small rule-detail">
                        {rule.metric === 'manual'
                          ? rule.description || 'Tick when earned'
                          : `${metricLabel(rule.metric, model)} ≥ ${rule.threshold ?? '?'}`}
                      </span>
                    </>
                  )}
                </th>
                {results.map((r, i) => {
                  const b = r.bonus.find((x) => x.rule.id === rule.id)!
                  return (
                    <td key={teams[i].id} className={`team-col team-${teams[i].color} rp-cell${b.earned ? ' earned' : ''}`}>
                      {rule.metric === 'manual' ? (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!!teams[i].checked[rule.id]}
                            onChange={(e) => updateTeam(teams[i].id, (t) => ({ ...t, checked: { ...t.checked, [rule.id]: e.target.checked } }))}
                          />
                          {b.earned ? `+${rule.rp}` : '—'}
                        </label>
                      ) : (
                        <>
                          <span className="rp-mark">{b.earned ? `✓ +${rule.rp}` : '✗'}</span>
                          <span className="muted small">
                            {b.value}
                            {rule.threshold != null && ` / ${rule.threshold}`}
                          </span>
                        </>
                      )}
                    </td>
                  )
                })}
                {editing && (
                  <td>
                    <button className="icon ghost" onClick={() => patchModel({ bonusRps: model.bonusRps.filter((r) => r.id !== rule.id) })} aria-label="Delete bonus RP">
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {editing && (
              <tr>
                <td colSpan={2 + teams.length + 1}>
                  <button
                    className="small"
                    onClick={() =>
                      patchModel({ bonusRps: [...model.bonusRps, { id: newRuleId(), name: 'New bonus RP', description: '', rp: 1, threshold: null, metric: 'manual' }] })
                    }
                  >
                    + Bonus RP
                  </button>
                </td>
              </tr>
            )}

            <tr>
              <th colSpan={2}>
                {editing ? (
                  <div className="edit-rule">
                    <label>
                      Win
                      <input type="number" min={0} value={model.winRp} onChange={(e) => patchModel({ winRp: Number(e.target.value) })} aria-label="Win RP" /> RP
                    </label>
                    <label>
                      Tie
                      <input type="number" min={0} value={model.tieRp} onChange={(e) => patchModel({ tieRp: Number(e.target.value) })} aria-label="Tie RP" /> RP
                    </label>
                  </div>
                ) : (
                  <>
                    Win / tie <span className="muted small">+{model.winRp} / +{model.tieRp} RP</span>
                  </>
                )}
              </th>
              {teams.map((t, i) => {
                const o = outcome(i)
                const rp = o === 'win' ? model.winRp : o === 'tie' ? model.tieRp : 0
                return (
                  <td key={t.id} className={`team-col team-${t.color} rp-cell${rp ? ' earned' : ''}`}>
                    <span className="rp-mark">{o == null ? '—' : rp ? `+${rp}` : '0'}</span>
                  </td>
                )
              })}
              {editing && <td />}
            </tr>
            <tr className="total-row">
              <th colSpan={2}>Total ranking points</th>
              {results.map((r, i) => {
                const o = outcome(i)
                const rp = r.bonusRp + (o === 'win' ? model.winRp : o === 'tie' ? model.tieRp : 0)
                return (
                  <td key={teams[i].id} className={`team-col team-${teams[i].color} num`}>
                    {rp} RP
                  </td>
                )
              })}
              {editing && <td />}
            </tr>
          </tbody>
        </table>
      </div>
      {teams.length > 2 && <p className="muted small calc-note">With more than two teams, “win” means scoring more than every other column.</p>}
    </div>
  )
}

function GroupRows({ group, children }: { group: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="group-row">
        <th colSpan={99}>{group}</th>
      </tr>
      {children}
    </>
  )
}

function Counter({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="counter">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 0} aria-label={`Fewer: ${label}`}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        onFocus={(e) => e.target.select()}
        aria-label={label}
      />
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`More: ${label}`}>
        +
      </button>
    </span>
  )
}
