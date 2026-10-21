# Amsterdam Roleplay — Live status

Een zelfstandige statuswebsite voor de Amsterdam Roleplay FiveM-servers, Discord-bot, MEOS en overheidsportaal. De pagina gebruikt een lichte statusweergave met beschikbaarheidsbalken, plus een lokaal opgeslagen donker thema.

## Wat de website controleert

De statuspagina voert elke vijf seconden een meting uit zolang iemand de pagina open heeft. Voor doorlopende controles, ook als er geen bezoekers zijn, staat er een aparte monitor in `monitor/worker.mjs`. Laat die op een altijd beschikbare Node-server draaien (bijvoorbeeld dezelfde VPS als de Discord-bot). De worker roept een beveiligde Vercel-route aan; zet daarvoor dezelfde geheime `MONITOR_SECRET` in Vercel en op de monitorserver. De hoofdserver op poort 30120 en de devserver op poort 30121 worden via FiveM `dynamic.json` gecontroleerd. MEOS, het overheidsportaal en andere websites worden via HTTP(S) gecontroleerd. Een botpoort zonder HTTP-healthroute kan niet bevestigen dat het botproces zelf draait en wordt daarom als niet gecontroleerd getoond.

De grafiek kan het laatste uur, 24 uur of 7 dagen tonen. Elk vakje vat één minuut, tien minuten of één uur samen. Diensten, onderhoudsmeldingen, meetgeschiedenis, incidenten en algemene mededelingen worden opgeslagen in PostgreSQL via Neon. Een incident wordt één keer geopend, bijgewerkt wanneer de status verandert en afgesloten wanneer de dienst herstelt. Beheerders kunnen in `/admin` een dienst op oranje onderhoud zetten, bezoekersmelding instellen, diensten toevoegen, aanpassen, pauzeren en verwijderen. Ze kunnen daar ook zelfstandige algemene storingen en mededelingen maken, meerdere getroffen diensten kiezen, concepten bewaren, berichten publiceren, aanpassen of intrekken. Gepubliceerde berichten verschijnen boven de actieve incidenten; ze maken geen automatisch incident aan. Technische controleadressen staan niet op de openbare statuspagina of in haar API-respons.

Bezoekers kunnen browsermeldingen op dit apparaat inschakelen. Daarvoor moet de browser meldingen toestaan en moet de statuspagina open blijven. Dit is geen e-mailabonnement of achtergrond-push wanneer de pagina gesloten is.

Open een dienst met storing of onderhoud via de knop eronder om de uitleg te lezen.

### Discord-profielfoto in de footer

Naast ‘by Gilles’ staat de Discord-profielfoto van account `960090714950225970`. De server haalt de avatar via Lanyard op en verwijst naar een kleine Discord CDN-afbeelding; er is geen bottoken nodig. Het account moet lid blijven van de Lanyard-server. De verwijzing wordt kort gecachet, waardoor een gewijzigde foto niet direct verschijnt. Bij een ontbrekende foto of een onbereikbare provider blijft alleen de klikbare naam zichtbaar. Discord-status en activiteiten worden niet op de website getoond.

## Vercel en Neon instellen

Koppel de repository aan Vercel en laat Vercel het project herkennen als Next.js. De standaardbuild is `npm run build`; Vercel bouwt daarmee de Next.js-app en de serverroutes.

Koppel een Neon PostgreSQL-database aan dit Vercel-project. Stel daarna voor Production en Preview deze servervariabelen in:

- `DATABASE_URL` — Neon-connection string.
- `ADMIN_PASSWORD_SALT` — kopieer de bestaande waarde uit het genegeerde lokale `.dev.vars`-bestand.
- `ADMIN_PASSWORD_HASH` — kopieer de bestaande waarde uit `.dev.vars`.
- `ADMIN_SESSION_SECRET` — kopieer de bestaande waarde uit `.dev.vars`.
- `DISCORD_WEBHOOK_URL` — optioneel. Maak een nieuwe Discord-webhook aan voor statusmeldingen en stel de URL alleen hier in als geheime hostingvariabele. Voeg de webhook-URL nooit toe aan de repository of frontendcode.
- `MONITOR_SECRET` — een willekeurige geheime sleutel die je ook instelt op de server waar de monitor-worker permanent draait.

De tabellen en standaarddiensten worden automatisch toegevoegd bij de eerste statusaanvraag. Het schema staat ook in `db/postgres.sql`. Een Discord-melding wordt alleen verstuurd bij het openen van een incident, het ingaan van onderhoud en herstel; herhaalde controles tijdens dezelfde storing sturen geen nieuw bericht. Gebruik op Vercel nooit het daadwerkelijke `.dev.vars`-bestand en commit geen geheimen. In `.env.example` staan alleen invulnamen. Maak na het instellen van variabelen een nieuwe deploy.

Dezelfde Neon-database kan alleen door deze statusapp worden gebruikt als de juiste `DATABASE_URL` voor dit Vercel-project is ingesteld. Diensten en onderhoudsstatus zijn gedeeld voor alle bezoekers; het gekozen kleurenthema wordt lokaal per browser opgeslagen.

## Doorlopende controle inschakelen

1. Stel in Vercel `MONITOR_SECRET` in als geheime omgevingsvariabele en deploy opnieuw.
2. Zet de repository op een Node.js-server die continu actief blijft. Stel daar `STATUS_API_URL` in op de publieke statuswebsite en zet `MONITOR_SECRET` op exact dezelfde geheime waarde.
3. Start `npm run monitor` en configureer de host om dit proces automatisch opnieuw te starten na een herstart of crash. De worker controleert elke vijf seconden; laat hem permanent actief.

### Render Free als monitorhost (best effort)

De Render-webservice kan de monitor-worker en een kleine health-route samen starten. Stel op Render als Build Command `npm ci` in en als Start Command `npm run start:render-monitor`. Voeg `STATUS_API_URL` toe met de publieke URL van de statuswebsite en stel `MONITOR_SECRET` in op exact dezelfde waarde als in Vercel. Render levert `PORT` zelf aan. Commit geen `.env`-bestand.

Maak daarna in UptimeRobot een HTTP(s)-monitor voor `https://<jouw-render-service>.onrender.com/health` met het gratis interval van vijf minuten. Die route meldt alleen `200` wanneer de worker draait. De inkomende checks kunnen voorkomen dat een gratis Render-webservice wegens inactiviteit slaapt, maar Render kan gratis services nog steeds herstarten; dit geeft dus geen uptimegarantie.

Vercel Cron is geen vervanging voor deze vijfseconden-worker: op Hobby is de minimale frequentie eenmaal per dag en op Pro eenmaal per minuut.

## Lokale voorvertoning

Vereist Node.js 22.13 of hoger.

```powershell
npm install
npm run dev -- --port 5180
```

Open `http://127.0.0.1:5180`. De statuspagina staat op `/` en het beheerpaneel op `/admin`. Zonder `DATABASE_URL` gebruikt de lokale preview tijdelijke opslag in het geheugen. Stel een lokale Neon-`DATABASE_URL` in als je lokaal opslag over herstarts heen wilt testen.

## Controles

```powershell
npm run build
node ./node_modules/eslint/bin/eslint.js app/page.tsx app/layout.tsx app/lib/server.ts app/admin/page.tsx app/api/status/route.ts app/api/admin/session/route.ts app/api/services/route.ts 'app/api/services/[id]/route.ts' components/theme-toggle.tsx
```
