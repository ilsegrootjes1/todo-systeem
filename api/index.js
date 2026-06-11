const TASKS_DB   = '47ae20e8-094b-475b-81fc-7efdf7f5d069';
const WMF_DB     = '33d17522-60d6-8044-b429-debae08d8cab';
const KOELKAST_DB= '87de96d6-051b-4035-959b-63fe753b1319';
const MENU_DB    = '8808d20d-d534-4413-9f46-1904a430bc1c';

const STATUS_RULES = [
  { match: 'nieuw menu maken', updates: [
    { db: MENU_DB,      status: 'Menu gemaakt' },
    { db: KOELKAST_DB,  status: 'Wachtend op GO Pieter' },
    { db: WMF_DB,       status: 'Wachtend op GO Pieter' },
  ]},
  { match: 'pieter heeft menu go', updates: [
    { db: MENU_DB,      status: 'Pieter GO' },
    { db: KOELKAST_DB,  status: 'Bezig' },
    { db: WMF_DB,       status: 'Bezig' },
  ]},
  { match: 'menu klaarzetten',             updates: [{ db: MENU_DB,      status: 'Menu klaargezet in Shopify' }] },
  { match: 'import draaien',               updates: [{ db: MENU_DB,      status: 'Import gedraaid' }] },
  { match: 'menucheck in verborgen',       updates: [{ db: MENU_DB,      status: 'Collectie gecheckt' }] },
  { match: 'live menucheck',               updates: [{ db: MENU_DB,      status: 'Live gegaan' }] },
  { match: 'weekmenuflyer maken',          updates: [{ db: WMF_DB,       status: 'Klaar voor proofread' }] },
  { match: 'weekmenuflyer bestellen',      updates: [{ db: WMF_DB,       status: 'Besteld' }] },
  { match: 'flyers geleverd',              updates: [{ db: WMF_DB,       status: 'Geleverd' }] },
  { match: 'koelkast productinformatie',   updates: [{ db: KOELKAST_DB,  status: 'Product informatie verwerkt' }] },
  { match: 'koelkast bestelling plaatsen', updates: [{ db: KOELKAST_DB,  status: 'Bestelling geplaatst' }] },
];

const HERHALING_DAYS = { 'Wekelijks': 7, '2 wekelijks': 14, '4 wekelijks': 28 };

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function maybeUpdateProjectStatus(env, taskName, doelweek) {
  if (!taskName || !doelweek) return;
  const lower = taskName.toLowerCase();
  const rule = STATUS_RULES.find(r => lower.includes(r.match));
  if (!rule) return;
  const weekLower = doelweek.toLowerCase().trim();
  await Promise.all(rule.updates.map(async ({ db, status }) => {
    const data = await notion(env, `/databases/${db}/query`, 'POST', { page_size: 30 });
    const entry = data.results.find(p => {
      const tp = Object.values(p.properties).find(x => x.type === 'title');
      return tp?.title?.[0]?.plain_text?.toLowerCase().trim() === weekLower;
    });
    if (entry) {
      await notion(env, `/pages/${entry.id}`, 'PATCH', {
        properties: { Status: { select: { name: status } } },
      });
    }
  }));
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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
  };
}

function formatProjectEntry(page) {
  const titleProp = Object.values(page.properties).find(p => p.type === 'title');
  return {
    id: page.id,
    week: titleProp?.title?.[0]?.plain_text || '',
    status: page.properties.Status?.select?.name || null,
    statusColor: page.properties.Status?.select?.color || null,
    opmerking: page.properties.Opmerking?.rich_text?.[0]?.plain_text || '',
  };
}

// ── Gmail OAuth helpers ──
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

// Patterns that indicate an actual request directed at Ilse
const ACTION_RE = /\b(kun jij|kan jij|kan je|kun je|wil jij|wil je|zou jij|zou je|heb jij|heb je|graag|zou kunnen|actie vereist|follow.?up|could you|can you|would you|please|action required|need you|let me know|laat.{0,5}weten|kun jij|kunt jij)\b|\?/i;

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

function extractTaskSuggestion(bodyText) {
  const lines = bodyText.split(/[\n]+/).map(s => s.trim()).filter(s => s.length > 15);
  for (const line of lines) {
    if (ACTION_RE.test(line) && !/^>/.test(line)) {
      return line.replace(/^[\s>*#-]+/, '').slice(0, 80);
    }
  }
  return null;
}

async function fetchGmailProposals(env) {
  const token = await getGmailToken(env);
  if (!token) return null;

  const q = encodeURIComponent('is:unread newer_than:7d -from:me');
  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=30`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listData = await listRes.json();
  if (!listData.messages?.length) return [];

  const proposals = [];
  const seenSubjects = new Set();

  for (const msg of listData.messages) {
    if (proposals.length >= 6) break;

    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msgData = await msgRes.json();
    const headers = msgData.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(geen onderwerp)';
    const from    = headers.find(h => h.name === 'From')?.value || '';
    const date    = headers.find(h => h.name === 'Date')?.value || '';
    const unsub   = headers.find(h => h.name === 'List-Unsubscribe')?.value || '';

    if (unsub) continue;
    if (/noreply|no-reply|donotreply|mailer-daemon/i.test(from)) continue;

    const key = subject.toLowerCase().replace(/\s+/g, '').slice(0, 40);
    if (seenSubjects.has(key)) continue;
    seenSubjects.add(key);

    // Only propose if the email body actually asks Ilse to do something
    const bodyText = extractBodyText(msgData.payload).slice(0, 3000);
    const taskSuggestion = extractTaskSuggestion(bodyText);
    if (!taskSuggestion) continue;

    proposals.push({ gmailId: msg.id, subject, from, date, taskSuggestion });
  }
  return proposals;
}

export default {
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
        return json(data.results.map(formatTask));
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
        if (body.taak)      properties.Taak      = { title: [{ text: { content: body.taak } }] };
        if (body.deadline !== undefined) properties.Deadline = body.deadline ? { date: { start: body.deadline } } : { date: null };
        if (body.project  !== undefined) properties.Project  = body.project  ? { select: { name: body.project } }  : { select: null };
        if (body.opmerking !== undefined) properties.Opmerking = { rich_text: body.opmerking ? [{ text: { content: body.opmerking } }] : [] };
        if (body.herhaling !== undefined) properties.Herhaling = body.herhaling ? { select: { name: body.herhaling } } : { select: null };
        await notion(env, `/pages/${id}`, 'PATCH', { properties });
        return json({ ok: true });
      }

      // PATCH /tasks/:id — mark done / status
      const taskMatch = pathname.match(/^\/tasks\/([a-f0-9-]+)$/);
      if (taskMatch && method === 'PATCH') {
        const id = taskMatch[1];
        const body = await request.json();
        const properties = {};
        if (body.klaar !== undefined) properties.Klaar = { checkbox: body.klaar };
        if (body.status) properties.Status = { select: { name: body.status } };
        await notion(env, `/pages/${id}`, 'PATCH', { properties });

        if (body.klaar === true) {
          await maybeUpdateProjectStatus(env, body.taak, body.doelweek);

          // Auto-create next recurring task
          if (body.herhaling && HERHALING_DAYS[body.herhaling] && body.deadline) {
            const nextDeadline = addDays(body.deadline, HERHALING_DAYS[body.herhaling]);
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
        const proposals = await fetchGmailProposals(env);
        if (proposals === null) return json({ error: 'not_connected' }, 401);
        return json(proposals);
      }

      // POST /gmail/dismiss/:id — mark as read so it won't reappear
      const dismissMatch = pathname.match(/^\/gmail\/dismiss\/(.+)$/);
      if (dismissMatch && method === 'POST') {
        const token = await getGmailToken(env);
        if (!token) return json({ error: 'not_connected' }, 401);
        await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${dismissMatch[1]}/modify`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
        });
        return json({ ok: true });
      }

      // GET /auth/gmail — start OAuth
      if (pathname === '/auth/gmail' && method === 'GET') {
        const params = new URLSearchParams({
          client_id: env.GMAIL_CLIENT_ID,
          redirect_uri: `${url.origin}/auth/callback`,
          response_type: 'code',
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          access_type: 'offline',
          prompt: 'consent',
        });
        return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
      }

      // GET /auth/callback — exchange code, show refresh_token for manual secret setup
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

      // GET /projects
      if (pathname === '/projects' && method === 'GET') {
        const [wmf, kk, mp] = await Promise.all([
          notion(env, `/databases/${WMF_DB}/query`, 'POST', { sorts: [{ timestamp: 'created_time', direction: 'ascending' }], page_size: 30 }),
          notion(env, `/databases/${KOELKAST_DB}/query`, 'POST', { sorts: [{ timestamp: 'created_time', direction: 'ascending' }], page_size: 30 }),
          notion(env, `/databases/${MENU_DB}/query`, 'POST', { sorts: [{ timestamp: 'created_time', direction: 'ascending' }], page_size: 30 }),
        ]);
        return json({
          weekmenuflyer: wmf.results.map(formatProjectEntry),
          koelkast: kk.results.map(formatProjectEntry),
          menuplanning: mp.results.map(formatProjectEntry),
        });
      }

      // PATCH /projects/:id
      const projMatch = pathname.match(/^\/projects\/([a-f0-9-]+)$/);
      if (projMatch && method === 'PATCH') {
        const id = projMatch[1];
        const body = await request.json();
        const properties = {};
        if (body.status !== undefined)   properties.Status   = body.status   ? { select: { name: body.status } }   : { select: null };
        if (body.opmerking !== undefined) properties.Opmerking = { rich_text: body.opmerking ? [{ text: { content: body.opmerking } }] : [] };
        await notion(env, `/pages/${id}`, 'PATCH', { properties });
        return json({ ok: true });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
