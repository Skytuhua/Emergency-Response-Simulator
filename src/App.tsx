import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ClipboardList, Map, ShieldCheck } from 'lucide-react';
import { Button } from './components/ui/button';
import type { AgentArtifact, CommandIntent, ScenarioConfig, SimState } from './model';
import { HORIZON } from './model';
import { createScenario, DALLAS_DEFAULT_CONFIG } from './scenario';
import { initialize, advanceMinute, dispatch } from './sim/engine';
import { observe } from './sim/observe';
import { validateArtifact } from './artifact';
import { downloadRun, makeRunFile, parseRunFile, replay } from './run-file';
import { Creator } from './ui/Creator';
import { Response } from './ui/Response';
import { Results } from './ui/Results';
import { SecondaryPanel } from './ui/SecondaryPanel';
import { newlyDiscoveredUrgency } from './ui/controller';

type Screen = 'create' | 'respond' | 'results';
type Notice = { text: string; urgentId?: string } | null;
const freshRunId = () => crypto.randomUUID();

export default function App() {
  const [screen, setScreen] = useState<Screen>('create');
  const [config, setConfig] = useState<ScenarioConfig>({ ...DALLAS_DEFAULT_CONFIG });
  const [artifacts, setArtifacts] = useState<Record<ScenarioConfig['template'], AgentArtifact | null>>({ 'storm-v1':null, 'storm-dallas-v1':null });
  const artifact = artifacts[config.template];
  const [state, setState] = useState<SimState | null>(null);
  const stateRef = useRef<SimState | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [unitId, setUnitId] = useState('');
  const [shelterId, setShelterId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmation, setConfirmation] = useState<'edit' | 'finish' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const view = useMemo(() => state ? observe(state) : null, [state]);
  const pause = () => { runningRef.current = false; setRunning(false); };
  const run = () => { if (!document.hidden && stateRef.current && !stateRef.current.finalized) { runningRef.current = true; setRunning(true); } };
  const install = (next: SimState) => { stateRef.current = next; setState(next); };
  const clearSelections = () => { setSelected(null); setUnitId(''); setShelterId(''); setNotice(null); setConfirmation(null); setError(null); };

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
        }).catch(() => {});
    }
    return () => controller.abort();
  }, []);

  const step = () => {
    const current = stateRef.current;
    if (!current || current.finalized) return;
    const next = advanceMinute(current);
    const urgentId = newlyDiscoveredUrgency(observe(current), observe(next));
    install(next);
    if (urgentId) { pause(); setNotice({ text: `Urgent need at ${urgentId}. Paused.`, urgentId }); }
    if (next.finalized) { pause(); generation.current++; setScreen('results'); setSelected(null); setNotice(null); }
  };

  useEffect(() => {
    if (!running || screen !== 'respond') return;
    let lastTime = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      if (now - lastTime > 2000 / speed * 1.8) { runningRef.current = false; setRunning(false); setNotice({ text: 'Playback paused. Press Run to continue.' }); lastTime = now; return; }
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
      const next = initialize(createScenario(chosen, artifacts[chosen.template]), freshRunId());
      if (override) setConfig({ ...override });
      generation.current++; pause(); clearSelections(); install(next); setScreen('respond');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the exercise settings.'); }
  };
  const select = (id: string | null) => {
    pause(); if (id !== selected) { setUnitId(''); setShelterId(''); } setSelected(id); if (id) setNotice(null);
  };
  const command = (intent: CommandIntent) => {
    const current = stateRef.current; if (!current) return;
    pause();
    if (current.commands.length >= 500) { setNotice({ text: 'Command limit reached. Export or start again.' }); return; }
    const sequence = (current.commands.at(-1)?.command.sequence ?? 0) + 1;
    const outcome = dispatch(current, { ...intent, runId: current.runId, commandId: freshRunId(), sequence, minute: current.minute });
    install(outcome.state);
    if (outcome.result.accepted) { setNotice(null); run(); }
    else setNotice({ text: outcome.result.reason });
  };
  const finish = () => {
    let current = stateRef.current; if (!current) return;
    pause(); generation.current++;
    while (!current.finalized && current.minute < HORIZON) current = advanceMinute(current);
    install(current); clearSelections(); setScreen('results');
  };
  const edit = () => {
    generation.current++; pause();
    if (stateRef.current) setConfig({ ...stateRef.current.scenario.config });
    stateRef.current = null; setState(null); clearSelections(); setScreen('create');
  };
  const restart = () => {
    const current = stateRef.current; if (!current) return;
    generation.current++; pause(); clearSelections(); install(initialize(structuredClone(current.scenario), freshRunId())); setScreen('respond');
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
  const requestEdit = () => { generation.current++; pause(); setConfirmation('edit'); };
  const requestFinish = () => { generation.current++; pause(); setConfirmation('finish'); };
  const navigate = (target: Screen) => {
    generation.current++; pause();
    if (target === 'create' && state) { setConfirmation('edit'); return; }
    if (target === 'respond' && state && !state.finalized) setScreen('respond');
    if (target === 'results' && state?.finalized) setScreen('results');
  };

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark"><ShieldCheck /></span><strong>Response Simulator</strong></div>
      <nav aria-label="Main navigation">{([{ id: 'create', label: 'Setup', Icon: ClipboardList }, { id: 'respond', label: 'Respond', Icon: Map }, { id: 'results', label: 'Results', Icon: BarChart3 }] as const).map(({ id, label, Icon }) => <button key={id} onClick={() => navigate(id)} aria-current={screen === id ? 'page' : undefined} disabled={id === 'respond' ? !state || state.finalized : id === 'results' ? !state?.finalized : false}><Icon />{label}</button>)}</nav>
      <span className="training-label">Fictional training</span>
    </header>
    <main className={`main-content screen-${screen}`}>
      {error && screen !== 'create' && <div className="global-error" role="alert"><span>{error}</span><Button variant="ghost" onClick={() => setError(null)}>Dismiss</Button></div>}
      {screen === 'create' && <Creator config={config} artifact={artifact} error={error} onChange={setConfig} onStart={start} onDefault={() => { setConfig({ ...DALLAS_DEFAULT_CONFIG }); setError(null); }} onImport={importClick} />}
      {screen === 'respond' && view && <Response view={view} selected={selected} unitId={unitId} shelterId={shelterId} artifact={state!.scenario.artifact}
        running={running} speed={speed} notice={notice} onSelect={select} onUnit={setUnitId} onShelter={setShelterId}
        onToggle={() => runningRef.current ? pause() : run()} onStep={() => { pause(); step(); }} onSpeed={setSpeed} onPause={pause} onDispatch={command}
        onExport={exportCurrent} onImport={importClick} onFinish={requestFinish} onEdit={requestEdit} onDismiss={() => setNotice(null)} />}
      {screen === 'results' && state?.finalized && <Results key={state.runId} state={state} onExport={exportCurrent} onReplay={replayCurrent} onRestart={restart} onEdit={requestEdit} />}
    </main>
    {confirmation && <SecondaryPanel title={confirmation === 'edit' ? 'New exercise' : 'Finish exercise'} variant="confirmation" fallbackFocusId="panel-exercise" onClose={() => setConfirmation(null)}>
      <p>{confirmation === 'edit' ? 'Discard this run and return to setup?' : 'Advance to minute 60 without more assignments?'}</p>
      <div className="confirmation-actions"><Button variant="outline" onClick={() => setConfirmation(null)}>Cancel</Button><Button onClick={confirmation === 'edit' ? edit : finish}>{confirmation === 'edit' ? 'Start over' : 'Finish now'}</Button></div>
    </SecondaryPanel>}
    <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Choose saved run file" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void importFile(file); }} />
  </div>;
}
