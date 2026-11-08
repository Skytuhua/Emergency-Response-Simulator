import { useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Check, ClipboardCheck, FileDown, Layers3, RotateCcw, Search, ShieldCheck, Timer, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { RunSummary, SimState } from '../model';
import { summarize, runBaseline } from '../sim/results';
import { observe } from '../sim/observe';
import { TownMap } from './TownMap';
import { Provenance } from './Provenance';
import { minuteLabel } from './Response';

type MetricKey = 'contactCoverage' | 'assessmentCoverage' | 'timelyUrgentAssistance' | 'stillUndiscovered' | 'resourceUse';
const percent = (value: number | null) => value === null ? 'N/A' : `${Math.round(value * 100)}%`;
const metrics: { key: MetricKey; title: string; icon: typeof Users; lower?: boolean; rate: boolean; neutral?: boolean }[] = [
  { key: 'contactCoverage', title: 'Contact coverage', icon: Users, rate: true },
  { key: 'assessmentCoverage', title: 'Assessment coverage', icon: ClipboardCheck, rate: true },
  { key: 'timelyUrgentAssistance', title: 'Timely urgent assistance', icon: ShieldCheck, rate: true },
  { key: 'stillUndiscovered', title: 'Still undiscovered', icon: Search, lower: true, rate: false },
  { key: 'resourceUse', title: 'Unit utilization', icon: Layers3, rate: true, neutral: true },
];

function delta(value: number | null, baseline: number | null, rate: boolean): string {
  if (value === null || baseline === null) return 'N/A';
  const diff = rate ? Math.round((value - baseline) * 100) : value - baseline;
  return `${diff > 0 ? '+' : ''}${diff}${rate ? ' pp' : ''}`;
}
function comparisonClass(value: number | null, baseline: number | null, lower = false): string {
  if (value === null || baseline === null || Math.abs(value - baseline) < .0001) return 'tie';
  return (lower ? value < baseline : value > baseline) ? 'better' : 'worse';
}

function AssistanceChart({ summary, baseline }: { summary: RunSummary; baseline: RunSummary }) {
  const max = Math.max(4, summary.peopleAssisted, baseline.peopleAssisted);
  const maxY = Math.ceil(max / 4) * 4;
  const x = (minute: number) => 35 + minute / 60 * 295;
  const y = (people: number) => 172 - people / maxY * 148;
  const path = (points: RunSummary['assistedOverTime']) => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.minute)},${y(point.people)}`).join(' ');
  return <><div className="chart-legend"><span><i className="chart-key" /> Your response</span><span><i className="chart-key baseline" /> Baseline</span></div><svg className="assistance-chart" viewBox="0 0 350 200" role="img" aria-label={`People assisted by minute 60: your response ${summary.peopleAssisted}, baseline ${baseline.peopleAssisted}`}>
    {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1={35} x2={330} y1={y(i * maxY / 4)} y2={y(i * maxY / 4)} stroke="#e9ebef" /><text x={28} y={y(i * maxY / 4) + 3} textAnchor="end" fontSize={9} fill="#707984">{i * maxY / 4}</text></g>)}
    {[0, 15, 30, 45, 60].map(minute => <text key={minute} x={x(minute)} y={188} textAnchor="middle" fontSize={9} fill="#707984">{minute}m</text>)}
    <line x1={35} x2={330} y1={172} y2={172} stroke="#cbd1d9" /><path d={path(baseline.assistedOverTime)} fill="none" stroke="#8e969f" strokeWidth={2} /><path d={path(summary.assistedOverTime)} fill="none" stroke="#c92332" strokeWidth={2.5} /><circle cx={x(60)} cy={y(summary.peopleAssisted)} r={3.5} fill="#c92332" stroke="white" /><text x={x(60) - 5} y={y(summary.peopleAssisted) - 9} textAnchor="end" fontSize={11} fontWeight={700} fill="#b82433">{summary.peopleAssisted}</text>
  </svg><p className="chart-caption">Time since incident · assistance counts at completion</p></>;
}

export function Results({ state, onExport, onReplay, onRestart, onEdit }: { state: SimState; onExport: () => void; onReplay: () => void; onRestart: () => void; onEdit: () => void }) {
  const summary = useMemo(() => summarize(state), [state]);
  const baselineState = useMemo(() => runBaseline(structuredClone(state.scenario)), [state.scenario]);
  const baseline = useMemo(() => summarize(baselineState), [baselineState]);
  const view = useMemo(() => observe(state), [state]);
  const [householdId, setHouseholdId] = useState('H19');
  const household = summary.households.find(h => h.householdId === householdId)!;
  const events = state.events.filter(event => event.householdId === householdId);
  const finishMinute = household.completedAt ?? 60;
  const highlightTitle = household.completedAt !== null ? 'Assistance completed' : household.undiscovered ? 'Need remained undiscovered' : household.need ? 'Assistance remained incomplete' : 'No primary need in this exercise';
  return <>
    <div className="page-heading results-heading"><div><h1>Results &amp; analysis</h1><p>Review outcomes, compare the baseline, and see the effect of your decisions.</p></div><div className="run-details"><div><small>Scenario</small><strong>Riverdale storm</strong></div><div><small>Duration</small><strong>60 minutes</strong></div><div><small>Seed</small><strong className="tabular">{state.scenario.config.seed}</strong></div></div></div>
    <div className="metrics-grid">{metrics.map(metric => {
      const value = summary[metric.key], base = baseline[metric.key], diff = value === null || base === null ? 0 : value - base;
      const className = comparisonClass(value, base, metric.lower);
      const Icon = metric.icon;
      return <section key={metric.key} className={`metric-card ${metric.neutral ? 'warning' : className === 'better' ? 'positive' : ''}`}><div className="metric-top"><Icon size={23} /><h2>{metric.title}</h2></div><div className="metric-value">{metric.rate ? percent(value) : value}</div><div className="metric-comparison"><span className={metric.neutral ? '' : className}>{diff > .0001 ? <ArrowUp size={10} style={{ display: 'inline' }} /> : diff < -.0001 ? <ArrowDown size={10} style={{ display: 'inline' }} /> : null}{delta(value, base, metric.rate)}</span> vs. baseline</div></section>;
    })}</div>
    <div className="results-panels"><section className="panel"><h2>Outcome comparison</h2><table className="comparison-table"><thead><tr><th>Metric</th><th className="your-column">Your response</th><th>Baseline</th><th>Δ</th></tr></thead><tbody>{metrics.map(metric => <tr key={metric.key}><td>{metric.title}</td><td className="your-column">{metric.rate ? percent(summary[metric.key]) : summary[metric.key]}</td><td>{metric.rate ? percent(baseline[metric.key]) : baseline[metric.key]}</td><td className={metric.neutral ? 'tie' : comparisonClass(summary[metric.key], baseline[metric.key], metric.lower)}>{delta(summary[metric.key], baseline[metric.key], metric.rate)}</td></tr>)}</tbody></table></section><section className="panel"><h2>People assisted over time</h2><AssistanceChart summary={summary} baseline={baseline} /></section><section className="panel"><h2>Response map · final</h2><div className="results-map"><TownMap view={view} compact debrief={summary} /></div></section></div>
    <section className="panel timeline-panel"><div className="timeline-header"><h2>Household timeline</h2><label className="sr-only" htmlFor="timeline-household">Inspect household timeline</label><select id="timeline-household" className="select-control" value={householdId} onChange={e => setHouseholdId(e.target.value)}>{summary.households.map(h => <option value={h.householdId} key={h.householdId}>{h.householdId} · {h.need ? h.need.kind : 'no primary need'}</option>)}</select></div><div className="timeline-track">{[0, 15, 30, 45, 60].map(minute => <div className="timeline-tick" key={minute}><span>{minute}m{minute === 0 ? ' · start' : minute === 60 ? ' · end' : ''}</span></div>)}</div><div className="timeline-content"><div className="timeline-highlight"><strong>{minuteLabel(finishMinute)}</strong><div><h3>{householdId} · {highlightTitle}</h3><p>{household.size} residents{household.accessible ? ', accessible transport required' : ''}.{household.need ? ` ${household.need.urgent ? 'Urgent' : 'Standard'} ${household.need.kind} need; deadline ${minuteLabel(household.need.deadline)}.` : ''}{household.completedAt !== null && household.need ? ` ${household.timely ? 'Completed on time.' : 'Completed after the deadline.'}` : ''}</p></div></div><ul className="timeline-events">{household.need && <li><time>00:00</time><span>{household.need.kind === 'delivery' ? 'Supply kit' : 'Shelter relocation'} need starts{household.need.urgent ? ' · urgent' : ''} (revealed in debrief).</span></li>}{events.map(event => <li key={event.id}><time>{minuteLabel(event.minute)}</time><span>{event.message}</span></li>)}{events.length === 0 && <li><time>01:00</time><span>No contact or response events were recorded for this household.</span></li>}</ul></div></section>
    <section className="panel" style={{ marginTop: 17, padding: '17px 21px' }} aria-label="Resource accounting"><h2 style={{ fontSize: 15, marginBottom: 12 }}>What the response used</h2><div className="resource-accounting"><span><strong>{summary.assistanceCompleted}/{summary.totalNeeds}</strong> needs resolved</span><span><strong>{summary.kitsConsumed}</strong> kits consumed · {state.kits.reserved} still reserved</span><span><strong>{summary.shelterOccupancy}</strong> occupied shelter places · {state.shelters.reduce((sum, s) => sum + s.reserved, 0)} reserved</span><span><strong>{summary.unmetUrgentNeedMinutes}</strong> unmet urgent-need minutes</span></div><p className="chart-caption" style={{ textAlign: 'left', marginTop: 12 }}>The baseline uses the same conditions and public observations. An incomplete transport remains unresolved at minute 60. Lower utilization alone does not indicate a better response.</p></section>
    <Provenance artifact={state.scenario.artifact} debrief />
    <div className="results-actions"><div><Button onClick={onRestart}><RotateCcw size={15} /> Restart same conditions</Button><Button variant="outline" onClick={onReplay}>Replay saved decisions</Button><Button variant="ghost" onClick={onEdit}>Edit conditions <ArrowRight size={14} /></Button></div><Button variant="outline" onClick={onExport}><FileDown size={15} /> Export run</Button></div><div className="bottom-note"><span><ShieldCheck size={12} /> Computed exercise outcomes · No claim of real-world or AI policy improvement</span><span><Check size={12} /> Both runs use the same materialized scenario</span></div>
  </>;
}
