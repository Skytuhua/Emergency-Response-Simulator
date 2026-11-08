import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, CloudRain, FileUp, House, RotateCcw, TriangleAlert, Truck, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import type { AgentArtifact, ScenarioConfig } from '../model';
import { createScenario, DEFAULT_CONFIG, DALLAS_DEFAULT_CONFIG } from '../scenario';
import { initialize } from '../sim/engine';
import { observe } from '../sim/observe';
import { TownMap } from './TownMap';
import { integrationLabel } from './Provenance';

interface CreatorProps {
  config: ScenarioConfig; artifact: AgentArtifact | null; error: string | null; loadingResidents?: boolean; loadingDefaultResidents?: boolean;
  onChange: (config: ScenarioConfig) => void; onStart: (config?: ScenarioConfig) => void; onDefault: () => void; onImport: () => void;
}
type FieldErrors = Partial<Record<keyof ScenarioConfig, string>>;
const steps = ['Conditions', 'Resources', 'Review'] as const;
const numericLimits = { seed: [0, 4294967295], additionalNeeds: [0, 9], vans: [1, 2], kits: [0, 6], shelterA: [0, 8], shelterB: [0, 8] } as const;
const conditionFields: (keyof ScenarioConfig)[] = ['networkGap', 'roadPreset', 'additionalNeeds', 'seed'];
const resourceFields: (keyof ScenarioConfig)[] = ['vans', 'kits', 'shelterA', 'shelterB'];
const outageLabels: Record<ScenarioConfig['networkGap'], string> = { none: 'Working everywhere', northwest: 'Down in the northwest', northeast: 'Down in the northeast', southwest: 'Down in the southwest', southeast: 'Down in the southeast' };

function validate(config: ScenarioConfig, fields: (keyof ScenarioConfig)[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const key of fields) {
    if (key in numericLimits) {
      const [min, max] = numericLimits[key as keyof typeof numericLimits];
      const value = config[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) errors[key] = `Enter a whole number from ${min} to ${max}.`;
    }
    if (key === 'networkGap' && !Object.hasOwn(outageLabels, config.networkGap)) errors.networkGap = 'Choose where phones and internet are down, or working everywhere.';
    if (key === 'roadPreset' && !['open', 'detour'].includes(config.roadPreset)) errors.roadPreset = 'Choose all roads open or one road closed.';
  }
  return errors;
}

export function Creator({ config, artifact, error, loadingResidents = false, loadingDefaultResidents = loadingResidents, onChange, onStart, onDefault, onImport }: CreatorProps) {
  const [customizing, setCustomizing] = useState(false);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusErrors = useRef(false);
  const previewConfig = customizing ? config : DALLAS_DEFAULT_CONFIG;
  const preview = useMemo(() => { try { return observe(initialize(createScenario(previewConfig, artifact?.template === previewConfig.template ? artifact : null), 'preview')); } catch { return null; } }, [previewConfig, artifact]);
  const isDefault = config.template === 'storm-v1' && Object.keys(DEFAULT_CONFIG).every(key => config[key as keyof ScenarioConfig] === DEFAULT_CONFIG[key as keyof ScenarioConfig]);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step, customizing]);
  useEffect(() => {
    if (!focusErrors.current) return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    focusErrors.current = false;
  }, [errors, step]);

  const change = <K extends keyof ScenarioConfig>(key: K, value: ScenarioConfig[K]) => {
    const next = { ...config, [key]: value };
    onChange(next);
    if (errors[key]) setErrors(current => ({ ...current, [key]: validate(next, [key])[key] }));
  };
  const advance = () => {
    const nextErrors = validate(config, step === 0 ? conditionFields : step === 1 ? resourceFields : [...conditionFields, ...resourceFields]);
    focusErrors.current = Object.keys(nextErrors).length > 0;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      if (nextErrors.seed) setAdvancedOpen(true);
      if (step === 2) setStep(conditionFields.some(key => nextErrors[key]) ? 0 : 1);
      return;
    }
    if (step < 2) setStep(step + 1);
    else if (!loadingResidents) onStart();
  };
  const fieldError = (key: keyof ScenarioConfig) => errors[key] ? <p id={`config-${key}-error`} className="field-error" role="alert">{errors[key]}</p> : null;
  const numberField = (key: 'seed' | 'additionalNeeds' | 'kits' | 'shelterA' | 'shelterB', label: string, hint?: string) => <div className="field">
    <label htmlFor={`config-${key}`}>{label}</label>
    <input id={`config-${key}`} type="number" min={numericLimits[key][0]} max={numericLimits[key][1]} step={1} value={Number.isNaN(config[key]) ? '' : config[key]} aria-invalid={errors[key] ? true : undefined} aria-describedby={errors[key] ? `config-${key}-error` : hint ? `config-${key}-hint` : undefined} onChange={e => change(key, e.target.value === '' ? Number.NaN : Number(e.target.value))} />
    {fieldError(key)}{hint && <small id={`config-${key}-hint`}>{hint}</small>}
  </div>;

  return <div className="wizard-screen">
    <div className="workspace-toolbar"><h1>{customizing ? 'Simulation conditions' : 'Dallas storm simulation'}</h1><div className="toolbar-actions">{customizing && <Button type="button" variant="ghost" size="sm" onClick={() => { onDefault(); setErrors({}); }}><RotateCcw size={15} /> Reset defaults</Button>}<Button variant="outline" size="sm" onClick={onImport}><FileUp size={15} /> Open run</Button></div></div>
    <div className="wizard-layout">
      {!customizing ? <section className="panel welcome-panel" aria-labelledby="welcome-heading">
        <h2 id="welcome-heading" ref={heading} tabIndex={-1}>Observe a Dallas storm response.</h2>
        <p className="welcome-situation">Residents report needs. Teams respond automatically.</p>
        <p>Follow requests, coordination and assistance as they unfold.</p>
        <p className="welcome-consequence">Some homes cannot call. On-site checks reveal their needs.</p>
        {error && <div className="alert-box error" role="alert"><TriangleAlert size={16} />{error}</div>}
        <div className="welcome-actions"><Button type="button" disabled={loadingDefaultResidents} onClick={() => onStart({ ...DALLAS_DEFAULT_CONFIG })}>{loadingDefaultResidents ? 'Loading residents…' : 'Start simulation'}<ArrowRight size={15} /></Button><Button type="button" variant="outline" onClick={() => setCustomizing(true)}>Customize conditions</Button></div>
        <p className="welcome-context">Real Dallas streets · 24 fictional homes · Automatic response</p>
      </section> : <form ref={form} className="panel wizard-panel" noValidate onSubmit={event => { event.preventDefault(); advance(); }}>
        <ol className="wizard-steps" aria-label="Setup progress">{steps.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span aria-hidden="true">{index < step ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>
        <div className="wizard-step-content">
          <h2 ref={heading} tabIndex={-1}>{steps[step]}</h2>
          {error && <div className="alert-box error" role="alert"><TriangleAlert size={16} />{error}</div>}
          {step === 0 && <>
            <div className="field"><label htmlFor="config-networkGap">Where can’t people call for help?</label><select id="config-networkGap" value={config.networkGap} aria-invalid={errors.networkGap ? true : undefined} aria-describedby={errors.networkGap ? 'config-networkGap-error outage-hint' : 'outage-hint'} onChange={e => change('networkGap', e.target.value as ScenarioConfig['networkGap'])}>{Object.entries(outageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{fieldError('networkGap')}<small id="outage-hint">{config.networkGap === 'none' ? 'Every home can call for help.' : 'Homes there cannot call for help.'}</small></div>
            <div className="field-row"><div className="field"><label htmlFor="config-roadPreset">Roads available</label><select id="config-roadPreset" value={config.roadPreset} aria-invalid={errors.roadPreset ? true : undefined} aria-describedby={errors.roadPreset ? 'config-roadPreset-error roads-hint' : 'roads-hint'} onChange={e => change('roadPreset', e.target.value as ScenarioConfig['roadPreset'])}><option value="open">All roads open</option><option value="detour">One road closed</option></select>{fieldError('roadPreset')}<small id="roads-hint">{config.roadPreset === 'open' ? 'Teams can use every road.' : 'Teams must take another route.'}</small></div>{numberField('additionalNeeds', 'How many more households need help?', 'Added to the 3 homes in every exercise.')}</div>
            <details className="simulation-disclosure" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>Advanced <ChevronDown size={15} /></summary>{numberField('seed', 'Scenario seed', 'Use the same number to repeat this setup.')}</details>
          </>}
          {step === 1 && <>
            <div className="field-row"><div className="field"><label htmlFor="config-vans">Vans to take people to shelter</label><select id="config-vans" value={config.vans} aria-invalid={errors.vans ? true : undefined} aria-describedby={errors.vans ? 'config-vans-error vans-hint' : 'vans-hint'} onChange={e => change('vans', Number(e.target.value))}><option value={1}>1 van</option><option value={2}>2 vans</option></select>{fieldError('vans')}<small id="vans-hint">One has wheelchair access. A help crew is also included.</small></div>{numberField('kits', 'Supply kits', 'For delivering essentials to homes.')}</div>
            <div className="field-row">{numberField('shelterA', config.template === 'storm-dallas-v1' ? 'Shelter A places' : 'East shelter places', 'Power and wheelchair access.')}{numberField('shelterB', config.template === 'storm-dallas-v1' ? 'Shelter B places' : 'West shelter places', 'Power; no wheelchair access.')}</div>
            {(config.kits === 0 || config.shelterA + config.shelterB < 5 || config.shelterA < 2) && <div className="alert-box"><TriangleAlert size={16} />Some homes may go without help with these supplies and places.</div>}
          </>}
          {step === 2 && <>
            <dl className="review-list"><div><dt>Phones &amp; internet</dt><dd>{outageLabels[config.networkGap]}</dd></div><div><dt>Roads</dt><dd>{config.roadPreset === 'open' ? 'All roads open' : 'One road closed'}</dd></div><div><dt>Homes needing help</dt><dd>3 + {config.additionalNeeds} extra</dd></div><div><dt>Teams</dt><dd>1 crew · {config.vans} van{config.vans === 1 ? '' : 's'}</dd></div><div><dt>Supply kits</dt><dd>{config.kits}</dd></div><div><dt>Shelter places</dt><dd>{config.template === 'storm-dallas-v1' ? 'A' : 'East'} {config.shelterA} · {config.template === 'storm-dallas-v1' ? 'B' : 'West'} {config.shelterB}</dd></div></dl>
            <div className="review-start"><Badge variant="secondary">Automatic response</Badge><span>60-minute exercise</span></div>
            <details className="simulation-disclosure"><summary>Advanced <ChevronDown size={15} /></summary><div><p>{config.template === 'storm-dallas-v1' ? 'Dallas streets, fictional homes' : 'Fictional Riverdale'} · seed {config.seed}. Travel and service times are exercise assumptions.</p><p>{integrationLabel(artifact)}. Prepared requests are reused; no model runs during the exercise.</p><p>{isDefault ? 'Default completion verified by a scripted response.' : 'Custom conditions: completion feasibility unverified.'}</p></div></details>
          </>}
        </div>
        <footer className="wizard-footer"><span>Step {step + 1} of 3</span><div><Button type="button" variant="outline" onClick={() => { setErrors({}); if (step > 0) setStep(step - 1); else setCustomizing(false); }}><ArrowLeft size={15} /> Back</Button><Button type="submit" disabled={step === 2 && loadingResidents}>{step === 2 ? loadingResidents ? 'Loading residents…' : 'Start simulation' : 'Continue'}<ArrowRight size={15} /></Button></div></footer>
      </form>}
      <aside className="panel wizard-preview" aria-label="Exercise preview"><div className="panel-heading"><div className="preview-title"><CloudRain size={20} /><h2>{previewConfig.template === 'storm-dallas-v1' ? 'Dallas demo' : 'Riverdale storm'}</h2></div><Badge variant="secondary">60 minutes</Badge></div><div className="wizard-map">{preview ? <TownMap view={preview} /> : <div className="empty-inspector"><p>Enter valid conditions to preview the town.</p></div>}</div><div className="preview-summary"><div><House size={21} /><div><strong>24 homes</strong><span>Four neighborhoods</span></div></div><div><Truck size={21} /><div><strong>{previewConfig.vans + 1} teams</strong><span>1 crew · {previewConfig.vans} van{previewConfig.vans === 1 ? '' : 's'}</span></div></div><div><Users size={21} /><div><strong>{Number.isFinite(previewConfig.shelterA + previewConfig.shelterB) ? previewConfig.shelterA + previewConfig.shelterB : '—'} places</strong><span>Two powered shelters</span></div></div></div></aside>
    </div>
  </div>;
}
