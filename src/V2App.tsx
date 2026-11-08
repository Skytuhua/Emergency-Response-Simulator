import { useEffect,useMemo,useRef,useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { SimState } from './model';
import { parseRunFile,replay } from './run-file';
import { Button } from './components/ui/button';
import { ObserverV2,type ObserverEvidenceV2 } from './ui/v2/ObserverV2';
import { ResultsV2,type ComparisonV2 } from './ui/v2/ResultsV2';
import { SecondaryPanel } from './ui/SecondaryPanel';
import { householdSituationV2 } from './ui/v2/household-situation';
import { SetupV2,type SetupV2Settings } from './ui/v2/SetupV2';
import { SetupMapV2 } from './ui/v2/SetupMapV2';
import { defaultSetupV2,effectiveScenarioV2,validateSetupV2,withSetupV2 } from './v2/setup';
import { baseSnapDistanceMetersV2,initialClosedEdgeIdsV2,resolveBaseV2 } from './v2/setup-topology';
import { MAX_V2_BYTES,parseScenarioV2 } from './v2/admission';
import type { PolicyIdV2,ScenarioBundleV2 } from './v2/contracts';
import { advanceSessionV2,finishSessionV2,initializeSessionV2 } from './v2/coordinate';
import { observeSnapshot } from './v2/observe';
import { makeRunFileV2,parseRunFileV2,replayV2 } from './v2/run-file';
import type { SessionV2 } from './v2/session';
import { summarizeWorld } from './v2/summary';
import './v2-app.css';

type AppError = { message: string; detail: string };
function readableError(message: string, cause: unknown): AppError {
  return { message, detail: cause instanceof Error ? cause.message : String(cause) };
}
function initialHomeV2(session:SessionV2):string|null {
  const prepared=new Set(effectiveScenarioV2(session.world.bundle).behavior?.personas.map(persona=>persona.householdId)??[]);
  const active=session.world.needs.filter(need=>need.completedAtMs===null);
  return (active.find(need=>need.urgent&&prepared.has(need.householdId))??active.find(need=>prepared.has(need.householdId))??active.find(need=>need.urgent)??active[0])?.householdId
    ??session.world.households[0]?.id??null;
}

export function V2App({onLegacy}:{onLegacy:(state?:SimState)=>void}){
  const [session,setSession]=useState<SessionV2|null>(null),sessionRef=useRef<SessionV2|null>(null);
  const [playing,setPlaying]=useState(false),playingRef=useRef(false),[speed,setSpeed]=useState(1);
  const [selected,setSelected]=useState<string|null>(null),[error,setError]=useState<AppError|null>(null);
  const [busy,setBusy]=useState<string|null>('Loading Dallas…');
  const [confirmation,setConfirmation]=useState<'restart'|'finish'|'setup'|'import'|null>(null);
  const [verification,setVerification]=useState<string|null>(null);
  const [phase,setPhase]=useState<'setup'|'run'>('setup');
  const [sourceBundle,setSourceBundle]=useState<ScenarioBundleV2|null>(null),[setupDraft,setSetupDraft]=useState<SetupV2Settings|null>(null);
  const draftRef=useRef<SetupV2Settings|null>(null),[setupEntry,setSetupEntry]=useState<'welcome'|'customize'>('welcome');
  const [editMode,setEditMode]=useState<'base'|'roads'>('base'),[setupErrors,setSetupErrors]=useState<Record<string,string>>({});
  const [placingBase,setPlacingBase]=useState(false),baseGeneration=useRef(0);
  const [comparisons,setComparisons]=useState<ComparisonV2[]>([]),[comparing,setComparing]=useState(false);
  const [controlsTarget,setControlsTarget]=useState<HTMLDivElement|null>(null);
  const fileInput=useRef<HTMLInputElement>(null),generation=useRef(0),verificationGeneration=useRef(0),abort=useRef<AbortController|null>(null);
  const pause=()=>{playingRef.current=false;setPlaying(false);};
  const run=()=>{if(sessionRef.current&&!sessionRef.current.world.finalized&&!document.hidden){playingRef.current=true;setPlaying(true);}};
  const install=(next:SessionV2)=>{sessionRef.current=next;setSession(next);};
  const installDraft=(next:SetupV2Settings|null|((previous:SetupV2Settings|null)=>SetupV2Settings|null))=>{
    const value=typeof next==='function'?next(draftRef.current):next;draftRef.current=value;setSetupDraft(value);
  };
  const snapshot=useMemo(()=>session?observeSnapshot(session.world):null,[session]);
  const situation=useMemo(()=>session&&selected?householdSituationV2(session.world,selected):null,[session,selected]);
  const evidence=useMemo<ObserverEvidenceV2|undefined>(()=>{
    if(!session)return;
    const b=session.world.bundle,sources=new Map([...b.assets.population.sourceReceipts,...b.assets.geography.sourceReceipts,...(b.assets.behavior?.sourceReceipts??[])].map(s=>[s.id,s]));
    return {assumptions:b.assumptions,sources:[...sources.values()],fit:b.assets.population.fit,geography:b.assets.geography,decisions:session.decisions,roadChangesDisableActions:!!b.setup?.roads.length,scenarioChangesDisableActions:!!b.setup?.scenario&&b.setup.scenario!=='storm',scenarioName:b.setup?.scenario??'storm'};
  },[session]);
  const initialize=(bundle:ScenarioBundleV2,policy:PolicyIdV2='urgency-plus-coverage-v2')=>{
    const next=initializeSessionV2(bundle,policy);install(next);setComparisons([]);setError(null);setVerification(null);
    setSelected(initialHomeV2(next));return next;
  };
  useEffect(()=>{
    const controller=new AbortController(),marker=++generation.current;abort.current=controller;
    fetch('/data/dallas-v2-scenario.json',{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error(`Scenario download returned HTTP ${response.status}.`);
      const text=await response.text();if(marker!==generation.current)return;
      const bundle=parseScenarioV2(text);setSourceBundle(bundle);installDraft(structuredClone(bundle.setup??defaultSetupV2(bundle)));setBusy(null);
    }).catch(cause=>{if(!controller.signal.aborted&&marker===generation.current){setError(readableError('Dallas could not load. Reload to try again.',cause));setBusy(null);}});
    return()=>{generation.current++;baseGeneration.current++;controller.abort();abort.current?.abort();playingRef.current=false;};
  },[]);
  const step=()=>{
    const current=sessionRef.current;if(!current||current.world.finalized)return;
    try{const next=advanceSessionV2(current);install(next);if(next.world.finalized)pause();}catch(cause){pause();setError(readableError('The simulation paused because of an error.',cause));}
  };
  useEffect(()=>{
    if(!playing)return;
    const interval=window.setInterval(()=>{if(playingRef.current&&!document.hidden)step();},1000/speed);
    return()=>window.clearInterval(interval);
  },[playing,speed]);
  useEffect(()=>{
    const hidden=()=>{if(document.hidden)pause();};
    const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('dialog[open]'))pause();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('keydown',keyboard);
    return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('keydown',keyboard);};
  },[]);
  useEffect(()=>{
    if(phase!=='run'||!session?.world.finalized)return;
    let cancelled=false;const marker=generation.current,controller=new AbortController();setComparing(true);
    (async()=>{
      const rows:ComparisonV2[]=[];
      for(const policy of ['received-order-v2','urgency-first-v2','urgency-plus-coverage-v2'] as PolicyIdV2[]){
        if(cancelled||marker!==generation.current)return;
        if(policy===session.policy)rows.push({policy,summary:summarizeWorld(session.world)});
        else{const next=await finishSessionV2(initializeSessionV2(session.world.bundle,policy),undefined,controller.signal);if(cancelled||marker!==generation.current)return;rows.push({policy,summary:summarizeWorld(next.world)});}
      }
      if(!cancelled){setComparisons(rows);setComparing(false);}
    })().catch(cause=>{if(!cancelled&&marker===generation.current){setError(readableError('The comparison could not finish. Your results are still available.',cause));setComparing(false);}});
    return()=>{cancelled=true;controller.abort();};
  },[session?.world.finalized,session?.world.runId,phase]);
  const exportRun=()=>{
    const current=sessionRef.current;if(!current)return;pause();
    try{
      const data=JSON.stringify(makeRunFileV2(current)),blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`dallas-v2-${current.world.nowMs/60000}min.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(cause){setError(readableError('This run could not be saved. Try exporting it again.',cause));}
  };
  const importFile=async(file:File|undefined)=>{
    if(!file)return;pause();setVerification(null);const marker=++generation.current;abort.current?.abort();setBusy('Opening saved run…');setError(null);
    try{
      if(file.size>MAX_V2_BYTES)throw new Error('Choose a file smaller than 32 MiB.');
      const text=await file.text();if(marker!==generation.current)return;
      const kind=JSON.parse(text);
      if(kind.version===1){const legacy=replay(parseRunFile(text));if(marker===generation.current)onLegacy(legacy);return;}
      const restored=await replayV2(parseRunFileV2(text));if(marker!==generation.current)return;
      baseGeneration.current++;setPlacingBase(false);install(restored);setSelected(initialHomeV2(restored));setComparisons([]);setError(null);
      setSourceBundle(restored.world.bundle);installDraft(structuredClone(restored.world.bundle.setup??defaultSetupV2(restored.world.bundle)));setSetupErrors({});setPhase('run');
    }catch(cause){if(marker===generation.current)setError(readableError(file.size>MAX_V2_BYTES?'This file is too large. Choose a saved run smaller than 32 MiB.':"This file couldn't be opened. Choose a saved simulation run.",cause));}
    finally{if(marker===generation.current)setBusy(null);}
  };
  const restart=()=>{const current=sessionRef.current;if(!current)return;generation.current++;abort.current?.abort();setConfirmation(null);setBusy(null);initialize(current.world.bundle,current.policy);run();};
  const openSetup=()=>{
    const bundle=sessionRef.current?.world.bundle??sourceBundle;if(!bundle)return;
    pause();generation.current++;baseGeneration.current++;abort.current?.abort();setConfirmation(null);setBusy(null);setPlacingBase(false);
    setVerification(null);setSourceBundle(bundle);installDraft(structuredClone(bundle.setup??defaultSetupV2(bundle)));setSetupEntry('customize');setSetupErrors({});setError(null);setPhase('setup');
  };
  const startConfigured=(settings:SetupV2Settings)=>{
    if(!sourceBundle||placingBase)return;
    const issues=validateSetupV2(sourceBundle,settings);
    if(issues.length){setSetupErrors(Object.fromEntries(issues.map(message=>{const colon=message.indexOf(':');return colon<0?['setup',message]:[message.slice(0,colon),message.slice(colon+1).trim()];})));return;}
    try{
      pause();generation.current++;baseGeneration.current++;abort.current?.abort();
      initialize(withSetupV2(sourceBundle,settings));setSetupErrors({});setPhase('run');setBusy(null);run();
    }catch(cause){setSetupErrors({setup:'These settings could not start. Check the base, roads and resources.'});setError(readableError('The simulation could not start with these settings.',cause));}
  };
  const pickBase=async(point:{lat:number;lon:number},roads=draftRef.current?.roads,scenario=draftRef.current?.scenario)=>{
    if(!sourceBundle||!draftRef.current||!roads)return;
    const marker=++baseGeneration.current;setPlacingBase(true);setSetupErrors(previous=>{const next={...previous};delete next.base;return next;});
    try{
      const result=await resolveBaseV2(sourceBundle,point,roads,scenario);if(marker!==baseGeneration.current)return;
      if(result.ok)installDraft(previous=>previous?{...previous,base:result.base}:previous);
      else setSetupErrors(previous=>({...previous,base:result.message}));
    }catch(cause){if(marker===baseGeneration.current)setSetupErrors(previous=>({...previous,base:'This point could not be checked. Choose another street location.'}));}
    finally{if(marker===baseGeneration.current)setPlacingBase(false);}
  };
  const toggleRoad=(edgeId:string)=>{
    const current=draftRef.current;if(!sourceBundle||!current)return;
    baseGeneration.current++;setPlacingBase(false);
    const closed=new Set(initialClosedEdgeIdsV2(sourceBundle,current.roads,current.scenario));
    const roads=[...current.roads.filter(road=>road.edgeId!==edgeId),{edgeId,closed:!closed.has(edgeId)}].sort((a,b)=>a.edgeId<b.edgeId?-1:a.edgeId>b.edgeId?1:0);
    installDraft({...current,roads});setSetupErrors((previous):Record<string,string>=>previous.base?{base:previous.base}:{});
    if(current.base&&!setupErrors.base)void pickBase(current.base.requested,roads);
  };
  const baseLabel=useMemo(()=>{
    if(!sourceBundle||!setupDraft)return;
    const node=sourceBundle.assets.map.nodes.find(item=>item.id===(setupDraft.base?.nodeId??sourceBundle.resources.depotNodeId));
    if(!node||node.lat===undefined||node.lon===undefined)return;
    const road=sourceBundle.assets.map.edges.find(edge=>edge.from===node.id||edge.to===node.id)?.name;
    const distance=setupDraft.base?baseSnapDistanceMetersV2(setupDraft.base.requested,{lat:node.lat,lon:node.lon}):0;
    return `${road?`${road} / `:''}${node.lat.toFixed(6)}, ${node.lon.toFixed(6)}${setupDraft.base?` / ${Math.round(distance)} m to street`:''}`;
  },[sourceBundle,setupDraft?.base]);
  const finish=async()=>{
    const current=sessionRef.current;if(!current)return;pause();setConfirmation(null);const marker=++generation.current,controller=new AbortController();abort.current?.abort();abort.current=controller;setBusy('Running the remaining time…');setError(null);
    try{const next=await finishSessionV2(current,undefined,controller.signal);if(marker===generation.current)install(next);}
    catch(cause){if(marker===generation.current)setError(readableError('The simulation could not finish. Try again from this point.',cause));}
    finally{if(marker===generation.current)setBusy(null);}
  };
  const ask=(next:'restart'|'finish'|'setup'|'import')=>{pause();setConfirmation(next);};
  return <div className="app-shell v2-app-shell">
    <header className="app-header"><div className="brand" id="v2-app-title" tabIndex={-1}><span className="brand-mark"><ShieldCheck/></span><div><strong>Emergency Response Simulator</strong><span className="v2-header-population">{snapshot?`${{storm:'Storm',flood:'Flood',tornado:'Tornado'}[session?.world.bundle.setup?.scenario??'storm']} / Dallas · ${snapshot.population.persons.toLocaleString()} simulated residents`:sourceBundle?`Dallas · ${sourceBundle.assets.population.persons.length.toLocaleString()} simulated residents`:'Dallas simulation'}</span></div></div><div className="v2-header-controls" ref={setControlsTarget}/></header>
    <main className={`main-content ${phase==='setup'?'screen-create':snapshot?.finalized?'screen-results':'screen-respond'}`}>
      {(busy||error)&&<div className={`v2-app-status${error?' error':''}`} role={error?'alert':'status'}><div><span>{error?.message??busy}</span>{error&&<details><summary>Error details</summary><pre>{error.detail}</pre></details>}</div>{error&&<Button variant="ghost" onClick={()=>setError(null)}>Dismiss</Button>}</div>}
      {verification&&<div className="v2-app-status" role="status">{verification}</div>}
      {!sourceBundle&&!busy&&<Button onClick={()=>location.reload()}>Reload Dallas</Button>}
      {phase==='setup'&&sourceBundle&&setupDraft&&<SetupV2 key={sourceBundle.hashes.population} initialScreen={setupEntry} bundle={sourceBundle} setup={setupDraft} onChange={next=>{const previous=draftRef.current;if((previous?.scenario??'storm')!==(next.scenario??'storm')){baseGeneration.current++;setPlacingBase(false);if(setupErrors.base){installDraft(next);setSetupErrors({base:setupErrors.base});return;}installDraft({...next,base:null});setSetupErrors({});if(next.base)void pickBase(next.base.requested,next.roads,next.scenario);return;}installDraft(next);setSetupErrors(previousErrors=>{const nextErrors:Record<string,string>={};if(previousErrors.base)nextErrors.base=previousErrors.base;return nextErrors;});}} onStart={startConfigured} onImport={()=>fileInput.current?.click()}
        map={<SetupMapV2 bundle={sourceBundle} setup={setupDraft} mode={editMode} onBasePick={point=>void pickBase(point)} onRoadToggle={toggleRoad} baseBusy={placingBase} message={setupErrors.base}/>}
        editMode={editMode} onEditMode={setEditMode} baseLabel={baseLabel} errors={setupErrors} busy={!!busy||placingBase}/>}
      {phase==='run'&&snapshot&&session&&!snapshot.finalized&&<ObserverV2 key={snapshot.runId} snapshot={snapshot} policy={session.policy} playing={playing} speed={speed} selected={selected} onSelect={setSelected} controlsTarget={controlsTarget} situation={situation??undefined}
        onToggle={()=>{if(!busy)playingRef.current?pause():run();}} onSpeed={setSpeed} onStep={()=>{if(!busy){pause();step();}}} onPause={pause} onExport={exportRun} onImport={()=>ask('import')}
        onRestart={()=>ask('restart')} onNew={()=>ask('setup')} onFinish={()=>ask('finish')} evidence={evidence}/>}
      {phase==='run'&&snapshot?.finalized&&session&&<ResultsV2 key={snapshot.runId} snapshot={snapshot} policy={session.policy} comparisons={comparisons} loading={comparing} evidence={evidence} onExport={exportRun}
        onReplay={()=>{
          pause();const marker=generation.current,verificationMarker=++verificationGeneration.current;setBusy('Checking this run...');setError(null);setVerification(null);
          const failed=(cause:unknown)=>{if(marker===generation.current&&verificationMarker===verificationGeneration.current)setError(readableError('This run could not be verified. Try saving it again.',cause));};
          try{replayV2(makeRunFileV2(session)).then(()=>{if(marker===generation.current&&verificationMarker===verificationGeneration.current)setVerification('Run verified.');}).catch(failed).finally(()=>{if(marker===generation.current&&verificationMarker===verificationGeneration.current)setBusy(null);});}
          catch(cause){failed(cause);if(marker===generation.current&&verificationMarker===verificationGeneration.current)setBusy(null);}
        }}
        onRestart={()=>ask('restart')} onNew={()=>ask('setup')}/>}
    </main>
    {confirmation&&<SecondaryPanel title={confirmation==='finish'?'Skip to the end?':confirmation==='setup'?'Change the setup?':confirmation==='import'?'Open a saved run?':'Restart simulation?'} variant="confirmation" fallbackFocusId="v2-app-title" onClose={()=>setConfirmation(null)}>
      <p>{confirmation==='finish'?'Run the remaining time and show the results?':confirmation==='setup'?'Leave this run and change the settings? Save it first to keep your progress.':confirmation==='import'?'Opening another run replaces this one. Save first to keep your progress.':'Start again with the same residents and conditions? Save first to keep this run.'}</p>
      <div className="confirmation-actions"><Button variant="outline" onClick={()=>setConfirmation(null)}>Cancel</Button><Button onClick={()=>{if(confirmation==='finish')void finish();else if(confirmation==='setup')openSetup();else if(confirmation==='import'){setConfirmation(null);fileInput.current?.click();}else restart();}}>{confirmation==='finish'?'Skip to the end':confirmation==='setup'?'Change setup':confirmation==='import'?'Choose file':'Restart'}</Button></div>
    </SecondaryPanel>}
    <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Choose a saved run" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void importFile(file);}}/>
  </div>;
}
