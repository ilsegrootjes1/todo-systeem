// Weekbord — vaste stappen per doelweek (menuweek), automatisch afgevinkt uit PIM, Builder en Drukwerk-tool.
//
// Ritme (Ilse, 18 okt 2026): op vrijdag maakt Ilse het menu en geeft Pieter GO in de PIM,
// daarna is er een week om alle voorbereidende stappen van die doelweek af te ronden.
// Het team werkt 5 weken vooruit. De uitvoer-stappen gebeuren in de week vóór de levering.
//
// Deadlines staan als dagen t.o.v. "Live" = de vrijdag waarop de menuweek start
// (vrijdag vóór de maandag van de ISO-week, zie CLAUDE.md).

export const STAPPEN = [
  // ── Voorbereiding: GO-vrijdag (Live − 35) + één week ──
  { key: 'menu',           naam: 'Nieuw menu gemaakt',               fase: 'voorbereiding', dl: -35, bron: 'PIM' },
  { key: 'go',             naam: 'Pieter GO',                        fase: 'voorbereiding', dl: -35, bron: 'PIM' },
  { key: 'pim_compleet',   naam: 'PIM compleet (open punten Ilse)',  fase: 'voorbereiding', dl: -28, bron: 'PIM' },
  { key: 'koelkast_info',  naam: 'Koelkast-productinfo verstuurd',   fase: 'voorbereiding', dl: -28, bron: 'PIM' },
  { key: 'flyer_gemaakt',  naam: 'Weekmenuflyer gemaakt',            fase: 'voorbereiding', dl: -28, bron: 'Builder' },
  { key: 'flyer_akkoord',  naam: 'Flyer goedgekeurd door Aron',      fase: 'voorbereiding', dl: -28, bron: null },
  { key: 'flyer_besteld',  naam: 'Weekmenuflyer besteld',            fase: 'voorbereiding', dl: -28, bron: 'Drukwerk' },
  { key: 'post_gemaakt',   naam: 'Weekmenupost gemaakt',             fase: 'voorbereiding', dl: -28, bron: 'Builder' },
  { key: 'post_ingepland', naam: 'Weekmenupost ingepland in Buffer', fase: 'voorbereiding', dl: -28, bron: null },
  { key: 'retentie',       naam: 'Retentie-ads naar Marcus',         fase: 'voorbereiding', dl: -28, bron: 'Builder' },
  // ── Uitvoer: in de week vóór de levering ──
  { key: 'flyer_binnen',        naam: 'Flyers binnen (depot of opgehaald)', fase: 'uitvoer', dl: -2, bron: 'Drukwerk' },
  // Bestellingen: geplaatst binnen de bestelweek zelf (vr t/m do, Ilse 20-10), dus deadline = donderdag.
  // Handmatig afvinken (Ilse 26-10): de PIM mag geen Shopify-orders lezen (geen read_orders).
  { key: 'koelkast_bestelling', naam: 'Koelkastbestelling geplaatst',       fase: 'uitvoer', dl:  6, start: '2026-W43' },
  { key: 'proef_bestelling',    naam: 'Proefbestelling geplaatst',          fase: 'uitvoer', dl:  6, start: '2026-W43' },
  { key: 'marc_bestelling',     naam: 'Bestelling Marc geplaatst',          fase: 'uitvoer', dl:  6, start: '2026-W43' },
  { key: 'live_check',          naam: 'Live menucheck',                     fase: 'uitvoer', dl:  0, bron: null },
];
const STAP = Object.fromEntries(STAPPEN.map(s => [s.key, s]));

// Weken vóór de start van het bord hebben geen bijgehouden voorbereiding; die stappen tellen daar niet mee.
const BORD_START = { voorbereiding: '2026-W46', uitvoer: '2026-W44' };

const BUILDER_URL  = 'https://thuysvers-flyer-builder.ilse-grootjes.workers.dev';
const DRUKWERK_URL = 'https://thuysvers-drukwerk.ilse-grootjes.workers.dev';

// ── Weekrekenen (ISO, UTC) ──
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const jaar = d.getUTCFullYear();
  const nr = Math.ceil(((d - Date.UTC(jaar, 0, 1)) / 864e5 + 1) / 7);
  return `${jaar}-W${String(nr).padStart(2, '0')}`;
}

function maandagVan(week) {
  const [jaar, nr] = week.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(jaar, 0, 4));
  const ma = new Date(jan4);
  ma.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (nr - 1) * 7);
  return ma;
}

function plusDagen(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

const ymd = d => d.toISOString().slice(0, 10);

export function liveVan(week) { return plusDagen(maandagVan(week), -3); }

// De menuweek die nu loopt: vanaf vrijdag hoort vandaag al bij de volgende ISO-week.
export function huidigeMenuweek(nu = new Date()) { return isoWeek(plusDagen(nu, 3)); }

export function bordWeken(nu = new Date()) {
  const start = maandagVan(huidigeMenuweek(nu));
  return Array.from({ length: 8 }, (_, i) => isoWeek(plusDagen(start, (i - 1) * 7)));
}

// ── Database ──
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS stap (
     week TEXT NOT NULL, stap TEXT NOT NULL,
     klaar_at TEXT, bron TEXT, door TEXT, info TEXT, link TEXT, gecheckt_at TEXT,
     PRIMARY KEY (week, stap))`,
  `CREATE TABLE IF NOT EXISTS stap_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
     week TEXT NOT NULL, stap TEXT NOT NULL, actie TEXT NOT NULL, bron TEXT, door TEXT, detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
];

async function zorgVoorSchema(db) {
  await db.batch(SCHEMA.map(s => db.prepare(s)));
}

async function log(db, { week, stap, actie, bron = null, door = null, detail = null }) {
  await db.prepare('INSERT INTO stap_log (at, week, stap, actie, bron, door, detail) VALUES (?,?,?,?,?,?,?)')
    .bind(new Date().toISOString(), week, stap, actie, bron, door, detail).run();
}

// ── Bronnen ophalen ──
// Elke bron geeft { ok, fout?, uitkomst: { [week]: { [stap]: { klaar, at?, door?, info?, link? } } } }.
// klaar === null betekent "weet ik niet" (dan blijft de stap zoals hij is).

async function haalJson(url, init, binding) {
  const res = binding ? await binding.fetch(url, init) : await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
  if (!(res.headers.get('content-type') || '').includes('json')) throw new Error(`geen geldig antwoord van ${url.split('?')[0]} (route nog niet live?)`);
  return res.json();
}

async function bronPim(env, weken) {
  if (!env.PIM_URL || !env.WEEKSTATUS_API_KEY) return { ok: false, fout: 'PIM-koppeling nog niet ingesteld', uitkomst: {} };
  const base = env.PIM_URL.replace(/\/$/, '');
  const data = await haalJson(`${base}/api/week-status?weken=${weken.join(',')}`, {
    headers: { 'X-Api-Key': env.WEEKSTATUS_API_KEY },
  });
  const uitkomst = {};
  for (const w of data.weken || []) {
    const op = w.ilseOpenPunten || { fouten: 0, waarschuwingen: 0 };
    const open = (op.fouten || 0) + (op.waarschuwingen || 0);
    const kk = w.koelkast || [];
    uitkomst[w.week] = {
      menu: { klaar: !!w.menu?.gepland, at: w.menu?.eersteAt, info: w.menu?.gepland ? `${w.menu.aantal} gerechten gepland` : null },
      go:   { klaar: !!w.go?.akkoord, at: w.go?.at, door: w.go?.door },
      pim_compleet: w.menu?.gepland
        ? { klaar: open === 0, info: open ? `${open} open punt${open === 1 ? '' : 'en'} (${op.fouten || 0} fout)` : 'geen open punten' }
        : { klaar: null },
      koelkast_info: kk.length
        ? { klaar: true, at: kk[0].at, door: kk[0].door, info: kk.map(k => k.bedrijfNaam || `bedrijf ${k.bedrijfId}`).join(', ') }
        : { klaar: false },
    };
  }
  return { ok: true, uitkomst };
}

async function bronBuilder(env, weken) {
  const tools = ['flyer', 'post', 'retentie', 'retentie-mail'];
  const lijsten = await Promise.all(tools.map(t =>
    haalJson(`${BUILDER_URL}/api/logboek?tool=${t}`, undefined, env.BUILDER).then(d => d.regels || []).catch(() => null)
  ));
  if (lijsten.slice(0, 3).every(l => l === null)) throw new Error('Builder-logboek niet bereikbaar');
  const eerste = (tool, week) => {
    const regels = (lijsten[tools.indexOf(tool)] || []).filter(r => r.week === week);
    return regels.length ? regels[regels.length - 1] : null; // nieuwste staat bovenaan
  };
  const uitkomst = {};
  for (const week of weken) {
    const flyer = eerste('flyer', week), post = eerste('post', week);
    const ret = eerste('retentie', week), mail = eerste('retentie-mail', week);
    uitkomst[week] = {
      flyer_gemaakt: flyer ? { klaar: true, at: flyer.at } : { klaar: false },
      post_gemaakt:  post  ? { klaar: true, at: post.at }  : { klaar: false },
      retentie: mail ? { klaar: true, at: mail.at, info: 'gemaild vanuit de Builder' }
              : { klaar: false, info: ret ? 'gemaakt, nog niet gemaild' : null },
    };
  }
  return { ok: true, uitkomst };
}

async function bronDrukwerk(env, weken) {
  const { docs = [] } = await haalJson(`${DRUKWERK_URL}/api/c/orders`, undefined, env.DRUKWERK);
  const flyers = docs.filter(o => o.type === 'Weekmenuflyer' && !o.retour);
  const uitkomst = {};
  for (const week of weken) {
    const o = flyers.find(x => x.doelweek === week);
    const binnen = o && (o.depot?.at || o.opgehaald?.at);
    uitkomst[week] = {
      flyer_besteld: o ? { klaar: true, at: o.orderdatum, info: `${o.leverancier || ''} #${o.ordernr}`.trim() } : { klaar: false },
      flyer_binnen: binnen
        ? { klaar: true, at: binnen, door: o.opgehaald?.by || o.depot?.by, info: o.opgehaald?.at ? 'opgehaald' : 'op depot' }
        : { klaar: o ? false : null },
    };
  }
  const zonderWeek = flyers.filter(o => !o.doelweek && o.orderdatum >= ymd(plusDagen(new Date(), -60)));
  return {
    ok: true, uitkomst,
    waarschuwing: zonderWeek.length
      ? `${zonderWeek.length} weekmenuflyer-bestelling${zonderWeek.length === 1 ? '' : 'en'} zonder doelweek in de Drukwerk-tool (${zonderWeek.map(o => '#' + o.ordernr).join(', ')})`
      : null,
  };
}

// ── Synchroniseren ──
export async function sync(env, nu = new Date()) {
  const db = env.DB;
  await zorgVoorSchema(db);
  const weken = bordWeken(nu);
  const bronnen = { PIM: bronPim, Builder: bronBuilder, Drukwerk: bronDrukwerk };
  const status = {};
  const nuIso = nu.toISOString();

  const bestaand = {};
  const { results } = await db.prepare(`SELECT * FROM stap WHERE week IN (${weken.map(() => '?').join(',')})`).bind(...weken).all();
  for (const r of results) bestaand[`${r.week}|${r.stap}`] = r;

  for (const [naam, fn] of Object.entries(bronnen)) {
    let res;
    try { res = await fn(env, weken); }
    catch (e) { status[naam] = { ok: false, fout: e.message }; continue; }
    status[naam] = { ok: res.ok, fout: res.fout || null, waarschuwing: res.waarschuwing || null };

    for (const [week, stappen] of Object.entries(res.uitkomst)) {
      for (const [stap, u] of Object.entries(stappen)) {
        if (!STAP[stap]) continue;
        const rij = bestaand[`${week}|${stap}`];
        const wasKlaar = !!rij?.klaar_at;
        let klaarAt = rij?.klaar_at || null, bron = rij?.bron || null, door = rij?.door || null;

        if (u.klaar === true && !wasKlaar) {
          klaarAt = u.at || nuIso; bron = naam; door = u.door || null;
          await log(db, { week, stap, actie: 'automatisch afgevinkt', bron: naam, door, detail: u.info || null });
        } else if (u.klaar === false && wasKlaar && rij?.bron === naam) {
          // De bron zegt expliciet dat het niet (meer) klopt, bv. GO ingetrokken of nieuw open punt.
          klaarAt = null; bron = null; door = null;
          await log(db, { week, stap, actie: 'heropend door bron', bron: naam, detail: u.info || null });
        }

        await db.prepare(`INSERT INTO stap (week, stap, klaar_at, bron, door, info, link, gecheckt_at)
                          VALUES (?,?,?,?,?,?,?,?)
                          ON CONFLICT (week, stap) DO UPDATE SET
                            klaar_at = excluded.klaar_at, bron = excluded.bron, door = excluded.door,
                            info = excluded.info, link = excluded.link, gecheckt_at = excluded.gecheckt_at`)
          .bind(week, stap, klaarAt, bron, door, u.info ?? null, u.link ?? null, nuIso).run();
      }
    }
  }

  await db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v')
    .bind('laatste_sync', JSON.stringify({ at: nuIso, status })).run();
  return { at: nuIso, status };
}


// ── Bord opbouwen voor de frontend ──
export async function bord(env, nu = new Date()) {
  const db = env.DB;
  await zorgVoorSchema(db);
  const weken = bordWeken(nu);
  const { results } = await db.prepare(`SELECT * FROM stap WHERE week IN (${weken.map(() => '?').join(',')})`).bind(...weken).all();
  const rijen = Object.fromEntries(results.map(r => [`${r.week}|${r.stap}`, r]));
  const meta = await db.prepare(`SELECT v FROM meta WHERE k = 'laatste_sync'`).first();
  const vandaag = ymd(nu);

  return {
    vandaag,
    huidigeMenuweek: huidigeMenuweek(nu),
    laatsteSync: meta ? JSON.parse(meta.v) : null,
    weken: weken.map(week => {
      const live = liveVan(week);
      const stappen = STAPPEN.map(s => {
        const r = rijen[`${week}|${s.key}`] || {};
        const deadline = ymd(plusDagen(live, s.dl));
        const dagenOver = Math.round((new Date(deadline) - new Date(vandaag)) / 864e5);
        const bronStuk = s.bron && meta && JSON.parse(meta.v).status?.[s.bron]?.ok === false;
        const status = r.klaar_at ? 'klaar'
          : week < (s.start || BORD_START[s.fase]) ? 'nvt'
          : bronStuk ? 'onbekend'
          : dagenOver < 0 ? 'te-laat' : dagenOver <= 2 ? 'bijna' : 'open';
        return {
          key: s.key, naam: s.naam, fase: s.fase, automatisch: s.bron, deadline, status,
          klaarAt: r.klaar_at || null, bron: r.bron || null, door: r.door || null, info: r.info || null, link: r.link || null,
        };
      });
      return { week, live: ymd(live), stappen };
    }),
  };
}

// ── Handmatig afvinken / heropenen ──
export async function zetHandmatig(env, week, stap, { klaar, door }) {
  if (!/^\d{4}-W\d{2}$/.test(week) || !STAP[stap]) throw new Error('Onbekende week of stap');
  const db = env.DB;
  await zorgVoorSchema(db);
  const nuIso = new Date().toISOString();
  door = (door || 'Ilse').slice(0, 40);
  if (klaar) {
    await db.prepare(`INSERT INTO stap (week, stap, klaar_at, bron, door) VALUES (?,?,?,?,?)
                      ON CONFLICT (week, stap) DO UPDATE SET klaar_at = excluded.klaar_at, bron = excluded.bron, door = excluded.door`)
      .bind(week, stap, nuIso, 'handmatig', door).run();
  } else {
    await db.prepare(`UPDATE stap SET klaar_at = NULL, bron = NULL, door = NULL WHERE week = ? AND stap = ?`).bind(week, stap).run();
  }
  await log(db, { week, stap, actie: klaar ? 'handmatig afgevinkt' : 'handmatig heropend', bron: 'handmatig', door });
}

export async function logboek(env, week) {
  await zorgVoorSchema(env.DB);
  const q = week
    ? env.DB.prepare('SELECT * FROM stap_log WHERE week = ? ORDER BY id DESC LIMIT 200').bind(week)
    : env.DB.prepare('SELECT * FROM stap_log ORDER BY id DESC LIMIT 200');
  return (await q.all()).results;
}
