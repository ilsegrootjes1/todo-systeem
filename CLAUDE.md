# Ilse's To-do systeem — projectcontext

## Wat is dit
Een persoonlijk taakbeheersysteem voor Ilse (ilse.grootjes@thuysvers.nl) gebouwd op:
- **Frontend**: `index.html` — statische pagina gedeployd via Cloudflare Pages (GitHub → auto-deploy)
- **Backend**: `api/index.js` — Cloudflare Worker op `https://todo-api.ilse-grootjes.workers.dev`
- **Data**: Notion databases (taken + 3 projectdatabases)
- **Repo**: https://github.com/ilsegrootjes1/todo-systeem

## Deployen
- **Frontend**: `git push` → GitHub Actions deployt automatisch naar Cloudflare Pages
- **Worker**: `cd api && CLOUDFLARE_API_TOKEN=<token-uit-wachtwoordmanager> npx wrangler deploy`

## Cloudflare Worker cron
Draait elke 30 minuten (ook zonder laptop): scant Gmail, slaat actie-voorstellen op in Notion.

## Notion databases
| Database | ID |
|---|---|
| Taken (hoofd) | `47ae20e8-094b-475b-81fc-7efdf7f5d069` |
| Weekmenuflyer (WMF) | `33d17522-60d6-8044-b429-debae08d8cab` |
| Koelkast | `87de96d6-051b-4035-959b-63fe753b1319` |
| Menuplanning | `8808d20d-d534-4413-9f46-1904a430bc1c` |

Notion token: staat als Worker-secret `NOTION_TOKEN` (zie Cloudflare dashboard)  
Cloudflare account ID: `2025734d6fc7a5fa3c277c8913cf9931`

## Taken-database: belangrijke velden
- **Taak** (title), **Deadline** (date), **Doelweek** (formula), **Klaar** (checkbox)
- **Project** (select): Weekmenuflyer · Menuplanning · Koelkast · Social posts · Overig · Gmail
- **Herhaling** (select): Wekelijks · 2 wekelijks · 4 wekelijks
- **Opmerking** (rich_text), **Status** (select), **Te laat** (formula)

## Doelweek-formula (kritiek!)
De Doelweek wordt berekend vanuit de taaknaam + deadline:
- naam bevat `(week +4)` of `pieter heeft menu go` → deadline + 4 weken
- naam bevat `(week +2)` → deadline + 2 weken
- anders → deadline + 1 week

## Herhaling-mechanisme
Als een taak met Herhaling=Wekelijks wordt afgevinkt (PATCH klaar:true), maakt de Worker automatisch een nieuwe taak aan met deadline + 7 dagen. Ilse werkt maximaal 4 weken vooruit — taken verder weg worden niet pre-aangemaakt.

## 15 standaard terugkerende taken
Elke week horen deze taken te bestaan (allemaal Herhaling=Wekelijks):
1. Nieuw menu maken (week +4)
2. Samengevoegde weekmenu sheet updaten + controleren (week +4)
3. Weekmenuflyer maken (week +4)
4. Koelkast productinformatie invullen en sturen (week +4)
5. Pieter heeft menu GO gegeven
6. Menucheck in verborgen collectie (week +2)
7. Weekmenuflyer bestellen (week +2)
8. Weekmenu post inplannen (week +2)
9. Retentie ads klaarzetten (week +2)
10. Import draaien (week +2)
11. Menu klaarzetten incl. nieuwe gerechten + foto's
12. Koelkast bestelling plaatsen
13. Bestelling proeven plaatsen
14. Aftelklok posten
15. Inhaakdagen aanvullen

## STATUS_RULES (automatische projectstatus-updates)
Als een taak wordt afgevinkt, updaten deze regels de projectdatabases:
- **nieuw menu maken** → Menu: Menu gemaakt · Koelkast: Wachtend op GO Pieter · WMF: Wachtend op GO Pieter
- **pieter heeft menu go** → Menu: Pieter GO · Koelkast: Bezig · WMF: Bezig
- **weekmenuflyer maken** → WMF: Klaar voor proofread
- **weekmenuflyer bestellen** → WMF: Besteld
- **koelkast productinformatie** → Koelkast: Product informatie verwerkt
- **koelkast bestelling plaatsen** → Koelkast: Bestelling geplaatst
- enz. (zie STATUS_RULES in api/index.js)

## Gmail-voorstellen
- Worker haalt elke 30 min nieuwe mails op en slaat actie-voorstellen op als Notion-taken (Project=Gmail)
- Frontend toont ze apart; "Invoegen" vult automatisch project/deadline in
- "Weigeren" archiveert de Notion-pagina en markeert mail als gelezen
- Alleen mails met expliciete actieverzoeken worden voorgesteld (geen orderbevestigingen, noreply, losse ?)

## Overzicht-tab
- Groepeert taken per Doelweek
- Weken verder dan curWeek+4 en eerder dan curWeek-4 zijn standaard ingeklapt
- Toont per week ook de projectstatus (WMF · Koelkast · Menuplanning) uit de projectdatabases

## Mail-templates
- **Retentie ads**: "ik heb de retentie ads voor week X in het mapje gezet" + link inline
- **Weekmenuflyer**: vraagt proofread aan Pieter
- **Koelkast**: stuurt productinformatie

## WMF-database titelproperty
Heet "Doc name" (niet "Week" zoals bij de andere twee).
