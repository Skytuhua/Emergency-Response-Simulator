import { useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, FileDown, RotateCcw } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { RunSummary, SimState } from '../model';
import { summarize, runBaseline } from '../sim/results';
import { observe } from '../sim/observe';
import { TownMap } from './TownMap';
import { Provenance } from './Provenance';
import { minuteLabel } from './Response';

type MetricKey = 'contactCoverage' | 'assessmentCoverage' | 'timelyUrgentAssistance' | 'stillUndiscovered' | 'resourceUse';
const percent = (value: number | null) => value === null ? 'N/A' : `${Math.round(value * 100)}%`;
const metrics: { key: MetricKey; title: string; lower?: boolean; rate: boolean; neutral?: boolean }[] = [
  { key: 'contactCoverage', title: 'Contact coverage', rate: true },
  { key: 'assessmentCoverage', title: 'Assessment coverage', rate: true },
  { key: 'timelyUrgentAssistance', title: 'Timely urgent assistance', rate: true },
  { key: 'stillUndiscovered', title: 'Still undiscovered', lower: true, rate: false },
  { key: 'resourceUse', title: 'Unit utilization', rate: true, neutral: true },
];
const tabs = ['Overview', 'Compare', 'Homes', 'Details'] as const;
type ResultsTab = typeof tabs[number];

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
  const maxY = Math.ceil(Math.max(4, summary.peopleAssisted, baseline.peopleAssisted) / 4) * 4;
  const x = (minute: number) => 48 + minute / 60 * 320;
  const y = (people: number) => 195 - people / maxY * 160;
  const path = (points: RunSummary['assistedOverTime']) => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.minute)},${y(point.people)}`).join(' ');
  return <><div className="chart-legend"><span><i className="chart-key" /> Your response</span><span><i className="chart-key baseline" /> Baseline</span></div><svg className="assistance-chart" viewBox="0 0 400 230" role="img" aria-label={`People assisted by minute 60: your response ${summary.peopleAssisted}, baseline ${baseline.peopleAssisted}`}>
    {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1={48} x2={368} y1={y(i * maxY / 4)} y2={y(i * maxY / 4)} stroke="#e9ebef" /><text x={38} y={y(i * maxY / 4) + 4} textAnchor="end" fontSize={12} fill="#58616d">{i * maxY / 4}</text></g>)}
    {[0, 15, 30, 45, 60].map(minute => <text key={minute} x={x(minute)} y={217} textAnchor="middle" fontSize={12} fill="#58616d">{minute}m</text>)}
    <line x1={48} x2={368} y1={195} y2={195} stroke="#cbd1d9" /><path d={path(baseline.assistedOverTime)} fill="none" stroke="#737c87" strokeWidth={2} /><path d={path(summary.assistedOverTime)} fill="none" stroke="#c92332" strokeWidth={2.5} /><circle cx={x(60)} cy={y(summary.peopleAssisted)} r={3.5} fill="#c92332" stroke="white" /><text x={x(60) - 5} y={y(summary.peopleAssisted) - 10} textAnchor="end" fontSize={14} fontWeight={700} fill="#b82433">{summary.peopleAssisted}</text>
  </svg><p className="chart-caption">Assistance counts when completed.</p></>;
}

export function Results({ state, onExport, onReplay, onRestart, onEdit }: { state: SimState; onExport: () => void; onReplay: () => void; onRestart: () => void; onEdit: () => void }) {
  const summary = useMemo(() => summarize(state), [state]);
  const baselineState = useMemo(() => runBaseline(structuredClone(state.scenario)), [state.scenario]);
  const baseline = useMemo(() => summarize(baselineState), [baselineState]);
  const view = useMemo(() => observe(state), [state]);
  const [activeTab, setActiveTab] = useState<ResultsTab>('Overview');
  const [householdId, setHouseholdId] = useState('H19');
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const household = summary.households.find(h => h.householdId === householdId)!;
  const events = state.events.filter(event => event.householdId === householdId);
  const finishMinute = household.completedAt ?? 60;
  const highlightTitle = household.completedAt !== null ? 'Assistance completed' : household.undiscovered ? 'Need remained undiscovered' : household.need ? 'Assistance remained incomplete' : 'No primary need';
  const config = state.scenario.config;
  return <div className="results-screen">
    <div className="workspace-toolbar"><h1>Results &amp; analysis</h1><div className="toolbar-actions"><Button variant="outline" size="sm" onClick={onExport}><FileDown size={15} /> Export run</Button><Button variant="outline" size="sm" onClick={onReplay}>Replay decisions</Button><Button variant="outline" size="sm" onClick={onRestart}><RotateCcw size={15} /> Restart same conditions</Button><Button variant="ghost" size="sm" onClick={onEdit}>Edit conditions <ArrowRight size={14} /></Button></div></div>
    <div className="results-tabs" role="tablist" aria-label="Results views">{tabs.map((tab, index) => <button key={tab} ref={element => { tabButtons.current[index] = element; }} type="button" id={`${id}-tab-${index}`} role="tab" aria-selected={activeTab === tab} aria-controls={`${id}-panel-${index}`} tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)} onKeyDown={event => {
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); setActiveTab(tabs[next]); tabButtons.current[next]?.focus();
    }}>{tab}</button>)}</div>
    <div className="results-tab-panel" id={`${id}-panel-${tabs.indexOf(activeTab)}`} role="tabpanel" aria-labelledby={`${id}-tab-${tabs.indexOf(activeTab)}`} tabIndex={0}>
      {activeTab === 'Overview' && <div className="results-overview">
        <dl className="outcome-summary"><div><dt id={`${id}-people`}>People helped</dt><dd aria-labelledby={`${id}-people`}>{summary.peopleAssisted}</dd></div><div><dt id={`${id}-urgent`}>Urgent help on time</dt><dd aria-labelledby={`${id}-urgent`}>{summary.urgentNeeds ? `${summary.timelyUrgentCount} / ${summary.urgentNeeds}` : 'N/A'}</dd></div><div><dt id={`${id}-undiscovered`}>Undiscovered needs</dt><dd aria-labelledby={`${id}-undiscovered`}>{summary.stillUndiscovered}</dd></div></dl>
        <section className="panel overview-map" aria-label="Final response map"><div className="panel-heading"><h2>Final response map</h2><span>{summary.assistanceCompleted} of {summary.totalNeeds} needs resolved</span></div><div className="results-map"><TownMap view={view} compact debrief={summary} /></div></section>
      </div>}
      {activeTab === 'Compare' && <div className="compare-layout"><section className="panel"><h2>Outcome comparison</h2><table className="comparison-table"><thead><tr><th scope="col">Metric</th><th scope="col" className="your-column">Your response</th><th scope="col">Baseline</th><th scope="col">Change</th></tr></thead><tbody>{metrics.map(metric => <tr key={metric.key}><td>{metric.title}</td><td className="your-column">{metric.rate ? percent(summary[metric.key]) : summary[metric.key]}</td><td>{metric.rate ? percent(baseline[metric.key]) : baseline[metric.key]}</td><td className={metric.neutral ? 'tie' : comparisonClass(summary[metric.key], baseline[metric.key], metric.lower)}>{delta(summary[metric.key], baseline[metric.key], metric.rate)}</td></tr>)}</tbody></table><p className="comparison-note">Same conditions and public observations. Lower utilization alone does not indicate a better response.</p></section><section className="panel"><h2>People helped over time</h2><AssistanceChart summary={summary} baseline={baseline} /></section></div>}
      {activeTab === 'Homes' && <section className="panel timeline-panel"><div className="timeline-header"><h2>Home timeline</h2><label className="sr-only" htmlFor="timeline-household">Inspect household timeline</label><select id="timeline-household" className="select-control" value={householdId} onChange={e => setHouseholdId(e.target.value)}>{summary.households.map(h => <option value={h.householdId} key={h.householdId}>{h.householdId} · {h.need ? h.need.kind : 'no primary need'}</option>)}</select></div><div className="timeline-track">{[0, 15, 30, 45, 60].map(minute => <div className="timeline-tick" key={minute}><span>{minute}m</span></div>)}</div><div className="timeline-content"><div className="timeline-highlight"><strong>{minuteLabel(finishMinute)}</strong><div><h3>{householdId} · {highlightTitle}</h3><p>{household.size} residents{household.accessible ? ' · Accessible transport' : ''}{household.need ? ` · ${household.need.urgent ? 'Urgent' : 'Standard'} ${household.need.kind} · Deadline ${minuteLabel(household.need.deadline)}` : ''}{household.completedAt !== null && household.need ? ` · ${household.timely ? 'On time' : 'After deadline'}` : ''}</p></div></div><ul className="timeline-events">{household.need && <li><time>00:00</time><span>{household.need.kind === 'delivery' ? 'Supply kit' : 'Shelter relocation'} need starts{household.need.urgent ? ' · urgent' : ''} (revealed in debrief).</span></li>}{events.map(event => <li key={event.id}><time>{minuteLabel(event.minute)}</time><span>{event.message}</span></li>)}{events.length === 0 && <li><time>01:00</time><span>No contact or response events recorded.</span></li>}</ul></div></section>}
      {activeTab === 'Details' && <div className="results-details-grid">
        <section className="panel" aria-label="Resource accounting"><h2>Resource accounting</h2><dl className="resource-accounting"><div><dt>Needs resolved</dt><dd>{summary.assistanceCompleted} / {summary.totalNeeds}</dd></div><div><dt>Kits consumed / reserved</dt><dd>{summary.kitsConsumed} / {state.kits.reserved}</dd></div><div><dt>Shelter places occupied / reserved</dt><dd>{summary.shelterOccupancy} / {state.shelters.reduce((sum, s) => sum + s.reserved, 0)}</dd></div><div><dt>Unmet urgent-need minutes</dt><dd>{summary.unmetUrgentNeedMinutes}</dd></div><div><dt>Unit busy minutes</dt><dd>{summary.unitBusyMinutes}</dd></div></dl><p className="comparison-note">Incomplete transport at minute 60 remains unresolved.</p></section>
        <section className="panel"><h2>Exercise settings</h2><dl className="settings-list"><div><dt>Scenario</dt><dd>Riverdale storm · 60 minutes</dd></div><div><dt>Seed</dt><dd>{config.seed}</dd></div><div><dt>Communications outage</dt><dd>{config.networkGap === 'none' ? 'None' : `${config.networkGap[0].toUpperCase()}${config.networkGap.slice(1)}`}</dd></div><div><dt>Roads / additional needs</dt><dd>{config.roadPreset === 'open' ? 'Open' : 'One detour'} / {config.additionalNeeds}</dd></div><div><dt>Crew / vans / starting kits</dt><dd>1 / {config.vans} / {config.kits}</dd></div><div><dt>Shelter capacity: East / West</dt><dd>{config.shelterA} / {config.shelterB}</dd></div></dl></section>
        <Provenance artifact={state.scenario.artifact} debrief />
      </div>}
    </div>
  </div>;
}
