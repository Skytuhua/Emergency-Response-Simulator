import { Brain, Check, FileCheck2, MessageSquareText, Radio, RadioTower, Truck, UserRound } from 'lucide-react';
import evidence from '../content/persona-evidence-dallas-v1.json';
import approved from '../../fixtures/mirofish-dallas-approved-v1.json';
import type { AgentArtifact, ObservationView, ObservedHousehold } from '../model';
import './persona-flow.css';

export interface PersonaFlowProps {
  view: ObservationView;
  artifact: AgentArtifact | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onInspect?: (id: string) => void;
}

type EvidenceRecord = typeof evidence.records[number];
type Stage = { title: string; detail: string; state: 'done' | 'waiting' | 'blocked'; eventId?: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** The structured enrichment belongs only to the exact approved source texts. */
function linkedArtifact(artifact: AgentArtifact | null): artifact is AgentArtifact {
  if (!artifact || artifact.generationOutcome !== 'target'
    || Object.entries(evidence.artifact).some(([key, value]) => artifact[key as keyof AgentArtifact] !== value)) return false;
  return canonical(artifact.profiles) === canonical(approved.profiles)
    && canonical(artifact.candidates) === canonical(approved.candidates)
    && canonical(artifact.actorContexts) === canonical(approved.actorContexts);
}

function excerpt(text: string, limit = 90): string {
  const speech = text.split('\n\n')[0];
  if (speech.length <= limit) return speech;
  const end = speech.lastIndexOf(' ', limit);
  return speech.slice(0, end > 0 ? end : limit) + '…';
}

function receiptStage(view: ObservationView, home: ObservedHousehold, attemptMinute: number): Stage {
  const receipt = view.events.find(event => event.type === 'request' && event.householdId === home.id
    && event.minute === attemptMinute && event.message.includes('prepared MiroFish request'));
  const knowledge = !home.known ? 'Coordinator need unknown'
    : home.known.source === 'assessment' ? `Known by radio assessment · m${home.known.receivedAt}`
      : `Coordinator facts known · m${home.known.receivedAt}`;
  if (receipt) return { title: `Request received · m${receipt.minute}`, detail: knowledge, state: 'done', eventId: receipt.id };
  if (view.minute < attemptMinute) return { title: 'Request not attempted yet', detail: knowledge, state: 'waiting' };
  if (home.completedAt !== null && home.completedAt <= attemptMinute) {
    return { title: 'No request receipt · already assisted', detail: `Assistance preceded the m${attemptMinute} report`, state: 'waiting' };
  }
  if (!home.communications) return { title: 'Cannot call · network gap', detail: knowledge, state: 'blocked' };
  return { title: 'No recorded request receipt', detail: knowledge, state: 'waiting' };
}

function responseStage(view: ObservationView, home: ObservedHousehold): Stage {
  const mission = view.missions.find(item => item.id === home.missionId);
  if (mission && mission.status !== 'completed') {
    const unit = view.units.find(item => item.id === mission.unitId);
    const action = mission.action === 'ASSESS' ? 'Checking home' : mission.action === 'DELIVER' ? 'Supply delivery' : 'Shelter transport';
    return { title: mission.action === 'ASSESS' ? 'Home check assigned' : 'Response assigned',
      detail: `${unit?.name || mission.unitId} · ${action}`, state: 'done', eventId: mission.id };
  }
  if (home.completedAt !== null) return { title: 'Response carried out', detail: 'See completed assistance below', state: 'done' };
  if (!home.known) return { title: 'Awaiting public information', detail: 'Unknown homes can receive a home check', state: 'waiting' };
  if (!home.known.need) return { title: 'No assistance need observed', detail: 'Public assessment recorded', state: 'done' };
  return { title: 'Awaiting coordination', detail: 'Known need awaits an available response', state: 'waiting' };
}

function SourceProof({ record, artifact, stages }: { record: EvidenceRecord; artifact: AgentArtifact; stages: Stage[] }) {
  const profile = artifact.profiles.find(item => item.householdId === record.householdId)!;
  const candidate = artifact.candidates.find(item => item.householdId === record.householdId)!;
  return <details className="persona-proof" id={`persona-${record.householdId}-full-source`}>
    <summary><FileCheck2 size={15} aria-hidden="true" /> Full source &amp; custody</summary>
    <div className="persona-proof-body">
      <p>Prepared synthetic output. These illustrative attributes do not establish why the model chose its post. Coordinator facts come from public receipts or assessment.</p>
      <h4>Observed flow details</h4>
      <ol className="persona-proof-stages">{stages.map((stage, index) => <li key={index}>
        <strong>Stage {index + 1}: {stage.title}</strong><span>{stage.detail}</span>
        {stage.eventId && <span>Record {stage.eventId}</span>}
      </li>)}</ol>
      <dl>
        <dt>Model / effort</dt><dd>{artifact.model} / {artifact.reasoningEffort}</dd>
        <dt>Manifest / input SHA-256</dt><dd>{evidence.manifestHash}</dd>
        <dt>Approved artifact SHA-256</dt><dd>{evidence.artifactSha256}</dd>
        <dt>Profile response SHA-256</dt><dd>{record.profileResponseSha256}</dd>
        <dt>Profile text SHA-256</dt><dd>{record.personaSha256}</dd>
        <dt>Post response SHA-256</dt><dd>{record.postResponseSha256}</dd>
        <dt>Platform trace SHA-256</dt><dd>{evidence.traceSha256}</dd>
        <dt>Profile export SHA-256</dt><dd>{evidence.profilesEvidenceSha256}</dd>
        <dt>Source action</dt><dd>{record.sourceActionId}</dd>
        <dt>Request text SHA-256</dt><dd>{record.requestSha256}</dd>
      </dl>
      <h4>Actual returned fields</h4>
      <pre>{JSON.stringify(record.fields, null, 2)}</pre>
      <h4>Actual generated persona</h4>
      <pre>{profile.persona}</pre>
      <h4>Actual stored request</h4>
      <pre>{candidate.sourceText}</pre>
      <p>First autonomous round maps to playback minute {candidate.attemptMinute}. A communications gap can prevent its receipt; an earlier assessment can independently establish public facts. Only completed assistance counts as assistance.</p>
    </div>
  </details>;
}

function Fallback({ artifact }: { artifact: AgentArtifact | null }) {
  const label = !artifact ? 'Rule-based reporting'
    : artifact.generationOutcome === 'blocked' ? 'Preparation unavailable · rule-based reporting'
      : artifact.generationOutcome === 'profiles-only' ? 'Profiles prepared · rule-based reporting'
        : 'Prepared source not linked to Dallas evidence';
  const profiles = artifact?.profiles.filter(profile => profile.outcome === 'llm').length ?? 0;
  return <section className="persona-flow persona-flow-fallback" aria-label="Resident source flow">
    <div className="persona-flow-heading"><UserRound size={18} aria-hidden="true" /><h2>Resident source flow</h2></div>
    <p className="persona-prepared-label">{label}</p>
    <p>{profiles} model-generated profiles in the loaded artifact.</p>
    <p>{artifact?.generationOutcome === 'profiles-only' ? 'No accepted autonomous requests. Reporting follows simulation rules.'
      : 'The approved Dallas attribute evidence is not linked to this run. Public observations and response progress remain available on the map.'}</p>
  </section>;
}

export function PersonaFlow({ view, artifact, selected, onSelect, onInspect }: PersonaFlowProps) {
  if (!linkedArtifact(artifact)) return <Fallback artifact={artifact} />;
  const records = evidence.records.filter(record => view.households.some(home => home.id === record.householdId));
  const record = records.find(item => item.householdId === selected) || records[0];
  if (!record) return <Fallback artifact={artifact} />;
  const home = view.households.find(item => item.id === record.householdId)!;
  const candidate = artifact.candidates.find(item => item.householdId === record.householdId)!;
  const receipt = receiptStage(view, home, candidate.attemptMinute);
  const response = responseStage(view, home);
  const completion: Stage = home.completedAt !== null
    ? { title: `Assistance complete · m${home.completedAt}`, detail: 'Observed delivery or shelter arrival', state: 'done',
      eventId: view.events.find(event => event.householdId === home.id && event.type === 'completion')?.id }
    : { title: home.missionId ? 'Assistance pending' : 'No completed assistance', detail: 'Assignment and assessment do not count', state: 'waiting' };
  const stages = [
    { title: 'Persona prepared', detail: 'Verified model output JSON', state: 'done' as const, Icon: Brain },
    { title: 'Stored request', detail: `Resident source · playback attempt m${candidate.attemptMinute}`, state: 'done' as const, Icon: MessageSquareText },
    { ...receipt, Icon: receipt.state === 'blocked' ? RadioTower : Radio },
    { ...response, Icon: Truck },
    { ...completion, Icon: Check },
  ];
  return <section className="persona-flow" aria-label="Resident source flow">
    <header className="persona-flow-header">
      <div className="persona-flow-heading persona-prepared-heading"><Brain size={18} aria-hidden="true" /><h2>Prepared Terra · playback</h2></div>
      <p className="persona-population" aria-label={`3 generated representatives · ${view.households.length} synthetic homes`}>3 AI reps · {view.households.length} synthetic homes</p>
    </header>
    <ul className="persona-residents" aria-label="Generated synthetic representatives">
      {records.map(item => <li key={item.householdId}>
        <button type="button" className="persona-resident" aria-label={`Select ${item.householdId} generated representative`}
          aria-describedby={`persona-${item.householdId}-profession`}
          aria-pressed={item.householdId === record.householdId} onClick={() => onSelect(item.householdId)}>
          <strong>{item.householdId}</strong>
          <span className="persona-profession" id={`persona-${item.householdId}-profession`}>{item.fields.profession}</span>
        </button>
      </li>)}
    </ul>
    <section className="persona-pipeline" aria-label={`${home.id} source and response flow`}>
      <div className="persona-pipeline-heading">
        <h3>{home.id}</h3>
        <div className="persona-attributes" aria-label="Selected representative attributes"><span><UserRound size={14} aria-hidden="true" />{record.fields.age} years</span><span><Brain size={14} aria-hidden="true" />{record.fields.mbti}</span></div>
        {onInspect && <button type="button" onClick={() => onInspect(home.id)} aria-label={`Inspect ${home.id}`}>Inspect</button>}
      </div>
      <ol className="persona-stages" aria-label="Source and observed response stages">
        {stages.map((stage, index) => <li key={index} className={`persona-stage persona-stage-${stage.state}`}>
          {index === 2 && <span className="persona-knowledge-boundary">{home.known ? 'Coordinator public knowledge' : 'Coordinator need unknown'}</span>}
          <span className="persona-stage-icon"><stage.Icon size={16} aria-hidden="true" /></span>
          <h4>{stage.title}</h4>
          {index === 1 && <blockquote cite={`#persona-${home.id}-full-source`}>“{excerpt(candidate.sourceText)}”</blockquote>}
        </li>)}
      </ol>
    </section>
    <SourceProof record={record} artifact={artifact} stages={stages} />
  </section>;
}
