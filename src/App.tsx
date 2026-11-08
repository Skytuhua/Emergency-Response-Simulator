import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ClipboardList, Map, ShieldCheck } from 'lucide-react';
import { Button } from './components/ui/button';
import type { AgentArtifact, ScenarioConfig, SimState } from './model';
import { HORIZON } from './model';
import { createScenario, DALLAS_DEFAULT_CONFIG } from './scenario';
import { initializeAutomatic, advanceAutomaticMinute, getAutomaticCoordinationIssue } from './sim/automatic';
import { observe } from './sim/observe';
import { validateArtifact } from './artifact';
import { downloadRun, makeRunFile, parseRunFile, replay } from './run-file';
import { Creator } from './ui/Creator';
import { Simulation } from './ui/Simulation';
import { Results } from './ui/Results';
import { SecondaryPanel } from './ui/SecondaryPanel';
import { newlyDiscoveredUrgency } from './ui/controller';
import { V2App } from './V2App';

type Screen = 'create' | 'respond' | 'results';
type Notice = { text: string; urgentId?: string } | null;
const freshRunId = () => crypto.randomUUID();
const initialHome = (state: SimState) => state.scenario.artifact?.profiles[0]?.householdId ?? state.households[0]?.householdId ?? null;

export default function App() {
  const [legacy,setLegacy]=useState(false);
  const [imported,setImported]=useState<SimState|null>(null);
  return legacy&&imported?<LegacyApp initialState={imported} compatibilityOnly onExpanded={()=>{setImported(null);setLegacy(false);}}/>:<V2App onLegacy={state=>{setImported(state??null);setLegacy(!!state);}}/>;
}
export function LegacyApp({initialState=null,onExpanded,compatibilityOnly=false}:{initialState?:SimState|null;onExpanded?:()=>void;compatibilityOnly?:boolean}={}) {
  const [screen, setScreen] = useState<Screen>(initialState?(initialState.finalized?'results':'respond'):'create');
  const [config, setConfig] = useState<ScenarioConfig>({ ...(initialState?.scenario.config??DALLAS_DEFAULT_CONFIG) });
  const [artifacts, setArtifacts] = useState<Record<ScenarioConfig['template'], AgentArtifact | null>>({ 'storm-v1':null, 'storm-dallas-v1':null });
  const [artifactReady, setArtifactReady] = useState<Record<ScenarioConfig['template'], boolean>>({ 'storm-v1':false, 'storm-dallas-v1':false });
  const artifact = artifacts[config.template];
  const [state, setState] = useState<SimState | null>(initialState);
  const stateRef = useRef<SimState | null>(initialState);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmation, setConfirmation] = useState<'edit' | 'finish' | 'expanded' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const view = useMemo(() => state ? observe(state) : null, [state]);
  const coordinationIssue = state ? getAutomaticCoordinationIssue(state) : null;
  const pause = () => { runningRef.current = false; setRunning(false); };
  const run = () => { if (!document.hidden && stateRef.current && !stateRef.current.finalized) { runningRef.current = true; setRunning(true); } };
  const install = (next: SimState) => { stateRef.current = next; setState(next); };
  const clearSelections = () => { setSelected(null); setNotice(null); setConfirmation(null); setError(null); };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const heading = document.querySelector<HTMLElement>('main h1');
    heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true });
  }, [screen]);

  useEffect(() => {
    const controller = new AbortController();
    for (const [template, url] of [['storm-v1','/data/mirofish-v1.json'], ['storm-dallas-v1','/data/mirofish-dallas-v1.json']] as const) {
      fetch(url, { signal: controller.signal })
        .then(response => { if (!response.ok) throw new Error('No prepared artifact'); return response.json(); })
        .then(json => {
          const prepared = validateArtifact(json);
          if (prepared.template !== template) throw new Error('Prepared location differs.');
          if (!controller.signal.aborted) setArtifacts(current => ({ ...current, [template]:prepared }));
        }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setArtifactReady(current => ({ ...current, [template]:true })); });
    }
    return () => controller.abort();
  }, []);

  const step = () => {
    const current = stateRef.current;
    if (!current || current.finalized) return;
    const next = advanceAutomaticMinute(current);
    const urgentId = newlyDiscoveredUrgency(observe(current), observe(next));
    install(next);
    if (urgentId) setNotice({ text: `Urgent request · ${urgentId}`, urgentId });
    if (next.finalized) { pause(); generation.current++; setScreen('results'); setSelected(null); setNotice(null); }
  };

  useEffect(() => {
    if (!running || screen !== 'respond') return;
    let lastTime = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      if (now - lastTime > 2000 / speed * 1.8) { runningRef.current = false; setRunning(false); setNotice({ text: 'Playback paused. Resume to continue.' }); lastTime = now; return; }
      lastTime = now;
      if (runningRef.current && !document.hidden) step();
    }, 2000 / speed);
    return () => window.clearInterval(interval);
  }, [running, speed, screen]);

  useEffect(() => {
    const visibility = () => { if (document.hidden) { runningRef.current = false; setRunning(false); } };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      runningRef.current = false; setRunning(false);
      setSelected(null);
    };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('keydown', keyboard); };
  }, []);

  const start = (override?: ScenarioConfig) => {
    try {
      const chosen = override ?? config;
      const next = initializeAutomatic(createScenario(chosen, artifacts[chosen.template]), freshRunId());
      if (override) setConfig({ ...override });
      generation.current++; clearSelections(); install(next); setSelected(initialHome(next)); setScreen('respond'); run();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the exercise settings.'); }
  };
  const select = (id: string | null) => {
    setSelected(id); if (id) setNotice(null);
  };
  const finish = () => {
    let current = stateRef.current; if (!current) return;
    pause(); generation.current++;
    while (!current.finalized && current.minute < HORIZON) current = advanceAutomaticMinute(current);
    install(current); clearSelections(); setScreen('results');
  };
  const edit = () => {
    generation.current++; pause();
    if (stateRef.current) setConfig({ ...stateRef.current.scenario.config });
    stateRef.current = null; setState(null); clearSelections(); setScreen('create');
  };
  const restart = () => {
    const current = stateRef.current; if (!current) return;
    generation.current++; clearSelections(); install(initializeAutomatic(structuredClone(current.scenario), freshRunId())); setScreen('respond'); run();
  };
  const replayCurrent = () => {
    const current = stateRef.current; if (!current) return;
    try {
      const next = replay(makeRunFile(current));
      generation.current++; pause(); clearSelections(); install(next); setScreen(next.finalized ? 'results' : 'respond');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to replay.'); }
  };
  const exportCurrent = () => {
    const current = stateRef.current; if (!current) return;
    pause(); try { downloadRun(current); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to export.'); }
  };
  const importClick = () => { generation.current++; pause(); fileInput.current?.click(); };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const marker = ++generation.current;
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose a file under 1 MiB.');
      const text = await file.text(); if (marker !== generation.current) return;
      const next = replay(parseRunFile(text)); if (marker !== generation.current) return;
      pause(); clearSelections(); install(next); setConfig({ ...next.scenario.config }); setScreen(next.finalized ? 'results' : 'respond');
      setNotice({ text: `Run restored at ${next.minute} min. Paused.` });
    } catch (cause) { if (marker === generation.current) setError(cause instanceof Error ? cause.message : 'Unable to import.'); }
  };
  const requestEdit = () => { generation.current++; pause(); setConfirmation(compatibilityOnly?'expanded':'edit'); };
  const requestFinish = () => { generation.current++; pause(); setConfirmation('finish'); };
  const navigate = (target: Screen) => {
    generation.current++; pause();
    if (target === 'create' && state) { setConfirmation('edit'); return; }
    if (target === 'respond' && state && !state.finalized) setScreen('respond');
    if (target === 'results' && state?.finalized) setScreen('results');
  };

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark"><ShieldCheck /></span><strong>Response Simulator</strong></div>
      <nav aria-label="Main navigation">{([{ id: 'create', label: 'Conditions', Icon: ClipboardList }, { id: 'respond', label: 'Simulation', Icon: Map }, { id: 'results', label: 'Results', Icon: BarChart3 }] as const).filter(item=>!compatibilityOnly||item.id!=='create').map(({ id, label, Icon }) => <button key={id} onClick={() => navigate(id)} aria-current={screen === id ? 'page' : undefined} disabled={id === 'respond' ? !state || state.finalized : id === 'results' ? !state?.finalized : false}><Icon />{label}</button>)}</nav>
      <span className="training-label">{compatibilityOnly?'Imported earlier run':'Fictional training'}</span>
      {onExpanded&&<Button variant="ghost" onClick={()=>{pause();if(state)setConfirmation('expanded');else onExpanded();}}>Dallas simulation</Button>}
    </header>
    <main className={`main-content screen-${screen}`}>
      {error && screen !== 'create' && <div className="global-error" role="alert"><span>{error}</span><Button variant="ghost" onClick={() => setError(null)}>Dismiss</Button></div>}
      {screen === 'create' && <Creator config={config} artifact={artifact} loadingResidents={!artifactReady[config.template]} loadingDefaultResidents={!artifactReady['storm-dallas-v1']} error={error} onChange={setConfig} onStart={start} onDefault={() => { setConfig({ ...DALLAS_DEFAULT_CONFIG }); setError(null); }} onImport={importClick} />}
      {screen === 'respond' && view && <Simulation key={view.runId} view={view} selected={selected} artifact={state!.scenario.artifact}
        running={running} speed={speed} notice={coordinationIssue ? { text: coordinationIssue } : notice} onSelect={select}
        onToggle={() => runningRef.current ? pause() : run()} onStep={() => { pause(); step(); }} onSpeed={setSpeed} onPause={pause}
        onExport={exportCurrent} onImport={importClick} onRestart={restart} onFinish={requestFinish} onEdit={requestEdit} />}
      {screen === 'results' && state?.finalized && <Results key={state.runId} state={state} onExport={exportCurrent} onReplay={replayCurrent} onRestart={restart} onEdit={requestEdit} />}
    </main>
    {confirmation && <SecondaryPanel title={confirmation === 'expanded' ? 'Open Dallas simulation?' : confirmation === 'edit' ? 'New exercise' : 'Finish exercise'} variant="confirmation" fallbackFocusId="observation-panel-exercise" onClose={() => setConfirmation(null)}>
      <p>{confirmation === 'expanded' ? 'Leave this run? Export first to keep your progress.' : confirmation === 'edit' ? 'Discard this run and return to setup?' : 'Complete the automatic simulation to minute 60?'}</p>
      <div className="confirmation-actions"><Button variant="outline" onClick={() => setConfirmation(null)}>Cancel</Button><Button onClick={confirmation === 'expanded' ? onExpanded : confirmation === 'edit' ? edit : finish}>{confirmation === 'expanded' ? 'Open Dallas simulation' : confirmation === 'edit' ? 'Start over' : 'Finish now'}</Button></div>
    </SecondaryPanel>}
    <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Choose saved run file" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void importFile(file); }} />
  </div>;
}
