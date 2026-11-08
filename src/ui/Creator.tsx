import { useMemo } from 'react';
import { ArrowRight, ChevronDown, CloudRain, FileUp, House, Info, Package, RadioTower, RotateCcw, ShieldCheck, Timer, TriangleAlert, Truck, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import type { AgentArtifact, ScenarioConfig } from '../model';
import { createScenario, DEFAULT_CONFIG } from '../scenario';
import { initialize } from '../sim/engine';
import { observe } from '../sim/observe';
import { TownMap } from './TownMap';
import { integrationLabel, Provenance } from './Provenance';

interface CreatorProps {
  config: ScenarioConfig; artifact: AgentArtifact | null; error: string | null;
  onChange: (config: ScenarioConfig) => void; onStart: () => void; onDefault: () => void; onImport: () => void;
}
export function Creator({ config, artifact, error, onChange, onStart, onDefault, onImport }: CreatorProps) {
  const preview = useMemo(() => { try { return observe(initialize(createScenario(config, artifact), 'preview')); } catch { return null; } }, [config, artifact]);
  const change = <K extends keyof ScenarioConfig>(key: K, value: ScenarioConfig[K]) => onChange({ ...config, [key]: value });
  const isDefault = Object.keys(DEFAULT_CONFIG).every(key => config[key as keyof ScenarioConfig] === DEFAULT_CONFIG[key as keyof ScenarioConfig]);
  const numberField = (key: 'seed' | 'additionalNeeds' | 'kits' | 'shelterA' | 'shelterB', label: string, max: number, hint?: string) => <div className="field"><label htmlFor={`config-${key}`}>{label}</label><input id={`config-${key}`} type="number" min={0} max={max} step={1} value={Number.isNaN(config[key]) ? '' : config[key]} onChange={e => change(key, e.target.value === '' ? Number.NaN : Number(e.target.value))} />{hint && <small>{hint}</small>}</div>;
  return <>
    <div className="page-heading"><div><h1>Set up your response</h1><p>Build an exercise. Find the people who might otherwise be overlooked.</p></div><Button variant="outline" size="sm" onClick={onImport}><FileUp size={15} /> Import saved run</Button></div>
    <div className="creator-layout">
      <div className="creator-sidebar">
        <form className="panel creator-form" onSubmit={event => { event.preventDefault(); onStart(); }}>
          <h2>Exercise conditions</h2><p className="form-intro">A storm has disrupted Riverdale. You coordinate the response for the next 60 minutes.</p>
          {error && <div className="alert-box error" role="alert"><TriangleAlert size={16} />{error}</div>}
          <div className="field"><label htmlFor="incident">Incident</label><input id="incident" value="Severe storm & power outage" readOnly aria-describedby="incident-description" /><small id="incident-description">This exercise supports the storm-v1 incident family.</small></div>
          <div className="field-row">{numberField('seed', 'Scenario seed', 4294967295)}{numberField('additionalNeeds', 'Additional needs', 9)}</div>
          <div className="field"><label htmlFor="network-gap">Household communications</label><select id="network-gap" value={config.networkGap} onChange={e => change('networkGap', e.target.value as ScenarioConfig['networkGap'])}><option value="none">All neighborhoods connected</option><option value="northwest">Northwest network outage</option><option value="northeast">Northeast network outage</option><option value="southwest">Southwest network outage</option><option value="southeast">Southeast network outage</option></select><small>Households in an outage cannot send requests. Response teams retain reliable radios.</small></div>
          <div className="field"><label htmlFor="road-preset">Road conditions</label><select id="road-preset" value={config.roadPreset} onChange={e => change('roadPreset', e.target.value as ScenarioConfig['roadPreset'])}><option value="open">Open roads</option><option value="detour">One connected detour</option></select></div>
          <details className="resource-disclosure"><summary><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Truck size={16} /> Response resources</span><ChevronDown className="disclosure-chevron" size={15} /></summary><div className="field-row"><div className="field"><label htmlFor="config-vans">Transport vans</label><select id="config-vans" value={config.vans} onChange={e => change('vans', Number(e.target.value))}><option value={1}>1 accessible van</option><option value={2}>2 vans (1 accessible)</option></select></div>{numberField('kits', 'Supply kits', 6)}</div><div className="field-row">{numberField('shelterA', 'East shelter places', 8, 'Accessible & powered')}{numberField('shelterB', 'West shelter places', 8, 'General & powered')}</div></details>
          {(config.kits === 0 || config.shelterA + config.shelterB < 5 || config.shelterA < 2) && <div className="alert-box"><TriangleAlert size={16} />Your resources may leave some assistance needs unmet. Capacities will stay exactly as configured.</div>}
          <div className="creator-actions"><Button type="submit" size="lg" className="w-full">Create exercise <ArrowRight size={17} /></Button><Button type="button" variant="ghost" size="sm" onClick={onDefault}><RotateCcw size={14} /> Load default conditions</Button></div>
          <p className="creator-disclosure">This creates a new response exercise using your conditions. Prepared MiroFish requests are reused where available; other reporting follows simulation rules. {isDefault ? 'Default conditions: completion verified by scripted response.' : 'Custom conditions: completion feasibility unverified.'}</p>
        </form>
      </div>
      <div>
        <section className="panel preview-panel" aria-label="Exercise preview"><div className="panel-heading"><div className="preview-title"><div className="icon-container"><CloudRain size={21} /></div><div><h2>Riverdale storm response</h2><p>Fictional town · storm-v1</p></div></div><Badge variant="secondary">60-minute exercise</Badge></div><div className="preview-map">{preview ? <TownMap view={preview} /> : <div className="empty-inspector"><p>Enter valid conditions to see the town preview.</p></div>}</div><div className="preview-summary"><div><House size={24} /><div><strong>24 households</strong><span>Four neighborhoods</span></div></div><div><Truck size={25} /><div><strong>{config.vans + 1} response units</strong><span>One crew + {config.vans} van{config.vans > 1 ? 's' : ''}</span></div></div><div><Users size={24} /><div><strong>{config.shelterA + config.shelterB} shelter places</strong><span>Two powered facilities</span></div></div></div><div className="assumption-note"><Info size={16} /><span>Needs, outages, and road conditions are fixed at the start. Kits are preloaded. Travel and service times are exercise assumptions. No real-world emergency data is used.</span></div></section>
        <div className="provenance-note"><ShieldCheck size={20} /><div><strong>{integrationLabel(artifact)}</strong><p>The simulation works offline. Prepared behavior, when verified and compatible, informs incoming requests; your decisions determine the response.</p></div></div>
        <Provenance artifact={artifact} />
      </div>
    </div>
    <div className="bottom-note"><span><ShieldCheck size={12} /> Synthetic training exercise · No operational emergency dispatch</span><span><Timer size={12} /> Unsaved runs reset on reload. Export to keep your decisions.</span></div>
  </>;
}
