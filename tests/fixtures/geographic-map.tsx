import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TownMap } from '../../src/ui/TownMap';
import { createScenario, DALLAS_DEFAULT_CONFIG } from '../../src/scenario';
import { advanceMinute, dispatch, initialize } from '../../src/sim/engine';
import { observe } from '../../src/sim/observe';
import '../../src/styles.css';

function Fixture() {
  const [state, setState] = useState(() => initialize(createScenario(DALLAS_DEFAULT_CONFIG), 'fixture-1'));
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState(true), [narrow, setNarrow] = useState(false), [keys, setKeys] = useState(0);
  const view = observe(state);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') setKeys(value => value + 1); };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => { Object.assign(window, { mapFixtureView: view }); }, [view]);
  return <main style={{ height: '100dvh', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', padding: 12, gap: 8 }}>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <button onClick={() => setState(advanceMinute)}>Advance minute</button>
      <button onClick={() => setState(previous => dispatch(previous, { runId: previous.runId, commandId: `mission-${previous.minute}`, sequence: previous.commands.length + 1, minute: previous.minute, action: 'ASSESS', unitId: 'C1', householdId: 'H19' }).state)}>Dispatch H19</button>
      <button onClick={() => setState(previous => ({ ...previous, scenario: structuredClone(previous.scenario) }))}>Clone map snapshot</button>
      <button onClick={() => { setState(initialize(createScenario(DALLAS_DEFAULT_CONFIG), `fixture-${Date.now()}`)); setSelected(null); }}>New scenario</button>
      <button onClick={() => setState(previous => ({ ...previous, scenario: { ...previous.scenario, config: { ...previous.scenario.config, networkGap: 'none' } } }))}>Clear outage</button>
      <button onClick={() => setNarrow(value => !value)}>Resize layout</button>
      <button onClick={() => setShown(value => !value)}>Toggle map</button>
      <output aria-label="Selection">{selected ?? 'none'}</output><output aria-label="Global escape count">{keys}</output><output aria-label="Minute">{view.minute}</output>
    </div>
    <div className="map-panel" style={{ width: narrow ? '70%' : '100%', minHeight: 0 }}>{shown && <TownMap view={view} selected={selected} onSelect={setSelected} />}</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
