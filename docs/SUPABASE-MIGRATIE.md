# Statusgegevens van Neon naar Supabase

Gebruik `scripts/migrate-status-database.mjs` vanuit de hoofdmap van de repository. Exporteren, importeren en controleren zijn afzonderlijke opdrachten. Het script verwijdert niets uit Neon.

## Wat wordt meegenomen?

Alle bestaande rijen van deze zeven tabellen in `public`:

- `amrp_status_services`
- `amrp_status_history`
- `amrp_status_incidents`
- `amrp_status_monitor`
- `amrp_status_announcements`
- `amrp_status_site_settings`
- `amrp_status_migrations`

IDs, tijdstippen, JSONB en de incidentnummering blijven behouden. De export gebruikt PostgreSQL-tekstwaarden om afronding van grote gehele getallen en tijdstippen door JavaScript te voorkomen. De migratiemarkeringen gaan mee, zodat de applicatie na de overstap geen standaarddiensten opnieuw toevoegt.

De applicatie ruimt meetgeschiedenis ouder dan zeven dagen op. De export neemt alle rijen mee die nog bestaan; eerder verwijderde geschiedenis kan hiermee niet worden teruggehaald.

## 1. Verbindingen voorbereiden

Installeer de afhankelijkheden met `npm ci`. Gebruik Node.js volgens `package.json`.

Maak lokaal `.env.migration.local` met deze twee variabelen en vul de verbindingen daar in:

```ini
SOURCE_DATABASE_URL=DE_NATIVE_POSTGRESQL_VERBINDING_VAN_NEON
TARGET_DATABASE_URL=DE_POSTGRESQL_VERBINDING_VAN_SUPABASE
```

- **Bron:** de directe, ongepoolde PostgreSQL-verbindingsstring uit Neon; geen HTTP-API-URL.
- **Doel:** kopieer in Supabase **Connect → Session pooler**, poort `5432`, als je netwerk alleen IPv4 ondersteunt. Een directe verbinding is geschikt met IPv6 of de IPv4-add-on. Gebruik voor deze migratie geen Transaction pooler op poort `6543`. Kopieer host en gebruikersnaam uit het dashboard; leid ze niet af uit de regio. [Supabase: databaseverbindingen](https://supabase.com/docs/guides/database/connecting-to-postgres)
- Gebruik de databasewachtwoorden en versleutelde PostgreSQL-verbindingen. Encodeer speciale tekens in wachtwoorden correct voor de verbindingsstring.

Het script controleert altijd het TLS-certificaat en de hostnaam. Als de provider een eigen CA vereist, download die via het officiële databasedashboard en voeg de volledige PEM-inhoud toe als `SOURCE_DATABASE_CA_CERT` of `TARGET_DATABASE_CA_CERT` in hetzelfde privébestand. Meerdere regels of letterlijke `\n` worden ondersteund. Een `sslrootcert`-bestandspad in de URL wordt geweigerd; schakel certificaatcontrole niet uit.

`.env.migration.local` en `.local/` worden door Git genegeerd. Plaats verbindingsstrings, back-ups en databasewachtwoorden nooit in Git, tickets of chat. De back-up bevat echte configuratie en inhoud: bewaar hem op een locatie met beperkte toegang en versleutel een externe kopie.

### Als Neon de transferlimiet heeft bereikt

Een native PostgreSQL-verbinding omzeilt deze limiet niet. Volgens Neon lopen ook directe verbindingen via hun proxy; overschrijding op Free schort de compute op tot de volgende factureringscyclus of een upgrade. Ook exportverkeer telt mee. Clientcompressie van bijvoorbeeld `pg_dump` vermindert die overdracht niet. [Neon: netwerkverkeer](https://neon.com/docs/introduction/network-transfer)

Als de bron niet toegankelijk is, stopt export. Er wordt dan geen lege vervanging geïmporteerd. Herstel eerst toegang via de provider of wacht op de limietreset; een al gemaakte en gecontroleerde back-up kan wel afzonderlijk worden geïmporteerd.

## 2. Alle schrijvers tijdelijk stoppen

Pauzeer vóór de definitieve export alle processen die bron of doel kunnen wijzigen:

Zet voor de website `STATUS_DATABASE_MIGRATION_PAUSED=1` en rol de bijbehorende versie uit. Deze serverinstelling blokkeert databasehandelingen, inclusief het opruimen van meetgeschiedenis. Zo worden bestaande metingen ook na de Neon-quotumreset niet alsnog weggehaald voordat ze zijn geëxporteerd. Houd de pauze actief tot de import gecontroleerd is en de productieconfiguratie naar Supabase is omgezet.

Stop daarnaast schrijvers die deze nieuwe instelling niet gebruiken, zoals oude deployments en losse processen:

- De monitorworker en geplande statuscontroles.
- Verzoeken naar de status-API: ook `GET`-controles kunnen geschiedenis en incidenten opslaan en oude metingen opruimen.
- Wijzigingen in het beheerpanel.

Alleen de publieke onderhoudspagina inschakelen is hiervoor onvoldoende als een monitor nog toegang heeft. Start de applicatie nog niet tegen een leeg Supabase-doel: de applicatie kan standaarddiensten aanmaken. Een alleen-lezen snapshot maakt de export consistent, maar neemt latere wijzigingen niet alsnog mee.

## 3. Export naar een nieuwe lokale back-upmap

Kies een nieuwe mapnaam; behoud eerdere back-ups.

```bash
node --env-file=.env.migration.local scripts/migrate-status-database.mjs export --backup .local/status-migration/amrp-neon-2026-10-23
```

De bron wordt binnen een alleen-lezen snapshot uitgelezen. De back-up bevat `manifest.json`, `schema.sql` en zeven `<tabel>.ndjson`-bestanden, met aantallen en SHA-256-controles. Het manifest bewaart ook de bronsequence. Ga uitsluitend verder na een volledig geslaagde export. Verplaats de back-up niet naar een publieke webmap. Zonder `--backup` kiest export zelf een nieuwe map onder `.local/status-migration/`; import en verify vereisen altijd een pad binnen `.local/`.

## 4. Importeren in het lege doel

Controleer eerst in het Supabase-dashboard dat `TARGET_DATABASE_URL` naar het bedoelde project wijst. De zeven doeltabellen moeten leeg zijn; bestaande applicatiegegevens worden niet overschreven.

```bash
node --env-file=.env.migration.local scripts/migrate-status-database.mjs import --backup .local/status-migration/amrp-neon-2026-10-23
```

Het script valideert de back-up vóór het verbinding met het doel maakt en importeert binnen een transactie. Het schema komt uit `schema.sql` in de back-up: een bij export gevalideerde kopie van `db/postgres.sql`, zodat latere codewijzigingen de back-up niet veranderen. Alleen de zeven applicatietabellen met hun indexen en incidentsequence zijn toegestaan.

Het script vergelijkt de geïmporteerde aantallen en gegevens met de back-up vóór commit. Ook primaire en vreemde sleutels, voorwaarden en indexen worden vergeleken. De fysieke kolomvolgorde mag verschillen; namen, typen en nullability moeten gelijk zijn. `NOT NULL` wordt apart gecontroleerd om het catalogusverschil tussen PostgreSQL 18 en 17 op te vangen. Andere anders weergegeven definities tussen PostgreSQL-versies stoppen de migratie veilig en vereisen onderzoek. Nieuwe DDL vraagt ook om een expliciete herbeoordeling van de script-allowlist.

De volgende incident-ID blijft behouden, inclusief eventuele gaten, of wordt verhoogd als dit nodig is om bestaande IDs vrij te houden. Dit gebeurt met een transactionele sequence-herstart, zodat een mislukte import kan worden teruggedraaid. Supabase-tabellen in `auth`, `storage` en andere applicaties horen buiten deze migratie te blijven.

## 5. Apart controleren en omschakelen

Voer, zolang de doelschrijvers nog gepauzeerd zijn, de controle opnieuw uit:

```bash
node --env-file=.env.migration.local scripts/migrate-status-database.mjs verify --backup .local/status-migration/amrp-neon-2026-10-23
```

Controleer daarnaast in de applicatie diensten, open en opgeloste incidenten, algemene meldingen, geselecteerde diensten, onderhoudsinstellingen en geschiedenis. Een ingeschakelde onderhoudsinstelling uit Neon blijft ook op het doel ingeschakeld.

Gebruik voor de website de generieke PostgreSQL-adapter uit deze repository. Alleen een Supabase-URL invullen bij de oude Neon-HTTP-driver werkt niet. Zet de Supabase-verbinding uitsluitend in de servervariabele `SUPABASE_DATABASE_URL` van de productieomgeving, rol die versie uit en controleer beheerlogin en monitor. Deze aparte variabele krijgt voorrang op bestaande beheerde Neon-variabelen. Houd RLS voor de zeven tabellen ingeschakeld; de bestaande backend doet de databasehandelingen. Er is geen publieke browsertoegang tot deze tabellen nodig.

Verwijder pas daarna `STATUS_DATABASE_MIGRATION_PAUSED`, rol opnieuw uit en hervat de monitor en overige schrijvers op het doel. Na nieuwe doelmetingen hoeft een vergelijking met de oude snapshot niet meer gelijk te zijn; gebruik daarom het controlebewijs van vóór hervatten.

## 6. Oude Neon-gegevens opruimen

Verwijder de brongegevens pas nadat de import en applicatiecontroles geslaagd zijn en de lokale back-up aantoonbaar herstelbaar is. Bewaar die back-up tijdens de afgesproken herstelperiode. Een terugkeer naar Neon na nieuwe Supabase-wijzigingen vereist het meenemen van die nieuwe wijzigingen.

Opruimen is een aparte, bewuste beheerhandeling. Beperk die tot de zeven hierboven genoemde `public.amrp_status_*`-tabellen en de bijbehorende incidentsequence. Controleer eerst de afhankelijkheden. Gebruik geen `DROP SCHEMA public CASCADE`, geen algemene wildcardverwijdering en verwijder geen Supabase- of andere projectgegevens. Het migratiescript heeft geen opdracht om de Neon-bron automatisch leeg te maken of het project te verwijderen.

## Hulp en foutafhandeling

```bash
node scripts/migrate-status-database.mjs --help
```

Bij een mislukte export blijft de bron behouden. Bij een mislukte import blijven de back-up en bron behouden. Als de verbinding precies tijdens commit wegvalt, is de uitkomst niet zeker: voer eerst `verify` uit. Los de oorzaak op voordat je opnieuw importeert; maak een doel met bestaande rijen niet automatisch leeg. Deel alleen de beknopte foutcategorie uit het script, geen volledige databasefouten of verbindingsstrings.

De offline regressiecontroles gebruiken tijdelijke bestanden en een nagebootste PostgreSQL-client; ze openen geen databaseverbinding en lezen geen geheimen:

```bash
node --test scripts/test-status-database-migration.mjs
```

Een geslaagde offline controle vervangt de gegevenscontrole op de echte bron en het echte doel niet.
