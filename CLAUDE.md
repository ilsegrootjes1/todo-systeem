# Ilse's To-do systeem — projectcontext

## Wat is dit
Een persoonlijk taakbeheersysteem voor Ilse (ilse.grootjes@thuysvers.nl) gebouwd op:
- **Frontend**: `index.html` — statische pagina gedeployd via Cloudflare Pages (GitHub → auto-deploy)
- **Backend**: `api/index.js` — Cloudflare Worker op `https://todo-api.ilse-grootjes.workers.dev`
- **Data**: Notion databases (taken + gecombineerde Weekoverzicht-database)
- **Repo**: https://github.com/ilsegrootjes1/todo-systeem

## Deployen
- **Frontend**: `git push` → GitHub Actions deployt automatisch naar Cloudflare Pages
- **Worker**: `cd api && CLOUDFLARE_API_TOKEN=<token-uit-wachtwoordmanager> npx wrangler deploy`

## Notion databases
| Database | ID |
|---|---|
| Taken (hoofd) | `47ae20e8-094b-475b-81fc-7efdf7f5d069` |
| Weekoverzicht (gecombineerd) | `38217522-60d6-819b-ba0b-cbd50c11e372` |

De 3 afzonderlijke projectdatabases (WMF, Koelkast, Menuplanning) zijn vervangen door één gecombineerde Weekoverzicht database met kolommen: Week (titel) | Menuplanning (select) | Weekmenuflyer (select) | Koelkast (select). Elke rij = één week.

Notion token: staat als Worker-secret `NOTION_TOKEN` (zie Cloudflare dashboard)  
Cloudflare account ID: `2025734d6fc7a5fa3c277c8913cf9931`

## Taken-database: belangrijke velden
- **Taak** (title), **Deadline** (date), **Doelweek** (formula), **Klaar** (checkbox)
- **Project** (select): Weekmenuflyer · Menuplanning · Koelkast · Social posts · Overig
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
Als een taak wordt afgevinkt, updaten deze regels de projectdatabases.
**Bron van waarheid = de app**, Notion is alleen opslag.

### Koelkast
| Taak | Status |
|---|---|
| Nieuw menu maken | Wachtend op GO Pieter |
| Pieter heeft menu GO gegeven | Bezig |
| Koelkast productinformatie invullen en sturen | Product informatie verwerkt |
| Koelkast bestelling plaatsen | Bestelling geplaatst |
| *(bezorgd — handmatig)* | Klaar |

### Weekmenuflyer
| Taak | Status |
|---|---|
| Nieuw menu maken | Wachtend op GO Pieter |
| Pieter heeft menu GO gegeven | Bezig |
| Weekmenuflyer maken | Klaar voor proofread |
| Weekmenuflyer bestellen | Besteld |
| *(geleverd Utrecht — handmatig)* | Geleverd |

### Menuplanning
| Taak | Status |
|---|---|
| Nieuw menu maken | Menu gemaakt |
| Pieter heeft menu GO gegeven | Pieter GO |
| Menu klaarzetten incl. nieuwe gerechten + foto's | Menu klaargezet in Shopify |
| Import draaien | Import gedraaid |
| Menucheck in verborgen collectie | Collectie gecheckt |
| Live menucheck | Live gegaan |

### Statusvolgorde en synchronisatie (twee richtingen)
- Elke kolom heeft een vaste statusvolgorde (`STATUS_ORDER` in `api/index.js`). Een taak afvinken zet de status alleen **vooruit**, nooit terug — als de status handmatig al verder staat dan wat de taak zou zetten, gebeurt er niets.
- Omgekeerd: een status handmatig aanpassen in het Overzicht vinkt automatisch alle nog openstaande taken af die bij die status of een eerdere status in de volgorde horen (voor die week/project). Zo lopen taken en Overzicht-status niet meer uit elkaar.

## Overzicht-tab — gewenste layout

Kolommen: **Week | Live | Menuplanning status | Menuplanning deadline | Flyer status | Flyer deadline | Koelkast status | Koelkast deadline**

- **Week**: ISO-weeknummer (Week 26)
- **Live**: de vrijdag van die ISO-week (= start ThuysVers menuweek). Berekend als `monday - 3 dagen`. Voorbeeld: week 26 = vr 19 jun 2026.
- Per project: huidige status + deadline waarop die status bereikt had moeten zijn (afgeleid van Live-datum)
- **Rood** als vandaag > deadline van de huidige status
- Verleden weken (alles "Live gegaan"/"Geleverd"/"Klaar") hebben geen deadline meer
- Weken verder dan curWeek+4 en eerder dan curWeek-4 zijn standaard ingeklapt

### Status-deadlines per project (offset t.o.v. Live-datum)

**Koelkast**
| Status | Deadline |
|---|---|
| Nog niet begonnen | — |
| Wachtend op GO Pieter | Live − 4 weken |
| Bezig | Live − 4 weken |
| Product informatie verwerkt | Live − 2 weken |
| Bestelling geplaatst | Live (0) |
| Klaar | Live + 10 dagen |

**Menuplanning**
| Status | Deadline |
|---|---|
| Menu gemaakt | Live − 4 weken |
| Pieter GO | Live − 4 weken |
| Menu klaargezet in Shopify | Live − 2 weken |
| Import gedraaid | Live − 2 weken |
| Collectie gecheckt | Live − 1 week |
| Live gegaan | Live (0) |

**Weekmenuflyer**
| Status | Deadline |
|---|---|
| Nog niet begonnen | — |
| Wachtend op GO Pieter | Live − 4 weken |
| Bezig | Live − 4 weken |
| Klaar voor proofread | Live − 3 weken |
| Besteld | Live − 14 dagen |
| Geleverd | Live − 1 week |

### Live-datum berekening
```
Live (vrijdag) van ISO-week N:
  jan4 = 4 jan van huidig jaar
  monday = jan4 - (jan4.day - 1) + (N-1)*7
  friday = monday - 3
```

## Mail-templates
- **Retentie ads**: "ik heb de retentie ads voor week X in het mapje gezet" + link inline
- **Weekmenuflyer**: vraagt proofread aan Pieter
- **Koelkast**: stuurt productinformatie
