# Amsterdam Roleplay — Live status

Een zelfstandige statuswebsite voor de Amsterdam Roleplay FiveM-servers, Discord-bot, MEOS en overheidsportaal. De pagina gebruikt een lichte statusweergave met beschikbaarheidsbalken, plus een lokaal opgeslagen donker thema.

## Wat de website controleert

De achtergrondmonitor is de enige plek die diensten controleert en metingen, incidenten en Discord-meldingen opslaat. De hoofdpagina wordt statisch vanaf de CDN aangeboden en leest geen databasegegevens tijdens het serverrenderen. De status-API geeft alleen openbare informatie terug en wordt maximaal 60 seconden door Vercel gecachet; browserkopieën verlopen na 15 seconden. Foutmeldingen en de onderhoudsbypass voor ingelogde beheerders blijven privé en worden niet gecachet. Bezoekers zien elke tien minuten een verversing; verborgen tabbladen verversen om de twintig minuten en halen bij terugkeer nieuwe gegevens op. De monitor draait standaard elke tien minuten, ook als er geen bezoekers zijn. Een databaselease voorkomt ook server-side dat dubbele workers vaker dan één keer per tien minuten een controlecyclus starten. Laat `monitor/worker.mjs` op een altijd beschikbare Node-server draaien (bijvoorbeeld dezelfde VPS als de Discord-bot). De worker roept een beveiligde Vercel-route aan; zet daarvoor dezelfde geheime `MONITOR_SECRET` in Vercel en op de monitorserver. De hoofdserver op poort 30120 en de devserver op poort 30121 worden via FiveM `dynamic.json` gecontroleerd. MEOS, het overheidsportaal en andere websites worden via HTTP(S) gecontroleerd. Een botpoort zonder HTTP-healthroute kan niet bevestigen dat het botproces zelf draait en wordt daarom als niet gecontroleerd getoond.

De grafiek toont het laatste uur, 12 uur of 24 uur. Er wordt één meetpunt per dienst per controle opgeslagen; bij het standaardinterval van tien minuten zijn dat maximaal 144 meetpunten per dag. Supabase ruimt meetgeschiedenis ouder dan 24 uur iedere vijf minuten automatisch op via de taak in `db/history-retention.sql`; de monitor voert dezelfde opruiming ook uit. Er vindt maximaal één controle per dienst per monitorronde plaats; meerdere gelijktijdig gestarte workers worden door de databaselease afgeremd. Incidenten en algemene meldingen vallen niet onder deze bewaartermijn. Diensten, onderhoudsmeldingen, meetgeschiedenis, incidenten en algemene mededelingen worden opgeslagen in PostgreSQL via Supabase. Een incident wordt één keer geopend, bijgewerkt wanneer de status verandert en afgesloten wanneer de dienst herstelt. Beheerders kunnen in `/admin` een dienst op oranje onderhoud zetten, bezoekersmelding instellen, diensten toevoegen, aanpassen, pauzeren en verwijderen. Ze kunnen daar ook zelfstandige algemene storingen en mededelingen maken, meerdere getroffen diensten kiezen, concepten bewaren, berichten publiceren, aanpassen of intrekken. Gepubliceerde berichten verschijnen boven de actieve incidenten; ze maken geen automatisch incident aan. Technische controleadressen staan niet op de openbare statuspagina of in haar API-respons.

Bezoekers kunnen browsermeldingen op dit apparaat inschakelen. Daarvoor moet de browser meldingen toestaan en moet de statuspagina open blijven. Dit is geen e-mailabonnement of achtergrond-push wanneer de pagina gesloten is.

Open een dienst met storing of onderhoud via de knop eronder om de uitleg te lezen.

Een gepubliceerde **Algemene storing** zet de geselecteerde diensten op rood, inclusief de groepen, filters en totaalsamenvatting. Intrekken, verwijderen of een selectie aanpassen geeft de onderliggende gemeten status weer terug, tenzij er nog een andere gepubliceerde storing voor die dienst geldt. Mededelingen en concepten wijzigen geen dienststatus. Meetgeschiedenis en uptime blijven de technische controles weergeven; de algemene melding blijft losstaan van automatisch aangemaakte incidenten.

### De hele statuswebsite in onderhoud zetten

In `/admin` staat **Deze site in onderhoud plaatsen**. Na bevestiging krijgen bezoekers alleen een onderhoudspagina en geeft de openbare status-API geen dienstgegevens meer terug. Al geopende statuspagina's schakelen bij de volgende controle over. Het beheerpanel blijft bereikbaar; ingelogde beheerders kunnen de statuspagina bekijken en via **Website weer openen** het onderhoud beëindigen. De beveiligde achtergrondmonitor blijft meten. De instelling wordt in PostgreSQL bewaard, ook na een herstart of deploy. Zonder database geldt de bestaande tijdelijke lokale opslag.

De blauw-witte onderhoudspagina gebruikt het AMRP-logo, de bestaande thema-instelling en een handmatige controle met duidelijke laad- en foutmeldingen. Zij controleert direct bij het openen, elke minuut zolang het tabblad zichtbaar is en bij terugkeer naar het tabblad. De openbare onderhoudsstatus wordt kort op de CDN gecachet en een databasefout wordt nooit gecachet. Alleen een bevestigde open website leidt automatisch terug naar het statusoverzicht. De weergegeven tijd is de laatste succesvolle controle; er wordt geen geschatte eindtijd verzonnen. In het beheerpanel opent **Onderhoudspagina bekijken** een beveiligd voorbeeld zonder de website te sluiten. In het voorbeeld gebeurt geen automatische controle of doorverwijzing; de controleknop toont daar alleen de echte huidige onderhoudsstand.

### Database tijdelijk niet beschikbaar

Als de database een verbindingsfout of een verbruikslimiet meldt, verschijnt een duidelijke pagina met ‘Status tijdelijk niet beschikbaar’. Er worden dan geen groene statussen of actuele metingen verzonnen. Een onleesbare onderhoudsinstelling opent de website niet alsnog. De server pauzeert databasepogingen tijdelijk (30 seconden bij een verbindingsfout, maximaal 5 minuten bij een quota-fout); de openbare API geeft een neutrale foutmelding met `Retry-After`. De browser en bijgewerkte monitor-worker respecteren die wachttijd. De beveiligde beheerlogin blijft bereikbaar. Zodra de database weer reageert, wordt de daadwerkelijke onderhoudsstand opnieuw toegepast. Een providerlimiet moet bij de databaseprovider weer ruimte geven; een codewijziging verhoogt die limiet niet.

### Discord-profielfoto in de footer

Naast ‘by Gilles’ staat de Discord-profielfoto van account `960090714950225970`. De server haalt de avatar via Lanyard op en verwijst naar een kleine Discord CDN-afbeelding; er is geen bottoken nodig. Het account moet lid blijven van de Lanyard-server. De avatarrespons wordt maximaal 15 minuten op de Vercel-CDN gecachet; de browser controleert de foto bij het openen, elke 15 minuten zolang de pagina zichtbaar is en wanneer je terugkeert naar het tabblad. Daardoor kan een nieuwe profielfoto iets later verschijnen. Bewegende avatars worden als geanimeerde WebP getoond, behalve bij de systeemvoorkeur voor minder beweging. Bij een tijdelijke fout blijft de laatst opgehaalde foto staan en volgt automatisch een nieuwe poging. Zonder profielfoto blijft alleen de klikbare naam zichtbaar. Discord-status en activiteiten worden niet op de website getoond.

## Supabase gebruiken en bestaande gegevens meenemen

De website ondersteunt Supabase PostgreSQL en de bestaande Neon-database. Beheerlogin, diensten, meldingen en meetgeschiedenis gebruiken dezelfde gegevensstructuur. Supabase Auth of openbare API-sleutels zijn hiervoor niet nodig.

Zet pas na een gecontroleerde import de geheime servervariabele `SUPABASE_DATABASE_URL` in Vercel. Gebruik hiervoor de **Transaction pooler**-URI uit Supabase **Connect**, met poort `6543`. Deze variabele krijgt voorrang op de bestaande Neon-variabelen; andere websites die met Neon verbonden zijn worden daardoor niet omgezet. Voor een eigen databasecertificaat kan `DATABASE_CA_CERT` worden ingesteld. Certificaatcontrole blijft ingeschakeld. De verbinding gebruikt maximaal drie clients per applicatie-instantie en geen benoemde prepared statements.

Alle zeven applicatietabellen hebben Row Level Security zonder openbare lees- of schrijfregels. De server moet als tabeleigenaar verbinden; alle bestaande beheerderscontroles blijven gelden. Gebruik deze databaseverbinding nooit in de browser.

Het overdrachtsplan en de export-, import- en verificatieopdrachten staan in [docs/SUPABASE-MIGRATIE.md](docs/SUPABASE-MIGRATIE.md). Verwijder alleen de tabellen van deze statuswebsite uit Neon nadat de gegevens en de live werking zijn gecontroleerd. Het Neon-project kan ook andere websites bedienen.

Supabase Free heeft ook een verkeerslimiet. De beveiligde achtergrondmonitor leest daarom geen meetgrafieken, incidentenoverzicht of mededelingen meer die hij toch niet gebruikt. Hij blijft wel diensten controleren, meetgeschiedenis en incidenten opslaan en Discordmeldingen afhandelen. Bezoekers behouden hun volledige overzicht. Het daadwerkelijke verbruik moet na de overstap worden opgevolgd.

Zet `STATUS_DATABASE_MIGRATION_PAUSED=1` tijdens de definitieve overdracht en deploy opnieuw. Dit stopt databasehandelingen van deze applicatie, inclusief controles, beheerwijzigingen en de automatische opschoning van oude metingen. Zo kan een monitor na het herstellen van een providerlimiet de nog over te zetten geschiedenis niet voortijdig verwijderen. De pagina meldt tijdelijk onbeschikbare statusgegevens. Verwijder de pauze pas na de gecontroleerde import en omschakeling en deploy opnieuw. Verouderde deployments of andere toepassingen met schrijftoegang moeten afzonderlijk worden gestopt.

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
3. Start `npm run monitor` en configureer de host om dit proces automatisch opnieuw te starten na een herstart of crash. De worker controleert standaard elke tien minuten; een ingestelde `STATUS_CHECK_INTERVAL_MS` kan de ronde niet korter dan tien minuten maken. Laat hem permanent actief.

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
# Onderhoud van het overheidsportaal

De websitecontrole van `overheid.amsterdamrp.nl` leest automatisch de publieke
onderhoudsmelding van het portaal. Een ingeschakelde onderhoudsstand verschijnt
oranje met de ingevoerde reden en wordt opgenomen in de bestaande historie en
incidenten. Hiervoor zijn geen Discord-tokens of beheersleutels nodig. Na heropening
gebruikt de volgende controle weer de normale bereikbaarheid van het portaal.

Bij onderhoud van de statuswebsite kan in `/admin` een reden van 5 tot 500 tekens worden ingevuld en tijdens onderhoud bijgewerkt. De reden verschijnt op de publieke onderhoudspagina en wordt automatisch ververst. De overheidswebsite wordt apart bediend via de beveiligde koppeling beschreven in `docs/overheid-onderhoud.md`.
