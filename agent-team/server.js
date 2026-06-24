#!/usr/bin/env node
// Agent Team System - Backend API + Dashboard
// Port 1707 - Full agent management system
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

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
      q("SELECT id::text as id, title, status, agent_type, priority, created_at FROM team.tasks ORDER BY created_at DESC LIMIT 10"),
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

  // GET /api/health - Health check (alias for /api/status)
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
      return json(res, { ...agent[0], currentTask: currentTask[0] || null, recentRuns });
    }
    const agents = await q('SELECT * FROM team.agents ORDER BY level, name');
    return json(res, agents);
  }

  // GET /api/tasks - Task board
  if (resource === 'tasks' && req.method === 'GET') {
    const query = body?.query || {};
    const { status, agent, limit = '50', offset = '0' } = query;
    let where = '1=1';
    const params = [];
    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    if (agent) { params.push(agent); where += ` AND t.assigned_agent_id = $${params.length}`; }
    params.push(parseInt(limit, 10)); params.push(parseInt(offset, 10));

    const tasks = await q(`
      SELECT t.*, a.name as agent_name
      FROM team.tasks t LEFT JOIN team.agents a ON t.assigned_agent_id = a.id
      WHERE ${where} ORDER BY t.priority ASC, t.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);

    const total = await q(`SELECT COUNT(*)::int as count FROM team.tasks t WHERE ${where}`,
      params.slice(0, -2));

    return json(res, { tasks, total: total[0]?.count || 0 });
  }

  // POST /api/tasks/retry - Retry failed tasks (must be before POST /api/tasks)
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
  if (resource === 'tasks' && req.method === 'POST') {
    const { title, description, agent_type, priority = 3, depends_on = [], source = 'manual', tags = [] } = body;
    if (!title || !agent_type) return error(res, 'title and agent_type required');

    const task = await q(`INSERT INTO team.tasks (title, description, agent_type, priority, depends_on, source, tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, description, agent_type, priority, depends_on, source, tags]);
    _cache.delete('stats');
    return json(res, task[0], 201);
  }

  // PATCH /api/tasks/:id - Update task
  if (resource === 'tasks' && id && req.method === 'PATCH') {
    const updates = [];
    const params = [];
    let idx = 0;
    for (const [key, val] of Object.entries(body)) {
      if (['title','description','status','priority','assigned_agent_id','output_data','error','retry_count'].includes(key)) {
        idx++;
        updates.push(`${key} = $${idx}`);
        params.push(key === 'output_data' ? JSON.stringify(val) : val);
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

  // POST /api/agents/:id/heartbeat
  if (resource === 'agents' && id && action === 'heartbeat' && req.method === 'POST') {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      await q('UPDATE team.agents SET last_active_at = NOW() WHERE id = $1', [id]);
    } else {
      await q('UPDATE team.agents SET last_active_at = NOW() WHERE name = $1', [id]);
    }
    return json(res, { ok: true });
  }


  // ─── DASHBOARD STATE (aggregated) ───
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

  // ─── NOTIFICATIONS ───
  if (resource === 'notifications' && id === 'vapid-key' && req.method === 'GET') {
    return json(res, { vapidKey: 'BAUK7hBjvWTKYquv-rOOM07SIeew7YBjsNBaE5rrnTbqIakacOBgOiT9JDqbLzgRv4jkT4WWgeQSRT_dXJSiBM8' });
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
    res.write('data: ' + JSON.stringify({ type: 'connected', ts: Date.now() }) + '\n\n');
    const interval = setInterval(() => { res.write(': keepalive\n\n'); }, 15000);
    req.on('close', () => clearInterval(interval));
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Agent Team System running on http://0.0.0.0:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
  console.log(`API: http://localhost:${PORT}/api/stats`);
});