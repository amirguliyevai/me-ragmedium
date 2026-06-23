#!/usr/bin/env node
// Agent Team System - Backend API + Dashboard
// Port 1707 - Full agent management system
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const PORT = 1707;
const pool = new Pool({ host: 'localhost', port: 5434, user: 'postgres', password: '61b73daf4c51b1b5c22cfac30476f067bce943a177e819c42fca9a1545339dc8', database: 'postgres', max: 10 });

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

    return json(res, {
      agents: agents[0], tasks: tasks[0],
      taskCounts, hierarchy, recentTasks, divisionStats,
      uptime: process.uptime()
    });
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
    return json(res, { roots, flat: rows });
  }

  // GET /api/agents - All agents
  if (resource === 'agents' && req.method === 'GET') {
    if (id) {
      let agent;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUuid) {
        agent = await q('SELECT * FROM team.agents WHERE id = $1', [id]);
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
    const { status, agent, limit = 50, offset = 0 } = body?.query || {};
    let where = '1=1';
    const params = [];
    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    if (agent) { params.push(agent); where += ` AND t.assigned_agent_id = $${params.length}`; }
    params.push(limit); params.push(offset);

    const tasks = await q(`
      SELECT t.*, a.name as agent_name
      FROM team.tasks t LEFT JOIN team.agents a ON t.assigned_agent_id = a.id
      WHERE ${where} ORDER BY t.priority ASC, t.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);

    const total = await q(`SELECT COUNT(*)::int as count FROM team.tasks t WHERE ${where}`,
      params.slice(0, -2));

    return json(res, { tasks, total: total[0]?.count || 0 });
  }

  // POST /api/tasks - Create task
  if (resource === 'tasks' && req.method === 'POST') {
    const { title, description, agent_type, priority = 3, depends_on = [], source = 'manual', tags = [] } = body;
    if (!title || !agent_type) return error(res, 'title and agent_type required');

    const task = await q(`INSERT INTO team.tasks (title, description, agent_type, priority, depends_on, source, tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, description, agent_type, priority, depends_on, source, tags]);
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
    const taskId = body?.query?.task_id;
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
    const rows = await q('SELECT * FROM team.knowledge ORDER BY updated_at DESC LIMIT 50');
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
        LEFT JOIN team.tasks dt ON dt.id = dep_id::uuid
        WHERE dt.status IS DISTINCT FROM 'done'
      )
    )
    ORDER BY t.priority ASC, t.created_at ASC
    LIMIT 5
  `);

  for (const task of pending) {
    // Find matching agent
    const agents = await q(
      `SELECT id, name, title FROM team.agents WHERE is_active = true AND (title ILIKE $1 OR name ILIKE $1)
       ORDER BY level DESC LIMIT 1`,
      [`%${task.agent_type}%`]
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
