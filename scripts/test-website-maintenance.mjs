import test from 'node:test';
import assert from 'node:assert/strict';
import {websiteMaintenanceReason} from '../app/lib/website-maintenance.ts';

test('De onderhoudsreden uit de headers wordt ook bij HTTP 503 herkend', async () => {
  const reason = 'Update personeel & roepnummers — even geduld.';
  const response = new Response('', {status:503,headers:{'x-amrp-maintenance':'1','x-amrp-maintenance-reason':encodeURIComponent(reason)}});
  assert.equal(await websiteMaintenanceReason('https://overheid.amsterdamrp.nl/', response), reason);
});
test('Een statische Vercel-homepage met HTTP 200 neemt het echte onderhoudssignaal over', async () => {
  const calls = [];
  const reason = 'Nieuwe versie van het overheidsportaal.';
  const request = async (url, init) => {
    calls.push(url.href);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, undefined);
    return Response.json({maintenance:{enabled:true,reason}});
  };
  assert.equal(await websiteMaintenanceReason('https://overheid.amsterdamrp.nl/', new Response('static site'), request), reason);
  assert.deepEqual(calls, ['https://overheid.amsterdamrp.nl/api/site-status']);
});
test('Heropening geeft geen onderhoud meer, en andere diensten worden niet omgezet', async () => {
  const request = async () => Response.json({maintenance:{enabled:false,reason:''}});
  assert.equal(await websiteMaintenanceReason('https://overheid.amsterdamrp.nl/', new Response(''), request), null);
  assert.equal(await websiteMaintenanceReason('https://meos.amsterdamrp.nl/', new Response(''), () => {throw Error('Niet verwacht');}), null);
});
test('Een fout of ongeldige header verzint geen onderhoudsreden', async () => {
  const response = new Response('', {status:503,headers:{'x-amrp-maintenance':'1','x-amrp-maintenance-reason':'%invalid'}});
  assert.equal(await websiteMaintenanceReason('https://overheid.amsterdamrp.nl/', response), 'De website is tijdelijk in onderhoud.');
  assert.equal(await websiteMaintenanceReason('https://overheid.amsterdamrp.nl/', new Response(''), async () => {throw Error('Offline');}), null);
});
