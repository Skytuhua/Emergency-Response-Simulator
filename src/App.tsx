import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Check, ClipboardList, CloudRain, FileUp, Map, RadioTower, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from './components/ui/button';
import type { AgentArtifact, CommandIntent, ScenarioConfig, SimState } from './model';
import { HORIZON } from './model';
import { createScenario, DEFAULT_CONFIG } from './scenario';
import { initialize, advanceMinute, dispatch } from './sim/engine';
import { observe } from './sim/observe';
import { validateArtifact } from './artifact';
import { downloadRun, makeRunFile, parseRunFile, replay } from './run-file';
import { Creator } from './ui/Creator';
import { Response } from './ui/Response';
import { Results } from './ui/Results';
import { newlyDiscoveredUrgency } from './ui/controller';

type Screen = 'create' | 'respond' | 'results';
type Notice = { text: string; urgentId?: string } | null;
const freshRunId = () => globalThis.crypto.randomUUID();

export default function App() {
  const [screen, setScreen] = useState<Screen>('create');
  const [config, setConfig] = useState<ScenarioConfig>({ ...DEFAULT_CONFIG });
  const [artifact, setArtifact] = useState<AgentArtifact | null>(null);
  const [state, setState] = useState<SimState | null>(null);
  const stateRef = useRef<SimState | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [unitId, setUnitId] = useState('C1');
  const [shelterId, setShelterId] = useState('A');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmation, setConfirmation] = useState<'edit' | 'finish' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const confirmationElement = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const view = useMemo(() => state ? observe(state) : null, [state]);

  const pause = () => { runningRef.current = false; setRunning(false); };
  const install = (next: SimState) => { stateRef.current = next; setState(next); };
  const clearSelections = () => { setSelected(null); setUnitId('C1'); setShelterId('A'); setNotice(null); setConfirmation(null); setError(null); };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const heading = document.querySelector<HTMLElement>('main h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }, [screen]);

  useEffect(() => {
    if (!confirmation) return;
    confirmationElement.current?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    confirmationElement.current?.focus({ preventScroll: true });
  }, [confirmation]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/mirofish-v1.json', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Prepared behavior not available'); return response.json(); })
      .then(json => setArtifact(validateArtifact(json)))
      .catch(() => { /* Offline rules remain available; provenance shows no verified artifact. */ });
    return () => controller.abort();
  }, []);

  const step = () => {
    const current = stateRef.current;
    if (!current || current.finalized) return;
    const next = advanceMinute(current);
    const urgentId = newlyDiscoveredUrgency(observe(current), observe(next));
    install(next);
    if (urgentId) {
      pause(); setNotice({ text: `New urgent need discovered at ${urgentId}. Exercise paused so you can respond.`, urgentId });
    }
    if (next.finalized) { pause(); generation.current++; setScreen('results'); setSelected(null); setNotice(null); }
  };

  useEffect(() => {
    if (!running || screen !== 'respond') return;
    let lastTime = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      // A delayed background/stalled tick must never become time catch-up.
      if (now - lastTime > 2000 / speed * 1.8) { runningRef.current = false; setRunning(false); setNotice({ text: 'Playback paused after a delayed tick. Resume when you are ready.' }); lastTime = now; return; }
      lastTime = now;
      if (runningRef.current && !document.hidden) step();
    }, 2000 / speed);
    return () => window.clearInterval(interval);
  }, [running, speed, screen]);

  useEffect(() => {
    const visibility = () => { if (document.hidden) { runningRef.current = false; setRunning(false); } };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSelected(null); setConfirmation(null); } };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('keydown', keyboard); };
  }, []);

  const start = () => {
    try {
      const next = initialize(createScenario(config, artifact), freshRunId());
      generation.current++; pause(); clearSelections(); install(next); setScreen('respond');
      setNotice({ text: 'Select an unassessed home, choose a unit, and send a welfare check. The exercise starts paused.' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The exercise conditions are invalid.'); }
  };
  const select = (id: string | null) => { pause(); setSelected(id); if (id) setNotice(null); };
  const command = (intent: CommandIntent) => {
    const current = stateRef.current;
    if (!current) return;
    pause();
    if (current.commands.length >= 500) { setNotice({ text: 'The 500-command limit has been reached. You can still advance, export, or reset this exercise.' }); return; }
    const sequence = (current.commands.at(-1)?.command.sequence ?? 0) + 1;
    const outcome = dispatch(current, { ...intent, runId: current.runId, commandId: freshRunId(), sequence, minute: current.minute });
    install(outcome.state);
    setNotice({ text: outcome.result.accepted ? `${intent.unitId} dispatched to ${intent.householdId}. Unit committed until completion.` : outcome.result.reason });
  };
  const finish = () => {
    let current = stateRef.current;
    if (!current) return;
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
    setNotice({ text: 'Same conditions restarted with a fresh clock and no previous assignments.' });
  };
  const replayCurrent = () => {
    const current = stateRef.current; if (!current) return;
    try {
      const next = replay(makeRunFile(current));
      generation.current++; pause(); clearSelections(); install(next); setScreen(next.finalized ? 'results' : 'respond');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The saved decisions could not be replayed.'); }
  };
  const exportCurrent = () => { const current = stateRef.current; if (current) { pause(); downloadRun(current); } };
  const importClick = () => { generation.current++; pause(); fileInput.current?.click(); };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const marker = ++generation.current;
    try {
      if (file.size > 1024 * 1024) throw new Error('Run files must be no larger than 1 MiB.');
      const text = await file.text();
      if (marker !== generation.current) return;
      const next = replay(parseRunFile(text));
      if (marker !== generation.current) return;
      pause(); clearSelections(); install(next); setConfig({ ...next.scenario.config }); setScreen(next.finalized ? 'results' : 'respond');
      setNotice({ text: `Saved decisions replayed to minute ${next.minute}. Playback is paused.` });
    } catch (cause) { if (marker === generation.current) setError(cause instanceof Error ? cause.message : 'The run file could not be imported.'); }
  };
  const navigate = (target: Screen) => {
    generation.current++; pause();
    if (target === 'create' && state) { setConfirmation('edit'); return; }
    if (target === 'respond' && state && !state.finalized) { setScreen('respond'); setConfirmation(null); }
    if (target === 'results' && state?.finalized) { setScreen('results'); setConfirmation(null); }
  };

  return <div className="app-shell"><header className="masthead"><div className="brand"><div className="brand-mark"><ShieldCheck size={23} strokeWidth={2.2} /></div><span className="brand-name">RESPONSE</span><span className="brand-divider" /><span className="brand-product">Catastrophe Response Simulator</span></div><div className="masthead-right"><span className="training-pill"><ShieldCheck size={12} /> TRAINING EXERCISE</span><span>Fictional Riverdale</span></div></header><nav className="main-nav" aria-label="Main navigation"><div className="nav-items"><button className={`nav-item ${screen === 'create' ? 'active' : ''}`} onClick={() => navigate('create')} aria-current={screen === 'create' ? 'page' : undefined}><ClipboardList size={18} /> Create</button><button className={`nav-item ${screen === 'respond' ? 'active' : ''}`} disabled={!state || state.finalized} onClick={() => navigate('respond')} aria-current={screen === 'respond' ? 'page' : undefined}><Map size={18} /> Respond</button><button className={`nav-item ${screen === 'results' ? 'active' : ''}`} disabled={!state?.finalized} onClick={() => navigate('results')} aria-current={screen === 'results' ? 'page' : undefined}><BarChart3 size={18} /> Results</button></div><div className="exercise-name"><CloudRain size={16} />Riverdale storm{state ? ` · seed ${state.scenario.config.seed}` : ' · new exercise'}{screen !== 'create' && <Button variant="ghost" size="icon-xs" onClick={importClick} aria-label="Import saved run"><FileUp size={13} /></Button>}</div></nav>
    <main className="main-content">
      {confirmation && <div ref={confirmationElement} tabIndex={-1} className="inline-confirm" role="alert"><TriangleAlert size={16} /><span>{confirmation === 'edit' ? 'Start over with new conditions? Export this run first if you want to keep it.' : `Advance to minute 60 with no further dispatch? Busy units will complete only if their schedule allows.`}</span><Button size="xs" onClick={confirmation === 'edit' ? edit : finish}>{confirmation === 'edit' ? 'Reset & edit conditions' : 'Finish exercise'}</Button><Button variant="ghost" size="xs" onClick={() => setConfirmation(null)}>Keep responding</Button></div>}
      {screen !== 'create' && error && <div className="alert-box error" role="alert"><TriangleAlert size={16} />{error}<button className="text-button" onClick={() => setError(null)} style={{ marginLeft: 'auto' }}>Dismiss</button></div>}
      {screen === 'create' && <Creator config={config} artifact={artifact} error={error} onChange={setConfig} onStart={start} onDefault={() => { setConfig({ ...DEFAULT_CONFIG }); setError(null); }} onImport={importClick} />}
      {screen === 'respond' && view && <Response view={view} selected={selected} unitId={unitId} shelterId={shelterId} running={running} speed={speed} notice={notice} onSelect={select} onUnit={id => { pause(); setUnitId(id); }} onShelter={setShelterId} onToggle={() => { const next = !runningRef.current; runningRef.current = next; setRunning(next); }} onStep={() => { pause(); step(); }} onSpeed={setSpeed} onDispatch={command} onExport={exportCurrent} onFinish={() => { pause(); setConfirmation('finish'); }} onDismiss={() => setNotice(null)} />}
      {screen === 'results' && state?.finalized && <Results key={state.runId} state={state} onExport={exportCurrent} onReplay={replayCurrent} onRestart={restart} onEdit={edit} />}
    </main><input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Choose saved run file" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void importFile(file); }} /></div>;
}
