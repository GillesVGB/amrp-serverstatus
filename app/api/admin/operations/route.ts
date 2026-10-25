import { hasAdminSession,isSameOrigin } from "@/app/lib/server";
import { adminOperationsOverview,createMaintenanceSchedule,cancelMaintenanceSchedule,createSettingsBackup,restoreSettingsBackup,importSettingsBackup } from "@/app/lib/admin-operations";
import { logAdminAction,operationsDatabase } from "@/app/lib/admin-storage";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
export async function GET(request:Request){
  if(!await hasAdminSession(request)) return Response.json({error:"Log eerst in."},{status:401,headers});
  try{
    const id=new URL(request.url).searchParams.get("download");
    if(id){const sql=await operationsDatabase();const rows=await sql`SELECT data FROM amrp_status_backups WHERE id=${id}`;if(!rows.length)return Response.json({error:"Back-up niet gevonden."},{status:404,headers});return Response.json(rows[0].data,{headers:{...headers,"Content-Disposition":'attachment; filename="amrp-diensten-backup.json"',"X-Content-Type-Options":"nosniff"}});}
    return Response.json(await adminOperationsOverview(),{headers});
  }catch{return Response.json({error:"De beheergegevens konden niet worden opgehaald."},{status:503,headers});}
}
export async function POST(request:Request){
  if(!isSameOrigin(request)) return Response.json({error:"Ongeldige herkomst."},{status:403,headers});
  if(!await hasAdminSession(request)) return Response.json({error:"Log eerst in."},{status:401,headers});
  try{
    const raw=await request.text();if(raw.length>1_000_000)throw new Error("Het back-upbestand is te groot (maximaal 1 MB).");
    const data=JSON.parse(raw) as {action?:string;id?:string;payload?:unknown};
    if(data.action==="schedule") await createMaintenanceSchedule(data);
    else if(data.action==="cancel"&&typeof data.id==="string") await cancelMaintenanceSchedule(data.id);
    else if(data.action==="backup"){await createSettingsBackup();await logAdminAction("Back-up aangemaakt","Diensten en controleadressen");}
    else if(data.action==="restore"&&typeof data.id==="string") await restoreSettingsBackup(data.id);
    else if(data.action==="import") await importSettingsBackup(data.payload);
    else throw new Error("Ongeldige beheeractie.");
    return Response.json({ok:true},{headers});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Wijzigen mislukt."},{status:400,headers});}
}
