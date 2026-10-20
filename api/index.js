import { sync, bord, zetHandmatig, logboek } from './weken.js';

const TASKS_DB    = '47ae20e8-094b-475b-81fc-7efdf7f5d069';
const OVERZICHT_DB = '38217522-60d6-819b-ba0b-cbd50c11e372';

const SYSTEM_PROJECTS = ['Weekmenuflyer', 'Menuplanning', 'Koelkast'];
const PROJECT_KLEUREN = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

// col = kolomnaam in OVERZICHT_DB
const STATUS_RULES = [
  { match: 'nieuw menu maken', updates: [
    { col: 'Menuplanning',  status: 'Menu gemaakt' },
    { col: 'Koelkast',      status: 'Wachtend op GO Pieter' },
    { col: 'Weekmenuflyer', status: 'Wachtend op GO Pieter' },
  ]},
  { match: 'pieter heeft menu go', updates: [
    { col: 'Menuplanning',  status: 'Pieter GO' },
    { col: 'Koelkast',      status: 'Bezig' },
    { col: 'Weekmenuflyer', status: 'Bezig' },
  ]},
  { match: 'menu klaarzetten',           updates: [{ col: 'Menuplanning',  status: 'Menu klaargezet in Shopify' }] },
  { match: 'import draaien',             updates: [{ col: 'Menuplanning',  status: 'Import gedraaid' }] },
  { match: 'menucheck in verborgen',     updates: [{ col: 'Menuplanning',  status: 'Collectie gecheckt' }] },
  { match: 'live menucheck',             updates: [{ col: 'Menuplanning',  status: 'Live gegaan' }] },
  { match: 'weekmenuflyer maken',        updates: [{ col: 'Weekmenuflyer', status: 'Klaar voor proofread' }] },
  { match: 'weekmenuflyer bestellen',    updates: [{ col: 'Weekmenuflyer', status: 'Besteld' }] },
  { match: 'koelkast productinformatie', updates: [{ col: 'Koelkast',      status: 'Product informatie verwerkt' }] },
  { match: 'koelkast bestelling',        updates: [{ col: 'Koelkast',      status: 'Bestelling geplaatst' }] },
];

// Volgorde van statussen per kolom — bepaalt of een update de status vooruit zet (nooit terug)
const STATUS_ORDER = {
  Weekmenuflyer: ['Nog niet begonnen', 'Wachtend op GO Pieter', 'Bezig', 'Klaar voor proofread', 'Besteld', 'Geleverd'],
  Koelkast:      ['Nog niet begonnen', 'Wachtend op GO Pieter', 'Bezig', 'Product informatie verwerkt', 'Bestelling geplaatst', 'Klaar'],
  Menuplanning:  ['Menu gemaakt', 'Pieter GO', 'Menu klaargezet in Shopify', 'Import gedraaid', 'Collectie gecheckt', 'Live gegaan'],
};

function statusRank(col, status) {
  const order = STATUS_ORDER[col] || [];
  const i = order.indexOf(status);
  return i === -1 ? -1 : i;
}

const HERHALING_DAYS = { 'Wekelijks': 7, '2 wekelijks': 14, '4 wekelijks': 28 };

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function queryAllOvz(env) {
  let results = [], cursor;
  do {
    const body = { page_size: 100, sorts: [{ timestamp: 'created_time', direction: 'ascending' }] };
    if (cursor) body.start_cursor = cursor;
    const data = await notion(env, `/databases/${OVERZICHT_DB}/query`, 'POST', body);
    if (!data.results) throw new Error(`Notion DB fout: ${data.message || data.code || JSON.stringify(data)}`);
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

function weekNumFromTitle(title) {
  const m = (title || '').match(/\d+/);
  return m ? parseInt(m[0]) : null;
}

function isoWeekNum(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - jan1) / 86400000) + 1) / 7);
}

function doelweekFromDeadline(taskName, deadline) {
  if (!deadline) return null;
  const lower = taskName.toLowerCase();
  let offsetDays = 7;
  if (lower.includes('pieter heeft menu go') || lower.includes('week +4')) offsetDays = 28;
  else if (lower.includes('week +2')) offsetDays = 14;
  const targetDate = addDays(deadline, offsetDays);
  return `Week ${isoWeekNum(targetDate)}`;
}

// Zet in gang wat er moet gebeuren zodra een taak wordt afgevinkt: Overzicht-status vooruit zetten + volgende herhaling aanmaken
async function completeTaskSideEffects(env, { taak, doelweek, deadline, herhaling, project, opmerking }) {
  await maybeUpdateProjectStatus(env, taak, doelweek, deadline);

  if (!herhaling || !HERHALING_DAYS[herhaling] || !deadline) return;
  const nextDeadline = addDays(deadline, HERHALING_DAYS[herhaling]);

  const fourWeeksOut = new Date();
  fourWeeksOut.setUTCDate(fourWeeksOut.getUTCDate() + 28);
  if (new Date(nextDeadline + 'T12:00:00Z') > fourWeeksOut) return;

  const dupCheck = await notion(env, `/databases/${TASKS_DB}/query`, 'POST', {
    filter: {
      and: [
        { property: 'Taak',     title:    { equals: taak } },
        { property: 'Klaar',    checkbox: { equals: false } },
        { property: 'Deadline', date:     { equals: nextDeadline } },
      ]
    },
    page_size: 1,
  });
  if (dupCheck.results.length) return;

  const nextProps = {
    Taak:      { title: [{ text: { content: taak } }] },
    Deadline:  { date: { start: nextDeadline } },
    Herhaling: { select: { name: herhaling } },
  };
  if (project)   nextProps.Project   = { select: { name: project } };
  if (opmerking) nextProps.Opmerking = { rich_text: [{ text: { content: opmerking } }] };
  await notion(env, '/pages', 'POST', { parent: { database_id: TASKS_DB }, properties: nextProps });
}

// Vindt open taken die bij het bereiken van (col, status) horen en vinkt ze af — omgekeerde richting van STATUS_RULES
async function syncTasksForOverzichtStatus(env, rowId, col, status) {
  const targetRank = statusRank(col, status);
  if (targetRank === -1) return;

  const rules = STATUS_RULES.filter(r =>
    r.updates.some(u => u.col === col && statusRank(col, u.status) <= targetRank)
  );
  if (!rules.length) return;

  const rowPage = await notion(env, `/pages/${rowId}`);
  const tp = Object.values(rowPage.properties).find(x => x.type === 'title');
  const targetWeekNum = weekNumFromTitle(tp?.title?.[0]?.plain_text || '');
  if (!targetWeekNum) return;

  const data = await notion(env, `/databases/${TASKS_DB}/query`, 'POST', {
    filter: { property: 'Klaar', checkbox: { equals: false } },
    page_size: 100,
  });

  for (const page of data.results) {
    const name = (page.properties.Taak.title[0]?.plain_text || '').toLowerCase();
    if (!rules.some(r => name.includes(r.match))) continue;
    const doelweek = page.properties.Doelweek.formula?.string || '';
    if (weekNumFromTitle(doelweek) !== targetWeekNum) continue;

    await notion(env, `/pages/${page.id}`, 'PATCH', { properties: { Klaar: { checkbox: true } } });
    const t = formatTask(page);
    await completeTaskSideEffects(env, t);
  }
}

async function maybeUpdateProjectStatus(env, taskName, doelweek, deadline) {
  if (!taskName) return;
  const lower = taskName.toLowerCase();
  const rule = STATUS_RULES.find(r => lower.includes(r.match));
  if (!rule) return;

  const resolved = doelweek || doelweekFromDeadline(taskName, deadline);
  if (!resolved) return;
  const targetWeekNum = weekNumFromTitle(resolved);
  if (!targetWeekNum) return;

  const rows = await queryAllOvz(env);
  const entry = rows.find(p => {
    const tp = Object.values(p.properties).find(x => x.type === 'title');
    return weekNumFromTitle(tp?.title?.[0]?.plain_text) === targetWeekNum;
  });

  const properties = {};
  rule.updates.forEach(({ col, status }) => {
    const currentStatus = entry?.properties?.[col]?.select?.name || null;
    const currentRank = currentStatus ? statusRank(col, currentStatus) : -1;
    if (statusRank(col, status) <= currentRank) return; // al verder gezet, niet terugdraaien
    properties[col] = { select: { name: status } };
  });
  if (!Object.keys(properties).length) return;

  if (entry) {
    await notion(env, `/pages/${entry.id}`, 'PATCH', { properties });
  } else {
    await notion(env, '/pages', 'POST', {
      parent: { database_id: OVERZICHT_DB },
      properties: { Week: { title: [{ text: { content: doelweek } }] }, ...properties },
    });
  }
}

// Weekbord → Notion: een eigen database "Weekbord" (één rij per menuweek, één kolom per stap; id in var
// NOTION_WEEKBORD_DB, de integratie moet er via "Verbindingen" toegang toe hebben),
// zodat Aron in Notion precies ziet wat er op het weekbord staat. Alleen gewijzigde weken worden bijgewerkt.
const NOTION_STATUS = {
  klaar:     { name: '✓ Klaar', color: 'green' },
  open:      { name: 'Open',    color: 'default' },
  bijna:     { name: 'Bijna',   color: 'orange' },
  'te-laat': { name: 'Te laat', color: 'red' },
  nvt:       { name: 'n.v.t.',  color: 'gray' },
  onbekend:  { name: 'Wacht op koppeling', color: 'yellow' },
};
const DAG = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MAAND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const kortDatum = iso => { const d = new Date(iso + 'T12:00:00Z'); return `${DAG[d.getUTCDay()]} ${d.getUTCDate()} ${MAAND[d.getUTCMonth()]}`; };
const tekst = t => ({ rich_text: t ? [{ text: { content: t.slice(0, 1900) } }] : [] });

async function metaGet(env, k) {
  const r = await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first();
  return r ? JSON.parse(r.v) : null;
}
async function metaSet(env, k, v) {
  await env.DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v)).run();
}

async function weekbordNaarNotion(env, { forceer = false } = {}) {
  const b = await bord(env);
  const dbId = env.NOTION_WEEKBORD_DB;
  if (!dbId) throw new Error('NOTION_WEEKBORD_DB ontbreekt');
  let bijgewerkt = 0;
  for (const w of b.weken) {
    const tellend = w.stappen.filter(s => s.status !== 'nvt');
    const open = tellend.filter(s => s.status !== 'klaar');
    const properties = {
      Week: { title: [{ text: { content: `Week ${parseInt(w.week.split('-W')[1])}` } }] },
      Live: { date: { start: w.live } },
      Voortgang: tekst(`${tellend.length - open.length}/${tellend.length}`),
      'Te laat': { number: open.filter(s => s.status === 'te-laat').length },
      'Nog open': tekst(open.map(s => `${s.status === 'te-laat' ? '⚠ ' : ''}${s.naam} (${s.status === 'onbekend' ? 'wacht op ' + s.automatisch : kortDatum(s.deadline)})`).join(', ')),
    };
    for (const s of w.stappen) properties[s.naam] = { select: { name: NOTION_STATUS[s.status].name } };

    const hash = JSON.stringify(properties);
    const vorige = await metaGet(env, `notion_wk_${w.week}`);
    if (!forceer && vorige?.hash === hash) continue;
    properties.Bijgewerkt = { date: { start: new Date().toISOString() } };

    let pageId = vorige?.pageId;
    if (pageId) {
      const r = await notion(env, `/pages/${pageId}`, 'PATCH', { properties });
      if (r.object === 'error') pageId = null;
    }
    if (!pageId) {
      const r = await notion(env, '/pages', 'POST', { parent: { database_id: dbId }, properties });
      if (!r.id) throw new Error(`Notion: rij ${w.week} mislukt (${r.message || r.code}). Heeft de integratie toegang tot de database Weekbord?`);
      pageId = r.id;
    }
    await metaSet(env, `notion_wk_${w.week}`, { pageId, hash });
    bijgewerkt++;
  }
  return { dbId, bijgewerkt };
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function notion(env, path, method = 'GET', body = null) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function formatTask(page) {
  return {
    id: page.id,
    taak: page.properties.Taak.title[0]?.plain_text || '',
    deadline: page.properties.Deadline.date?.start || null,
    doelweek: page.properties.Doelweek.formula?.string || '',
    project: page.properties.Project.select?.name || null,
    projectColor: page.properties.Project.select?.color || null,
    status: page.properties.Status.select?.name || null,
    klaar: page.properties.Klaar.checkbox,
    teLaat: page.properties['Te laat'].formula?.string || '',
    opmerking: page.properties.Opmerking.rich_text[0]?.plain_text || '',
    herhaling: page.properties.Herhaling?.select?.name || null,
    lastEdited: page.last_edited_time || null,
  };
}

function formatOvzRow(page) {
  const tp = Object.entries(page.properties).find(([, v]) => v.type === 'title');
  return {
    id: page.id,
    week: tp?.[1]?.title?.[0]?.plain_text || '',
    menuplanning:  page.properties.Menuplanning?.select?.name  || null,
    weekmenuflyer: page.properties.Weekmenuflyer?.select?.name || null,
    koelkast:      page.properties.Koelkast?.select?.name      || null,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      // ── Weekbord ──
      if (pathname === '/weken' && method === 'GET') {
        if (url.searchParams.get('sync') === '1') {
          await sync(env);
          await weekbordNaarNotion(env).catch(() => {});
        }
        return json(await bord(env));
      }
      if (pathname === '/weken/notion-sync' && method === 'POST') {
        return json(await weekbordNaarNotion(env, { forceer: true }));
      }
      if (pathname === '/weken/log' && method === 'GET') {
        return json(await logboek(env, url.searchParams.get('week')));
      }
      const stapMatch = pathname.match(/^\/weken\/(\d{4}-W\d{2})\/([a-z_]+)$/);
      if (stapMatch && method === 'POST') {
        const body = await request.json();
        await zetHandmatig(env, stapMatch[1], stapMatch[2], { klaar: !!body.klaar, door: body.door });
        await weekbordNaarNotion(env).catch(() => {});
        return json(await bord(env));
      }

      // GET /tasks
      if (pathname === '/tasks' && method === 'GET') {
        const data = await notion(env, `/databases/${TASKS_DB}/query`, 'POST', {
          filter: { property: 'Klaar', checkbox: { equals: false } },
          sorts: [{ property: 'Deadline', direction: 'ascending' }],
          page_size: 100,
        });
        return json(data.results.map(formatTask).filter(t => t.project !== 'Gmail'));
      }

      // GET /tasks/recent
      if (pathname === '/tasks/recent' && method === 'GET') {
        const data = await notion(env, `/databases/${TASKS_DB}/query`, 'POST', {
          filter: { property: 'Klaar', checkbox: { equals: true } },
          sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
          page_size: 50,
        });
        return json(data.results.map(formatTask).filter(t => t.project !== 'Gmail'));
      }

      // GET /tasks/projects — project list from Notion schema
      if (pathname === '/tasks/projects' && method === 'GET') {
        const db = await notion(env, `/databases/${TASKS_DB}`);
        const options = db.properties?.Project?.select?.options || [];
        // kleuren kiest Ilse in de app; Notion kan een optiekleur niet via de API wijzigen
        const kleuren = (await metaGet(env, 'projectkleuren')) || {};
        return json(options
          .filter(o => o.name !== 'Gmail')
          .map(o => ({ name: o.name, color: kleuren[o.name] || o.color || 'default' }))
        );
      }

      // POST /tasks/projects — add project
      if (pathname === '/tasks/projects' && method === 'POST') {
        const body = await request.json();
        if (!body.name?.trim()) return json({ error: 'Naam vereist' }, 400);
        const db = await notion(env, `/databases/${TASKS_DB}`);
        const existing = db.properties?.Project?.select?.options || [];
        if (existing.find(o => o.name.toLowerCase() === body.name.trim().toLowerCase())) {
          return json({ error: 'Bestaat al' }, 400);
        }
        await notion(env, `/databases/${TASKS_DB}`, 'PATCH', {
          properties: {
            Project: { select: { options: [...existing, { name: body.name.trim(), color: body.color || 'default' }] } }
          }
        });
        return json({ ok: true });
      }

      // PUT /tasks/projects/:name/kleur — kleur kiezen (opgeslagen in de app, zie GET)
      const projKleurMatch = pathname.match(/^\/tasks\/projects\/(.+)\/kleur$/);
      if (projKleurMatch && method === 'PUT') {
        const name = decodeURIComponent(projKleurMatch[1]);
        const { color } = await request.json();
        if (!PROJECT_KLEUREN.includes(color)) return json({ error: 'Onbekende kleur' }, 400);
        const kleuren = (await metaGet(env, 'projectkleuren')) || {};
        kleuren[name] = color;
        await metaSet(env, 'projectkleuren', kleuren);
        return json({ ok: true });
      }

      // PATCH /tasks/projects/:name — hernoemen. Notion kan een select-optie niet via de API
      // hernoemen, dus: nieuwe optie erbij, taken in porties omzetten, daarna de oude optie weg.
      // Per aanroep max. 35 taken (subrequest-limiet); de app herhaalt met doorgaan:true tot klaar.
      const projRenameMatch = pathname.match(/^\/tasks\/projects\/(.+)$/);
      if (projRenameMatch && method === 'PATCH') {
        const name = decodeURIComponent(projRenameMatch[1]);
        const body = await request.json();
        const nieuw = body.name?.trim();
        if (!nieuw) return json({ error: 'Naam vereist' }, 400);
        if (nieuw.includes(',')) return json({ error: 'Geen komma in de naam' }, 400);
        const db = await notion(env, `/databases/${TASKS_DB}`);
        let opties = db.properties?.Project?.select?.options || [];
        const oud = opties.find(o => o.name === name);
        if (!oud) return json({ error: 'Project niet gevonden' }, 404);
        const bestaand = opties.find(o => o.name !== name && o.name.toLowerCase() === nieuw.toLowerCase());
        if (bestaand && !body.doorgaan) return json({ error: 'Bestaat al' }, 400);
        if (!bestaand) {
          opties = [...opties, { name: nieuw, color: oud.color }];
          await notion(env, `/databases/${TASKS_DB}`, 'PATCH', { properties: { Project: { select: { options: opties } } } });
        }
        const q = await notion(env, `/databases/${TASKS_DB}/query`, 'POST', {
          filter: { property: 'Project', select: { equals: name } },
          page_size: 35,
        });
        if (q.object === 'error') return json({ error: q.message || 'Notion weigerde' }, 400);
        for (const page of q.results) {
          await notion(env, `/pages/${page.id}`, 'PATCH', { properties: { Project: { select: { name: (bestaand || { name: nieuw }).name } } } });
        }
        if (q.has_more) return json({ ok: true, klaar: false, verplaatst: q.results.length });
        const na = await notion(env, `/databases/${TASKS_DB}`);
        await notion(env, `/databases/${TASKS_DB}`, 'PATCH', {
          properties: { Project: { select: { options: (na.properties?.Project?.select?.options || []).filter(o => o.name !== name) } } }
        });
        const kleuren = (await metaGet(env, 'projectkleuren')) || {};
        if (kleuren[name]) { kleuren[(bestaand || { name: nieuw }).name] ??= kleuren[name]; delete kleuren[name]; await metaSet(env, 'projectkleuren', kleuren); }
        return json({ ok: true, klaar: true, verplaatst: q.results.length });
      }

      // DELETE /tasks/projects/:name
      const projDeleteMatch = pathname.match(/^\/tasks\/projects\/(.+)$/);
      if (projDeleteMatch && method === 'DELETE') {
        const name = decodeURIComponent(projDeleteMatch[1]);
        if (SYSTEM_PROJECTS.includes(name)) {
          return json({ error: 'Systeemproject kan niet worden verwijderd' }, 400);
        }
        const db = await notion(env, `/databases/${TASKS_DB}`);
        const existing = db.properties?.Project?.select?.options || [];
        await notion(env, `/databases/${TASKS_DB}`, 'PATCH', {
          properties: {
            Project: { select: { options: existing.filter(o => o.name !== name) } }
          }
        });
        return json({ ok: true });
      }

      // POST /tasks
      if (pathname === '/tasks' && method === 'POST') {
        const body = await request.json();
        const properties = {
          Taak: { title: [{ text: { content: body.taak } }] },
        };
        if (body.deadline)   properties.Deadline  = { date: { start: body.deadline } };
        if (body.project)    properties.Project   = { select: { name: body.project } };
        if (body.opmerking)  properties.Opmerking = { rich_text: [{ text: { content: body.opmerking } }] };
        if (body.herhaling)  properties.Herhaling = { select: { name: body.herhaling } };
        const data = await notion(env, '/pages', 'POST', {
          parent: { database_id: TASKS_DB },
          properties,
        });
        return json({ id: data.id });
      }

      // PATCH /tasks/:id/edit
      const editMatch = pathname.match(/^\/tasks\/([a-f0-9-]+)\/edit$/);
      if (editMatch && method === 'PATCH') {
        const id = editMatch[1];
        const body = await request.json();
        const properties = {};
        if (body.taak)                   properties.Taak      = { title: [{ text: { content: body.taak } }] };
        if (body.deadline !== undefined)  properties.Deadline  = body.deadline  ? { date: { start: body.deadline } } : { date: null };
        if (body.project  !== undefined)  properties.Project   = body.project   ? { select: { name: body.project } }  : { select: null };
        if (body.opmerking !== undefined) properties.Opmerking = { rich_text: body.opmerking ? [{ text: { content: body.opmerking } }] : [] };
        if (body.herhaling !== undefined) properties.Herhaling = body.herhaling ? { select: { name: body.herhaling } } : { select: null };
        await notion(env, `/pages/${id}`, 'PATCH', { properties });
        return json({ ok: true });
      }

      const taskMatch = pathname.match(/^\/tasks\/([a-f0-9-]+)$/);

      // DELETE /tasks/:id — archive task
      if (taskMatch && method === 'DELETE') {
        const id = taskMatch[1];
        await notion(env, `/pages/${id}`, 'PATCH', { archived: true });
        return json({ ok: true });
      }

      // PATCH /tasks/:id — mark done / update status
      if (taskMatch && method === 'PATCH') {
        const id = taskMatch[1];
        const body = await request.json();
        const properties = {};
        if (body.klaar !== undefined) properties.Klaar = { checkbox: body.klaar };
        if (body.status) properties.Status = { select: { name: body.status } };
        await notion(env, `/pages/${id}`, 'PATCH', { properties });

        if (body.klaar === true) {
          await completeTaskSideEffects(env, {
            taak: body.taak, doelweek: body.doelweek, deadline: body.deadline,
            herhaling: body.herhaling, project: body.project, opmerking: body.opmerking,
          });
        }
        return json({ ok: true });
      }

      // POST /email
      if (pathname === '/email' && method === 'POST') {
        const body = await request.json();
        // bijlagen: [{ name, content (base64) }], samen max. ~10 MB (base64 is 4/3 van het bestand)
        const bijlagen = (body.attachments || []).filter(a => a?.name && a?.content);
        if (bijlagen.reduce((n, a) => n + a.content.length, 0) > 14_000_000) {
          return json({ error: 'Bijlagen te groot (max. 10 MB samen)' }, 400);
        }
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: { name: 'Ilse Grootjes', email: 'ilse.grootjes@thuysvers.nl' },
            to: body.to.map(email => ({ email })),
            subject: body.subject,
            textContent: body.text,
            ...(bijlagen.length ? { attachment: bijlagen.map(a => ({ name: a.name, content: a.content })) } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) return json({ error: data.message || 'Versturen mislukt' }, 400);
        return json({ ok: true });
      }

      // GET /debug/overzicht — raw Notion response voor diagnose
      if (pathname === '/debug/overzicht' && method === 'GET') {
        const raw = await notion(env, `/databases/${OVERZICHT_DB}/query`, 'POST', { page_size: 5 });
        return json({ db_id: OVERZICHT_DB, response: raw });
      }

      // GET /projects — overzicht uit gecombineerde DB
      if (pathname === '/projects' && method === 'GET') {
        const rows = (await queryAllOvz(env)).map(formatOvzRow);
        return json({
          weekmenuflyer: rows.map(r => ({ id: r.id, week: r.week, status: r.weekmenuflyer })),
          koelkast:      rows.map(r => ({ id: r.id, week: r.week, status: r.koelkast })),
          menuplanning:  rows.map(r => ({ id: r.id, week: r.week, status: r.menuplanning })),
        });
      }

      // POST /projects — status instellen (maakt rij aan als die nog niet bestaat)
      if (pathname === '/projects' && method === 'POST') {
        const body = await request.json();
        const COL_MAP = { weekmenuflyer: 'Weekmenuflyer', koelkast: 'Koelkast', menuplanning: 'Menuplanning' };
        const col = COL_MAP[body.proj];
        if (!col) return json({ error: 'Onbekend project' }, 400);

        const targetNum = weekNumFromTitle(body.week);
        const rows = await queryAllOvz(env);
        const existing = rows.find(p => {
          const tp = Object.values(p.properties).find(x => x.type === 'title');
          return weekNumFromTitle(tp?.title?.[0]?.plain_text) === targetNum;
        });

        if (existing) {
          if (body.status) {
            await notion(env, `/pages/${existing.id}`, 'PATCH', {
              properties: { [col]: { select: { name: body.status } } },
            });
            await syncTasksForOverzichtStatus(env, existing.id, col, body.status);
          }
          return json({ id: existing.id });
        } else {
          const props = { Week: { title: [{ text: { content: body.week } }] } };
          if (body.status) props[col] = { select: { name: body.status } };
          const page = await notion(env, '/pages', 'POST', {
            parent: { database_id: OVERZICHT_DB },
            properties: props,
          });
          if (body.status) await syncTasksForOverzichtStatus(env, page.id, col, body.status);
          return json({ id: page.id });
        }
      }

      // PATCH /projects/:id — status updaten (col bepaald door proj in body)
      const projMatch = pathname.match(/^\/projects\/([a-f0-9-]+)$/);
      if (projMatch && method === 'PATCH') {
        const id = projMatch[1];
        const body = await request.json();
        const COL_MAP = { weekmenuflyer: 'Weekmenuflyer', koelkast: 'Koelkast', menuplanning: 'Menuplanning' };
        const col = body.proj ? COL_MAP[body.proj] : null;
        if (col && body.status !== undefined) {
          await notion(env, `/pages/${id}`, 'PATCH', {
            properties: { [col]: body.status ? { select: { name: body.status } } : { select: null } },
          });
          if (body.status) await syncTasksForOverzichtStatus(env, id, col, body.status);
        }
        return json({ ok: true });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sync(env).then(() => weekbordNaarNotion(env)));
  },
};
