import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, CloudRain, FileUp, House, RotateCcw, TriangleAlert, Truck, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import type { AgentArtifact, ScenarioConfig } from '../model';
import { createScenario, DEFAULT_CONFIG } from '../scenario';
import { initialize } from '../sim/engine';
import { observe } from '../sim/observe';
import { TownMap } from './TownMap';
import { integrationLabel } from './Provenance';

interface CreatorProps {
  config: ScenarioConfig; artifact: AgentArtifact | null; error: string | null;
  onChange: (config: ScenarioConfig) => void; onStart: () => void; onDefault: () => void; onImport: () => void;
}
type FieldErrors = Partial<Record<keyof ScenarioConfig, string>>;
const steps = ['Conditions', 'Resources', 'Review'] as const;
const numericLimits = { seed: [0, 4294967295], additionalNeeds: [0, 9], vans: [1, 2], kits: [0, 6], shelterA: [0, 8], shelterB: [0, 8] } as const;
const conditionFields: (keyof ScenarioConfig)[] = ['networkGap', 'roadPreset', 'additionalNeeds', 'seed'];
const resourceFields: (keyof ScenarioConfig)[] = ['vans', 'kits', 'shelterA', 'shelterB'];
const outageLabels: Record<ScenarioConfig['networkGap'], string> = { none: 'No outage', northwest: 'Northwest', northeast: 'Northeast', southwest: 'Southwest', southeast: 'Southeast' };

function validate(config: ScenarioConfig, fields: (keyof ScenarioConfig)[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const key of fields) {
    if (key in numericLimits) {
      const [min, max] = numericLimits[key as keyof typeof numericLimits];
      const value = config[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) errors[key] = `Enter a whole number from ${min} to ${max}.`;
    }
    if (key === 'networkGap' && !Object.hasOwn(outageLabels, config.networkGap)) errors.networkGap = 'Choose a neighborhood or no outage.';
    if (key === 'roadPreset' && !['open', 'detour'].includes(config.roadPreset)) errors.roadPreset = 'Choose open roads or one detour.';
  }
  return errors;
}

export function Creator({ config, artifact, error, onChange, onStart, onDefault, onImport }: CreatorProps) {
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const focusErrors = useRef(false);
  const preview = useMemo(() => { try { return observe(initialize(createScenario(config, artifact), 'preview')); } catch { return null; } }, [config, artifact]);
  const isDefault = Object.keys(DEFAULT_CONFIG).every(key => config[key as keyof ScenarioConfig] === DEFAULT_CONFIG[key as keyof ScenarioConfig]);

  useEffect(() => {
    if (previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [step]);
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
    else onStart();
  };
  const fieldError = (key: keyof ScenarioConfig) => errors[key] ? <p id={`config-${key}-error`} className="field-error" role="alert">{errors[key]}</p> : null;
  const numberField = (key: 'seed' | 'additionalNeeds' | 'kits' | 'shelterA' | 'shelterB', label: string, hint?: string) => <div className="field">
    <label htmlFor={`config-${key}`}>{label}</label>
    <input id={`config-${key}`} type="number" min={numericLimits[key][0]} max={numericLimits[key][1]} step={1} value={Number.isNaN(config[key]) ? '' : config[key]} aria-invalid={errors[key] ? true : undefined} aria-describedby={errors[key] ? `config-${key}-error` : hint ? `config-${key}-hint` : undefined} onChange={e => change(key, e.target.value === '' ? Number.NaN : Number(e.target.value))} />
    {fieldError(key)}{hint && <small id={`config-${key}-hint`}>{hint}</small>}
  </div>;

  return <div className="wizard-screen">
    <div className="workspace-toolbar"><h1>Set up exercise</h1><div className="toolbar-actions"><Button type="button" variant="ghost" size="sm" onClick={() => { onDefault(); setErrors({}); }}><RotateCcw size={15} /> Reset defaults</Button><Button variant="outline" size="sm" onClick={onImport}><FileUp size={15} /> Open run</Button></div></div>
    <div className="wizard-layout">
      <form ref={form} className="panel wizard-panel" noValidate onSubmit={event => { event.preventDefault(); advance(); }}>
        <ol className="wizard-steps" aria-label="Setup progress">{steps.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span aria-hidden="true">{index < step ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>
        <div className="wizard-step-content">
          <h2 ref={heading} tabIndex={-1}>{steps[step]}</h2>
          {error && <div className="alert-box error" role="alert"><TriangleAlert size={16} />{error}</div>}
          {step === 0 && <>
            <div className="field"><label htmlFor="config-networkGap">Communications outage</label><select id="config-networkGap" value={config.networkGap} aria-invalid={errors.networkGap ? true : undefined} aria-describedby={errors.networkGap ? 'config-networkGap-error' : 'outage-hint'} onChange={e => change('networkGap', e.target.value as ScenarioConfig['networkGap'])}>{Object.entries(outageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{fieldError('networkGap')}<small id="outage-hint">Homes in an outage cannot send requests. Teams keep radio contact.</small></div>
            <div className="field-row"><div className="field"><label htmlFor="config-roadPreset">Road conditions</label><select id="config-roadPreset" value={config.roadPreset} aria-invalid={errors.roadPreset ? true : undefined} aria-describedby={errors.roadPreset ? 'config-roadPreset-error' : undefined} onChange={e => change('roadPreset', e.target.value as ScenarioConfig['roadPreset'])}><option value="open">Open roads</option><option value="detour">One detour</option></select>{fieldError('roadPreset')}</div>{numberField('additionalNeeds', 'Additional needs')}</div>
            <details className="simulation-disclosure" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>Advanced <ChevronDown size={15} /></summary>{numberField('seed', 'Scenario seed')}</details>
          </>}
          {step === 1 && <>
            <div className="field-row"><div className="field"><label htmlFor="config-vans">Transport vans</label><select id="config-vans" value={config.vans} aria-invalid={errors.vans ? true : undefined} aria-describedby={errors.vans ? 'config-vans-error' : 'vans-hint'} onChange={e => change('vans', Number(e.target.value))}><option value={1}>1 accessible van</option><option value={2}>2 vans, 1 accessible</option></select>{fieldError('vans')}<small id="vans-hint">One response crew is always included.</small></div>{numberField('kits', 'Supply kits')}</div>
            <div className="field-row">{numberField('shelterA', 'East shelter places', 'Accessible and powered')}{numberField('shelterB', 'West shelter places', 'General and powered')}</div>
            {(config.kits === 0 || config.shelterA + config.shelterB < 5 || config.shelterA < 2) && <div className="alert-box"><TriangleAlert size={16} />Limited resources may leave needs unmet.</div>}
          </>}
          {step === 2 && <>
            <dl className="review-list"><div><dt>Outage</dt><dd>{outageLabels[config.networkGap]}</dd></div><div><dt>Roads</dt><dd>{config.roadPreset === 'open' ? 'Open roads' : 'One detour'}</dd></div><div><dt>Additional needs</dt><dd>{config.additionalNeeds}</dd></div><div><dt>Response teams</dt><dd>1 crew · {config.vans} van{config.vans === 1 ? '' : 's'}</dd></div><div><dt>Supply kits</dt><dd>{config.kits}</dd></div><div><dt>Shelter places</dt><dd>East {config.shelterA} · West {config.shelterB}</dd></div></dl>
            <div className="review-start"><Badge variant="secondary">Starts paused</Badge><span>60-minute exercise</span></div>
            <details className="simulation-disclosure"><summary>Simulation details <ChevronDown size={15} /></summary><div><p>Fictional Riverdale · seed {config.seed}. Travel and service times are exercise assumptions.</p><p>{integrationLabel(artifact)}. Prepared requests are reused; no model runs during the exercise.</p><p>{isDefault ? 'Default completion verified by a scripted response.' : 'Custom conditions: completion feasibility unverified.'}</p></div></details>
          </>}
        </div>
        <footer className="wizard-footer"><span>Step {step + 1} of 3</span><div>{step > 0 && <Button type="button" variant="outline" onClick={() => { setErrors({}); setStep(step - 1); }}><ArrowLeft size={15} /> Back</Button>}<Button type="submit">{step === 2 ? 'Start exercise' : 'Continue'}<ArrowRight size={15} /></Button></div></footer>
      </form>
      <aside className="panel wizard-preview" aria-label="Exercise preview"><div className="panel-heading"><div className="preview-title"><CloudRain size={20} /><h2>Riverdale storm</h2></div><Badge variant="secondary">60 minutes</Badge></div><div className="wizard-map">{preview ? <TownMap view={preview} /> : <div className="empty-inspector"><p>Enter valid conditions to preview the town.</p></div>}</div><div className="preview-summary"><div><House size={21} /><div><strong>24 homes</strong><span>Four neighborhoods</span></div></div><div><Truck size={21} /><div><strong>{config.vans + 1} teams</strong><span>1 crew · {config.vans} van{config.vans === 1 ? '' : 's'}</span></div></div><div><Users size={21} /><div><strong>{Number.isFinite(config.shelterA + config.shelterB) ? config.shelterA + config.shelterB : '—'} places</strong><span>Two powered shelters</span></div></div></div></aside>
    </div>
  </div>;
}
