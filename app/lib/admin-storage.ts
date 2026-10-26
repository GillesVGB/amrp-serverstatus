import { adminDatabase } from "./server";

let ready: Promise<void> | undefined;
const localConfirmations=new Map<string,{failures:number;checkedAt:number}>();
export async function operationsDatabase() {
  const sql = await adminDatabase();
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS amrp_status_admin_log (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at BIGINT NOT NULL)`;
    await sql`ALTER TABLE amrp_status_admin_log ADD COLUMN IF NOT EXISTS discord_sent SMALLINT NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE amrp_status_admin_log ADD COLUMN IF NOT EXISTS discord_after BIGINT NOT NULL DEFAULT 0`;
    await sql`CREATE TABLE IF NOT EXISTS amrp_status_backups (id TEXT PRIMARY KEY, label TEXT NOT NULL, data JSONB NOT NULL, created_at BIGINT NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS amrp_status_schedules (id TEXT PRIMARY KEY, target TEXT NOT NULL, target_name TEXT NOT NULL, reason TEXT NOT NULL, starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', lease_until BIGINT NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL)`;
    await sql`CREATE INDEX IF NOT EXISTS amrp_status_schedules_due_idx ON amrp_status_schedules(state, starts_at, ends_at)`;
    await sql`CREATE TABLE IF NOT EXISTS amrp_status_probe_confirmation (service_id TEXT PRIMARY KEY REFERENCES amrp_status_services(id) ON DELETE CASCADE, failures INTEGER NOT NULL DEFAULT 0, checked_at BIGINT NOT NULL)`;
    for (const table of ["amrp_status_admin_log", "amrp_status_backups", "amrp_status_schedules", "amrp_status_probe_confirmation"]) await sql.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  })().catch(error => { ready = undefined; throw error; });
  await ready;
  return sql;
}

export async function logAdminAction(action: string, target: string, actor = "beheerder") {
  const sql = await operationsDatabase();
  const id=crypto.randomUUID();
  await sql`INSERT INTO amrp_status_admin_log(id,actor,action,target,created_at) VALUES (${id},${actor},${action},${target.slice(0,200)},${Date.now()})`;
  await deliverAdminWebhook(id);
}

export async function deliverAdminWebhook(id?:string) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  const sql=await operationsDatabase(),now=Date.now();
  const rows=await sql.query(`UPDATE amrp_status_admin_log SET discord_after=$1+60000 WHERE id=(SELECT id FROM amrp_status_admin_log WHERE discord_sent=0 AND discord_after<=$1 AND ($2::text IS NULL OR id=$2) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) AND discord_sent=0 AND discord_after<=$1 RETURNING *`,[now,id||null]);
  const entry=rows[0];if(!entry)return;
  try {
    const response=await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(1800), body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ title: "Amsterdam Roleplay · Beheerlogboek", color: 0x3471c8, fields: [{name:"Actie",value:String(entry.action).slice(0,900)},{name:"Onderdeel",value:String(entry.target).slice(0,200)||"Statuswebsite"},{name:"Uitvoerder",value:String(entry.actor)}],timestamp:new Date(Number(entry.created_at)).toISOString() }] }) });
    if(response.ok)await sql`UPDATE amrp_status_admin_log SET discord_sent=1 WHERE id=${String(entry.id)}`;
  } catch { /* The persisted log remains available if Discord cannot be reached. */ }
}

export async function confirmAutomaticProbe(id: string, status: string, checkedAt: number) {
  const failed = status === "down" || status === "degraded";
  if(!process.env.SUPABASE_DATABASE_URL&&!process.env.DATABASE_URL&&!process.env.POSTGRES_URL){
    const previous=localConfirmations.get(id);
    if(previous&&checkedAt<=previous.checkedAt)return failed?previous.failures:0;
    if(!failed){localConfirmations.set(id,{failures:0,checkedAt});return 0;}
    if(previous&&checkedAt-previous.checkedAt<5000)return previous.failures;
    const failures=previous&&checkedAt-previous.checkedAt<=1800000?Math.min(previous.failures+1,3):1;
    localConfirmations.set(id,{failures,checkedAt});return failures;
  }
  const sql = await operationsDatabase();
  const rows = await sql.query(`INSERT INTO amrp_status_probe_confirmation(service_id,failures,checked_at) VALUES($1,$2,$3)
    ON CONFLICT(service_id) DO UPDATE SET
    failures=CASE WHEN EXCLUDED.checked_at <= amrp_status_probe_confirmation.checked_at THEN amrp_status_probe_confirmation.failures
      WHEN $2=0 THEN 0 WHEN EXCLUDED.checked_at-amrp_status_probe_confirmation.checked_at < 5000 THEN amrp_status_probe_confirmation.failures
      WHEN EXCLUDED.checked_at-amrp_status_probe_confirmation.checked_at > 1800000 THEN 1 ELSE LEAST(amrp_status_probe_confirmation.failures+1,3) END,
    checked_at=CASE WHEN EXCLUDED.checked_at>amrp_status_probe_confirmation.checked_at AND ($2=0 OR EXCLUDED.checked_at-amrp_status_probe_confirmation.checked_at>=5000) THEN EXCLUDED.checked_at ELSE amrp_status_probe_confirmation.checked_at END
    RETURNING failures`,[id,failed?1:0,checkedAt]);
  return failed ? Number(rows[0].failures) : 0;
}
