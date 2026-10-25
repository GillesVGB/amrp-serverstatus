import { getSiteSettings, listServices, saveService, saveSiteSettings, validateService } from "./server";
import { operationsDatabase, logAdminAction, deliverAdminWebhook } from "./admin-storage";
import { setPortalMaintenance } from "./portal-control";

export async function createSettingsBackup(label = "Handmatige back-up") {
  const sql = await operationsDatabase();
  const services = await listServices(true);
  const id = crypto.randomUUID();
  await sql.query("INSERT INTO amrp_status_backups(id,label,data,created_at) VALUES($1,$2,$3::jsonb,$4)",[id,label,JSON.stringify({version:1,services}),Date.now()]);
  return id;
}

export async function restoreSettingsBackup(id: string) {
  const sql=await operationsDatabase();
  const rows=await sql`SELECT data FROM amrp_status_backups WHERE id=${id}`;
  const data=rows[0]?.data as {version?:number;services?:unknown[]}|undefined;
  if(data?.version!==1 || !Array.isArray(data.services) || data.services.length>500) throw new Error("Deze back-up is niet geldig.");
  const services=data.services.map(value=>{
    const row=value as {id?:unknown};
    if(typeof row?.id!=="string" || row.id.length>100) throw new Error("De back-up bevat een ongeldige dienst.");
    return {id:row.id,...validateService(value)};
  });
  await createSettingsBackup("Voor herstel van back-up");
  // Restore all services atomically, retaining history and services added afterwards.
  await sql.query(`INSERT INTO amrp_status_services(id,name,category,kind,endpoint,enabled,paused,maintenance,maintenance_message,created_at,updated_at)
    SELECT x.id,x.name,x.category,x.kind,x.endpoint,x.enabled,x.paused,x.maintenance,x."maintenanceMessage",$2,$2
    FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,category text,kind text,endpoint text,enabled smallint,paused smallint,maintenance smallint,"maintenanceMessage" text)
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,kind=EXCLUDED.kind,endpoint=EXCLUDED.endpoint,enabled=EXCLUDED.enabled,paused=EXCLUDED.paused,maintenance=EXCLUDED.maintenance,maintenance_message=EXCLUDED.maintenance_message,updated_at=EXCLUDED.updated_at`,[JSON.stringify(services),Date.now()]);
  await logAdminAction("Back-up hersteld",`${services.length} diensten`);
}

export async function importSettingsBackup(input:unknown) {
  const data=input as {version?:number;services?:unknown[]};
  if(data?.version!==1||!Array.isArray(data.services)||data.services.length>500)throw new Error("Kies een geldige dienstenback-up.");
  for(const value of data.services){const row=value as {id?:unknown};if(typeof row?.id!=="string"||row.id.length>100)throw new Error("Ongeldige dienst in back-up.");validateService(value);}
  const sql=await operationsDatabase(),id=crypto.randomUUID();
  await sql.query("INSERT INTO amrp_status_backups(id,label,data,created_at) VALUES($1,$2,$3::jsonb,$4)",[id,"Geïmporteerde back-up",JSON.stringify(data),Date.now()]);
  await restoreSettingsBackup(id);
}

export async function createMaintenanceSchedule(input: unknown) {
  const value=input as {target?:unknown;reason?:unknown;startsAt?:unknown;endsAt?:unknown};
  if(!value || typeof value.target!=="string" || typeof value.reason!=="string" || typeof value.startsAt!=="number" || typeof value.endsAt!=="number") throw new Error("Vul alle planningsgegevens in.");
  const {target,startsAt,endsAt}=value, reason=value.reason.trim();
  if(!Number.isFinite(startsAt)||!Number.isFinite(endsAt)||startsAt<Date.now()||endsAt<=startsAt||reason.length<5||reason.length>220) throw new Error("Kies een toekomstige begintijd, een latere eindtijd en een reden van 5 tot 220 tekens.");
  const services=await listServices(true);
  const service=services.find(item=>`service:${item.id}`===target);
  if(!["statuswebsite","overheid"].includes(target)&&!service) throw new Error("Kies een bestaand onderdeel.");
  if(target==="overheid"&&!process.env.OVERHEID_STATUS_CONTROL_SECRET) throw new Error("De overheidskoppeling is niet ingesteld.");
  const name=target==="statuswebsite"?"Statuswebsite":target==="overheid"?"Overheidsportaal (echte website)":service!.name;
  const sql=await operationsDatabase();
  const conflict=await sql`SELECT id FROM amrp_status_schedules WHERE target=${target} AND state IN ('pending','starting','active','ending') AND starts_at<${endsAt} AND ends_at>${startsAt} LIMIT 1`;
  if(conflict.length) throw new Error("Er staat al onderhoud voor dit onderdeel in deze periode gepland.");
  const id=crypto.randomUUID();
  await sql`INSERT INTO amrp_status_schedules(id,target,target_name,reason,starts_at,ends_at,created_at) VALUES(${id},${target},${name},${reason},${startsAt},${endsAt},${Date.now()})`;
  await logAdminAction("Onderhoud ingepland",name);
  return id;
}

export async function cancelMaintenanceSchedule(id: string) {
  const sql=await operationsDatabase();
  const rows=await sql`UPDATE amrp_status_schedules SET state='cancelled' WHERE id=${id} AND state='pending' RETURNING target_name`;
  if(!rows.length) throw new Error("Alleen nog niet begonnen onderhoud kan worden geannuleerd.");
  await logAdminAction("Onderhoudsplanning geannuleerd",String(rows[0].target_name));
}

export async function runScheduledMaintenance() {
  const sql=await operationsDatabase(),now=Date.now();
  await deliverAdminWebhook();
  const last=await sql`SELECT max(created_at) AS last FROM amrp_status_backups`;
  if(!last[0]?.last || now-Number(last[0].last)>86_400_000) await createSettingsBackup("Automatische dagelijkse back-up");
  const expired=await sql`UPDATE amrp_status_schedules SET state='expired',last_error='De monitor was niet op tijd beschikbaar; het onderhoud is niet gestart.' WHERE state='pending' AND ends_at<=${now} RETURNING target_name`;
  for(const item of expired) await logAdminAction("Onderhoudsplanning gemist · controleer de monitor",String(item.target_name),"achtergrondmonitor");
  const rows=await sql.query(`UPDATE amrp_status_schedules SET state=CASE WHEN state IN ('active','ending') THEN 'ending' ELSE 'starting' END,lease_until=$1+60000
    WHERE id=(SELECT id FROM amrp_status_schedules WHERE ((state='pending' AND starts_at<=$1 AND ends_at>$1) OR (state='active' AND ends_at<=$1) OR (state IN ('starting','ending') AND lease_until<$1)) ORDER BY starts_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,[now]);
  const job=rows[0];
  if(!job) return;
  const enabled=job.state==="starting",target=String(job.target),reason=String(job.reason);
  try{
    if(target==="overheid") await setPortalMaintenance(enabled,reason);
    else if(target==="statuswebsite") await saveSiteSettings(enabled,reason);
    else{
      const service=(await listServices(true)).find(item=>`service:${item.id}`===target);
      if(!service) throw new Error("De geplande dienst is verwijderd.");
      await saveService({...service,maintenance:enabled?1:0,maintenanceMessage:enabled?reason:""},service.id);
    }
    await sql`UPDATE amrp_status_schedules SET state=${enabled?"active":"completed"},lease_until=0,last_error='' WHERE id=${String(job.id)}`;
    await logAdminAction(enabled?"Gepland onderhoud gestart":"Gepland onderhoud beëindigd",String(job.target_name),"achtergrondmonitor");
  }catch(error){
    if(error instanceof Error&&error.message==="De geplande dienst is verwijderd."){
      await sql`UPDATE amrp_status_schedules SET state='failed',last_error='De geplande dienst is verwijderd.',lease_until=0 WHERE id=${String(job.id)}`;
      await logAdminAction("Gepland onderhoud mislukt · dienst verwijderd",String(job.target_name),"achtergrondmonitor");
      return;
    }
    await sql`UPDATE amrp_status_schedules SET last_error='Uitvoering niet bevestigd. De monitor probeert het opnieuw.',lease_until=${Date.now()+30_000} WHERE id=${String(job.id)}`;
    if(!job.last_error)await logAdminAction("Gepland onderhoud niet bevestigd · wordt opnieuw geprobeerd",String(job.target_name),"achtergrondmonitor");
  }
}

export async function adminOperationsOverview() {
  const sql=await operationsDatabase();
  const [schedules,logs,backups,settings]=await Promise.all([
    sql`SELECT id,target,target_name AS "targetName",reason,starts_at AS "startsAt",ends_at AS "endsAt",state,last_error AS "lastError" FROM amrp_status_schedules ORDER BY starts_at DESC LIMIT 100`,
    sql`SELECT id,actor,action,target,created_at AS "createdAt" FROM amrp_status_admin_log ORDER BY created_at DESC LIMIT 100`,
    sql`SELECT id,label,created_at AS "createdAt",jsonb_array_length(data->'services') AS count FROM amrp_status_backups ORDER BY created_at DESC LIMIT 30`,getSiteSettings()
  ]);
  return {schedules,logs,backups,settings};
}
