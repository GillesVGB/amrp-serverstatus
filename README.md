# Amsterdam Roleplay — Live status

Een zelfstandige statuswebsite voor de Amsterdam Roleplay FiveM-servers, Discord-bot, MEOS en overheidsportaal. De pagina gebruikt een lichte statusweergave met beschikbaarheidsbalken, plus een lokaal opgeslagen donker thema.

## Wat de website controleert

Zolang iemand de statuspagina open heeft, wordt elke vijf seconden een meting uitgevoerd. De hoofdserver op poort 30120 en de devserver op poort 30121 worden via FiveM `dynamic.json` gecontroleerd. MEOS, het overheidsportaal en andere websites worden via HTTP(S) gecontroleerd. Een botpoort zonder HTTP-healthroute kan niet bevestigen dat het botproces zelf draait en wordt daarom als niet gecontroleerd getoond.

De grafiek laat de afgelopen 60 minuten zien; ieder vakje staat voor één minuut. Diensten, onderhoudsmeldingen en meetgeschiedenis worden opgeslagen in PostgreSQL via Neon. Daardoor blijven ingestelde diensten en eerdere metingen beschikbaar na verversen, een nieuwe bezoeker of een nieuwe Vercel-deploy. Metingen lopen alleen zolang de pagina door een bezoeker wordt bekeken.

Open een dienst met storing of onderhoud via de knop eronder om de uitleg te lezen. Beheerders kunnen in `/admin` een dienst op oranje onderhoud zetten, bezoekersmelding instellen, diensten toevoegen, aanpassen, pauzeren en verwijderen. Technische controleadressen staan niet op de openbare statuspagina of in haar API-respons.

## Vercel en Neon instellen

Koppel de repository aan Vercel en laat Vercel het project herkennen als Next.js. De standaardbuild is `npm run build`; Vercel bouwt daarmee de Next.js-app en de serverroutes.

Koppel een Neon PostgreSQL-database aan dit Vercel-project. Stel daarna voor Production en Preview deze servervariabelen in:

- `DATABASE_URL` — Neon-connection string.
- `ADMIN_PASSWORD_SALT` — kopieer de bestaande waarde uit het genegeerde lokale `.dev.vars`-bestand.
- `ADMIN_PASSWORD_HASH` — kopieer de bestaande waarde uit `.dev.vars`.
- `ADMIN_SESSION_SECRET` — kopieer de bestaande waarde uit `.dev.vars`.

De tabellen en standaarddiensten worden automatisch toegevoegd bij de eerste statusaanvraag. Het schema staat ook in `db/postgres.sql`. Gebruik op Vercel nooit het daadwerkelijke `.dev.vars`-bestand en commit geen geheimen. In `.env.example` staan alleen invulnamen. Maak na het instellen van variabelen een nieuwe deploy.

Dezelfde Neon-database kan alleen door deze statusapp worden gebruikt als de juiste `DATABASE_URL` voor dit Vercel-project is ingesteld. Diensten en onderhoudsstatus zijn gedeeld voor alle bezoekers; het gekozen kleurenthema wordt lokaal per browser opgeslagen.

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
