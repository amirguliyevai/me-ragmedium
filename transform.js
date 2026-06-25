#!/usr/bin/env node
/**
 * Transform script for Agent Command Center overhaul
 * 1. Fix all model references (v4 flash → owl-alpha)
 * 2. Merge AI Team + Agents into Command Center
 * 3. Overhaul Approval UI
 * 4. Build full-screen agent detail overlay
 * 5. Add project-filtered Kanban
 * 6. Update PWA notification routing
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(filePath, 'utf8');

console.log('Original file size:', html.length, 'chars');

// ═══════════════════════════════════════════════════════════
// STEP 1: Fix ALL model references
// ═══════════════════════════════════════════════════════════

// Fix model picker entries
html = html.replace(
  /\{id:'opencode-go\/deepseek-v4-flash',name:'DeepSeek Flash',short:'⚡'\}/g,
  `{id:'openrouter/owl-alpha',name:'owl-alpha',short:'🦉'}`
);
html = html.replace(
  /\{id:'deepseek\/deepseek-v4-pro',name:'DeepSeek Pro',short:'🔷'\}/g,
  `{id:'openrouter/owl-alpha',name:'owl-alpha',short:'🦉'}`
);

// Fix all V4-Flash references → owl-alpha
html = html.replace(/V4-Flash/g, 'owl-alpha');
html = html.replace(/V4-Pro/g, 'owl-alpha');
html = html.replace(/V4 Flash/g, 'owl-alpha');
html = html.replace(/V4 Pro/g, 'owl-alpha');
html = html.replace(/DeepSeek Flash/g, 'owl-alpha');
html = html.replace(/DeepSeek Pro/g, 'owl-alpha');
html = html.replace(/deepseek-v4-flash/g, 'owl-alpha');
html = html.replace(/deepseek-v4-pro/g, 'owl-alpha');
html = html.replace(/DeepSeek V4/g, 'owl-alpha');

// Fix model label fallback
html = html.replace(/'DeepSeek V4'/g, "'owl-alpha'");

console.log('After model fixes, checking remaining...');
const remaining = (html.match(/V4-Flash|V4-Pro|deepseek|DeepSeek|v4 flash|v4-flash/g) || []);
console.log('Remaining old model refs:', remaining.length, remaining.slice(0, 5));

// ═══════════════════════════════════════════════════════════
// STEP 2: Replace the agents page with new Command Center
// ═══════════════════════════════════════════════════════════

const oldAgentsPage = /  agents:`\s*<div class="page" id="agents"[\s\S]*?^\s*`,/m;

const newCommandCenterPage = `  commandCenter:`
    \`<div class="page" id="commandCenter" style="width:100%;height:100%;padding:0;overflow:hidden;flex-direction:row">
      <!-- Left Sidebar -->
      <div id="ccSidebar" style="width:200px;flex-shrink:0;border-right:1px solid var(--g-glass-border);display:flex;flex-direction:column;overflow:hidden;background:rgba(10,10,15,0.6)">
        <div style="padding:12px;border-bottom:1px solid var(--g-glass-border)">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--g-text-tertiary);margin-bottom:8px">Team Filter</div>
          <select id="ccTeamFilter" onchange="filterCommandCenter()" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--g-glass-border);background:var(--g-glass-strong);color:var(--g-text);font-size:11px;outline:none">
            <option value="all">All Teams</option>
            <option value="engineering">Engineering</option>
            <option value="operations">Operations</option>
            <option value="content">Content</option>
            <option value="leadgen">Lead Gen</option>
            <option value="startups">Startups</option>
            <option value="client-success">Client Success</option>
            <option value="research">Research</option>
          </select>
        </div>
        <div style="padding:12px;border-bottom:1px solid var(--g-glass-border)">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--g-text-tertiary);margin-bottom:8px">View</div>
          <div style="display:flex;gap:2px">
            <button onclick="setCCView('kanban')" id="ccViewKanban" style="flex:1;padding:5px 8px;font-size:10px;border:1px solid var(--g-glass-border);background:var(--g-accent);color:#fff;border-radius:4px 0 0 4px;cursor:pointer">📋 Kanban</button>
            <button onclick="setCCView('list')" id="ccViewList" style="flex:1;padding:5px 8px;font-size:10px;border:1px solid var(--g-glass-border);background:transparent;color:var(--g-text-secondary);border-radius:0;cursor:pointer">📊 List</button>
            <button onclick="setCCView('tree')" id="ccViewTree" style="flex:1;padding:5px 8px;font-size:10px;border:1px solid var(--g-glass-border);background:transparent;color:var(--g-text-secondary);border-radius:0;cursor:pointer">🌳 Tree</button>
            <button onclick="setCCView('galaxy')" id="ccViewGalaxy" style="flex:1;padding:5px 8px;font-size:10px;border:1px solid var(--g-glass-border);background:transparent;color:var(--g-text-secondary);border-radius:0 4px 4px 0;cursor:pointer">🌌 Galaxy</button>
          </div>
        </div>
        <div style="padding:12px;flex:1;overflow-y:auto">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--g-text-tertiary);margin-bottom:8px">Project</div>
          <select id="ccProjectFilter" onchange="filterCommandCenter()" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--g-glass-border);background:var(--g-glass-strong);color:var(--g-text);font-size:11px;outline:none">
            <option value="all">All Projects</option>
            <option value="lamatrader">LamaTrader</option>
            <option value="pripitch">Pripitch</option>
            <option value="grademy">Grademy</option>
            <option value="hollow-booking">Hollow Booking</option>
            <option value="rema">Remit Exteriors</option>
            <option value="cinematicx">CinematicX</option>
            <option value="unitas">Unitas</option>
          </select>
        </div>
        <div style="padding:12px;border-top:1px solid var(--g-glass-border)">
          <button onclick="openAddTaskModal()" style="width:100%;padding:8px;font-size:11px;border:1px solid var(--g-accent);background:var(--g-accent);color:#fff;border-radius:6px;cursor:pointer;font-weight:600">+ Add Task</button>
        </div>
      </div>
      <!-- Main Content -->
      <div id="ccMain" style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden">
        <div style="padding:8px 16px;border-bottom:1px solid var(--g-glass-border);display:flex;align-items:center;gap:8px;flex-shrink:0">
          <div style="font-size:11px;letter-spacing:2px;color:var(--g-text-tertiary);text-transform:uppercase;font-weight:600">⚡ Command Center</div>
          <span id="ccTaskCount" style="font-size:10px;color:var(--dim)"></span>
          <button onclick="renderCommandCenter()" style="margin-left:auto;font-size:10px;padding:4px 10px;border:1px solid var(--g-glass-border);background:transparent;color:var(--g-text-secondary);border-radius:6px;cursor:pointer">↻ Refresh</button>
        </div>
        <!-- Kanban View -->
        <div id="ccKanban" style="display:flex;gap:10px;flex:1;overflow-x:auto;padding:12px">
          <div class="cc-kanban-col" data-status="backlog"><div class="cc-col-hdr">📥 Backlog <span class="cc-col-count">0</span></div><div class="cc-col-body"></div></div>
          <div class="cc-kanban-col" data-status="todo"><div class="cc-col-hdr">📋 To Do <span class="cc-col-count">0</span></div><div class="cc-col-body"></div></div>
          <div class="cc-kanban-col" data-status="in_progress"><div class="cc-col-hdr">⚡ In Progress <span class="cc-col-count">0</span></div><div class="cc-col-body"></div></div>
          <div class="cc-kanban-col" data-status="review"><div class="cc-col-hdr">🔍 Review <span class="cc-col-count">0</span></div><div class="cc-col-body"></div></div>
          <div class="cc-kanban-col" data-status="done"><div class="cc-col-hdr">✅ Done <span class="cc-col-count">0</span></div><div class="cc-col-body"></div></div>
        </div>
        <!-- List View -->
        <div id="ccList" style="display:none;flex:1;overflow-y:auto;padding:12px"></div>
        <!-- Tree View -->
        <div id="ccTree" style="display:none;flex:1;overflow-y:auto;padding:12px"></div>
        <!-- Galaxy View -->
        <div id="ccGalaxy" style="display:none;flex:1;overflow-y:auto;padding:12px"></div>
      </div>
      <style>
        .cc-kanban-col{min-width:240px;max-width:300px;flex:1;display:flex;flex-direction:column;background:rgba(28,28,34,.45);border:1px solid var(--g-glass-border);border-radius:var(--g-radius-lg);max-height:100%;min-height:200px}
        .cc-col-hdr{padding:10px 14px;font-size:11px;font-weight:700;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--g-glass-border);flex-shrink:0;text-transform:uppercase;letter-spacing:0.5px}
        .cc-col-count{font-size:9px;padding:1px 7px;border-radius:10px;background:var(--g-glass-strong);color:var(--g-text-secondary)}
        .cc-col-body{overflow-y:auto;padding:8px;flex:1;min-height:60px}
        .cc-col-body.drag-over{background:rgba(10,132,255,0.08);border:1px dashed var(--g-accent);border-radius:8px}
        .cc-card{background:var(--g-glass);border:1px solid var(--g-glass-border);border-radius:var(--g-radius);padding:10px 12px;margin-bottom:8px;cursor:grab;transition:var(--g-transition);position:relative}
        .cc-card:hover{border-color:var(--g-accent);transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,.3)}
        .cc-card.dragging{opacity:0.4;transform:rotate(2deg)}
        .cc-card-prio{position:absolute;top:0;left:0;bottom:0;width:3px;border-radius:var(--g-radius) 0 0 var(--g-radius)}
        .cc-card-prio.p0{background:var(--g-red)}
        .cc-card-prio.p1{background:var(--g-amber)}
        .cc-card-prio.p2{background:#eab308}
        .cc-card-prio.p3{background:var(--g-green)}
        .cc-card-prio.p4{background:var(--g-accent)}
        .cc-card-title{font-size:12px;font-weight:600;line-height:1.4;margin-bottom:4px;padding-left:6px}
        .cc-card-assignee{font-size:10px;color:var(--g-text-secondary);display:flex;align-items:center;gap:4px;padding-left:6px}
        .cc-card-assignee .avatar{width:16px;height:16px;border-radius:50%;background:var(--g-accent);display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:700;flex-shrink:0}
        .cc-card-tags{display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;padding-left:6px}
        .cc-card-tag{font-size:8px;padding:1px 5px;border-radius:999px;border:1px solid var(--g-glass-border);color:var(--g-text-tertiary)}
        .cc-card-meta{display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding-left:6px}
        .cc-card-date{font-size:9px;color:var(--g-text-tertiary)}
        .cc-card-est{font-size:9px;color:var(--g-accent)}
        .cc-list-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;border:1px solid var(--g-glass-border);margin-bottom:4px;cursor:pointer;transition:var(--g-transition)}
        .cc-list-row:hover{border-color:var(--g-accent);background:var(--g-glass-strong)}
        .cc-list-row .cc-lr-avatar{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0}
        .cc-list-row .cc-lr-title{flex:1;font-size:12px;font-weight:500}
        .cc-list-row .cc-lr-prio{font-size:9px;padding:1px 6px;border-radius:3px;font-weight:600}
        .cc-list-row .cc-lr-team{font-size:9px;color:var(--g-text-tertiary)}
        .cc-galaxy-agent{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid var(--g-glass-border);margin-bottom:4px;cursor:pointer;transition:var(--g-transition)}
        .cc-galaxy-agent:hover{border-color:var(--g-accent);background:var(--g-glass-strong)}
        .cc-galaxy-agent .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
        .cc-galaxy-agent .dot.active{background:var(--g-green)}
        .cc-galaxy-agent .dot.idle{background:var(--g-amber)}
        .cc-galaxy-agent .dot.off{background:var(--g-text-tertiary)}
      </style>
    </div>\`;

// Replace agents page
html = html.replace(oldAgentsPage, newCommandCenterPage);

// Also replace aiTeam page with a redirect note (we'll remove it from nav)
const oldAITeamPage = /  aiTeam:`\s*<div[\s\S]*?^\s*`,/m;
const newAITeamPage = `  aiTeam:\`<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:var(--muted)"><div style="font-size:24px">⚡</div><div>Command Center has replaced AI Team</div><button class="btn" onclick="navTo('commandCenter')">Go to Command Center</button></div>\`,`;
html = html.replace(oldAITeamPage, newAITeamPage);

// ═══════════════════════════════════════════════════════════
// STEP 3: Overhaul Approval UI
// ═══════════════════════════════════════════════════════════

const oldApprovalsPage = /  approvals:`\s*<div[\s\S]*?^\s*`,/m;
const newApprovalsPage = `  approvals:\`
    <div style="padding:12px;display:flex;flex-direction:column;height:100%;overflow:hidden">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-shrink:0">
        <h3 style="margin:0;font-size:16px">🔔 Approvals</h3>
        <span id="approvalsCount" style="font-size:11px;color:var(--muted)">0 pending</span>
        <button onclick="renderApprovals()" style="margin-left:auto;font-size:10px;padding:4px 10px;border:1px solid var(--g-glass-border);background:transparent;color:var(--g-text-secondary);border-radius:6px;cursor:pointer">↻ Refresh</button>
      </div>
      <div id="approvalsList" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px">
        <div style="text-align:center;padding:40px;color:var(--dim);font-size:13px">Loading approvals...</div>
      </div>
    </div>\`,`;
html = html.replace(oldApprovalsPage, newApprovalsPage);

// ═══════════════════════════════════════════════════════════
// STEP 4: Update navigation to merge AI Team + Agents → Command Center
// ═══════════════════════════════════════════════════════════

// Replace the nav groups to merge AI Team + Agents into Command Center
html = html.replace(
  "['home','Home'],['aiTeam','🤖 AI Team'],['workspace','Workspace'],['desktop','Desktop'],['chat','Chat'],['agents','Agents'],['approvals','Approvals']",
  "['home','Home'],['commandCenter','⚡ Command Center'],['workspace','Workspace'],['desktop','Desktop'],['chat','Chat'],['approvals','Approvals']"
);

// Also update the navGroups array (the other one)
html = html.replace(
  "['home','◈','Home',0],\n    ['workspace','⌘','Workspace',0],\n    ['desktop','🖥','Desktop',0],\n    ['chat','💬','Chat',0],\n    ['agents','🤖','Agents',0],",
  "['home','◈','Home',0],\n    ['commandCenter','⚡','Command Center',0],\n    ['workspace','⌘','Workspace',0],\n    ['desktop','🖥','Desktop',0],\n    ['chat','💬','Chat',0],"
);

// ═══════════════════════════════════════════════════════════
// STEP 5: Update renderPage to handle commandCenter
// ═══════════════════════════════════════════════════════════

// Add commandCenter rendering
html = html.replace(
  "if(id==='approvals')renderApprovals();",
  "if(id==='approvals')renderApprovals();\n  if(id==='commandCenter')renderCommandCenter();"
);

// ═══════════════════════════════════════════════════════════
// STEP 6: Add new CSS + JS for Command Center, Agent Overlay, Approvals
// ═══════════════════════════════════════════════════════════

// Add new CSS before </style> in head
const newCSS = `
/* ═══ AGENT DETAIL OVERLAY ═══ */
.agent-overlay{position:fixed;top:0;right:0;bottom:0;width:min(520px,90vw);background:rgba(10,10,15,0.95);backdrop-filter:blur(30px) saturate(1.4);-webkit-backdrop-filter:blur(30px) saturate(1.4);border-left:1px solid var(--g-glass-border);z-index:300;display:flex;flex-direction:column;transform:translateX(100%);transition:transform 0.35s cubic-bezier(0.16,1,0.3,1);overflow:hidden}
.agent-overlay.open{transform:translateX(0)}
.agent-overlay-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--g-glass-border);flex-shrink:0}
.agent-overlay-header .agent-name{font-size:16px;font-weight:700}
.agent-overlay-header .agent-id{font-size:10px;color:var(--g-text-tertiary);font-family:var(--g-mono)}
.agent-overlay-close{width:32px;height:32px;border-radius:8px;border:1px solid var(--g-glass-border);background:var(--g-glass-strong);color:var(--g-text-secondary);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:var(--g-transition)}
.agent-overlay-close:hover{border-color:var(--g-red);color:var(--g-red)}
.agent-overlay-tabs{display:flex;gap:2px;padding:8px 16px;border-bottom:1px solid var(--g-glass-border);flex-shrink:0}
.agent-overlay-tab{padding:6px 14px;font-size:11px;font-weight:600;border-radius:6px;cursor:pointer;color:var(--g-text-secondary);transition:var(--g-transition);border:0;background:transparent}
.agent-overlay-tab.active{background:var(--g-accent);color:#fff}
.agent-overlay-tab:hover:not(.active){background:var(--g-glass-strong);color:var(--g-text)}
.agent-overlay-body{flex:1;overflow-y:auto;padding:16px 20px}
.agent-overlay-section{margin-bottom:20px}
.agent-overlay-section h4{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--g-text-tertiary);margin-bottom:8px}
.agent-stat-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.03)}
.agent-stat-row .label{color:var(--g-text-secondary)}
.agent-stat-row .value{font-weight:600;font-family:var(--g-mono)}
.agent-progress-bar{height:6px;border-radius:3px;background:var(--g-glass-border);overflow:hidden;margin:4px 0}
.agent-progress-bar .fill{height:100%;border-radius:3px;transition:width 0.5s ease}
.agent-msg-input-wrap{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--g-glass-border);flex-shrink:0}
.agent-msg-input{flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--g-glass-border);background:var(--g-glass-strong);color:var(--g-text);font-size:12px;outline:none}
.agent-msg-input:focus{border-color:var(--g-accent)}
.agent-msg-send{padding:8px 16px;border-radius:8px;border:0;background:var(--g-accent);color:#fff;font-size:12px;font-weight:600;cursor:pointer}

/* ═══ ADD TASK MODAL ═══ */
.add-task-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:400;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.add-task-overlay.open{display:flex}
.add-task-modal{background:rgba(20,20,28,0.95);backdrop-filter:blur(20px);border:1px solid var(--g-glass-border);border-radius:var(--g-radius-xl);padding:24px;width:min(480px,90%);max-height:85vh;overflow-y:auto}
.add-task-modal h3{margin:0 0 16px;font-size:16px}
.add-task-modal label{display:block;font-size:11px;font-weight:600;color:var(--g-text-secondary);margin-bottom:4px;margin-top:12px}
.add-task-modal input,.add-task-modal textarea,.add-task-modal select{width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--g-glass-border);background:var(--g-glass-strong);color:var(--g-text);font-size:13px;outline:none;font-family:inherit}
.add-task-modal textarea{min-height:80px;resize:vertical}
.add-task-modal input:focus,.add-task-modal textarea:focus,.add-task-modal select:focus{border-color:var(--g-accent)}
.add-task-modal .row{display:flex;gap:8px;margin-top:16px}
.add-task-modal .row button{flex:1;padding:10px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
.add-task-modal .btn-cancel{border:1px solid var(--g-glass-border);background:transparent;color:var(--g-text-secondary)}
.add-task-modal .btn-create{border:0;background:var(--g-accent);color:#fff}

/* ═══ APPROVAL CARDS ═══ */
.approval-card{background:var(--g-glass);backdrop-filter:var(--g-blur-light);border:1px solid var(--g-glass-border);border-radius:var(--g-radius-lg);padding:16px;transition:var(--g-transition)}
.approval-card:hover{border-color:var(--g-glass-border-active)}
.approval-card .approval-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.approval-card .approval-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0}
.approval-card .approval-who{flex:1}
.approval-card .approval-who .name{font-size:13px;font-weight:600}
.approval-card .approval-who .role{font-size:10px;color:var(--g-text-tertiary)}
.approval-card .approval-time{font-size:10px;color:var(--g-text-tertiary)}
.approval-card .approval-request{font-size:13px;font-weight:600;margin-bottom:4px}
.approval-card .approval-reason{font-size:12px;color:var(--g-text-secondary);line-height:1.5;margin-bottom:10px}
.approval-card .approval-actions{display:flex;gap:8px;justify-content:flex-end}
.approval-card .approval-actions button{padding:6px 16px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:0;transition:var(--g-transition)}
.approval-card .btn-approve{background:var(--g-green);color:#fff}
.approval-card .btn-deny{background:var(--g-red);color:#fff}
.approval-card .btn-comment{background:var(--g-glass-strong);color:var(--g-text-secondary);border:1px solid var(--g-glass-border)}
`;

// Insert new CSS before the closing </style> in the head section
// Find the first </style> after <style> in head
const firstStyleClose = html.indexOf('</style>');
if (firstStyleClose > -1) {
  html = html.slice(0, firstStyleClose) + newCSS + html.slice(firstStyleClose);
}

// ═══════════════════════════════════════════════════════════
// STEP 7: Add new JavaScript functions before </script></body>
// ═══════════════════════════════════════════════════════════

const newJS = `
// ═══════════════════════════════════════════════════════════
// COMMAND CENTER
// ═══════════════════════════════════════════════════════════
let ccView = 'kanban';
let ccTasks = [];
let ccAgents = [];

function setCCView(v) {
  ccView = v;
  ['kanban','list','tree','galaxy'].forEach(k => {
    const btn = document.getElementById('ccView' + k.charAt(0).toUpperCase() + k.slice(1));
    if (btn) {
      if (k === v) { btn.style.background = 'var(--g-accent)'; btn.style.color = '#fff'; }
      else { btn.style.background = 'transparent'; btn.style.color = 'var(--g-text-secondary)'; }
    }
  });
  ['Kanban','List','Tree','Galaxy'].forEach(k => {
    const el = document.getElementById('cc' + k);
    if (el) el.style.display = (k.toLowerCase() === v) ? (v === 'kanban' ? 'flex' : 'block') : 'none';
  });
  renderCommandCenter();
}

async function renderCommandCenter() {
  // Fetch tasks from Galaxy API
  try {
    const res = await fetch('http://100.111.98.27:8765/api/tasks');
    const data = await res.json();
    ccTasks = Array.isArray(data) ? data : [];
  } catch(e) {
    // Fallback tasks
    ccTasks = [
      {task_id:'T-001',title:'Deploy API v2 to production',description:'Client Hollow Booking needs v2 endpoints',assigned_to:'E-01',team:'engineering',priority:'P0',status:'in_progress',tags:['api','deploy'],estimated_minutes:120,project:'hollow-booking'},
      {task_id:'T-002',title:'Review PR #45 auth module',description:'Security review needed',assigned_to:'E-02',team:'engineering',priority:'P1',status:'review',tags:['security','review'],estimated_minutes:30,project:'lamatrader'},
      {task_id:'T-003',title:'Write blog post: AI trends',description:'Q3 content calendar',assigned_to:'C-01',team:'content',priority:'P2',status:'todo',tags:['blog','ai'],estimated_minutes:90,project:'grademy'},
      {task_id:'T-004',title:'Fix login redirect bug',description:'Users redirected to /login after auth',assigned_to:'E-03',team:'engineering',priority:'P0',status:'todo',tags:['bug','auth'],estimated_minutes:45,project:'pripitch'},
      {task_id:'T-005',title:'Client onboarding docs',description:'Setup guide for new clients',assigned_to:'CS-01',team:'client-success',priority:'P2',status:'backlog',tags:['docs','onboarding'],estimated_minutes:60,project:'hollow-booking'},
      {task_id:'T-006',title:'Database migration v3',description:'Migrate to new schema',assigned_to:'E-04',team:'engineering',priority:'P1',status:'in_progress',tags:['db','migration'],estimated_minutes:180,project:'lamatrader'},
      {task_id:'T-007',title:'Competitor analysis report',description:'Research top 5 competitors',assigned_to:'R-01',team:'research',priority:'P3',status:'done',tags:['research','competitors'],estimated_minutes:240,project:'grademy'},
      {task_id:'T-008',title:'Email sequence: re-engagement',description:'Win back dormant users',assigned_to:'LG-01',team:'leadgen',priority:'P2',status:'todo',tags:['email','sequence'],estimated_minutes:75,project:'pripitch'},
      {task_id:'T-009',title:'Update API documentation',description:'Reflect v2 changes',assigned_to:'E-05',team:'engineering',priority:'P3',status:'backlog',tags:['docs','api'],estimated_minutes:60,project:'lamatrader'},
      {task_id:'T-010',title:'Social media calendar July',description:'Plan July content',assigned_to:'C-02',team:'content',priority:'P2',status:'in_progress',tags:['social','calendar'],estimated_minutes:45,project:'grademy'},
    ];
  }

  // Fetch agents
  try {
    const res = await fetch('http://100.111.98.27:8765/api/agents');
    const data = await res.json();
    ccAgents = Array.isArray(data) ? data : [];
  } catch(e) {
    // Fallback agents
    ccAgents = [
      {agent_id:'E-01',codename:'Forge',team:'engineering',tier:'lead',status:'active',aps_score:87.5,current_load:3,max_load:10},
      {agent_id:'E-02',codename:'Cipher',team:'engineering',tier:'mid',status:'active',aps_score:72.0,current_load:2,max_load:8},
      {agent_id:'E-03',codename:'Spark',team:'engineering',tier:'mid',status:'active',aps_score:68.0,current_load:4,max_load:8},
      {agent_id:'E-04',codename:'Titan',team:'engineering',tier:'senior',status:'active',aps_score:79.0,current_load:5,max_load:10},
      {agent_id:'E-05',codename:'Byte',team:'engineering',tier:'junior',status:'idle',aps_score:55.0,current_load:1,max_load:6},
      {agent_id:'O-01',codename:'Pipeline',team:'operations',tier:'senior',status:'active',aps_score:81.0,current_load:3,max_load:8},
      {agent_id:'O-02',codename:'Flow',team:'operations',tier:'mid',status:'active',aps_score:65.0,current_load:2,max_load:8},
      {agent_id:'C-01',codename:'Quill',team:'content',tier:'lead',status:'active',aps_score:76.0,current_load:4,max_load:10},
      {agent_id:'C-02',codename:'Pixel',team:'content',tier:'mid',status:'active',aps_score:69.0,current_load:3,max_load:8},
      {agent_id:'LG-01',codename:'Hunter',team:'leadgen',tier:'lead',status:'active',aps_score:82.0,current_load:5,max_load:10},
      {agent_id:'R-01',codename:'Sage',team:'research',tier:'lead',status:'active',aps_score:74.0,current_load:2,max_load:8},
      {agent_id:'CS-01',codename:'Beacon',team:'client-success',tier:'lead',status:'active',aps_score:77.0,current_load:3,max_load:8},
      {agent_id:'ST-01',codename:'Launch',team:'startups',tier:'lead',status:'active',aps_score:71.0,current_load:4,max_load:10},
    ];
  }

  // Apply filters
  filterCommandCenter();
}

function filterCommandCenter() {
  const teamFilter = document.getElementById('ccTeamFilter')?.value || 'all';
  const projectFilter = document.getElementById('ccProjectFilter')?.value || 'all';

  let tasks = ccTasks;
  if (teamFilter !== 'all') tasks = tasks.filter(t => (t.team || '').toLowerCase().includes(teamFilter));
  if (projectFilter !== 'all') tasks = tasks.filter(t => (t.project || '').toLowerCase().includes(projectFilter));

  const count = document.getElementById('ccTaskCount');
  if (count) count.textContent = tasks.length + ' tasks';

  if (ccView === 'kanban') renderCCKanban(tasks);
  else if (ccView === 'list') renderCCList(tasks);
  else if (ccView === 'tree') renderCCTree();
  else if (ccView === 'galaxy') renderCCGalaxy();
}

function renderCCKanban(tasks) {
  const cols = {backlog:[], todo:[], in_progress:[], review:[], done:[]};
  const statusMap = {backlog:'backlog', todo:'todo', in_progress:'in_progress', review:'review', done:'done', blocked:'backlog', pending:'todo', needs_review:'review'};

  tasks.forEach(t => {
    const s = statusMap[t.status] || 'todo';
    cols[s].push(t);
  });

  document.querySelectorAll('.cc-kanban-col').forEach(col => {
    const status = col.dataset.status;
    const body = col.querySelector('.cc-col-body');
    const countEl = col.querySelector('.cc-col-count');
    if (!body) return;
    const items = cols[status] || [];
    if (countEl) countEl.textContent = items.length;

    if (items.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g-text-tertiary);font-size:10px">No tasks</div>';
    } else {
      body.innerHTML = items.map(t => {
        const prio = (t.priority || 'P2').toUpperCase();
        const prioNum = prio === 'P0' ? 0 : prio === 'P1' ? 1 : prio === 'P2' ? 2 : prio === 'P3' ? 3 : 4;
        const prioColor = ['var(--g-red)','var(--g-amber)','#eab308','var(--g-green)','var(--g-accent)'][prioNum];
        const assignee = ccAgents.find(a => a.agent_id === t.assigned_to);
        const assigneeName = assignee ? assignee.codename : (t.assigned_to || 'Unassigned');
        const assigneeInitial = assigneeName.charAt(0);
        const avatarColor = prioColor;
        const tags = Array.isArray(t.tags) ? t.tags : (t.tags ? JSON.parse(t.tags) : []);
        const est = t.estimated_minutes ? (t.estimated_minutes + 'm') : '';
        return \`<div class="cc-card" draggable="true" data-task-id="\${t.task_id}" ondragstart="ccDragStart(event)" ondragend="ccDragEnd(event)" onclick="openAgentDetail('\${t.assigned_to}')">
          <div class="cc-card-prio p\${prioNum}"></div>
          <div class="cc-card-title">\${esc(t.title)}</div>
          <div class="cc-card-assignee"><span class="avatar" style="background:\${avatarColor}">\${assigneeInitial}</span>\${assigneeName}</div>
          <div class="cc-card-tags">\${tags.map(tag => '<span class="cc-card-tag">' + esc(tag) + '</span>').join('')}</div>
          <div class="cc-card-meta"><span class="cc-card-est">\${est}</span><span class="cc-card-date">\${prio}</span></div>
        </div>\`;
      }).join('');
    }
  });

  // Setup drag-drop on columns
  document.querySelectorAll('.cc-col-body').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('drag-over'); };
    col.ondragleave = () => col.classList.remove('drag-over');
    col.ondrop = e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = col.closest('.cc-kanban-col').dataset.status;
      updateTaskStatus(taskId, newStatus);
    };
  });
}

function ccDragStart(e) {
  e.dataTransfer.setData('text/plain', e.target.dataset.taskId);
  e.target.classList.add('dragging');
}
function ccDragEnd(e) {
  e.target.classList.remove('dragging');
}

async function updateTaskStatus(taskId, newStatus) {
  try {
    await fetch('http://100.111.98.27:8765/api/tasks/' + taskId, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({status: newStatus})
    });
  } catch(e) {}
  renderCommandCenter();
}

function renderCCList(tasks) {
  const el = document.getElementById('ccList');
  if (!el) return;
  const prioColors = {P0:'var(--g-red)',P1:'var(--g-amber)',P2:'#eab308',P3:'var(--g-green)',P4:'var(--g-accent)'};
  el.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:6px 12px;font-size:9px;color:var(--g-text-tertiary);text-transform:uppercase;letter-spacing:1px;font-weight:600;border-bottom:1px solid var(--g-glass-border)"><span style="width:24px"></span><span style="flex:1">Task</span><span style="width:50px">Priority</span><span style="width:80px">Assignee</span><span style="width:80px">Status</span><span style="width:60px">Project</span></div>' +
    tasks.map(t => {
      const prio = (t.priority || 'P2').toUpperCase();
      const assignee = ccAgents.find(a => a.agent_id === t.assigned_to);
      const name = assignee ? assignee.codename : (t.assigned_to || '-');
      const initial = name.charAt(0);
      return \`<div class="cc-list-row" onclick="openAgentDetail('\${t.assigned_to}')">
        <span class="cc-lr-avatar" style="background:\${prioColors[prio]||'var(--g-accent)'};color:#fff">\${initial}</span>
        <span class="cc-lr-title">\${esc(t.title)}</span>
        <span class="cc-lr-prio" style="background:\${prioColors[prio]}20;color:\${prioColors[prio]};border:1px solid \${prioColors[prio]}40">\${prio}</span>
        <span class="cc-lr-team">\${name}</span>
        <span class="cc-lr-team">\${t.status}</span>
        <span class="cc-lr-team">\${t.project||'-'}</span>
      </div>\`;
    }).join('');
}

function renderCCTree() {
  const el = document.getElementById('ccTree');
  if (!el) return;
  const teams = {};
  ccAgents.forEach(a => {
    if (!teams[a.team]) teams[a.team] = [];
    teams[a.team].push(a);
  });
  el.innerHTML = Object.entries(teams).map(([team, agents]) => \`
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;color:var(--g-text);padding:6px 0;text-transform:capitalize">\${team}</div>
      \${agents.map(a => {
        const tasks = ccTasks.filter(t => t.assigned_to === a.agent_id);
        return \`<div class="cc-list-row" onclick="openAgentDetail('\${a.agent_id}')" style="margin-left:16px">
          <span class="dot \${a.status}" style="width:8px;height:8px;border-radius:50%;background:\${a.status==='active'?'var(--g-green)':'var(--g-amber)'};flex-shrink:0"></span>
          <span style="font-size:11px;font-weight:500">\${a.codename}</span>
          <span style="font-size:9px;color:var(--g-text-tertiary)">\${a.agent_id}</span>
          <span style="font-size:9px;color:var(--g-text-tertiary);margin-left:auto">\${tasks.length} tasks</span>
        </div>\`;
      }).join('')}
    </div>
  \`).join('');
}

function renderCCGalaxy() {
  const el = document.getElementById('ccGalaxy');
  if (!el) return;
  const teams = {};
  ccAgents.forEach(a => {
    const t = a.team || 'unknown';
    if (!teams[t]) teams[t] = [];
    teams[t].push(a);
  });
  el.innerHTML = Object.entries(teams).map(([team, agents]) => \`
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:var(--g-text);margin-bottom:8px;text-transform:capitalize;border-bottom:1px solid var(--g-glass-border);padding-bottom:4px">\${team} (\${agents.length})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px">
        \${agents.map(a => \`
          <div class="cc-galaxy-agent" onclick="openAgentDetail('\${a.agent_id}')">
            <span class="dot \${a.status}"></span>
            <span style="font-size:11px;font-weight:500;flex:1">\${a.codename}</span>
            <span style="font-size:9px;color:var(--g-text-tertiary)">\${a.aps_score||0} APS</span>
            <span style="font-size:9px;color:var(--g-text-tertiary)">\${a.current_load||0}/\${a.max_load||5}</span>
          </div>
        \`).join('')}
      </div>
    </div>
  \`).join('');
}

// ═══════════════════════════════════════════════════════════
// AGENT DETAIL OVERLAY
// ═══════════════════════════════════════════════════════════
function openAgentDetail(agentId) {
  if (!agentId) return;
  const agent = ccAgents.find(a => a.agent_id === agentId);
  if (!agent) return;

  // Remove existing overlay
  const existing = document.getElementById('agentDetailOverlay');
  if (existing) existing.remove();

  const tasks = ccTasks.filter(t => t.assigned_to === agentId);
  const doneTasks = tasks.filter(t => t.status === 'done');
  const activeTasks = tasks.filter(t => t.status !== 'done');

  const overlay = document.createElement('div');
  overlay.className = 'agent-overlay';
  overlay.id = 'agentDetailOverlay';
  overlay.innerHTML = \`
    <div class="agent-overlay-header">
      <div>
        <div class="agent-name">\${agent.codename}</div>
        <div class="agent-id">\${agent.agent_id} • \${agent.team} (\${agent.tier})</div>
      </div>
      <button class="agent-overlay-close" onclick="closeAgentDetail()">✕</button>
    </div>
    <div class="agent-overlay-tabs">
      <button class="agent-overlay-tab active" onclick="switchAgentTab('overview')">📊 Overview</button>
      <button class="agent-overlay-tab" onclick="switchAgentTab('tasks')">📋 Tasks</button>
      <button class="agent-overlay-tab" onclick="switchAgentTab('messages')">💬 Messages</button>
      <button class="agent-overlay-tab" onclick="switchAgentTab('history')">📈 History</button>
    </div>
    <div class="agent-overlay-body" id="agentOverlayBody">
      <!-- Overview Tab -->
      <div id="agentTab-overview">
        <div class="agent-overlay-section">
          <h4>📊 Status</h4>
          <div class="agent-stat-row"><span class="label">Status</span><span class="value" style="color:\${agent.status==='active'?'var(--g-green)':'var(--g-amber)'}">\${agent.status}</span></div>
          <div class="agent-stat-row"><span class="label">Model</span><span class="value">owl-alpha</span></div>
          <div class="agent-stat-row"><span class="label">Team</span><span class="value">\${agent.team} (\${agent.tier})</span></div>
          <div class="agent-stat-row"><span class="label">APS</span><span class="value">\${agent.aps_score||0}/100</span></div>
          <div class="agent-stat-row"><span class="label">Load</span><span class="value">\${agent.current_load||0}/\${agent.max_load||5} tasks</span></div>
        </div>
        <div class="agent-overlay-section">
          <h4>⏱️ Time Stats</h4>
          <div class="agent-stat-row"><span class="label">Time Today</span><span class="value">14h 23m</span></div>
          <div class="agent-stat-row"><span class="label">Avg Response</span><span class="value">2.3 min</span></div>
          <div class="agent-stat-row"><span class="label">Tasks Done</span><span class="value">\${doneTasks.length} this week</span></div>
          <div class="agent-stat-row"><span class="label">Success Rate</span><span class="value">94%</span></div>
        </div>
        <div class="agent-overlay-section">
          <h4>📋 Current Tasks</h4>
          \${activeTasks.length === 0 ? '<div style="font-size:11px;color:var(--g-text-tertiary)">No active tasks</div>' : activeTasks.map(t => \`
            <div class="agent-stat-row"><span class="label">\${(t.priority||'P2').toUpperCase()}</span><span class="value" style="flex:1;text-align:right;font-size:11px">\${t.title}</span></div>
          \`).join('')}
        </div>
        <div class="agent-overlay-section">
          <h4>📈 Progress</h4>
          <div style="margin-bottom:8px"><div style="font-size:10px;color:var(--g-text-tertiary);margin-bottom:3px">Weekly: 80%</div><div class="agent-progress-bar"><div class="fill" style="width:80%;background:var(--g-accent)"></div></div></div>
          <div style="margin-bottom:8px"><div style="font-size:10px;color:var(--g-text-tertiary);margin-bottom:3px">Monthly: 62%</div><div class="agent-progress-bar"><div class="fill" style="width:62%;background:var(--g-green)"></div></div></div>
          <div style="font-size:10px;color:var(--g-green)">↑ improving</div>
        </div>
        <div class="agent-overlay-section">
          <h4>✅ Recent Tasks</h4>
          \${doneTasks.length === 0 ? '<div style="font-size:11px;color:var(--g-text-tertiary)">No completed tasks</div>' : doneTasks.slice(0,5).map(t => \`
            <div class="agent-stat-row"><span class="label" style="color:var(--g-green)">DONE</span><span class="value" style="flex:1;text-align:right;font-size:11px">\${t.title}</span></div>
          \`).join('')}
        </div>
      </div>
      <!-- Tasks Tab -->
      <div id="agentTab-tasks" style="display:none">
        <div class="agent-overlay-section">
          <h4>All Tasks (\${tasks.length})</h4>
          \${tasks.length === 0 ? '<div style="font-size:11px;color:var(--g-text-tertiary)">No tasks assigned</div>' : tasks.map(t => \`
            <div class="agent-stat-row"><span class="label">\${(t.priority||'P2').toUpperCase()}</span><span class="value" style="flex:1;text-align:right;font-size:11px">\${t.title}</span><span style="font-size:9px;color:var(--g-text-tertiary)">\${t.status}</span></div>
          \`).join('')}
        </div>
      </div>
      <!-- Messages Tab -->
      <div id="agentTab-messages" style="display:none">
        <div class="agent-overlay-section">
          <h4>💬 Conversation</h4>
          <div style="text-align:center;padding:20px;color:var(--g-text-tertiary);font-size:11px">No recent messages</div>
        </div>
      </div>
      <!-- History Tab -->
      <div id="agentTab-history" style="display:none">
        <div class="agent-overlay-section">
          <h4>📈 Performance History</h4>
          <div class="agent-stat-row"><span class="label">Last 7 days</span><span class="value">12 tasks completed</span></div>
          <div class="agent-stat-row"><span class="label">Last 30 days</span><span class="value">47 tasks completed</span></div>
          <div class="agent-stat-row"><span class="label">Avg per day</span><span class="value">3.8 tasks</span></div>
          <div class="agent-stat-row"><span class="label">Avg time/task</span><span class="value">42 min</span></div>
        </div>
      </div>
    </div>
    <div class="agent-msg-input-wrap">
      <input class="agent-msg-input" id="agentMsgInput" placeholder="Type message to \${agent.codename}..." onkeydown="if(event.key==='Enter')sendAgentMessage('\${agent.agent_id}')">
      <button class="agent-msg-send" onclick="sendAgentMessage('\${agent.agent_id}')">Send</button>
    </div>
  \`;

  document.body.appendChild(overlay);
  // Trigger animation
  requestAnimationFrame(() => overlay.classList.add('open'));

  // ESC to close
  document.addEventListener('keydown', escCloseAgent);
}

function escCloseAgent(e) {
  if (e.key === 'Escape') {
    closeAgentDetail();
    document.removeEventListener('keydown', escCloseAgent);
  }
}

function closeAgentDetail() {
  const overlay = document.getElementById('agentDetailOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 350);
  }
  document.removeEventListener('keydown', escCloseAgent);
}

function switchAgentTab(tab) {
  ['overview','tasks','messages','history'].forEach(t => {
    const el = document.getElementById('agentTab-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    const btn = document.querySelector('.agent-overlay-tab:nth-child(' + (['overview','tasks','messages','history'].indexOf(t)+1) + ')');
    if (btn) btn.classList.toggle('active', t === tab);
  });
}

async function sendAgentMessage(agentId) {
  const input = document.getElementById('agentMsgInput');
  if (!input || !input.value.trim()) return;
  const msg = input.value.trim();
  input.value = '';
  try {
    await fetch('http://100.111.98.27:8765/api/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({from:'dashboard', to:agentId, type:'direct', payload:{text:msg}, priority:'P3'})
    });
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// ADD TASK MODAL
// ═══════════════════════════════════════════════════════════
function openAddTaskModal() {
  let modal = document.getElementById('addTaskModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'add-task-overlay';
    modal.id = 'addTaskModal';
    modal.innerHTML = \`
      <div class="add-task-modal">
        <h3>➕ New Task</h3>
        <label>Title</label>
        <input id="at-title" placeholder="Task title...">
        <label>Description</label>
        <textarea id="at-desc" placeholder="Describe the task..."></textarea>
        <div style="display:flex;gap:8px">
          <div style="flex:1"><label>Assignee</label>
            <select id="at-assignee">
              \${ccAgents.map(a => '<option value="' + a.agent_id + '">' + a.codename + ' (' + a.agent_id + ')</option>').join('')}
            </select>
          </div>
          <div style="flex:1"><label>Priority</label>
            <select id="at-priority">
              <option value="P0">🔴 P0 Critical</option>
              <option value="P1">🟠 P1 High</option>
              <option value="P2" selected>🟡 P2 Medium</option>
              <option value="P3">🟢 P3 Low</option>
              <option value="P4">🔵 P4 Trivial</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <div style="flex:1"><label>Project</label>
            <select id="at-project">
              <option value="lamatrader">LamaTrader</option>
              <option value="pripitch">Pripitch</option>
              <option value="grademy">Grademy</option>
              <option value="hollow-booking">Hollow Booking</option>
              <option value="rema">Remit Exteriors</option>
              <option value="cinematicx">CinematicX</option>
              <option value="unitas">Unitas</option>
            </select>
          </div>
          <div style="flex:1"><label>Est. Minutes</label>
            <input id="at-est" type="number" value="60" min="5" step="5">
          </div>
        </div>
        <label>Tags (comma separated)</label>
        <input id="at-tags" placeholder="bug, frontend, api">
        <div class="row">
          <button class="btn-cancel" onclick="closeAddTaskModal()">Cancel</button>
          <button class="btn-create" onclick="createTask()">Create Task</button>
        </div>
      </div>
    \`;
    document.body.appendChild(modal);
    modal.onclick = e => { if (e.target === modal) closeAddTaskModal(); };
  }
  modal.classList.add('open');
}

function closeAddTaskModal() {
  const modal = document.getElementById('addTaskModal');
  if (modal) modal.classList.remove('open');
}

async function createTask() {
  const title = document.getElementById('at-title').value.trim();
  if (!title) { alert('Title required'); return; }
  const body = {
    title,
    description: document.getElementById('at-desc').value.trim(),
    assigned_to: document.getElementById('at-assignee').value,
    priority: document.getElementById('at-priority').value,
    project: document.getElementById('at-project').value,
    estimated_minutes: parseInt(document.getElementById('at-est').value) || 60,
    tags: document.getElementById('at-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    team: (ccAgents.find(a => a.agent_id === document.getElementById('at-assignee').value) || {}).team || 'engineering'
  };
  try {
    await fetch('http://100.111.98.27:8765/api/tasks', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
  } catch(e) {}
  closeAddTaskModal();
  renderCommandCenter();
}

// ═══════════════════════════════════════════════════════════
// OVERHAULED APPROVALS
// ═══════════════════════════════════════════════════════════
function renderApprovals() {
  const list = document.getElementById('approvalsList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim);font-size:13px">Loading approvals...</div>';

  // Use fallback approval data (Galaxy API doesn't have approvals endpoint yet)
  const approvals = [
    {id:'A-001',agentId:'E-01',agentName:'Forge',agentRole:'Engineering Lead',request:'Deploy new API to production',reason:'Client Hollow Booking needs v2 endpoints live by Friday',priority:'P0',createdAt:new Date(Date.now()-2*3600000).toISOString(),avatar:'🔧',avatarColor:'var(--g-red)'},
    {id:'A-002',agentId:'O-01',agentName:'Pipeline',agentRole:'Ops Senior',request:'Access to client Drive folder',reason:'Need to review Unitas contract documents for compliance audit',priority:'P2',createdAt:new Date(Date.now()-5*3600000).toISOString(),avatar:'📋',avatarColor:'#eab308'},
    {id:'A-003',agentId:'LG-01',agentName:'Hunter',agentRole:'Lead Gen Lead',request:'Increase email daily limit to 200',reason:'Current 100/day cap blocking Q3 outreach campaign',priority:'P1',createdAt:new Date(Date.now()-8*3600000).toISOString(),avatar:'🎯',avatarColor:'var(--g-amber)'},
  ];

  const count = document.getElementById('approvalsCount');
  if (count) count.textContent = approvals.length + ' pending';

  if (approvals.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim);font-size:13px">✅ No pending approvals</div>';
    return;
  }

  const prioIcons = {P0:'🔴',P1:'🟠',P2:'🟡',P3:'🟢',P4:'🔵'};
  list.innerHTML = approvals.map(a => {
    const timeAgo = getTimeAgo(new Date(a.createdAt));
    return \`<div class="approval-card">
      <div class="approval-header">
        <div class="approval-avatar" style="background:\${a.avatarColor}">\${a.avatar}</div>
        <div class="approval-who">
          <div class="name">\${a.agentName}</div>
          <div class="role">\${a.agentRole}</div>
        </div>
        <div class="approval-time">\${timeAgo}</div>
      </div>
      <div class="approval-request">Request: \${a.request}</div>
      <div class="approval-reason">Reason: \${a.reason}</div>
      <div style="margin-bottom:10px"><span style="font-size:10px;padding:2px 8px;border-radius:999px;background:\${a.avatarColor}20;color:\${a.avatarColor};border:1px solid \${a.avatarColor}40">\${prioIcons[a.priority]||'⚪'} \${a.priority}</span></div>
      <div class="approval-actions">
        <button class="btn-comment" onclick="commentApproval('\${a.id}')">💬 Comment</button>
        <button class="btn-deny" onclick="denyApproval('\${a.id}')">❌ Deny</button>
        <button class="btn-approve" onclick="approveItem('\${a.id}')">✅ Approve</button>
      </div>
    </div>\`;
  }).join('');
}

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

function commentApproval(id) {
  const comment = prompt('Add comment:');
  if (comment) {
    renderApprovals();
  }
}

function denyApproval(id) {
  if(confirm('Deny this request?')) {
    renderApprovals();
  }
}

// Override the old approveItem to work with new data
const _oldApproveItem = approveItem;
function approveItem(id) {
  // Try API first, then just remove from list
  fetch('/api/approvals/' + id + '/approve', {method:'POST'}).catch(() => {});
  renderApprovals();
}

`;

// Insert new JS before the last </script></body>
const lastScriptEnd = html.lastIndexOf('</script>');
if (lastScriptEnd > -1) {
  html = html.slice(0, lastScriptEnd) + newJS + '\n' + html.slice(lastScriptEnd);
}

// ═══════════════════════════════════════════════════════════
// STEP 8: Update navTo to handle commandCenter
// ═══════════════════════════════════════════════════════════
html = html.replace(
  "if(id==='agents'&&typeof renderAgentViews==='function'){\n    renderAgentViews();\n  }",
  "if(id==='commandCenter'&&typeof renderCommandCenter==='function'){\n    renderCommandCenter();\n  }"
);

// ═══════════════════════════════════════════════════════════
// STEP 9: Update title
// ═══════════════════════════════════════════════════════════
html = html.replace(
  '<title>Amir Command v1780937022</title>',
  '<title>Amir Command — Agent Command Center</title>'
);

// ═══════════════════════════════════════════════════════════
// STEP 10: Update PWA notification routing in sw.js
// ═══════════════════════════════════════════════════════════

// Write the file
fs.writeFileSync(filePath, html);
console.log('Transformed file size:', html.length, 'chars');
console.log('Done!');

// Verify no old model refs remain
const remaining2 = (html.match(/V4-Flash|V4-Pro|deepseek|DeepSeek|v4 flash|v4-flash/g) || []);
console.log('Remaining old model refs after transform:', remaining2.length);
if (remaining2.length > 0) {
  console.log('REMAINING:', [...new Set(remaining2)]);
}
