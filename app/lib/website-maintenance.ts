// A public, read-only signal; status checks never receive portal credentials.
export async function websiteMaintenanceReason(endpoint: string, response: Response, request: typeof fetch = fetch, signal?: AbortSignal): Promise<string | null> {
  if (response.headers.get('x-amrp-maintenance') === '1') {
    try {return decodeURIComponent(response.headers.get('x-amrp-maintenance-reason') || '').trim().slice(0, 500) || 'De website is tijdelijk in onderhoud.';}
    catch {return 'De website is tijdelijk in onderhoud.';}
  }
  const target = new URL(endpoint);
  if (target.protocol !== 'https:' || target.hostname !== 'overheid.amsterdamrp.nl') return null;
  try {
    const status = await request(new URL('/api/site-status', target), {cache:'no-store', redirect:'error', signal, headers:{Accept:'application/json'}});
    if (!status.ok) return null;
    const data = await status.json() as {maintenance?: {enabled?: unknown;reason?: unknown}};
    if (data.maintenance?.enabled !== true) return null;
    return typeof data.maintenance.reason === 'string' && data.maintenance.reason.trim()
      ? data.maintenance.reason.trim().slice(0, 500) : 'Het overheidsportaal is tijdelijk in onderhoud.';
  } catch {return null;}
}
