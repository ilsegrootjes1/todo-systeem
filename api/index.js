const TASKS_DB    = '47ae20e8-094b-475b-81fc-7efdf7f5d069';
const OVERZICHT_DB = '38217522-60d6-819b-ba0b-cbd50c11e372';

const SYSTEM_PROJECTS = ['Weekmenuflyer', 'Menuplanning', 'Koelkast'];

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
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

function weekNumFromTitle(title) {
  const m = (title || '').match(/\d+/);
  return m ? parseInt(m[0]) : null;
}

async function maybeUpdateProjectStatus(env, taskName, doelweek) {
  if (!taskName || !doelweek) return;
  const lower = taskName.toLowerCase();
  const rule = STATUS_RULES.find(r => lower.includes(r.match));
  if (!rule) return;
  const targetWeekNum = weekNumFromTitle(doelweek);
  if (!targetWeekNum) return;

  const rows = await queryAllOvz(env);
  const entry = rows.find(p => {
    const tp = Object.values(p.properties).find(x => x.type === 'title');
    return weekNumFromTitle(tp?.title?.[0]?.plain_text) === targetWeekNum;
  });

  const properties = {};
  rule.updates.forEach(({ col, status }) => { properties[col] = { select: { name: status } }; });

  if (entry) {
    await notion(env, `/pages/${entry.id}`, 'PATCH', { properties });
  } else {
    await notion(env, '/pages', 'POST', {
      parent: { database_id: OVERZICHT_DB },
      properties: { Week: { title: [{ text: { content: doelweek } }] }, ...properties },
    });
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

// ── Gmail helpers ──
async function getGmailToken(env) {
  if (!env.GMAIL_REFRESH_TOKEN) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

const SKIP_FROM_RE    = /noreply|no-reply|donotreply|mailer-daemon|notification@|updates@|newsletter|info@thuys/i;
const SKIP_SUBJECT_RE = /\b(order|bestell|bevestig|tracking|betaling|factuur|invoice|nieuwsbrief|receipt|confirm|verzend)\b/i;

function extractBodyText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    try {
      const b64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      return atob(b64);
    } catch { return ''; }
  }
  for (const part of (payload.parts || [])) {
    const t = extractBodyText(part);
    if (t) return t;
  }
  return '';
}

async function analyzeEmail(env, subject, from, bodyText) {
  if (!env.ANTHROPIC_API_KEY) return null;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Je bent assistent voor Ilse Grootjes, eigenaar van ThuysVers (wekelijkse maaltijdbox bezorging, Utrecht).

Van: ${from}
Onderwerp: ${subject}
Bericht:
${bodyText.slice(0, 1500)}

Bepaal of er een CONCRETE ACTIE VOOR ILSE PERSOONLIJK in zit.

isActionable=true ALLEEN als:
- Iemand vraagt Ilse specifiek om iets te doen, beslissen of reageren
- Relevant voor: inkoop, leveranciers, klanten, menu-planning, team

isActionable=false voor:
- Orderbevestigingen, facturen, automatische meldingen, tracking
- Nieuwsbrieven, promoties, reclame
- Alleen ter informatie, geen actie nodig
- Systeemmeldingen (betalingen, verzendingen, etc.)

Taaktitel: begin met werkwoord, max 60 tekens (bijv. "Reageren op X over Y")

Antwoord ALLEEN met JSON:
{"isActionable":true/false,"taskTitle":"...of null","summary":"max 1 zin wat Ilse moet doen of null"}`,
      }],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const text = data.content?.[0]?.text?.trim();
  if (!text) return null;

  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

async function fetchGmailProposals(env) {
  const token = await getGmailToken(env);
  if (!token) return null;

  const q = encodeURIComponent('is:unread newer_than:7d -from:me');
  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=40`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json();
  if (!listData.messages?.length) return [];

  const proposals = [];
  const seenSubjects = new Set();

  for (const msg of listData.messages) {
    if (proposals.length >= 8) break;

    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msgData = await msgRes.json();
    const headers = msgData.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(geen onderwerp)';
    const from    = headers.find(h => h.name === 'From')?.value || '';
    const unsub   = headers.find(h => h.name === 'List-Unsubscribe')?.value || '';

    if (unsub) continue;
    if (SKIP_FROM_RE.test(from)) continue;
    if (SKIP_SUBJECT_RE.test(subject)) continue;

    const key = subject.toLowerCase().replace(/^(re:|fwd?:)\s*/i, '').replace(/\s+/g, '').slice(0, 40);
    if (seenSubjects.has(key)) continue;
    seenSubjects.add(key);

    const bodyText = extractBodyText(msgData.payload);
    const analysis = await analyzeEmail(env, subject, from, bodyText);
    if (!analysis?.isActionable) continue;

    proposals.push({
      gmailId: msg.id,
      subject,
      from,
      taskSuggestion: analysis.taskTitle || subject.slice(0, 60),
      summary: analysis.summary || '',
    });
  }
  return proposals;
}

async function collectGmailProposals(env) {
  const proposals = await fetchGmailProposals(env);
  if (!proposals?.length) return;

  const existing = await notion(env, `/databases/${TASKS_DB}/query`, 'POST', {
    filter: { and: [
      { property: 'Project', select: { equals: 'Gmail' } },
      { property: 'Klaar', checkbox: { equals: false } },
    ]},
    page_size: 50,
  });
  const existingGmailIds = new Set(
    existing.results.map(p => {
      const op = p.properties.Opmerking?.rich_text?.[0]?.plain_text || '';
      return op.split('||')[0];
    })
  );

  for (const p of proposals) {
    if (existingGmailIds.has(p.gmailId)) continue;
    await notion(env, '/pages', 'POST', {
      parent: { database_id: TASKS_DB },
      properties: {
        Taak:      { title: [{ text: { content: p.taskSuggestion } }] },
        Project:   { select: { name: 'Gmail' } },
        Opmerking: { rich_text: [{ text: { content: `${p.gmailId}||${p.from}||${p.subject}||${p.summary || ''}`.slice(0, 2000) } }] },
      },
    });
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(collectGmailProposals(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
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
        return json(options
          .filter(o => o.name !== 'Gmail')
          .map(o => ({ name: o.name, color: o.color || 'default' }))
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
          await maybeUpdateProjectStatus(env, body.taak, body.doelweek);

          if (body.herhaling && HERHALING_DAYS[body.herhaling] && body.deadline) {
            const nextDeadline = addDays(body.deadline, HERHALING_DAYS[body.herhaling]);

            const fourWeeksOut = new Date();
            fourWeeksOut.setUTCDate(fourWeeksOut.getUTCDate() + 28);

            if (new Date(nextDeadline + 'T12:00:00Z') <= fourWeeksOut) {
              const dupCheck = await notion(env, `/databases/${TASKS_DB}/query`, 'POST', {
                filter: {
                  and: [
                    { property: 'Taak',     title:    { equals: body.taak } },
                    { property: 'Klaar',    checkbox: { equals: false } },
                    { property: 'Deadline', date:     { equals: nextDeadline } },
                  ]
                },
                page_size: 1,
              });

              if (!dupCheck.results.length) {
                const nextProps = {
                  Taak:      { title: [{ text: { content: body.taak } }] },
                  Deadline:  { date: { start: nextDeadline } },
                  Herhaling: { select: { name: body.herhaling } },
                };
                if (body.project)   nextProps.Project   = { select: { name: body.project } };
                if (body.opmerking) nextProps.Opmerking = { rich_text: [{ text: { content: body.opmerking } }] };
                await notion(env, '/pages', 'POST', { parent: { database_id: TASKS_DB }, properties: nextProps });
              }
            }
          }
        }
        return json({ ok: true });
      }

      // POST /email
      if (pathname === '/email' && method === 'POST') {
        const body = await request.json();
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: { name: 'Ilse Grootjes', email: 'ilse.grootjes@thuysvers.nl' },
            to: body.to.map(email => ({ email })),
            subject: body.subject,
            textContent: body.text,
          }),
        });
        const data = await res.json();
        if (!res.ok) return json({ error: data.message || 'Versturen mislukt' }, 400);
        return json({ ok: true });
      }

      // GET /gmail/proposals
      if (pathname === '/gmail/proposals' && method === 'GET') {
        if (!env.NOTION_TOKEN) return json({ error: 'not_connected' }, 401);
        const data = await notion(env, `/databases/${TASKS_DB}/query`, 'POST', {
          filter: { and: [
            { property: 'Project', select: { equals: 'Gmail' } },
            { property: 'Klaar',   checkbox: { equals: false } },
          ]},
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          page_size: 20,
        });
        const proposals = data.results.map(p => {
          const op = p.properties.Opmerking?.rich_text?.[0]?.plain_text || '';
          const parts = op.split('||');
          const [gmailId, from, subject, ...summaryParts] = parts;
          return {
            notionId:       p.id,
            gmailId:        gmailId || '',
            from:           from || '',
            subject:        subject || '',
            summary:        summaryParts.join('||') || '',
            taskSuggestion: p.properties.Taak?.title?.[0]?.plain_text || '',
          };
        });
        return json(proposals);
      }

      // POST /gmail/scan — manual trigger
      if (pathname === '/gmail/scan' && method === 'POST') {
        await collectGmailProposals(env);
        return json({ ok: true });
      }

      // POST /gmail/dismiss/:notionId
      const dismissMatch = pathname.match(/^\/gmail\/dismiss\/([a-f0-9-]+)$/);
      if (dismissMatch && method === 'POST') {
        const notionId = dismissMatch[1];
        await notion(env, `/pages/${notionId}`, 'PATCH', { archived: true });
        const body = await request.json().catch(() => ({}));
        if (body.gmailId) {
          const token = await getGmailToken(env);
          if (token) {
            await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${body.gmailId}/modify`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
            }).catch(() => {});
          }
        }
        return json({ ok: true });
      }

      // GET /auth/gmail
      if (pathname === '/auth/gmail' && method === 'GET') {
        const params = new URLSearchParams({
          client_id: env.GMAIL_CLIENT_ID,
          redirect_uri: `${url.origin}/auth/callback`,
          response_type: 'code',
          scope: 'https://www.googleapis.com/auth/gmail.modify',
          access_type: 'offline',
          prompt: 'consent',
        });
        return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
      }

      // GET /auth/callback
      if (pathname === '/auth/callback' && method === 'GET') {
        const code = url.searchParams.get('code');
        if (!code) return json({ error: 'No code' }, 400);
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.GMAIL_CLIENT_ID,
            client_secret: env.GMAIL_CLIENT_SECRET,
            redirect_uri: `${url.origin}/auth/callback`,
            code,
            grant_type: 'authorization_code',
          }),
        });
        const data = await res.json();
        if (!data.refresh_token) return new Response(`<html><body style="font-family:sans-serif;padding:40px"><h2>Fout</h2><pre>${JSON.stringify(data,null,2)}</pre></body></html>`, { headers: {'Content-Type':'text/html'} });
        return new Response(`<html><body style="font-family:sans-serif;padding:40px;max-width:600px">
          <h2>✓ Bijna klaar!</h2>
          <p>Kopieer deze token en stuur hem naar Claude Code:</p>
          <textarea style="width:100%;height:80px;font-family:monospace;font-size:12px;padding:8px">${data.refresh_token}</textarea>
          <p style="color:#666;font-size:13px;margin-top:12px">Je kunt dit venster daarna sluiten.</p>
        </body></html>`, { headers: { 'Content-Type': 'text/html' } });
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
          }
          return json({ id: existing.id });
        } else {
          const props = { Week: { title: [{ text: { content: body.week } }] } };
          if (body.status) props[col] = { select: { name: body.status } };
          const page = await notion(env, '/pages', 'POST', {
            parent: { database_id: OVERZICHT_DB },
            properties: props,
          });
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
        }
        return json({ ok: true });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
