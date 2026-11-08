import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck, House, MapPin, Package, Route, Truck, Users } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { ScenarioBundleV2, SetupOverlayV2 } from '../../v2/contracts';
import './setup-v2.css';

/** A complete UI draft. Core admission remains authoritative before a run starts. */
export type SetupV2Settings=SetupOverlayV2;
export interface SetupV2Props {
  bundle:ScenarioBundleV2; setup:SetupV2Settings;
  onChange:(setup:SetupV2Settings)=>void; onStart:(setup:SetupV2Settings)=>void; onImport:()=>void;
  map:ReactNode; editMode:'base'|'roads'; onEditMode:(mode:'base'|'roads')=>void;
  baseLabel?:string; errors?:Record<string,string>; busy?:boolean; initialScreen?:'welcome'|'customize';
}
type Step=0|1|2;
const steps=['Base & roads','Resources','Review'];
const validInteger=(value:number,min:number,max:number)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function resourceErrors(setup:SetupV2Settings,persons:number):Record<string,string> {
  const result:Record<string,string>={},r=setup.resources;
  if(!validInteger(r.crews,0,64))result.crews='Choose 0 to 64 response teams.';
  if(!validInteger(r.vans,0,64))result.vans='Choose 0 to 64 transport vans.';
  const vanLimit=validInteger(r.vans,0,64)?r.vans:0;
  if(!validInteger(r.accessibleVans,0,vanLimit))result.accessibleVans=`Choose 0 to ${vanLimit} accessible vans.`;
  if(!validInteger(r.supplyBundles,0,100000))result.supplyBundles='Choose 0 to 100,000 supply bundles.';
  for(const shelter of r.shelterPlaces)if(!validInteger(shelter.places,0,persons))result[`shelter:${shelter.facilityId}`]=`Choose 0 to ${persons.toLocaleString()} shelter places.`;
  return result;
}
function numberValue(value:number):number|'' {return Number.isFinite(value)?value:'';}

export function SetupV2({bundle,setup,onChange,onStart,onImport,map,editMode,onEditMode,baseLabel,errors={},busy=false,initialScreen='welcome'}:SetupV2Props) {
  const [screen,setScreen]=useState(initialScreen),[step,setStep]=useState<Step>(0),[attempted,setAttempted]=useState(false);
  const title=useRef<HTMLHeadingElement>(null),focusRequested=useRef(false),id=useId();
  const preview=useRef<HTMLDivElement>(null),credit=useRef<HTMLAnchorElement>(null);
  const [mapAttempt,setMapAttempt]=useState(0),[mapUnavailable,setMapUnavailable]=useState(false);
  useEffect(()=>{
    if(screen!=='welcome'||!preview.current){setMapUnavailable(false);return;}
    const node=preview.current,update=()=>setMapUnavailable(!!node.querySelector('.geographic-tile-status'));
    const observer=new MutationObserver(update);observer.observe(node,{childList:true,subtree:true});update();
    return()=>observer.disconnect();
  },[screen,mapAttempt]);
  useLayoutEffect(()=>{if(focusRequested.current){title.current?.focus();focusRequested.current=false;}},[screen,step]);
  const localErrors=resourceErrors(setup,bundle.assets.population.persons.length);
  const fieldError=(key:string)=>errors[key]??errors[`resources.${key}`]??(attempted?localErrors[key]:undefined);
  const baseError=errors.base??errors['base.requested']??errors['base.nodeId'];
  const roadError=errors.roads;
  const generalError=errors.setup??errors.general;
  const sourceBase=bundle.assets.facilities.find(facility=>facility.kind==='base');
  const actualBase=setup.base?bundle.assets.map.nodes.find(node=>node.id===setup.base!.nodeId):sourceBase?.position;
  const base=baseLabel??(actualBase&&typeof actualBase.lat==='number'&&typeof actualBase.lon==='number'?`${actualBase.lat.toFixed(5)}, ${actualBase.lon.toFixed(5)} (street location)`:'Choose a response base');
  const shelters=bundle.assets.facilities.filter(facility=>facility.kind==='shelter');
  const labelForShelter=(facilityId:string,index:number)=>`Shelter ${String.fromCharCode(65+index)} places`;
  const totalShelter=setup.resources.shelterPlaces.reduce((sum,item)=>sum+(Number.isFinite(item.places)?item.places:0),0);
  const setResource=(key:'crews'|'vans'|'accessibleVans'|'supplyBundles',raw:string)=>onChange({...setup,resources:{...setup.resources,[key]:raw===''?Number.NaN:Number(raw)}});
  const setShelter=(facilityId:string,raw:string)=>onChange({...setup,resources:{...setup.resources,shelterPlaces:setup.resources.shelterPlaces.map(item=>item.facilityId===facilityId?{...item,places:raw===''?Number.NaN:Number(raw)}:item)}});
  const focusTitle=()=>{focusRequested.current=true;};
  const move=(next:Step)=>{setStep(next);setAttempted(false);focusTitle();};
  const start=()=>{
    setAttempted(true);
    if(baseError||roadError||generalError){setScreen('customize');move(0);return;}
    if(Object.keys(localErrors).length||Object.keys(errors).some(key=>key.startsWith('resources.')||['crews','vans','accessibleVans','supplyBundles'].includes(key)||key.startsWith('shelter:'))){setScreen('customize');setStep(1);focusTitle();return;}
    onStart(setup);
  };
  const next=()=>{
    setAttempted(true);
    if(step===0){if(!baseError&&!roadError&&!generalError)move(1);return;}
    if(step===1){if(!Object.keys(localErrors).length&&!Object.keys(errors).some(key=>key.startsWith('resources.')||['crews','vans','accessibleVans','supplyBundles'].includes(key)||key.startsWith('shelter:')))move(2);return;}
    start();
  };
  const numberField=(label:string,key:string,value:number,onValue:(raw:string)=>void,max:number,hint?:string)=>{
    const error=fieldError(key),fieldId=`${id}-${key.replace(/[^a-z0-9]/gi,'-')}`;
    return <div className="setup-v2-number"><label htmlFor={fieldId}>{label}</label><div><input id={fieldId} type="number" inputMode="numeric" min={0} max={max} step={1} value={numberValue(value)} disabled={busy} aria-invalid={!!error} aria-describedby={error?`${fieldId}-error`:hint?`${fieldId}-hint`:undefined} onChange={event=>onValue(event.currentTarget.value)}/>{hint&&<span id={`${fieldId}-hint`} className="setup-v2-field-hint">{hint}</span>}</div>{error&&<p id={`${fieldId}-error`} className="setup-v2-error" role="alert">{error}</p>}</div>;
  };

  if(screen==='welcome')return <section className="setup-v2 setup-v2-welcome" aria-label="Dallas simulation welcome">
    <div className="setup-v2-welcome-copy"><span className="setup-v2-eyebrow">Automatic response simulation</span><h1 ref={title} tabIndex={-1}>Dallas storm response</h1><p className="setup-v2-intro">Watch how reports and home checks guide help after a simulated storm.</p>
      <dl className="setup-v2-population"><div><dd>{bundle.assets.population.households.length.toLocaleString()}</dd><dt>simulated homes</dt></div><div><dd>{bundle.assets.population.persons.length.toLocaleString()}</dd><dt>residents</dt></div><div><dd>6 hours</dd><dt>simulated time</dt></div></dl>
      <div className="setup-v2-welcome-actions"><Button onClick={start} disabled={busy}>Start simulation<ChevronRight size={17}/></Button><Button variant="outline" onClick={()=>{setScreen('customize');move(0);}} disabled={busy}>Customize setup</Button><Button variant="ghost" onClick={onImport} disabled={busy}>Open saved run</Button></div>
      <p className="setup-v2-muted">Teams respond automatically. You can pause and inspect any home.</p>
      {generalError&&<p className="setup-v2-error" role="alert">{generalError}</p>}
    </div><div className="setup-v2-welcome-map"><div className="setup-v2-welcome-map-heading">Dallas simulation area</div><div key={mapAttempt} ref={preview} className="setup-v2-welcome-preview" inert aria-hidden="true">{map}</div>{mapUnavailable&&<div className="setup-v2-welcome-map-status"><span role="status">Map incomplete or unavailable. Roads are still shown.</span><Button variant="outline" onClick={()=>{credit.current?.focus();setMapUnavailable(false);setMapAttempt(value=>value+1);}}>Reload map</Button></div>}<a ref={credit} className="setup-v2-welcome-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a></div>
  </section>;

  return <section className={`setup-v2 setup-v2-wizard setup-v2-step-${step}`} aria-label="Simulation setup">
    <header className="setup-v2-heading"><div><p className="setup-v2-eyebrow">Step {step+1} of 3</p><h1 ref={title} tabIndex={-1}>{steps[step]}</h1></div><ol aria-label="Setup steps">{steps.map((name,index)=><li key={name} aria-current={step===index?'step':undefined}><span>{index+1}</span><span>{name}</span></li>)}</ol></header>
    <div className="setup-v2-content">
      {step===0&&<section className="setup-v2-location" aria-label="Base and roads"><div className="setup-v2-location-tools"><div className="setup-v2-edit-modes" role="group" aria-label="Map editing"><Button variant={editMode==='base'?'default':'outline'} onClick={()=>onEditMode('base')} disabled={busy} aria-pressed={editMode==='base'}><MapPin size={17}/>Place base</Button><Button variant={editMode==='roads'?'default':'outline'} onClick={()=>onEditMode('roads')} disabled={busy} aria-pressed={editMode==='roads'}><Route size={17}/>Edit road blocks</Button></div><p>{editMode==='base'?'Choose a point inside the boundary.':'Select a street to add or remove a block.'}</p><dl><div><dt>Response base</dt><dd>{base}</dd></div><div><dt>Road changes</dt><dd>{setup.roads.length}</dd></div></dl><p className="setup-v2-muted">Road changes last for this run.</p>{baseError&&<p className="setup-v2-error" role="alert">{baseError}</p>}{roadError&&<p className="setup-v2-error" role="alert">{roadError}</p>}{generalError&&<p className="setup-v2-error" role="alert">{generalError}</p>}</div><div className="setup-v2-map">{map}</div></section>}
      {step===1&&<section className="setup-v2-resources" aria-label="Response resources"><p className="setup-v2-muted">Adjustable exercise assumptions</p><div className="setup-v2-resource-grid">
        {numberField('Response teams','crews',setup.resources.crews,raw=>setResource('crews',raw),64,'Check homes and deliver supplies')}
        {numberField('Transport vans','vans',setup.resources.vans,raw=>setResource('vans',raw),64,'6 passengers per van')}
        {numberField('Vans with accessible places','accessibleVans',setup.resources.accessibleVans,raw=>setResource('accessibleVans',raw),Number.isFinite(setup.resources.vans)?setup.resources.vans:0,'Included in the van total')}
        {numberField('Supply bundles','supplyBundles',setup.resources.supplyBundles,raw=>setResource('supplyBundles',raw),100000,'One bundle per household delivery')}
        {shelters.map((shelter,index)=>numberField(labelForShelter(shelter.id,index),`shelter:${shelter.id}`,setup.resources.shelterPlaces.find(item=>item.facilityId===shelter.id)?.places??0,raw=>setShelter(shelter.id,raw),bundle.assets.population.persons.length))}
      </div><details className="setup-v2-assumptions"><summary>About these numbers</summary><p>These are exercise settings, not a measured Dallas allocation. Each accessible van has one accessible place within its six passenger places. Travel, road access and available shelter places limit what teams can complete.</p></details></section>}
      {step===2&&<section className="setup-v2-review" aria-label="Review setup"><h2>Ready to observe</h2><dl><div><dt><MapPin size={18}/>Response base</dt><dd>{base}</dd></div><div><dt><Route size={18}/>Road changes</dt><dd>{setup.roads.length}</dd></div><div><dt><Users size={18}/>Response teams</dt><dd>{setup.resources.crews}</dd></div><div><dt><Truck size={18}/>Transport vans</dt><dd>{setup.resources.vans} total / {setup.resources.accessibleVans} accessible</dd></div><div><dt><Package size={18}/>Supply bundles</dt><dd>{setup.resources.supplyBundles.toLocaleString()}</dd></div><div><dt><House size={18}/>Shelter places</dt><dd>{totalShelter.toLocaleString()}</dd></div></dl>{setup.roads.length>0&&<p className="setup-v2-notice">Road edits use simulation reporting rules.</p>}{setup.resources.crews+setup.resources.vans===0&&<p className="setup-v2-notice">No teams can respond with these settings.</p>}<p className="setup-v2-muted"><ClipboardCheck size={17}/>The response will run automatically.</p>{generalError&&<p className="setup-v2-error" role="alert">{generalError}</p>}</section>}
    </div>
    <footer className="setup-v2-footer"><Button variant="outline" onClick={()=>{if(step===0){setScreen('welcome');setAttempted(false);focusTitle();}else move((step-1) as Step);}} disabled={busy}><ChevronLeft size={17}/>Back</Button><span>{bundle.assets.population.households.length.toLocaleString()} homes / {bundle.assets.population.persons.length.toLocaleString()} residents</span><Button onClick={next} disabled={busy}>{busy?'Preparing...':step===2?'Start simulation':'Continue'}<ChevronRight size={17}/></Button></footer>
  </section>;
}
