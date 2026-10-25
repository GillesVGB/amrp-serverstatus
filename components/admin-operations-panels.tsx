"use client";
import { FormEvent,useCallback,useEffect,useState } from "react";
import { CalendarClock,History,Archive } from "lucide-react";

type Service={id:string;name:string};
type Schedule={id:string;targetName:string;reason:string;startsAt:number;endsAt:number;state:string;lastError:string};
type Log={id:string;actor:string;action:string;target:string;createdAt:number};
type Backup={id:string;label:string;createdAt:number;count:number};
const date=(value:number)=>new Date(Number(value)).toLocaleString("nl-BE",{dateStyle:"short",timeStyle:"short"});
const states:Record<string,string>={pending:"Gepland",starting:"Wordt gestart",active:"Onderhoud actief",ending:"Wordt beëindigd",completed:"Afgerond",cancelled:"Geannuleerd",expired:"Niet uitgevoerd",failed:"Uitvoering mislukt"};

export function AdminOperationsPanels({services,onChanged}:{services:Service[];onChanged:()=>Promise<void>}){
  const [schedules,setSchedules]=useState<Schedule[]>([]),[logs,setLogs]=useState<Log[]>([]),[backups,setBackups]=useState<Backup[]>([]);
  const [target,setTarget]=useState("statuswebsite"),[reason,setReason]=useState(""),[starts,setStarts]=useState(""),[ends,setEnds]=useState("");
  const [busy,setBusy]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{
    const response=await fetch("/api/admin/operations",{cache:"no-store"});
    const data=await response.json() as {schedules?:Schedule[];logs?:Log[];backups?:Backup[];error?:string};
    if(!response.ok) throw new Error(data.error||"Ophalen mislukt.");
    setSchedules(data.schedules||[]);setLogs(data.logs||[]);setBackups(data.backups||[]);
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>{void load().catch(e=>setError(e.message)).finally(()=>setBusy(false));},0);return()=>window.clearTimeout(timer);},[load]);
  async function act(body:Record<string,unknown>,message:string){
    setBusy(true);setError("");setNotice("");
    try{const r=await fetch("/api/admin/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error||"Wijzigen mislukt.");setNotice(message);await Promise.all([load(),onChanged()]);return true;}
    catch(e){setError(e instanceof Error?e.message:"Wijzigen mislukt.");return false;}finally{setBusy(false);}
  }
  async function schedule(event:FormEvent){event.preventDefault();if(await act({action:"schedule",target,reason,startsAt:new Date(starts).getTime(),endsAt:new Date(ends).getTime()},"Onderhoud ingepland.")){setReason("");setStarts("");setEnds("");}}
  async function refresh(){setBusy(true);setError("");try{await load();}catch(e){setError(e instanceof Error?e.message:"Ophalen mislukt.");}finally{setBusy(false);}}
  return <>
    {error&&<p className="form-error notice" role="alert">{error}</p>}{notice&&<p className="form-success notice" role="status">{notice}</p>}
    <details className="admin-panel admin-collapsible">
      <summary className="admin-collapse-heading"><div className="panel-heading"><span className="panel-icon"><CalendarClock size={18}/></span><div><h2>Onderhoud plannen</h2><p>Plan een begin- en eindtijd. De achtergrondmonitor start en beëindigt het onderhoud automatisch.</p></div></div></summary>
      <div className="admin-collapse-content">
        <form className="admin-form" onSubmit={schedule}>
          <label className="wide-field">Onderdeel<select value={target} onChange={e=>setTarget(e.target.value)}><option value="statuswebsite">Statuswebsite · echt sluiten</option><option value="overheid">Overheidsportaal · echt sluiten</option>{services.map(s=><option value={`service:${s.id}`} key={s.id}>Dienststatus · {s.name}</option>)}</select></label>
          <label>Begintijd<input type="datetime-local" required value={starts} onChange={e=>setStarts(e.target.value)}/></label>
          <label>Eindtijd<input type="datetime-local" required value={ends} onChange={e=>setEnds(e.target.value)}/></label>
          <label className="wide-field">Onderhoudsreden<textarea className="portal-maintenance-reason" rows={3} required minLength={5} maxLength={220} value={reason} onChange={e=>setReason(e.target.value)}/></label>
          <p className="admin-muted wide-field">Tijden worden ingevoerd volgens de tijdzone van je apparaat. De planning werkt zolang de achtergrondmonitor actief is. ‘Dienststatus’ wijzigt alleen de statusweergave. Reeds lopend onderhoud wordt op de geplande eindtijd beëindigd.</p>
          <button className="primary-button" disabled={busy}>Onderhoud inplannen</button>
        </form>
        <button type="button" className="subtle-button" onClick={()=>void refresh()} disabled={busy}>Planning verversen</button>
        <div className="operations-list">{!schedules.length&&<p className="admin-muted">Nog geen onderhoud ingepland.</p>}{schedules.map(s=><article key={s.id}><div><strong>{s.targetName}</strong><span>{date(s.startsAt)} – {date(s.endsAt)} · {states[s.state]||s.state}</span><p>{s.reason}</p>{s.lastError&&<p className="form-error">{s.lastError}</p>}</div>{s.state==="pending"&&<button className="subtle-button" disabled={busy} onClick={()=>{if(window.confirm("Deze onderhoudsplanning annuleren?"))void act({action:"cancel",id:s.id},"Planning geannuleerd.");}}>Annuleren</button>}</article>)}</div>
      </div>
    </details>
    <details className="admin-panel admin-collapsible">
      <summary className="admin-collapse-heading"><div className="panel-heading"><span className="panel-icon"><History size={18}/></span><div><h2>Beheerlogboek</h2><p>De laatste 100 beheeracties. Nieuwe acties worden ook naar de ingestelde Discord-webhook gestuurd.</p></div></div></summary>
      <div className="admin-collapse-content"><p className="admin-muted">Er is één gedeeld beheeraccount. Acties worden geregistreerd als ‘beheerder’; automatische acties als ‘achtergrondmonitor’.</p><button className="subtle-button" disabled={busy} onClick={()=>void refresh()}>Logboek verversen</button><div className="operations-list">{!logs.length&&<p className="admin-muted">Nog geen beheeracties vastgelegd.</p>}{logs.map(log=><article key={log.id}><div><strong>{log.action}</strong><span>{log.target} · {log.actor}</span><time>{date(log.createdAt)}</time></div></article>)}</div></div>
    </details>
    <details className="admin-panel admin-collapsible">
      <summary className="admin-collapse-heading"><div className="panel-heading"><span className="panel-icon"><Archive size={18}/></span><div><h2>Back-ups van diensten</h2><p>Diensten, controleadressen en hun instellingen veilig terugzetten.</p></div></div></summary>
      <div className="admin-collapse-content"><p className="admin-muted">Automatisch dagelijks en vóór beheerwijzigingen. Bij herstel worden diensten toegevoegd of bijgewerkt; meetgeschiedenis en later toegevoegde diensten blijven bewaard. De echte toegang tot gekoppelde websites wordt niet teruggezet.</p><label className="backup-import-field">Back-upbestand terugzetten<input type="file" accept="application/json,.json" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;if(file.size>1_000_000){setError("Het bestand is te groot (maximaal 1 MB).");return;}if(!window.confirm("De diensteninstellingen uit dit bestand herstellen? Er wordt eerst een back-up van de huidige situatie gemaakt."))return;void file.text().then(text=>{const payload:unknown=JSON.parse(text);return act({action:"import",payload},"Back-upbestand hersteld.");}).catch(()=>setError("Het bestand is geen geldige JSON-back-up."));}}/></label><div className="operations-actions"><button className="primary-button" disabled={busy} onClick={()=>void act({action:"backup"},"Back-up aangemaakt.")}>Nu een back-up maken</button><button className="subtle-button" disabled={busy} onClick={()=>void refresh()}>Back-ups verversen</button></div><div className="operations-list">{!backups.length&&<p className="admin-muted">Nog geen back-up beschikbaar.</p>}{backups.map(b=><article key={b.id}><div><strong>{b.label}</strong><span>{date(b.createdAt)} · {b.count} diensten</span></div><a className="subtle-button" href={`/api/admin/operations?download=${encodeURIComponent(b.id)}`} download>Downloaden</a><button className="subtle-button" disabled={busy} onClick={()=>{if(window.confirm("Deze diensteninstellingen herstellen? De huidige instellingen worden eerst automatisch geback-upt."))void act({action:"restore",id:b.id},"Diensteninstellingen hersteld.");}}>Herstellen</button></article>)}</div></div>
    </details>
  </>;
}
