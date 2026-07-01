#!/usr/bin/env node
// Agent Team System - Backend API + Dashboard
// Port 1707 - Full agent management system
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

// ─── Web Push (optional) ───
let webpush;
try {
  webpush = require('web-push');
} catch(e) { webpush = null; }

// ─── Push notification subscriptions (PG-backed for persistence across restarts) ───
let _pushSubscriptions = [];
async function loadPushSubs() {
  try {
    const r = await q('SELECT endpoint, keys FROM team.push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC', ['amir']);
    _pushSubscriptions = r.map(row => ({
      endpoint: row.endpoint,
      keys: row.keys || {}
    }));
    return _pushSubscriptions.length;
  } catch (e) {
    console.error('loadPushSubs error:', e.message);
    return 0;
  }
}
async function savePushSub(sub) {
  try {
    await q(
      'INSERT INTO team.push_subscriptions (user_id, endpoint, keys, user_agent, last_active) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (endpoint) DO UPDATE SET last_active = NOW()',
      ['amir', sub.endpoint, JSON.stringify(sub.keys || {}), sub.userAgent || 'unknown']
    );
  } catch (e) {
    console.error('savePushSub error:', e.message);
  }
}
async function removePushSub(endpoint) {
  try {
    await q('DELETE FROM team.push_subscriptions WHERE endpoint = $1', [endpoint]);
  } catch (e) { console.error('removePushSub error:', e.message); }
}

// ─── VAPID Keys for Web Push ───
const VAPID_PUBLIC_KEY = 'BLy9SgseEX5gH1W3wrAoQgVdVP9BYVZdCSZwMdaXQLRH2sfv-ZQeWnspz8lzeXsI_qgAcSJCt2qNCDQ9AO5yD6A';
const VAPID_PRIVATE_KEY = 'a-mH7WTF2x9N2j2aAiLbIWHrQv_y2QEUrhlxiF6cKGA';

if (webpush) {
  webpush.setVapidDetails('mailto:amirg@ragmedium.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('Web Push notifications enabled');
} else {
  console.warn('web-push not installed — push notifications disabled');
}

const PORT = 1707;
const pool = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: '61b73daf4c51b1b5c22cfac30476f067bce943a177e819c42fca9a1545339dc8', database: 'postgres', max: 10 });

// ─── Agent SOUL files directory ───
const SOUL_DIR = path.join(__dirname, 'agent-souls');
if (!fs.existsSync(SOUL_DIR)) fs.mkdirSync(SOUL_DIR, { recursive: true });

// ─── MIME Types ───
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ─── Simple in-memory cache (5s TTL) for high-frequency endpoints ───
const _cache = new Map();
function cacheGet(key) { const e = _cache.get(key); if (e && Date.now() - e.ts < 5000) return e.data; return null; }
function cacheSet(key, data) { _cache.set(key, { data, ts: Date.now() }); if (_cache.size > 100) { const first = _cache.keys().next().value; _cache.delete(first); } }

// ─── API Response helpers ───
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, content, code = 200) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

function error(res, msg, code = 400) {
  json(res, { error: msg }, code);
}

// ─── DB Query helper ───
async function q(sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    return r.rows;
  } catch (e) {
    console.error('DB Error:', e.message, sql?.substring(0, 100));
    throw e;
  }
}

// ─── Static file serve ───
function serveStatic(res, url) {
  let filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'public', 'index.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
}

// ─── API Router ───
async function handleAPI(req, res, parts, body) {
  parts = parts.map(p => decodeURIComponent(p));
  const [resource, id, action] = parts;

  // GET /api/stats - Dashboard overview
  if (resource === 'stats' && req.method === 'GET') {
    const cached = cacheGet('stats');
    if (cached) return json(res, cached);
    const [agents, tasks, tasksByStatus, hierarchy, recentTasks, divisionStats] = await Promise.all([
      q('SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE is_active)::int as active FROM team.agents'),
      q('SELECT COUNT(*)::int as total FROM team.tasks'),
      q("SELECT status, COUNT(*)::int as count FROM team.tasks GROUP BY status ORDER BY status"),
      q(`WITH RECURSIVE tree AS (
        SELECT id, name, title, level, division, parent_agent_id, is_active, 0 as depth, name::text as path
        FROM team.agents WHERE parent_agent_id IS NULL
        UNION ALL
        SELECT a.id, a.name, a.title, a.level, a.division, a.parent_agent_id, a.is_active, t.depth+1,
          t.path || ' → ' || a.name
        FROM team.agents a JOIN tree t ON a.parent_agent_id = t.id
      ) SELECT id, name, title, level, division, parent_agent_id, is_active, depth FROM tree ORDER BY path`),
      q("SELECT t.id::text as id, t.title, t.status, t.agent_type, t.priority, t.created_at, a.division as agent_division FROM team.tasks t LEFT JOIN team.agents a ON t.assigned_agent_id = a.id ORDER BY t.created_at DESC LIMIT 10"),
      q(`SELECT division, COUNT(*)::int as agents, COUNT(*) FILTER (WHERE is_active)::int as active
         FROM team.agents GROUP BY division ORDER BY agents DESC`)
    ]);

    const taskCounts = {};
    tasksByStatus.forEach(r => taskCounts[r.status] = r.count);

    const result = {
      agents: agents[0], tasks: tasks[0],
      taskCounts, hierarchy, recentTasks, divisionStats,
      uptime: process.uptime()
    };
    cacheSet('stats', result);
    return json(res, result);
  }

  // POST /api/notify - Receive and store notification, with push for @Amir mentions
  if (resource === 'notify' && req.method === 'POST') {
    try {
      const n = body || {};
      if (!fs.existsSync(path.join(__dirname, 'public'))) fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
      const log = path.join(__dirname, 'public', 'notifications.json');
      let notes = [];
      try { notes = JSON.parse(fs.readFileSync(log, 'utf8')); } catch(e) {}
      const priority = n.priority || 'normal';
      notes.push({ id: Date.now(), ts: new Date().toISOString(), title: n.title || 'Notification', message: n.message, source: n.source || 'agent', priority, read: false });
      if (notes.length > 100) notes = notes.slice(-100);
      fs.writeFileSync(log, JSON.stringify(notes));

      // 2026-06-30: trigger push for ANY high-priority notification,
      // @Amir mentions, OR deliverable (✅) from agents. Caveman format.
      const title = n.title || '';
      const message = n.message || '';
      const searchText = title + ' ' + message;
      const isHighPriority = n.priority === 'high' || n.priority === 'urgent';
      const isAmirMention = /@Amir|AM-00/i.test(searchText);
      const isDeliverable = /✅|🔥|done|completed|deliverable|launched|sent|posted|shipped/i.test(searchText) && n.source && n.source !== 'test';
      if (isHighPriority || isAmirMention || isDeliverable) {
        const reason = isAmirMention ? '@Amir' : (isDeliverable ? 'deliverable' : 'high-priority');
        console.log(`PUSH [${reason}]: ${_pushSubscriptions.length} subscribers`);
        if (webpush && _pushSubscriptions.length > 0) {
          const payload = JSON.stringify({
            title: title.substring(0, 100) || '🤖 Agent Update',
            body: message.substring(0, 250) || (title),
            icon: '/icon.png',
            badge: '/badge.png',
            data: { url: n.url || '/', tag: reason },
            tag: `agent-${reason}-${Date.now()}`
          });
          for (const sub of _pushSubscriptions) {
            try { webpush.sendNotification(sub, payload); }
            catch(e) {
              if (e.statusCode === 410 || e.statusCode === 404) {
                const idx = _pushSubscriptions.indexOf(sub);
                if (idx >= 0) _pushSubscriptions.splice(idx, 1);
              }
            }
          }
        }
      }

      return json(res, { ok: true, count: notes.length });
    } catch(e) { return error(res, 'Invalid request', 400); }
  }

  // POST /api/push/register-device - Register an FCM/APNS token for native push
  // Used by the AgentCMD Android app (FcmService) to register its FCM token
  // with the backend so future messages can route via FCM once Firebase is
  // configured. Tokens are stored in team.push_devices (auto-created).
  if (resource === 'push' && id === 'register-device' && req.method === 'POST') {
    try {
      const b = body || {};
      const platform = (b.platform || 'unknown').toString().substring(0, 32);
      const token = (b.token || '').toString().substring(0, 4096);
      const deviceId = (b.deviceId || '').toString().substring(0, 256);
      if (!token) return error(res, 'token required', 400);

      // Auto-create the table once at startup (idempotent) and on demand
      await q(`CREATE TABLE IF NOT EXISTS team.push_devices (
        id SERIAL PRIMARY KEY,
        platform TEXT,
        token TEXT UNIQUE,
        device_id TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW()
      )`);

      const r = await q(
        `INSERT INTO team.push_devices (platform, token, device_id, last_seen)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (token) DO UPDATE
           SET platform = EXCLUDED.platform,
               device_id = EXCLUDED.device_id,
               last_seen = NOW()
         RETURNING id`,
        [platform, token, deviceId]
      );
      console.log(`[push/register-device] platform=${platform} device=${deviceId.substring(0,8)} id=${r[0]?.id}`);
      return json(res, { ok: true, id: r[0]?.id, platform, deviceId });
    } catch (e) {
      console.error('register-device error:', e.message);
      return error(res, 'register-device failed: ' + e.message, 500);
    }
  }
  // VAPID key must come before generic notifications GET
  if (resource === 'notifications' && id === 'vapid-key' && req.method === 'GET') {
    return json(res, { vapidKey: 'BLy9SgseEX5gH1W3wrAoQgVdVP9BYVZdCSZwMdaXQLRH2sfv-ZQeWnspz8lzeXsI_qgAcSJCt2qNCDQ9AO5yD6A' });
  }
  if (resource === 'notifications' && req.method === 'GET') {
    const log = path.join(__dirname, 'public', 'notifications.json');
    try { json(res, JSON.parse(fs.readFileSync(log, 'utf8'))); } catch(e) { json(res, []); }
    return true;
  }
  if (resource === 'health' && req.method === 'GET') {
    try {
      await q('SELECT 1');
      return json(res, { status: 'ok', db: 'connected', uptime: process.uptime(), port: PORT });
    } catch (e) {
      return json(res, { status: 'error', db: 'disconnected', error: e.message }, 503);
    }
  }

  // GET /api/status - Health check
  if (resource === 'status' && req.method === 'GET') {
    try {
      await q('SELECT 1');
      return json(res, { status: 'ok', db: 'connected', uptime: process.uptime(), port: PORT });
    } catch (e) {
      return json(res, { status: 'error', db: 'disconnected', error: e.message }, 503);
    }
  }

  // GET /api/metrics - System metrics
  if (resource === 'metrics' && req.method === 'GET') {
    const [agentMetrics, taskMetrics] = await Promise.all([
      q('SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE is_active)::int as active, COUNT(*) FILTER (WHERE NOT is_active)::int as inactive FROM team.agents'),
      q("SELECT status, COUNT(*)::int as count FROM team.tasks GROUP BY status"),
    ]);
    const taskCounts = {};
    taskMetrics.forEach(r => taskCounts[r.status] = r.count);
    return json(res, {
      agents: agentMetrics[0],
      tasks: taskCounts,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  }

  // GET /api/hierarchy - Org tree
  if (resource === 'hierarchy' && req.method === 'GET') {
    const cached = cacheGet('hierarchy');
    if (cached) return json(res, cached);
    const rows = await q(`WITH RECURSIVE tree AS (
      SELECT id, name, title, level, division, parent_agent_id, is_active, last_active_at,
        total_tasks_completed, success_rate, 0 as depth, name::text as sort_path
      FROM team.agents WHERE parent_agent_id IS NULL
      UNION ALL
      SELECT a.id, a.name, a.title, a.level, a.division, a.parent_agent_id, a.is_active,
        a.last_active_at, a.total_tasks_completed, a.success_rate, t.depth+1,
        t.sort_path || '|' || a.name
      FROM team.agents a JOIN tree t ON a.parent_agent_id = t.id
    ) SELECT * FROM tree ORDER BY sort_path`);

    // Build tree structure
    const agentMap = {};
    const roots = [];
    rows.forEach(r => {
      const agent = { ...r, children: [] };
      agentMap[r.id] = agent;
    });
    rows.forEach(r => {
      if (r.parent_agent_id && agentMap[r.parent_agent_id]) {
        agentMap[r.parent_agent_id].children.push(agentMap[r.id]);
      } else if (!r.parent_agent_id) {
        roots.push(agentMap[r.id]);
      }
    });
    const result = { roots, flat: rows };
    cacheSet('hierarchy', result);
    return json(res, result);
  }

  // POST /api/agents - Create agent
  if (resource === 'agents' && req.method === 'POST' && !id) {
    const { name, title, agent_type, division = 'General', level = 2, model = 'v4-flash', max_concurrent_tasks = 3, parent_agent_id = null, role_description = null } = body;
    if (!name || !agent_type) return error(res, 'name and agent_type required');
    const agent = await q(`INSERT INTO team.agents (name, title, agent_type, division, level, model, max_concurrent_tasks, parent_agent_id, role_description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, title || name, agent_type, division, level, model, max_concurrent_tasks, parent_agent_id, role_description]);
    _cache.delete('stats');
    _cache.delete('hierarchy');
    return json(res, agent[0], 201);
  }

  // GET /api/agents - All agents
  if (resource === 'agents' && req.method === 'GET') {
    if (id) {
      let agent;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const isInt = /^\d+$/.test(id);
      if (isUuid) {
        agent = await q('SELECT * FROM team.agents WHERE id = $1', [id]);
      } else if (isInt) {
        agent = await q('SELECT * FROM team.agents WHERE id = $1::int', [id]);
      }
      if (!agent || !agent.length) {
        agent = await q('SELECT * FROM team.agents WHERE name = $1', [id]);
      }
      if (!agent.length) return error(res, 'Agent not found', 404);
      const agentId = agent[0].id;
      // Get current task
      const currentTask = await q(
        "SELECT * FROM team.tasks WHERE assigned_agent_id = $1 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1", [agentId]);
      const recentRuns = await q(
        `SELECT * FROM team.agent_runs WHERE agent_id = $1 ORDER BY started_at DESC LIMIT 10`, [agentId]);
      // Get assigned projects
      const projects = await q(`
        SELECT p.*, ap.role FROM team.projects p
        JOIN team.agent_projects ap ON p.id = ap.project_id
        WHERE ap.agent_id = $1 ORDER BY p.priority`, [agentId]);
      // Get connections (other agents on same projects/tasks)
      const connections = await q(`
        SELECT DISTINCT a.id, a.name, a.division, a.status, a.title
        FROM team.agents a
        WHERE a.id != $1 AND (
          a.id IN (SELECT ap2.agent_id FROM team.agent_projects ap2 WHERE ap2.project_id IN
            (SELECT project_id FROM team.agent_projects WHERE agent_id = $1))
        )
        ORDER BY a.name LIMIT 20`, [agentId]);
      // Get recent tasks
      const recentTasks = await q(
        "SELECT * FROM team.tasks WHERE assigned_agent_id = $1 AND status = 'done' ORDER BY completed_at DESC LIMIT 5", [agentId]);
      return json(res, { ...agent[0], currentTask: currentTask[0] || null, recentRuns, projects, connections, recentTasks });
    }
    const agents = await q('SELECT * FROM team.agents ORDER BY level, name');
    return json(res, agents);
  }

  // GET /api/tasks - Task board
  // ─── RUNNING TASKS (side tab: currently executing) ───
  if (resource === 'tasks' && id === 'running' && req.method === 'GET') {
    const tasks = await q(`SELECT * FROM team.tasks WHERE status='in_progress' ORDER BY started_at ASC NULLS LAST LIMIT 100`);
    return json(res, { tasks, count: tasks.length });
  }

  if (resource === 'tasks' && req.method === 'GET') {
    const query = body?.query || {};
    const { status, agent, limit = '500', offset = '0' } = query;
    let where = '1=1';
    const params = [];
    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    if (agent) { params.push(agent); where += ` AND t.assigned_agent_id = $${params.length}`; }
    params.push(parseInt(limit, 10)); params.push(parseInt(offset, 10));

    const tasks = await q(`
      SELECT t.*, a.name as agent_name, a.division as agent_division
      FROM team.tasks t LEFT JOIN team.agents a ON t.assigned_agent_id = a.id
      WHERE ${where} 
      -- 2026-06-30: failed first, then in_progress, done, pending (so what's broken is at the top)
      ORDER BY 
        CASE t.status 
          WHEN 'failed' THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'done' THEN 2
          WHEN 'pending' THEN 3
          ELSE 4
        END,
        t.priority ASC, t.created_at DESC 
      LIMIT $${params.length-1} OFFSET $${params.length}`, params);

    const total = await q(`SELECT COUNT(*)::int as count FROM team.tasks t WHERE ${where}`,
      params.slice(0, -2));

    return json(res, { tasks, total: total[0]?.count || 0 });
  }

  // ─── INITIATIVES (campaigns / goals / cron-jobs within a project) ───
  // 2026-06-30: RAG Empire hierarchy — Project > Initiative > Task
  if (resource === 'initiatives' && req.method === 'GET') {
    if (id) {
      const init = await q('SELECT * FROM team.initiatives WHERE id = $1', [id]);
      if (!init.length) return error(res, 'Initiative not found', 404);
      const tasks = await q('SELECT * FROM team.tasks WHERE initiative_id = $1 ORDER BY priority ASC, created_at DESC', [id]);
      const chat = await q('SELECT * FROM team.initiative_chat WHERE initiative_id = $1 ORDER BY created_at ASC', [id]).catch(() => []);
      return json(res, { ...init[0], tasks, chat });
    }
    const { project, status } = body?.query || {};
    let where = '1=1'; const params = [];
    if (project) { params.push(project); where += ` AND project = $${params.length}`; }
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    const initiatives = await q(`
      SELECT i.*,
        COUNT(t.id)::int as task_count,
        COUNT(t.id) FILTER (WHERE t.status = 'in_progress')::int as in_progress_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'done')::int as done_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'failed')::int as failed_tasks
      FROM team.initiatives i
      LEFT JOIN team.tasks t ON t.initiative_id = i.id
      WHERE ${where}
      GROUP BY i.id ORDER BY i.created_at DESC
    `, params);
    return json(res, initiatives);
  }
  if (resource === 'initiatives' && req.method === 'POST') {
    const { project, name, description, status, goal_metric, lead_agent_id } = body;
    if (!project || !name) return error(res, 'project and name required');
    const r = await q(
      `INSERT INTO team.initiatives (project, name, description, status, goal_metric, lead_agent_id, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [project, name, description||null, status||'active', goal_metric||null, lead_agent_id||null]
    );
    return json(res, r[0], 201);
  }
  if (resource === 'initiatives' && id && req.method === 'PATCH') {
    const updates = []; const params = []; let idx = 0;
    for (const [k, v] of Object.entries(body)) {
      if (['name','description','status','goal_metric','lead_agent_id','completed_at'].includes(k)) {
        idx++; updates.push(`${k} = $${idx}`); params.push(v);
      }
    }
    if (!updates.length) return error(res, 'No valid fields');
    params.push(id);
    const r = await q(`UPDATE team.initiatives SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.length) return error(res, 'Not found', 404);
    return json(res, r[0]);
  }

  // ─── INITIATIVE CHAT (per-initiative thread) ───
  if (resource === 'initiative_chat' && req.method === 'GET') {
    const { initiative_id, limit = 50 } = body?.query || {};
    if (!initiative_id) return error(res, 'initiative_id required');
    const msgs = await q('SELECT * FROM team.initiative_chat WHERE initiative_id = $1 ORDER BY created_at ASC LIMIT $2', [initiative_id, Math.min(parseInt(limit), 200)]);
    return json(res, msgs);
  }
  if (resource === 'initiative_chat' && req.method === 'POST') {
    const { initiative_id, from_agent, message, agent_name, attachments } = body;
    if (!initiative_id || !from_agent || !message) return error(res, 'initiative_id, from_agent, message required');
    const r = await q(
      `INSERT INTO team.initiative_chat (initiative_id, from_agent, agent_name, message, attachments)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [initiative_id, from_agent, agent_name || from_agent, message, attachments ? JSON.stringify(attachments) : null]
    );
    return json(res, r[0], 201);
  }

  // ─── PROJECTS ───
  if (resource === 'projects' && req.method === 'GET') {
  if (id) {
    const project = await q('SELECT * FROM team.projects WHERE id = $1', [id]);
    if (!project.length) return error(res, 'Project not found', 404);
    const tasks = await q('SELECT t.*, a.name as agent_name FROM team.tasks t LEFT JOIN team.agents a ON a.id = ANY(t.assigned_agents) WHERE t.project_id = $1 ORDER BY t.created_at DESC', [id]);
    const agentsInProject = await q(`
      SELECT a.*, ap.role FROM team.agents a 
      JOIN team.agent_projects ap ON a.id = ap.agent_id 
      WHERE ap.project_id = $1 ORDER BY a.name`, [id]);
    return json(res, { ...project[0], tasks, agents: agentsInProject });
  }
  const projects = await q(`
    SELECT p.*, COUNT(t.id)::int as task_count, 
      COUNT(t.id) FILTER (WHERE t.status = 'in_progress')::int as active_tasks,
      COUNT(a.id)::int as agent_count
    FROM team.projects p
    LEFT JOIN team.tasks t ON t.project_id = p.id
    LEFT JOIN team.agent_projects ap ON ap.project_id = p.id
    LEFT JOIN team.agents a ON a.id = ap.agent_id
    GROUP BY p.id ORDER BY p.priority, p.name`);
  return json(res, projects);
  }
  if (resource === 'projects' && req.method === 'POST') {
  const { name, description, squad, priority = 2 } = body;
  if (!name) return error(res, 'name required');
  const project = await q('INSERT INTO team.projects (name, description, squad, priority) VALUES ($1,$2,$3,$4) RETURNING *', [name, description, squad, priority]);
  return json(res, project[0], 201);
  }
  if (resource === 'projects' && id && req.method === 'PATCH') {
  const updates = []; const params = []; let idx = 0;
  for (const [key, val] of Object.entries(body)) {
    if (['name','description','status','squad','priority'].includes(key)) {
      idx++; updates.push(`${key} = $${idx}`); params.push(val);
    }
  }
  if (!updates.length) return error(res, 'No valid fields');
  idx++; updates.push(`updated_at = $${idx}`); params.push(new Date());
  params.push(id);
  const r = await q(`UPDATE team.projects SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!r.length) return error(res, 'Project not found', 404);
  _cache.delete('stats');
  return json(res, r[0]);
  }
  if (resource === 'projects' && id && req.method === 'DELETE') {
  await q('DELETE FROM team.agent_projects WHERE project_id = $1', [id]);
  await q('UPDATE team.tasks SET project_id = NULL WHERE project_id = $1', [id]);
  const r = await q('DELETE FROM team.projects WHERE id = $1 RETURNING id', [id]);
  if (!r.length) return error(res, 'Project not found', 404);
  return json(res, { ok: true });
  }

  // ─── AGENT CONNECTIONS ───
  if (resource === 'agents' && id && action === 'connections' && req.method === 'GET') {
  // Find all agents that share a project or task with this agent
  const agentId = parseInt(id, 10);
  const connections = await q(`
    SELECT DISTINCT a.id, a.name, a.division, a.status, a.title
    FROM team.agents a
    WHERE a.id != $1 AND (
      a.id IN (SELECT ap.agent_id FROM team.agent_projects ap WHERE ap.project_id IN 
        (SELECT project_id FROM team.agent_projects WHERE agent_id = $1))
      OR
      a.id IN (SELECT unnest(t.assigned_agents) FROM team.tasks t WHERE $1 = ANY(t.assigned_agents))
    )
    ORDER BY a.name
  `, [agentId]);
  return json(res, connections);
  }

  // ─── AGENT PROJECTS ───
  if (resource === 'agents' && id && action === 'projects' && req.method === 'GET') {
  const agentId = parseInt(id, 10);
  const projects = await q(`
    SELECT p.*, ap.role FROM team.projects p
    JOIN team.agent_projects ap ON p.id = ap.project_id
    WHERE ap.agent_id = $1 ORDER BY p.priority, p.name
  `, [agentId]);
  return json(res, projects);
  }

  // ─── POST /api/tasks/retry - Retry failed tasks (must be before POST /api/tasks)
  if (resource === 'tasks' && id === 'retry' && req.method === 'POST') {
    const { task_id, all_failed = false } = body || {};
    if (task_id) {
      const r = await q(
        `UPDATE team.tasks SET status = 'pending', error = NULL, retry_count = 0, assigned_agent_id = NULL, started_at = NULL
         WHERE id = $1 AND status IN ('failed','cancelled') RETURNING id`,
        [task_id]
      );
      return json(res, { ok: true, retried: r.length });
    }
    if (all_failed) {
      const r = await q(
        `UPDATE team.tasks SET status = 'pending', error = NULL, retry_count = 0, assigned_agent_id = NULL, started_at = NULL
         WHERE status IN ('failed','cancelled') RETURNING id`
      );
      return json(res, { ok: true, retried: r.length });
    }
    return error(res, 'task_id or all_failed required');
  }

  // POST /api/tasks - Create task
  // 2026-06-30: added 'project' (venture name string) for dashboard grouping
  if (resource === 'tasks' && req.method === 'POST') {
    const { title, description, agent_type, priority = 3, depends_on = [], source = 'manual', tags = [], assigned_agents = [], project_id = null, project = null } = body;
    if (!title || !agent_type) return error(res, 'title and agent_type required');

    const task = await q(`INSERT INTO team.tasks (title, description, agent_type, priority, depends_on, source, tags, assigned_agents, project_id, project)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [title, description, agent_type, priority, depends_on, source, tags, assigned_agents, project_id, project]);
    _cache.delete('stats');
    return json(res, task[0], 201);
  }

  // PATCH /api/tasks/:id - Update task
  if (resource === 'tasks' && id && req.method === 'PATCH') {
    const updates = [];
    const params = [];
    let idx = 0;
    for (const [key, val] of Object.entries(body)) {
      if (['title','description','status','priority','assigned_agent_id','assigned_agents','project_id','project','output_data','error','retry_count','initiative_id','initiative_name','is_recurring','cron_schedule','deliverable','ai_summary','chat_thread_id','last_heartbeat'].includes(key)) {
        idx++;
        updates.push(`${key} = $${idx}`);
        params.push(key === 'output_data' ? JSON.stringify(val) : key === 'assigned_agents' ? JSON.stringify(val) : val);
      }
    }
    if (body.status === 'in_progress') { idx++; updates.push(`started_at = $${idx}`); params.push(new Date()); }
    if (body.status === 'done' || body.status === 'failed') { idx++; updates.push(`completed_at = $${idx}`); params.push(new Date()); }
    if (!updates.length) return error(res, 'No valid fields to update');
    params.push(id);
    const r = await q(`UPDATE team.tasks SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.length) return error(res, 'Task not found', 404);
    return json(res, r[0]);
  }

  // GET /api/artifacts - Artifacts list
  if (resource === 'artifacts' && req.method === 'GET') {
    const artifacts = await q(`
      SELECT a.*, t.title as task_title, ag.name as agent_name
      FROM team.artifacts a
      LEFT JOIN team.tasks t ON a.task_id = t.id
      LEFT JOIN team.agents ag ON a.agent_id = ag.id
      ORDER BY a.created_at DESC LIMIT 50`);
    return json(res, artifacts);
  }

  // GET /api/logs - Recent logs
  if (resource === 'logs' && req.method === 'GET') {
    const query = body?.query || {};
    const taskId = query.task_id;
    if (taskId) {
      const logs = await q('SELECT * FROM team.task_logs WHERE task_id = $1 ORDER BY created_at DESC', [taskId]);
      return json(res, logs);
    }
    const logs = await q(`
      SELECT l.*, t.title as task_title FROM team.task_logs l
      LEFT JOIN team.tasks t ON l.task_id = t.id
      ORDER BY l.created_at DESC LIMIT 100`);
    return json(res, logs);
  }

  // POST /api/dispatch - Manual dispatch trigger
  if (resource === 'dispatch' && req.method === 'POST') {
    const result = await runDispatcher();
    return json(res, result);
  }

  // GET /api/config - System configuration
  if (resource === 'config' && req.method === 'GET') {
    return json(res, {
      port: PORT,
      version: '2.0.0',
      db: 'connected',
      uptime: process.uptime(),
      endpoints: ['agents', 'tasks', 'hierarchy', 'stats', 'artifacts', 'logs', 'knowledge', 'goals', 'secrets', 'threads', 'approvals', 'skills', 'vault', 'notifications', 'agent-runs', 'state', 'metrics']
    });
  }

  // GET /api/knowledge - Knowledge base
  if (resource === 'knowledge' && req.method === 'GET') {
    const rows = await q('SELECT id, title, content, source, tags, updated_at, created_at FROM team.knowledge ORDER BY updated_at DESC LIMIT 50');
    return json(res, rows);
  }

  // POST /api/knowledge - Add knowledge entry
  if (resource === 'knowledge' && req.method === 'POST') {
    const { title, content, source, tags = [] } = body;
    if (!title) return error(res, 'title required');
    const entry = await q(
      'INSERT INTO team.knowledge (title, content, source, tags) VALUES ($1,$2,$3,$4) RETURNING id, title, source, tags, updated_at',
      [title, content, source, tags]
    );
    return json(res, entry[0], 201);
  }

  // GET /api/knowledge/search - Search knowledge
  if (resource === 'knowledge' && id === 'search' && req.method === 'GET') {
    const query = body?.query || {};
    const { q: searchQuery, limit = '10' } = query;
    if (!searchQuery) return error(res, 'query (q) parameter required');
    const rows = await q(
      `SELECT id, title, content, source, tags, updated_at FROM team.knowledge
       WHERE title ILIKE $1 OR content ILIKE $1 OR $2 = ANY(tags)
       ORDER BY updated_at DESC LIMIT $3`,
      [`%${searchQuery}%`, searchQuery, parseInt(limit, 10)]
    );
    return json(res, rows);
  }

  // GET /api/agent-runs - Recent runs
  if (resource === 'agent-runs' && req.method === 'GET') {
    const runs = await q(`
      SELECT r.*, a.name as agent_name, t.title as task_title
      FROM team.agent_runs r
      LEFT JOIN team.agents a ON r.agent_id = a.id
      LEFT JOIN team.tasks t ON r.task_id = t.id
      ORDER BY r.started_at DESC LIMIT 50`);
    return json(res, runs);
  }

  // DELETE /api/agents/:id - Delete agent
  if (resource === 'agents' && id && req.method === 'DELETE') {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const isInt = /^\d+$/.test(id);
    let r;
    if (isUuid) {
      r = await q('DELETE FROM team.agents WHERE id = $1 RETURNING id', [id]);
    } else if (isInt) {
      r = await q('DELETE FROM team.agents WHERE id = $1::int RETURNING id', [id]);
    } else {
      r = await q('DELETE FROM team.agents WHERE name = $1 RETURNING id', [id]);
    }
    if (!r.length) return error(res, 'Agent not found', 404);
    _cache.delete('stats');
    _cache.delete('hierarchy');
    return json(res, { ok: true });
  }

  // PATCH /api/agents/:id - Update agent
  if (resource === 'agents' && id && req.method === 'PATCH') {
    const updates = [];
    const params = [];
    let idx = 0;
    for (const [key, val] of Object.entries(body)) {
      if (['name','title','agent_type','division','level','model','max_concurrent_tasks','parent_agent_id','role_description','is_active','status','capabilities'].includes(key)) {
        idx++;
        updates.push(`${key} = $${idx}`);
        params.push(key === 'capabilities' ? JSON.stringify(val) : val);
      }
    }
    if (!updates.length) return error(res, 'No valid fields to update');
    idx++; updates.push(`updated_at = $${idx}`); params.push(new Date());
    params.push(id);
    const r = await q(`UPDATE team.agents SET ${updates.join(', ')} WHERE id = $${params.length}::int RETURNING *`, params);
    if (!r.length) return error(res, 'Agent not found', 404);
    _cache.delete('stats');
    _cache.delete('hierarchy');
    return json(res, r[0]);
  }

  // POST /api/agents/:id/heartbeat
  if (resource === 'agents' && id && action === 'heartbeat' && req.method === 'POST') {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      await q('UPDATE team.agents SET last_active_at = NOW() WHERE id = $1', [id]);
    } else {
      await q('UPDATE team.agents SET last_active_at = NOW() WHERE name = $1', [id]);
    }
    // Emit SSE event for status change
    _emitSSE('agent:heartbeat', { agentId: id, ts: Date.now() });
    return json(res, { ok: true });
  }

  // POST /api/heartbeat - top-level agent heartbeat (for status pings)
  if (resource === 'heartbeat' && req.method === 'POST') {
    const { agent_id, status, name } = body || {};
    if (agent_id) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agent_id);
      const isInt = /^\d+$/.test(agent_id);
      if (isUuid || isInt) {
        await q('UPDATE team.agents SET last_active_at = NOW(), status = COALESCE($1, status) WHERE id = $2', [status || 'active', isInt ? parseInt(agent_id) : agent_id]);
      } else {
        await q('UPDATE team.agents SET last_active_at = NOW(), status = COALESCE($1, status) WHERE name = $2', [status || 'active', agent_id]);
      }
    } else if (name) {
      await q('UPDATE team.agents SET last_active_at = NOW(), status = COALESCE($1, status) WHERE name = $2', [status || 'active', name]);
    }
    _emitSSE('agent:heartbeat', { agentId: agent_id || name, status: status || 'active', ts: Date.now() });
    return json(res, { ok: true });
  }

  // POST /api/messages - Send inter-agent message
  if (resource === 'messages' && req.method === 'POST' && !id) {
    const { from_agent, to_agent, subject, text, priority = 'normal', thread_id } = body;
    if (!from_agent || !to_agent) return error(res, 'from_agent and to_agent required');
    const msg = await q(
      `INSERT INTO team.notifications (type, title, message, is_read)
       VALUES ('agent_message', $1, $2, false) RETURNING *`,
      [subject || `Message from ${from_agent}`,
       JSON.stringify({ from_agent, to_agent, text, priority, thread_id, sent_at: new Date().toISOString() })]
    );
    _cache.delete('stats');
    _emitSSE('agent:message', { id: msg[0].id, from: from_agent, to: to_agent, subject, ts: Date.now() });
    return json(res, msg[0], 201);
  }

  // GET /api/messages/:agent_id - Read inbox for an agent
  if (resource === 'messages' && id && req.method === 'GET') {
    const _u = new URL(req.url, 'http://localhost'); const limit = Math.min(200, Math.max(5, parseInt(_u.searchParams.get('limit') || '30')));
    const rows = await q(
      `SELECT * FROM team.notifications
       WHERE type = 'agent_message'
       AND (message::jsonb->>'to_agent' = $1 OR message::jsonb->>'from_agent' = $1)
       ORDER BY created_at DESC LIMIT $2`,
      [id, limit]
    );
    // Parse message field
    const inbox = rows.map(r => ({
      ...r,
      message: typeof r.message === 'string' ? JSON.parse(r.message) : r.message
    }));
    return json(res, inbox);
  }
  if (resource === 'state' && req.method === 'GET') {
    const [agents, tasksByStatus, goals, recentThreads, divisions] = await Promise.all([
      q('SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE is_active)::int as active FROM team.agents'),
      q("SELECT status, COUNT(*)::int as count FROM team.tasks GROUP BY status"),
      q("SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status IN ('planned','running'))::int as active FROM team.goals"),
      q('SELECT id, title, updated_at FROM team.threads ORDER BY updated_at DESC LIMIT 5'),
      q('SELECT division, COUNT(*)::int as count FROM team.agents GROUP BY division ORDER BY count DESC')
    ]);
    const taskCounts = {};
    tasksByStatus.forEach(r => taskCounts[r.status] = r.count);
    return json(res, {
      agents: agents[0], taskCounts, goals: goals[0],
      recentThreads, divisions,
      uptime: process.uptime()
    });
  }

  // ─── GOALS ───
  if (resource === 'goals' && req.method === 'GET') {
    if (id) {
      const goal = await q('SELECT * FROM team.goals WHERE id = $1', [id]);
      if (!goal.length) return error(res, 'Goal not found', 404);
      return json(res, { goal: goal[0] });
    }
    const goals = await q('SELECT * FROM team.goals ORDER BY created_at DESC');
    return json(res, goals);
  }

  if (resource === 'goals' && req.method === 'POST') {
    const { title, description, priority = 3, owner_agent_id } = body;
    if (!title) return error(res, 'title required');
    const goal = await q(
      'INSERT INTO team.goals (title, description, priority, owner_agent_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [title, description, priority, owner_agent_id || null]
    );
    return json(res, goal[0], 201);
  }

  if (resource === 'goals' && id && action === 'start' && req.method === 'POST') {
    const goal = await q("UPDATE team.goals SET status = 'running', updated_at = NOW() WHERE id = $1 RETURNING *", [id]);
    if (!goal.length) return error(res, 'Goal not found', 404);
    return json(res, { ok: true, goal: goal[0] });
  }

  if (resource === 'goals' && req.method === 'DELETE') {
    const { id: goalId } = body;
    if (goalId) { await q('DELETE FROM team.goals WHERE id = $1', [goalId]); }
    return json(res, { ok: true });
  }

  // ─── SECRETS ───
  if (resource === 'secrets' && req.method === 'GET') {
    const secrets = await q('SELECT id, project, key, notes, type, created_at, updated_at FROM team.secrets ORDER BY project, key');
    return json(res, secrets);
  }

  if (resource === 'secrets' && req.method === 'POST') {
    const { project, key, value, notes = '', type = 'api-key' } = body;
    if (!project || !key) return error(res, 'project and key required');
    const encoded = Buffer.from(value || '').toString('base64');
    const secret = await q(
      'INSERT INTO team.secrets (project, key, value_encrypted, notes, type) VALUES ($1,$2,$3,$4,$5) RETURNING id, project, key, notes, type',
      [project, key, encoded, notes, type]
    );
    return json(res, secret[0], 201);
  }

  if (resource === 'secrets' && id && req.method === 'PATCH') {
    const { project, key, value, notes, type } = body;
    const updates = [];
    const params = [];
    let idx = 0;
    if (project) { idx++; updates.push('project = ' + idx); params.push(project); }
    if (key) { idx++; updates.push('key = ' + idx); params.push(key); }
    if (value) { idx++; updates.push('value_encrypted = ' + idx); params.push(Buffer.from(value).toString('base64')); }
    if (notes !== undefined) { idx++; updates.push('notes = ' + idx); params.push(notes); }
    if (type) { idx++; updates.push('type = ' + idx); params.push(type); }
    if (!updates.length) return error(res, 'No fields to update');
    idx++; updates.push('updated_at = ' + idx); params.push(new Date());
    params.push(id);
    const r = await q('UPDATE team.secrets SET ' + updates.join(', ') + ' WHERE id = ' + params.length + ' RETURNING id, project, key, notes, type', params);
    if (!r.length) return error(res, 'Secret not found', 404);
    return json(res, r[0]);
  }

  if (resource === 'secrets' && id && req.method === 'DELETE') {
    await q('DELETE FROM team.secrets WHERE id = $1', [id]);
    return json(res, { ok: true });
  }

  if (resource === 'secrets' && action === 'decrypt' && req.method === 'POST') {
    const { id: secretId } = body;
    const secret = await q('SELECT value_encrypted FROM team.secrets WHERE id = $1', [secretId]);
    if (!secret.length) return error(res, 'Secret not found', 404);
    const value = Buffer.from(secret[0].value_encrypted, 'base64').toString('utf8');
    return json(res, { value });
  }

  // ─── THREADS ───
  if (resource === 'threads' && req.method === 'GET') {
    const threads = await q('SELECT * FROM team.threads ORDER BY is_pinned DESC, updated_at DESC LIMIT 50');
    return json(res, threads);
  }

  if (resource === 'threads' && req.method === 'POST') {
    const { id, title, messages = [], context = {} } = body;
    const thread = await q(
      'INSERT INTO team.threads (id, title, messages, context) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET title=$2, updated_at=NOW() RETURNING *',
      [id || require('crypto').randomUUID(), title, JSON.stringify(messages), JSON.stringify(context)]
    );
    return json(res, thread[0], 201);
  }

  if (resource === 'threads' && id && req.method === 'DELETE') {
    await q('DELETE FROM team.threads WHERE id = $1', [id]);
    return json(res, { ok: true });
  }

  if (resource === 'threads' && id && action === 'pin' && req.method === 'POST') {
    const r = await q('UPDATE team.threads SET is_pinned = NOT is_pinned WHERE id = $1 RETURNING *', [id]);
    if (!r.length) return error(res, 'Thread not found', 404);
    return json(res, r[0]);
  }

  if (resource === 'threads' && id && action === 'messages' && req.method === 'POST') {
    const { message } = body;
    const r = await q(
      "UPDATE team.threads SET messages = messages || $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *",
      [id, JSON.stringify([message])]
    );
    if (!r.length) return error(res, 'Thread not found', 404);
    return json(res, r[0]);
  }

  // ─── APPROVALS ───
  if (resource === 'approvals' && req.method === 'GET') {
    const approvals = await q('SELECT a.*, t.title as task_title FROM team.approvals a LEFT JOIN team.tasks t ON a.task_id = t.id ORDER BY a.created_at DESC LIMIT 50');
    return json(res, approvals);
  }

  if (resource === 'approvals' && id && action === 'approve' && req.method === 'POST') {
    const r = await q("UPDATE team.approvals SET status = 'approved', decided_at = NOW() WHERE id = $1 RETURNING *", [id]);
    if (!r.length) return error(res, 'Approval not found', 404);
    return json(res, r[0]);
  }

  if (resource === 'approvals' && id && action === 'decline' && req.method === 'POST') {
    const r = await q("UPDATE team.approvals SET status = 'declined', decided_at = NOW() WHERE id = $1 RETURNING *", [id]);
    if (!r.length) return error(res, 'Approval not found', 404);
    return json(res, r[0]);
  }

  // ─── COMMANDS ───
  if (resource === 'commands' && req.method === 'POST') {
    const { text, threadId, send = false, modes = {} } = body;
    const cmd = await q(
      "INSERT INTO team.notifications (type, title, message) VALUES ('command', $1, $2) RETURNING *",
      [text?.substring(0, 100) || '', JSON.stringify({ text, threadId, send, modes })]
    );
    return json(res, { ok: true, id: cmd[0].id }, 201);
  }

  // ─── SKILLS ───
  if (resource === 'skills' && req.method === 'GET') {
    const skills = await q('SELECT * FROM team.skills ORDER BY category, name');
    return json(res, skills.length ? skills : [
      { id: '1', name: 'web_search', description: 'Web search', category: 'research', is_active: true },
      { id: '2', name: 'web_fetch', description: 'Fetch web pages', category: 'research', is_active: true },
      { id: '3', name: 'exec', description: 'Execute commands', category: 'development', is_active: true },
      { id: '4', name: 'write', description: 'Write files', category: 'development', is_active: true },
      { id: '5', name: 'edit', description: 'Edit files', category: 'development', is_active: true },
      { id: '6', name: 'image_generate', description: 'Generate images', category: 'creative', is_active: true },
      { id: '7', name: 'dns', description: 'DNS lookups', category: 'lead_generation', is_active: true },
      { id: '8', name: 'playwright', description: 'Browser automation', category: 'lead_generation', is_active: true },
    ]);
  }

  // ─── VAULT ───
  if (resource === 'vault' && req.method === 'GET') {
    const entries = await q('SELECT id, title, content, source, tags, metadata, created_at FROM team.vault ORDER BY updated_at DESC LIMIT 50');
    return json(res, entries);
  }

  if (resource === 'vault' && req.method === 'POST') {
    const { title, content, source, tags = [], metadata = {} } = body;
    if (!title) return error(res, 'title required');
    const entry = await q(
      'INSERT INTO team.vault (title, content, source, tags, metadata) VALUES ($1,$2,$3,$4,$5) RETURNING id, title, source, tags',
      [title, content, source, tags, JSON.stringify(metadata)]
    );
    return json(res, entry[0], 201);
  }

  if (resource === 'vault' && action === 'graph' && req.method === 'GET') {
    const entries = await q('SELECT id, title, source, tags FROM team.vault ORDER BY updated_at DESC LIMIT 30');
    const nodes = entries.map(e => ({ id: e.id, title: e.title, source: e.source, tags: e.tags }));
    const links = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const shared = entries[i].tags?.filter(t => entries[j].tags?.includes(t)) || [];
        if (shared.length) links.push({ source: entries[i].id, target: entries[j].id, shared });
      }
    }
    return json(res, { nodes, links });
  }

  if (resource === 'vault' && action === 'rag-search' && req.method === 'POST') {
    const { query } = body;
    const results = await q(
      "SELECT id, title, content, source, tags FROM team.vault WHERE title ILIKE $1 OR content ILIKE $1 OR $1 = ANY(tags) ORDER BY updated_at DESC LIMIT 10",
      ['%' + query + '%']
    );
    return json(res, results);
  }

  // POST /api/notifications/subscribe - Register for push notifications
  if (resource === 'notifications' && id === 'subscribe' && req.method === 'POST') {
    if (!body || !body.endpoint) return error(res, 'subscription object with endpoint required');
    const sub = { endpoint: body.endpoint, keys: body.keys || {}, userAgent: req.headers['user-agent'] || '' };
    await savePushSub(sub);
    // Also keep in-memory mirror for fast access in notify loop
    const existing = _pushSubscriptions.findIndex(s => s.endpoint === sub.endpoint);
    if (existing >= 0) _pushSubscriptions[existing] = sub;
    else _pushSubscriptions.push(sub);
    console.log(`Push subscription persisted + cached (${_pushSubscriptions.length} total)`);
    return json(res, { ok: true, count: _pushSubscriptions.length });
  }
  // 2026-06-30: inspect subs (returns count for sanity check)
  if (resource === 'notifications' && id === 'list' && req.method === 'GET') {
    return json(res, { ok: true, count: _pushSubscriptions.length, subs: _pushSubscriptions.map(s => s.endpoint.slice(0,80)) });
  }

  // POST /api/notifications/unsubscribe - Unregister from push notifications
  if (resource === 'notifications' && id === 'unsubscribe' && req.method === 'POST') {
    const endpoint = body?.endpoint;
    if (!endpoint) return error(res, 'endpoint required');
    const existing = _pushSubscriptions.findIndex(s => s.endpoint === endpoint);
    if (existing >= 0) {
      _pushSubscriptions.splice(existing, 1);
    }
    console.log(`Push subscription removed (${_pushSubscriptions.length} remaining)`);
    return json(res, { ok: true, count: _pushSubscriptions.length });
  }

  // ─── OPENCODE STATUS ───
  if (resource === 'opencode' && id === 'status' && req.method === 'GET') {
    return json(res, { status: 'idle', lastRun: null });
  }

  // ─── GALLERY ───
  if (resource === 'gallery' && req.method === 'GET') {
    const artifacts = await q(`SELECT a.id, a.name as file_name, a.content_type as file_type, a.created_at, t.title as task_title FROM team.artifacts a LEFT JOIN team.tasks t ON a.task_id = t.id WHERE a.content_type LIKE 'image/%' ORDER BY a.created_at DESC LIMIT 30`);
    return json(res, artifacts);
  }

  // ─── CHECKIN ───
  if (resource === 'checkin' && req.method === 'POST') {
    const { agent_id, date, status = 'present', notes = '' } = body;
    const checkin = await q('INSERT INTO team.checkins (agent_id, date, status, notes) VALUES ($1,$2,$3,$4) RETURNING *', [agent_id, date, status, notes]);
    return json(res, checkin[0], 201);
  }

  // ─── EMAIL ───
  if (resource === 'email' && id === 'check' && req.method === 'POST') {
    return json(res, { ok: true, checked: new Date().toISOString(), newEmails: 0 });
  }

  // ─── BRAIN (AI state) ───
  if (resource === 'brain' && req.method === 'GET') {
    const [goals, activeGoals, recentRuns] = await Promise.all([
      q('SELECT * FROM team.goals ORDER BY updated_at DESC LIMIT 10'),
      q("SELECT COUNT(*)::int as count FROM team.goals WHERE status IN ('planned','running','verifying')"),
      q('SELECT * FROM team.agent_runs ORDER BY started_at DESC LIMIT 5')
    ]);
    return json(res, {
      goals, activeGoals: activeGoals[0]?.count || 0, recentRuns,
      thinking: false, lastUpdate: new Date().toISOString()
    });
  }

  // ─── TRACE STREAM (SSE) ───
  if (resource === 'trace-stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');
    res.write('event: connected\n');
    res.write('data: ' + JSON.stringify({ type: 'connected', ts: Date.now() }) + '\n\n');
    // Register client for real-time events
    _sseClients.add(res);
    const interval = setInterval(() => { res.write(': keepalive\n\n'); }, 15000);
    req.on('close', () => {
      clearInterval(interval);
      _sseClients.delete(res);
    });
    return;
  }




  // POST /api/tasks/cleanup - Cancel stale tasks
  if (resource === 'tasks' && action === 'cleanup' && req.method === 'POST') {
    const { status, title_pattern, older_than_hours = 24 } = body || {};
    let whereClause = "status IN ('in_progress', 'failed', 'cancelled')";
    const params = [older_than_hours * 3600 * 1000];
    if (title_pattern) {
      params.push(title_pattern);
      whereClause += ` AND title LIKE $${params.length}`;
    }
    const r = await q(
      `UPDATE team.tasks SET status = 'cancelled', completed_at = NOW(), error = 'Auto-cancelled by cleanup' WHERE ${whereClause} AND created_at < NOW() - INTERVAL '1 millisecond' * $${params.length - 1} RETURNING id`,
      params
    );
    return json(res, { ok: true, cancelled: r.length });
  }

  return error(res, 'Not found', 404);
}

// ─── DISPATCHER ───────────────────────────────────────────────
async function runDispatcher() {
  const results = { dispatched: [], errors: [], skipped: 0 };

  // 1. Get pending tasks whose dependencies are satisfied
  const pending = await q(`
    SELECT t.* FROM team.tasks t
    WHERE t.status = 'pending'
    AND (
      t.dependency_task_ids IS NULL
      OR t.dependency_task_ids = '{}'
      OR NOT EXISTS (
        SELECT 1 FROM unnest(t.dependency_task_ids) dep_id
        LEFT JOIN team.tasks dt ON dt.id = dep_id
        WHERE dt.status IS DISTINCT FROM 'done'
      )
    )
    ORDER BY t.priority ASC, t.created_at ASC
    LIMIT 5
  `);

  for (const task of pending) {
    // Find matching agent — match by agent_type first, then fall back to title/name
    const agents = await q(
      `SELECT id, name, title FROM team.agents WHERE is_active = true
       AND (agent_type = $1 OR title ILIKE $2 OR name ILIKE $2)
       ORDER BY level DESC LIMIT 1`,
      [task.agent_type, `%${task.agent_type}%`]
    );

    if (!agents.length) {
      await q("UPDATE team.tasks SET status = 'failed', error = 'No matching agent found' WHERE id = $1", [task.id]);
      results.errors.push({ task: task.id, reason: 'no_agent' });
      continue;
    }

    // Check if agent is already busy
    const busyCount = await q(
      "SELECT COUNT(*)::int as c FROM team.tasks WHERE assigned_agent_id = $1 AND status = 'in_progress'",
      [agents[0].id]
    );

    const agentConfig = await q('SELECT max_concurrent_tasks FROM team.agents WHERE id = $1', [agents[0].id]);
    const maxBusy = agentConfig[0]?.max_concurrent_tasks || 1;

    if (busyCount[0]?.c >= maxBusy) {
      results.skipped++;
      continue;
    }

    // Assign and mark in_progress
    await q(`UPDATE team.tasks SET status = 'in_progress', assigned_agent_id = $1, started_at = NOW()
      WHERE id = $2`, [agents[0].id, task.id]);

    await q(`INSERT INTO team.task_logs (task_id, agent_id, level, message)
      VALUES ($1, $2, 'info', 'Task dispatched to ' || $3::text)`,
      [task.id, agents[0].id, agents[0].name]);

    results.dispatched.push({ task: task.id, agent: agents[0].name });
  }

  // 2. Check for stale in_progress tasks (older than 30 min)
  const stale = await q(`
    SELECT t.*, a.name as agent_name FROM team.tasks t
    LEFT JOIN team.agents a ON t.assigned_agent_id = a.id
    WHERE t.status = 'in_progress'
    AND t.started_at < NOW() - INTERVAL '30 minutes'
  `);

  for (const task of stale) {
    const nextRetry = (task.retry_count || 0) + 1;
    const isExhausted = nextRetry >= task.max_retries;
    await q(`UPDATE team.tasks SET
      retry_count = $2,
      status = $3,
      error = 'Timed out after 30 min',
      assigned_agent_id = NULL,
      started_at = NULL,
      completed_at = CASE WHEN $4 THEN NOW() ELSE NULL END
      WHERE id = $1`, [task.id, nextRetry, isExhausted ? 'failed' : 'pending', isExhausted]);

    await q(`INSERT INTO team.task_logs (task_id, level, message)
      VALUES ($1, 'warn', 'Task timed out. Retry ' || $2::text || '/' || $3::text)`,
      [task.id, nextRetry, task.max_retries]);
  }

  results.stale_handled = stale.length;
  return results;
}

// ─── SSE Event Emitter ───
const _sseClients = new Set();

function _emitSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of _sseClients) {
    try { client.write(payload); } catch (e) { _sseClients.delete(client); }
  }
}

// ─── HTTP Server ───
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') return res.writeHead(204).end();

    // API routes
    if (parts[0] === 'api') {
      let body = null;
      if (method === 'POST' || method === 'PATCH') {
        body = await new Promise((resolve) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve({}); }
          });
        });
      }

      // Parse query params for GET
      const queryParams = {};
      url.searchParams.forEach((val, key) => queryParams[key] = val);
      if (method === 'GET' && Object.keys(queryParams).length) {
        if (!body) body = {};
        body.query = queryParams;
      }

      await handleAPI(req, res, parts.slice(1), body);
      return;
    }

    // Dispatcher endpoint (called by cron)
    if (parts[0] === 'dispatch' && method === 'POST') {
      const result = await runDispatcher();
      return json(res, result);
    }

    // Static files
    serveStatic(res, url.pathname);

  } catch (e) {
    console.error('Server error:', e);
    if (!res.headersSent) {
      json(res, { error: 'Internal server error', detail: e.message }, 500);
    }
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Agent Team System running on http://0.0.0.0:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
  console.log(`API: http://localhost:${PORT}/api/stats`);
  // 2026-06-30: persist push subscriptions in PG so they survive restarts
  try {
    const n = await loadPushSubs();
    console.log(`[push] loaded ${n} persisted push subscriptions from PG`);
  } catch (e) {
    console.error('[push-load] err:', e.message);
  }
});