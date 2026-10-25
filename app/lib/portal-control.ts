import { listServices, saveService } from "./server";

export async function setPortalMaintenance(enabled: boolean, reason: string) {
  const secret=process.env.OVERHEID_STATUS_CONTROL_SECRET;
  if (!secret) throw new Error("De overheidskoppeling is niet ingesteld.");
  const response=await fetch("https://overheid.amsterdamrp.nl/api/status-control/maintenance",{method:"PUT",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify({enabled,reason})});
  const data=await response.json() as {maintenance?:{enabled:boolean;reason:string;updatedAt:string}};
  if (!response.ok || data.maintenance?.enabled!==enabled) throw new Error("Het overheidsportaal heeft de wijziging niet bevestigd. Ververs de status voordat je opnieuw probeert.");
  for(const service of await listServices(true)) if(service.kind==="website" && new URL(service.endpoint).hostname==="overheid.amsterdamrp.nl") await saveService({...service,maintenance:enabled?1:0,maintenanceMessage:enabled?reason:""},service.id);
  return data.maintenance;
}
