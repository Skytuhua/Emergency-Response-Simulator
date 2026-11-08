import { ChevronDown, FileCheck2 } from 'lucide-react';
import type { AgentArtifact } from '../model';

export function integrationLabel(artifact: AgentArtifact | null): string {
  if (artifact?.generationOutcome === 'target') return 'Prepared MiroFish behavior';
  if (artifact?.generationOutcome === 'profiles-only') return 'MiroFish profiles · rule-based reporting';
  return 'Rule-based reporting · MiroFish unavailable';
}

export function Provenance({ artifact, debrief = false }: { artifact: AgentArtifact | null; debrief?: boolean }) {
  const verified = artifact?.profiles.filter(profile => profile.outcome === 'llm').length ?? 0;
  return <details className="panel provenance-drawer">
    <summary><FileCheck2 size={16} /> Behavior provenance <ChevronDown size={14} style={{ marginLeft: 'auto' }} /></summary>
    <div className="provenance-body">
      <p>{integrationLabel(artifact)}. {verified} verified model-generated profiles; {artifact?.candidates.length ?? 0} accepted autonomous requests.</p>
      {!artifact && <p>No verified MiroFish artifact is loaded. This exercise uses explicit deterministic reporting rules. The offline response engine remains fully usable.</p>}
      {artifact && <><dl><dt>Integration level</dt><dd>{artifact.generationOutcome}</dd><dt>Upstream revision</dt><dd>{artifact.sourceCommit}</dd><dt>Model</dt><dd>{artifact.model}</dd>{artifact.reasoningEffort && <><dt>Reasoning</dt><dd>{artifact.reasoningEffort} · {artifact.api} API</dd></>}<dt>Prepared social episode</dt><dd>{artifact.episode.rounds} round(s), {artifact.episode.activeAgents} active agents, {artifact.episode.autonomousActions} autonomous actions</dd><dt>Report timing</dt><dd>Accepted social request: minute 5. Rule-based representative request: minute 10. Outages can prevent delivery.</dd></dl>{artifact.provenance.map((entry, i) => <p key={i}><strong>{entry.label}:</strong> {entry.detail}</p>)}</>}
      {debrief && artifact && <details><summary>Generated speech and persona evidence</summary><p>Generated speech is preparation evidence. The live exercise renders canonical facts rather than treating prose as verified world state.</p>{artifact.profiles.map(profile => <div key={profile.householdId}><strong>{profile.householdId} · {profile.displayName} · {profile.outcome}</strong><pre>{profile.persona}</pre></div>)}{artifact.candidates.map(candidate => <div key={candidate.sourceActionId}><strong>{candidate.householdId} · autonomous action {candidate.sourceActionId}</strong><pre>{candidate.sourceText}</pre></div>)}</details>}
    </div>
  </details>;
}
