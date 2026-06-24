const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 1702);
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data', 'state.json');
const MINDMAP = '/home/admin/.openclaw/workspace/ragmind-deploy/index.html';
const SKILL_ROOT = '/home/admin/.openclaw/workspace/lamatrader-ingest/skills-unpacked';

// Pre-load galaxy content for inline embedding
let GALAXY_HEAD = '', GALAXY_BODY = '';
try {
  const raw = fs.readFileSync(path.join(ROOT, 'galaxy-3d.html'), 'utf8');
  // Extract head content (styles + importmap)
  const headMatch = raw.match(/<head>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    // Extract all style and importmap script tags
    const styles = (headMatch[1].match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');
    const importMap = (headMatch[1].match(/<script\s+type="importmap"[^>]*>[\s\S]*?<\/script>/gi) || []).join('\n');
    GALAXY_HEAD = styles + '\n' + importMap;
  }
  // Extract body content (HTML elements + module script)
  const bodyMatch = raw.match(/<body>([\s\S]*?)<\/body>/i);
  if (bodyMatch) GALAXY_BODY = bodyMatch[1];
  console.log('[server] Galaxy pre-loaded: head', GALAXY_HEAD.length, 'bytes, body', GALAXY_BODY.length, 'bytes');
} catch(e) { console.error('[server] Galaxy pre-load failed:', e.message); }
const DIST = '/home/admin/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/dist';
const webpush = require('web-push');
const GATEWAY_TOKEN = '18887c5120877c427dbf9882558acc3d55683db10cc2a4bc';
const VAPID_PUBLIC = 'BAUK7hBjvWTKYquv-rOOM07SIeew7YBjsNBaE5rrnTbqIakacOBgOiT9JDqbLzgRv4jkT4WWgeQSRT_dXJSiBM8';
const VAPID_PRIVATE = 'eko2QpZhYyMNJ0U7HNZTl0L_-4AbrdV2gkc6M2gOplw';
webpush.setVapidDetails('mailto:amir@ragmedium.com', VAPID_PUBLIC, VAPID_PRIVATE);
const SESSIONS_DB = '/home/admin/.openclaw/agents/main/sessions/sessions.json';

// ─── Push notification helper ────────────────────────────────────
function sendPushToAll(state, title, body, tag, data) {
  const subs = (state.pushSubscriptions || []).filter(s => s.endpoint);
  if (!subs.length) return;
  const isTodo = (tag||'').startsWith('todo-');
  const actions = isTodo ? [
    { action: 'mark_done', title: '✅ Mark Done' },
    { action: 'open', title: '🔍 View' }
  ] : [{ action: 'open', title: '🔍 View' }];
  const payload = JSON.stringify({
    title: title || 'Amir Command',
    body: body || '',
    tag: tag || 'dashboard-notif',
    data: data || {},
    icon: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: actions
  });
  const dead = [];
  for (const sub of subs) {
    try {
      webpush.sendNotification(sub, payload).catch(e => {
        if (e.statusCode === 410 || e.statusCode === 404) dead.push(sub.endpoint);
      });
    } catch(e) {}
  }
  // Clean dead subs async
  if (dead.length) {
    state.pushSubscriptions = subs.filter(s => !dead.includes(s.endpoint));
    try { fs.writeFileSync(DATA, JSON.stringify(state, null, 2)); } catch(e) {}
  }
}

// ─── Gateway RPC client (routes to Kaneki via OpenClaw gateway) ───
// Raw WebSocket bridge — bypasses GatewayClient module for stability
const WS_PATH = path.join(DIST,'..','node_modules','ws','index.js');
let WebSocket = null;
try { WebSocket = require(WS_PATH); } catch(e) { console.error('[gateway] ws not found:', e.message); }
let gwWs = null, gwReady = false, gwSeq = 0;
const gwPending = {};

function connectGateway() {
  if (!WebSocket) return;
  try {
    gwWs = new WebSocket('ws://127.0.0.1:18789', { headers: { 'Origin': 'http://127.0.0.1:18789' } });
    gwWs.on('open', () => console.log('[gateway] Socket open'));
    gwWs.on('message', (raw) => {
      try {
        const f = JSON.parse(raw.toString());
        if (f.type === 'event' && f.event === 'connect.challenge') {
          gwWs.send(JSON.stringify({
            type: 'req', id: String(++gwSeq), method: 'connect',
            params: {
              minProtocol: 3, maxProtocol: 4,
              client: { id: 'webchat', version: '1.0', platform: 'linux', mode: 'webchat' },
              role: 'operator',
              scopes: ['operator.read', 'operator.write', 'operator.admin'],
              caps: [], commands: ['chat.send'], permissions: {},
              auth: { token: GATEWAY_TOKEN }
            }
          }));
          return;
        }
        if (f.type === 'res') {
          if (f.ok && f.payload?.type === 'hello-ok') {
            gwReady = true;
            console.log('[gateway] Connected and authenticated');
          }
          if (f.id && gwPending[f.id]) { gwPending[f.id].resolve(f); delete gwPending[f.id]; }
        }
      } catch(e) {}
    });
    gwWs.on('close', () => { gwReady = false; console.log('[gateway] Disconnected'); setTimeout(connectGateway, 5000); });
    gwWs.on('error', (e) => console.error('[gateway] Socket error:', e.message));
  } catch(e) { console.error('[gateway] Connect error:', e.message); }
}

function gwRpc(method, params, timeoutMs) {
  if (!gwReady || !gwWs) return Promise.reject(new Error('Gateway not connected'));
  const t = timeoutMs || 120000;
  return new Promise((resolve, reject) => {
    const id = String(++gwSeq);
    gwPending[id] = { resolve, reject };
    gwWs.send(JSON.stringify({ type: 'req', id, method, params }));
    setTimeout(() => {
      if (gwPending[id]) { delete gwPending[id]; reject(new Error('Gateway RPC timeout')); }
    }, t);
  });
}

function getSessionReply(sessionKey) {
  try {
    if (!fs.existsSync(SESSIONS_DB)) return null;
    const db = JSON.parse(fs.readFileSync(SESSIONS_DB, 'utf8'));
    const entry = db[sessionKey];
    if (!entry || entry.status !== 'done') return null;
    const sessFile = entry.sessionFile;
    if (!sessFile || !fs.existsSync(sessFile)) return null;
    const raw = fs.readFileSync(sessFile, 'utf8').trim();
    if (!raw) return null;
    const lines = raw.split(String.fromCharCode(10));
    let reply = '';
    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        const msg = parsed.message || parsed;
        if (msg.role === 'assistant') {
          const cnt = msg.content || msg.text || '';
          if (typeof cnt === 'string') { reply = cnt; }
          else if (Array.isArray(cnt)) {
            const parts = cnt.filter(function(x) { return x && x.type === 'text' && x.text; }).map(function(x) { return x.text; });
            if (parts.length) reply = parts.join(String.fromCharCode(10));
          }
        }
      } catch(e) {}
    }
    return reply || null;
  } catch(e) { return null; }
}

function waitForGateway() {
  if (gwReady) return Promise.resolve();
  return new Promise(resolve => {
    const check = setInterval(() => {
      if (gwReady) { clearInterval(check); resolve(); }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 10000);
  });
}

const nowISO = () => new Date().toISOString();
function localDateKey(d=new Date()){ const x=new Date(d); const y=x.getFullYear(), m=String(x.getMonth()+1).padStart(2,'0'), day=String(x.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function todayKey(d=new Date()){ const x=new Date(d); if(x.getHours()<6)x.setDate(x.getDate()-1); return localDateKey(x); }
function id(prefix='id'){ return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }
function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,54)||id('slug'); }
function clip(s,n=140){ s=String(s||'').replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n-1)+'…':s; }
function genericTitle(t){ return !t || /^(new chat|chat|kaneki)$/i.test(String(t).trim()); }
function smartThreadTitle(text, thread, state){
  let x=String(text||'').replace(/^Turn this into clean dashboard to-dos.*?:\s*/i,'').replace(/^Create useful content ideas.*?:\s*/i,'').replace(/^Make a concise execution plan.*?:\s*/i,'').replace(/^VISUALIZE this\..*?:\s*/i,'').replace(/^Return a structured.*?:\s*/i,'').replace(/\s+/g,' ').trim();
  x=x.replace(/^(can you|could you|please|hey|hi|yo|bro|ibr)\b[,.\s]*/i,'').trim();
  const pid=(thread.context?.businessIds||[])[0]; const proj=pid?(state.businesses||[]).find(b=>b.id===pid)?.name:'';
  let title=clip(x,48).replace(/[?.!,:;]+$/,'') || (proj?`${proj} chat`:'New thread');
  if(proj && !title.toLowerCase().includes(proj.toLowerCase().split(' ')[0])) title=`${proj}: ${title}`;
  return title;
}
function sessionKeyForThread(t){ return t.sessionKey || `agent:main:dashboard-${t.id||'general'}`; }

function parseSkillFrontmatter(txt){
  const m=String(txt||'').match(/^---\n([\s\S]*?)\n---/); const meta={}; if(!m) return meta;
  const lines=m[1].split(/\r?\n/); let key=null, buf=[];
  const flush=()=>{ if(key){ meta[key]=buf.join('\n').replace(/^\s+/gm,'').trim(); key=null; buf=[]; } };
  for(const line of lines){
    const mm=line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if(mm){ flush(); key=mm[1]; let v=mm[2]||''; if(v==='>'||v==='|'){ buf=[]; } else { buf=[v.replace(/^['"]|['"]$/g,'')]; } }
    else if(key) buf.push(line);
  }
  flush(); return meta;
}
function discoverSkills(){
  const out=[]; const walk=dir=>{ let entries=[]; try{ entries=fs.readdirSync(dir,{withFileTypes:true}); }catch{return;} for(const e of entries){ const p=path.join(dir,e.name); if(e.isDirectory()) walk(p); else if(e.isFile()&&e.name==='SKILL.md'){ try{ const txt=fs.readFileSync(p,'utf8'); const meta=parseSkillFrontmatter(txt); const rel=path.relative(SKILL_ROOT,p); const id=slug(meta.name||path.basename(path.dirname(p))); const group=rel.split(path.sep)[0]||'skills'; out.push({id,name:meta.name||id,description:clip(meta.description||txt.replace(/^---[\s\S]*?---/,'').replace(/[#*_`]/g,' '),420),path:p,group,enabled:true,configured:true}); }catch{} } } };
  walk(SKILL_ROOT); return out.sort((a,b)=>(a.group+a.name).localeCompare(b.group+b.name));
}
function ensureSkills(s){
  s.brain ||= {}; const found=discoverSkills(); const existing=new Map((s.brain.skills||[]).map(x=>[x.id,x]));
  s.brain.skills=found.map(x=>({...x,...(existing.get(x.id)||{}),path:x.path,description:(existing.get(x.id)?.description||x.description),configured:true}));
  for(const t of s.brain.threads||[]) { t.context ||= {businessIds:[]}; t.context.skillIds ||= t.context.skillIds||[]; }
  return s.brain.skills;
}

function defaultNonnegotiables(){ return [
  { id:'fajr', text:'Fajr / prayer discipline', cadence:'daily' },
  { id:'gym', text:'Workout / physical training', cadence:'daily' },
  { id:'deepwork', text:'One serious deep-work block', cadence:'daily' },
  { id:'shutdown', text:'End-of-day review + tomorrow plan', cadence:'daily' }
]; }
function defaultBusinesses(){ return [
  { id:'rema-exteriors', name:'Rema Exteriors', type:'B2C home services', lane:'Volume engine', status:'pilot-design', priority:'high', health:'amber', tags:['homeowners','email-first','sms-careful'], description:'Homeowner/home-services acquisition engine. Email-first, careful SMS follow-up, quote-booking pipeline.', links:[], metrics:{ leads:0, replies:0, booked:0 } },
  { id:'ragx', name:'RAGx', type:'Outreach infrastructure', lane:'Email/SMS ops', status:'active', priority:'high', health:'green', tags:['campaigns','inboxes','suppression'], description:'Main B2B outreach platform: inboxes, campaigns, suppression, replies, sending guardrails.', links:[], metrics:{ inboxes:0, activeCampaigns:0 } },
  { id:'ragmedium-b2b', name:'RAGmedium B2B', type:'Lead-gen/enrichment', lane:'Precision appointment setting', status:'design', priority:'high', health:'amber', tags:['enrichment','appointments','fresh-data'], description:'Fresh enrichment, decision-maker validation, lead scoring, appointment generation.', links:[], metrics:{ enriched:0, meetings:0 } },
  { id:'lamatrader', name:'LamaTrader', type:'Fintech/white-label trading', lane:'Sniper targeting', status:'targeting-map', priority:'medium', health:'amber', tags:['fintech','email-only','white-label'], description:'Professional enriched email only. Focus on operators/funds/quants/internal desks/brokerages.', links:[], metrics:{ targetAccounts:0 } },
  { id:'content-empire', name:'Content Empire', type:'Media/content', lane:'Distribution', status:'tracker-needed', priority:'medium', health:'gray', tags:['social','content','distribution'], description:'Social/media tracker, content calendar, post ideas, distribution metrics.', links:[], metrics:{ posts:0 } }
]; }
function defaultThreads(){ return [
  { id:'general', title:'General Brain', icon:'🧠', scope:'Personal + cross-topic thinking', sessionKey:'agent:main:dashboard-general', tags:['general'], context:{ businessIds:[] }, messages:[] },
  { id:'rema', title:'Rema Exteriors', icon:'🏠', scope:'Home-services acquisition, homeowner campaigns, SMS/email flow', sessionKey:'agent:main:dashboard-rema', tags:['rema','homeowners'], context:{ businessIds:['rema-exteriors'] }, messages:[] },
  { id:'ragx', title:'RAGx Ops', icon:'📨', scope:'Email/SMS infra, inboxes, campaign ops, suppression', sessionKey:'agent:main:dashboard-ragx', tags:['ragx','outreach'], context:{ businessIds:['ragx'] }, messages:[] },
  { id:'ragmedium', title:'RAGmedium B2B', icon:'🎯', scope:'Enrichment, appointment setting, B2B lead-gen system', sessionKey:'agent:main:dashboard-ragmedium', tags:['ragmedium','b2b'], context:{ businessIds:['ragmedium-b2b'] }, messages:[] },
  { id:'lamatrader', title:'LamaTrader', icon:'📈', scope:'Fintech ICP, professional email targeting, product strategy', sessionKey:'agent:main:dashboard-lamatrader', tags:['lama','fintech'], context:{ businessIds:['lamatrader'] }, messages:[] },
  { id:'crm', title:'CRM / Leads', icon:'🧲', scope:'Leads, clients, pipeline movement, follow-ups', sessionKey:'agent:main:dashboard-crm', tags:['crm','leads'], context:{ businessIds:[] }, messages:[] },
  { id:'content', title:'Content Empire', icon:'📣', scope:'Social media, content calendar, distribution tracker', sessionKey:'agent:main:dashboard-content', tags:['content','social'], context:{ businessIds:['content-empire'] }, messages:[] },
  { id:'discipline', title:'Discipline / Life', icon:'⚔️', scope:'Fitness, religion, reminders, personal accountability', sessionKey:'agent:main:dashboard-discipline', tags:['fitness','religion','reminders'], context:{ businessIds:[] }, messages:[] }
]; }
function defaultIntegrations(){ return [
  { id:'openclaw', name:'OpenClaw / Kaneki', category:'AI', status:'connected', mode:'live', url:'local gateway', note:'Chats are real OpenClaw sessions with selectable project context.' },
  { id:'ragmind', name:'RAGmind Mindmap', category:'Knowledge', status:'linked', mode:'read', url:'http://100.111.98.27:4444/', note:'Dashboard can pull readable strategy context.' },
  { id:'google-calendar', name:'Google Calendar', category:'Calendar', status:'connected', mode:'read-live/write-planned', url:'gog calendar', note:'Live pull through gog; creation/update can be routed through Kaneki with confirmation.' },
  { id:'ragx', name:'RAGx', category:'Outreach', status:'stubbed', mode:'planned-api', url:'', note:'Next: connect campaign/leads/replies API.' },
  { id:'social', name:'Social Media Tracker', category:'Content', status:'stubbed', mode:'planned-api', url:'', note:'Content calendar and social metrics can sync here.' },
  { id:'domain-apps', name:'Domain / old apps', category:'Apps', status:'inventory-needed', mode:'manual', url:'', note:'Add links and API notes as platforms are mapped.' }
]; }
function defaultContent(){ return {
  accounts:[
    {id:'linkedin-amir', platform:'LinkedIn', handle:'Amir / RAGmedium', businessId:'ragmedium-b2b', status:'planned', followers:0, impressions30d:0},
    {id:'rema-local', platform:'Local/Reels', handle:'Rema Exteriors', businessId:'rema-exteriors', status:'planned', followers:0, impressions30d:0},
    {id:'lama-linkedin', platform:'LinkedIn', handle:'LamaTrader', businessId:'lamatrader', status:'planned', followers:0, impressions30d:0}
  ],
  posts:[
    {id:'post_ragx_case', title:'Proof-before-pitch: outreach system lesson', platform:'LinkedIn', businessId:'ragx', type:'insight', status:'idea', scheduledAt:'', impressions:0, engagement:0},
    {id:'post_rema_offer', title:'Rema homeowner offer angle test', platform:'Instagram/TikTok', businessId:'rema-exteriors', type:'short-form', status:'idea', scheduledAt:'', impressions:0, engagement:0}
  ],
  personas:[
    {id:'founder-amir', name:'Founder Amir', angle:'builder / operator / honest lessons', tone:'sharp, reflective, useful', accounts:['linkedin-amir']},
    {id:'kaneki-edge', name:'Kaneki Edge', angle:'discipline, scars, execution, faith', tone:'direct, motivational, no fluff', accounts:['linkedin-amir']},
    {id:'rema-local', name:'Rema Local Operator', angle:'homeowner trust + exterior transformations', tone:'clear, local, proof-led', accounts:['rema-local']}
  ],
  platforms:[
    {id:'linkedin', name:'LinkedIn', formats:['text post','carousel','case study'], cadence:'3-5/wk', status:'planned'},
    {id:'x', name:'X', formats:['thread','short post'], cadence:'daily', status:'planned'},
    {id:'tiktok', name:'TikTok/Reels', formats:['short video','before-after'], cadence:'3/wk', status:'planned'},
    {id:'youtube', name:'YouTube', formats:['short','long-form'], cadence:'weekly', status:'planned'},
    {id:'newsletter', name:'Newsletter', formats:['essay','digest'], cadence:'weekly', status:'planned'}
  ],
  engine:{status:'designing', focus:'mass distribution with persona-safe repurposing', backlog:['Map account/persona matrix','Define platform-specific templates','Create weekly content engine review','Connect social metrics/export sources'], lastThought:'Use one source idea and repurpose by persona/platform instead of creating from scratch.'},
  personalPlan:{mission:'Build public proof around AI ops, discipline, and businesses without becoming noisy.', weeklyTheme:'Proof > pitch', notes:'Tie posts back to RAGmedium/RAGx/Lama/Rema when useful, but keep personal credibility first.'},
  pillars:['Founder story','Proof/results','Educational breakdowns','Offer/CTA','Behind-the-scenes ops'],
  metrics:{ impressions30d:0, posts30d:0, connectedAccounts:0 }
}; }
function defaultPipelines(){ return {
  leads:{ name:'Lead CRM', stages:['new','researching','contacted','replied','qualified','booked','won','lost'] },
  clients:{ name:'Client delivery', stages:['prospect','trial','onboarding','active','at-risk','paused','closed'] },
  tasks:{ name:'Execution board', stages:['backlog','today','doing','waiting','done'] }
}; }
function defaultState(){ return {
  todos:{}, journal:[], metrics:{ focusSessions:[], weight:[], nonnegotiables:{} }, chat:[],
  ops:{ inbox:[], briefs:{}, nonnegotiables:defaultNonnegotiables(), activity:[] },
  businesses:defaultBusinesses(), crm:{ leads:[], clients:[], pipelines:defaultPipelines(), tags:[] }, integrations:defaultIntegrations(),
  brain:{ activeThread:'general', threads:defaultThreads(), reminders:[], calendar:[], timetable:defaultTimetableConfig(), commands:[], sync:{ lastRefresh:null, sources:{} }, notes:[], content:defaultContent(), goals:[] },
  secrets:[], views:{ activeBusiness:'rema-exteriors' }, updatedAt:nowISO()
}; }
function normalizeState(s){
  const d=defaultState(); s=s&&typeof s==='object'?s:d;
  s.todos ||= {}; s.journal ||= []; s.metrics ||= d.metrics; s.metrics.focusSessions ||= []; s.metrics.weight ||= []; s.metrics.nonnegotiables ||= {};
  s.chat ||= []; s.ops ||= d.ops; s.ops.inbox ||= []; s.ops.briefs ||= {}; s.ops.nonnegotiables ||= defaultNonnegotiables(); s.ops.activity ||= [];
  s.businesses = Array.isArray(s.businesses)&&s.businesses.length ? s.businesses : defaultBusinesses();
  s.crm ||= {}; s.crm.leads ||= []; s.crm.clients ||= []; s.crm.pipelines ||= defaultPipelines(); s.crm.tags ||= [];
  s.integrations = Array.isArray(s.integrations)&&s.integrations.length ? s.integrations : defaultIntegrations();
  for(const def of defaultIntegrations()) if(!s.integrations.find(x=>x.id===def.id)) s.integrations.push(def);
  s.brain ||= {}; s.brain.activeThread ||= 'general'; s.brain.threads = Array.isArray(s.brain.threads)&&s.brain.threads.length ? s.brain.threads : defaultThreads();
  for(const def of defaultThreads()) if(!s.brain.threads.find(x=>x.id===def.id)) s.brain.threads.push(def);
  for(const t of s.brain.threads){ t.messages ||= []; t.tags ||= []; t.context ||= {businessIds:[]}; t.context.skillIds ||= t.context.skillIds||[]; t.sessionKey ||= sessionKeyForThread(t); }
  ensureSkills(s);
  s.brain.reminders ||= []; s.brain.calendar ||= []; s.brain.timetable ||= defaultTimetableConfig(); s.brain.commands ||= []; s.brain.notes ||= []; s.brain.content ||= defaultContent(); s.brain.content.accounts ||= []; s.brain.content.posts ||= []; s.brain.content.personas ||= defaultContent().personas; s.brain.content.platforms ||= defaultContent().platforms; s.brain.content.engine ||= defaultContent().engine; s.brain.content.personalPlan ||= defaultContent().personalPlan; s.brain.content.pillars ||= defaultContent().pillars; s.brain.content.metrics ||= defaultContent().metrics; s.brain.goals ||= []; s.brain.sync ||= { lastRefresh:null, sources:{} }; s.brain.sync.sources ||= {};
  s.secrets ||= [];
  s.payments ||= [];
  s.views ||= { activeBusiness:s.businesses[0]?.id };
  return s;
}
function backupState(s,label){
  const bakDir=path.join(path.dirname(DATA),'backups');
  fs.mkdirSync(bakDir,{recursive:true});
  const ts=new Date().toISOString().replace(/[:.]/g,'-');
  const bakPath=path.join(bakDir,`state-${ts}-${label||'auto'}.json`);
  try { fs.writeFileSync(bakPath, JSON.stringify(normalizeState(s),null,2)); }
  catch(e){ console.error('[backup] failed:',e.message); }
  // Keep only last 20 backups
  try {
    const files=fs.readdirSync(bakDir).filter(f=>f.startsWith('state-')).sort().reverse();
    for(let i=20;i<files.length;i++) fs.unlinkSync(path.join(bakDir,files[i]));
  } catch(e){}
}
// ─── State cache (invalidated on write) ───
let _stateCache = null;
let _stateCacheMtime = 0;
const STATE_CACHE_TTL = 2000; // ms — short TTL for freshness without disk thrash
function readState(){
  try {
    const mtime = fs.statSync(DATA).mtimeMs;
    if (_stateCache && mtime === _stateCacheMtime) return _stateCache;
    const parsed=JSON.parse(fs.readFileSync(DATA,'utf8'));
    const s = normalizeState(parsed);
    _stateCache = s;
    _stateCacheMtime = mtime;
    return s;
  } catch(e){
    console.error('[state] read error:',e.message);
    if (_stateCache) return _stateCache; // serve stale on error
    // Try restoring from latest backup before falling back to fresh default
    try {
      const bakDir=path.join(path.dirname(DATA),'backups');
      if(fs.existsSync(bakDir)){
        const files=fs.readdirSync(bakDir).filter(f=>f.startsWith('state-')).sort().reverse();
        if(files.length>0){
          const restored=JSON.parse(fs.readFileSync(path.join(bakDir,files[0]),'utf8'));
          console.log('[state] restored from backup:',files[0]);
          return normalizeState(restored);
        }
      }
    } catch(bakErr){ console.error('[state] backup restore failed:',bakErr.message); }
    const s=defaultState(); writeState(s); return s;
  }
}
function writeState(s){ s.updatedAt=nowISO(); const ns=normalizeState(s); fs.mkdirSync(path.dirname(DATA),{recursive:true}); fs.writeFileSync(DATA, JSON.stringify(ns,null,2)); _stateCache=ns; try { _stateCacheMtime=fs.statSync(DATA).mtimeMs; } catch(e){} backupState(s,'write'); }
function activity(s,type,text,meta={}){ s.ops.activity.unshift({ id:id('act'), type, text:clip(text,280), meta, at:nowISO() }); s.ops.activity=s.ops.activity.slice(0,400); }
function body(req){ return new Promise((res,rej)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>8e6){ req.destroy(); rej(new Error('too_large')); }}); req.on('end',()=>{ try{ res(b?JSON.parse(b):{}); }catch(e){ rej(e); }}); }); }
function send(res,code,data,type='application/json'){ const out=type==='application/json'?JSON.stringify(data):data; res.writeHead(code,{'content-type':`${type}; charset=utf-8`,'cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type'}); res.end(out); }
function upsertById(arr,input,prefix){ const item={...input}; item.id ||= slug(item.name||item.company||item.title||item.text)||id(prefix); const idx=arr.findIndex(x=>x.id===item.id); if(idx>=0) arr[idx]={...arr[idx],...item,updatedAt:nowISO()}; else arr.unshift({...item,createdAt:nowISO(),updatedAt:nowISO()}); return idx>=0?arr[idx]:arr[0]; }

function getMindmapContext(){
  try{ const raw=fs.readFileSync(MINDMAP,'utf8'); const out=[]; const patterns=[/title:"([^"]+)"[^\n]{0,160}/g,/n:"([^"]+)"[^\n]{0,100}/g,/>\s*([^<>]{18,150})\s*</g];
    for(const re of patterns){ let m; while((m=re.exec(raw))&&out.length<260){ const x=clip(m[1],170); if(x&&!out.includes(x)) out.push(x); } }
    return out.join('\n').slice(0,36000);
  }catch{ return ''; }
}
function extractProject(text){ const m=String(text||'').match(/^(Rema Exteriors|RAGx|RAGmedium|LamaTrader|LamaBroker|Grademy|Pripitch|HalalBooking|Unitas|Content Empire)\b/i); return m ? m[1].replace(/\b\w/g,c=>c.toUpperCase()).replace('Ragx','RAGx') : 'Execution'; }
function generateSuggestions(state,prompt=''){
  state=normalizeState(state); const p=String(prompt||'').toLowerCase(); const open=(state.todos[todayKey()]||[]).filter(t=>!t.done); const ideas=[]; const add=(text,project='Execution',priority='medium',minutes=45,source='brain')=>ideas.push({text,project,priority,minutes,source});
  for(const x of state.ops.inbox.slice(0,5)) add(`Turn ops note into concrete next action: ${clip(x.text,85)}`, x.project||extractProject(x.text), x.urgency==='high'?'high':'medium', 35, 'ops-inbox');
  for(const t of open.slice(0,4)) add(`Advance open task: ${clip(t.text,90)}`, t.project||'Execution', t.priority||'medium', t.minutes||45, 'todo-followup');
  const hay=[p,...open.map(x=>x.text),...state.ops.inbox.slice(0,8).map(x=>x.text)].join(' ').toLowerCase();
  if(/dashboard|brain|thread|chat/.test(hay)) add('Create topic-specific dashboard threads and decide which business data each thread sees','Mastermind OS','high',45);
  if(/crm|lead|pipeline/.test(hay)) add('Load first real lead table into CRM with business tags, stage, owner, next action','CRM','high',60);
  if(/calendar|remind|personal/.test(hay)) add('Centralize reminders/calendar: prayer, gym, calls, deadlines, follow-ups','Discipline','high',35);
  if(/sync|integration|app/.test(hay)) add('Map each external app: source, API/export path, refresh cadence, fields to ingest','Integrations','high',45);
  if(/rema|homeowner/.test(hay)) add('Define Rema pilot: niche, location, offer, daily cap, reply/SMS rules','Rema Exteriors','high',45);
  if(/ragx|inbox|campaign/.test(hay)) add('Set RAGx campaign health schema: inboxes, sends, bounces, replies, suppression','RAGx','high',50);
  if(/social|content/.test(hay)) add('Design social tracker: idea → scripted → recorded → edited → posted → repurposed','Content Empire','medium',45);
  const existing=new Set((state.todos[todayKey()]||[]).map(t=>String(t.text).toLowerCase())); const seen=new Set();
  return ideas.filter(x=>!existing.has(x.text.toLowerCase())&&!seen.has(x.text.toLowerCase())&&seen.add(x.text.toLowerCase())).slice(0,10);
}
function generateBrief(state,date=todayKey()){
  const open=(state.todos[date]||[]).filter(t=>!t.done); const sorted=[...open.filter(t=>t.priority==='high'),...open.filter(t=>t.priority!=='high')].slice(0,6); const existing=state.ops.briefs[date]||{};
  const lanes=[...new Set(open.map(t=>t.project).filter(Boolean))]; const biz=state.businesses.filter(b=>b.priority==='high').map(b=>`${b.name}: ${b.lane}`); const reminders=state.brain.reminders.filter(r=>!r.done).slice(0,3).map(r=>`Reminder: ${r.text}${r.dueAt?' @ '+r.dueAt:''}`);
  return { date, mission: existing.mission || (sorted[0]?.text ? `Win the day by finishing: ${sorted[0].text}` : 'Pick one sharp outcome and execute.'), priorities: existing.priorities || sorted.map(t=>({id:t.id,text:t.text,project:t.project||'Execution',minutes:t.minutes||30})), mind: existing.mind || [`Active threads: ${state.brain.threads.map(t=>t.title).slice(0,6).join(', ')}`, lanes.length?`Open task lanes: ${lanes.join(', ')}`:'No task lanes yet', ...biz.slice(0,4), ...reminders].filter(Boolean), avoid: existing.avoid || ['Do not merge every topic into one messy stream.', 'Do not plan instead of shipping.', 'Do not let shallow admin eat deep work.'], nonnegotiables: state.ops.nonnegotiables.map(n=>({...n,done:!!(state.metrics.nonnegotiables[date]||{})[n.id]})), source: existing.source || 'generated' };
}
function threadContext(state,thread){
  const bizIds=new Set(thread.context?.businessIds||[]); const businesses=bizIds.size?state.businesses.filter(b=>bizIds.has(b.id)):state.businesses;
  const leads=state.crm.leads.filter(l=>!bizIds.size || bizIds.has(l.businessId) || businesses.some(b=>l.business===b.name)).slice(0,40);
  const tasks=Object.values(state.todos).flat().filter(t=>!t.done && (!bizIds.size || businesses.some(b=>String(t.project||'').toLowerCase().includes(b.name.toLowerCase().split(' ')[0])))).slice(0,25);
  const reminders=state.brain.reminders.filter(r=>!r.done).slice(0,12);
  const skillIds=new Set(thread.context?.skillIds||[]); const skills=(state.brain.skills||[]).filter(sk=>skillIds.has(sk.id)).slice(0,8);
  const activeModes=thread.context?.modes||[];
  // Mode-specific behavioral prompts
  const modePrompts=[];
  if(activeModes.some(m=>m.includes('Goal'))) modePrompts.push('GOAL MODE: You are working towards a specific goal. Ask clarifying questions when uncertain. Break the goal into actionable sub-tasks. Track progress and push back if the user gets distracted. Do NOT just answer — actively steer toward the goal.');
  if(activeModes.some(m=>m.includes('Code'))) modePrompts.push('CODE MODE: Focus on technical accuracy, clean architecture, and production-ready code. Output complete, runnable code. Explain architectural choices briefly. Prioritize correctness over speed.');
  if(activeModes.some(m=>m.includes('Research'))) modePrompts.push('RESEARCH MODE: Conduct thorough analysis. Use web_search and external sources. Distinguish facts from opinions. Present findings with sources. Highlight uncertainties and alternative viewpoints.');
  const skillCtx=skills.map(sk=>{ let body=''; try{ body=fs.readFileSync(sk.path,'utf8').slice(0,3500); }catch{} return `SKILL ${sk.name} (${sk.path})\nDescription: ${sk.description}\nInstructions excerpt:\n${body}`; }).join('\n---\n')||'none';
  return [`Thread: ${thread.title} — ${thread.scope}`, `Active modes: ${activeModes.length?activeModes.join(', '):'none (default)'}`, `Mode instructions:\n${modePrompts.length?modePrompts.join('\n---\n'):'No special mode instructions (respond normally).'}`, `Relevant businesses: ${businesses.map(b=>`${b.name}(${b.status}/${b.health})`).join('; ')||'all'}`, `Selected skills: ${skillCtx}`, `Open tasks: ${tasks.map(t=>`${t.project||'Execution'}: ${t.text}`).join(' | ')||'none'}`, `Leads: ${leads.map(l=>`${l.company||l.name||'Lead'} [${l.stage||'new'}] ${l.nextAction||''}`).join(' | ')||'none'}`, `Reminders: ${reminders.map(r=>`${r.text}${r.dueAt?' @ '+r.dueAt:''}`).join(' | ')||'none'}`, `Recent ops: ${state.ops.inbox.slice(0,8).map(x=>x.text).join(' | ')||'none'}`].join('\n').slice(0,14000);
}
function gogEnv(){ const env={...process.env}; const gogPaths=['/home/linuxbrew/.linuxbrew/bin','/home/linuxbrew/.linuxbrew/sbin']; const pathParts=[]; for(const p of (env.PATH||'').split(':')) if(p&&!pathParts.includes(p)) pathParts.push(p); for(const p of gogPaths) if(!pathParts.includes(p)) pathParts.unshift(p); env.PATH=pathParts.join(':'); try{ const raw=fs.readFileSync('/home/admin/.openclaw/private/gog.env','utf8'); for(const line of raw.split(/\r?\n/)){ const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/); if(m){ let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); env[m[1]]=v; } } }catch{} return env; }
function execGog(args,timeoutMs=45000){ return new Promise((resolve,reject)=>execFile('gog',args,{timeout:timeoutMs,maxBuffer:8*1024*1024,env:gogEnv()},(err,stdout,stderr)=>err?reject(new Error((stderr||stdout||err.message).slice(0,1800))):resolve(stdout))); }
// ─── RAG MEMORY SEARCH ───
const RAG_SCRIPT = '/home/admin/.openclaw/workspace/rag-memory/rag.sh';
let lastRagCache = { query: '', results: '', at: 0 };
function searchRagMemory(queryStr){
  const maxAge = 120 * 1000;
  if(lastRagCache.query === queryStr && Date.now() - lastRagCache.at < maxAge && lastRagCache.results) {
    return Promise.resolve(lastRagCache.results);
  }
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    const child = execFile(RAG_SCRIPT, ['search', '--brief', '--top-k', '8', queryStr],
      { timeout: 12000, maxBuffer: 64 * 1024, env: { ...process.env, HF_TOKEN: '' } },
      (err, stdout, stderr) => {
        if (err) { resolve(''); return; }
        const out = (stdout || '').trim().split('\n').filter(l => l.startsWith('  \uD83D\uDCC1 ') || l.startsWith('  \uD83D\uDCCE ')).slice(0, 16).map(l => l.replace(/\s{2,}/g,' ').trim()).join('\n');
        if(out && out.length > 30) {
          lastRagCache = { query: queryStr, results: out, at: Date.now() };
          resolve(out);
        } else resolve('');
      });
  });
}

connectGateway(); // Connect gateway for web_search + agent routing

// ─── DASHBOARD AI BRIDGE (Gateway-based, full Kaneki via OpenClaw Gateway) ───
// Routes dashboard messages through the OpenClaw Gateway so the dashboard AI
// gets the same Kaneki capabilities as Telegram: tools, memory, web search,
// file ops, skills, and real-time transparency. No more hacked-together API calls.

// ─── Master context cache (cache-optimized prefix for DeepSeek) ───
let MASTER_CONTEXT_CACHE = null;
function getMasterContext(){
  if(MASTER_CONTEXT_CACHE) return MASTER_CONTEXT_CACHE;
  try {
    // Single stable 2.3KB cache prefix — identical across all requests
    // DeepSeek automatically caches repeated prefixes, saving ~$0.14/M tokens
    MASTER_CONTEXT_CACHE = fs.readFileSync('/home/admin/.openclaw/workspace/CACHE-PREFIX.md','utf8');
    return MASTER_CONTEXT_CACHE;
  }catch(e){ return 'Kaneki AI assistant for Amir. Use MASTER-MANIFEST.md for full context.'; }
}

async function sendToAssistant(state,thread,message,model){
  // Build dashboard thread context to inject into the agent's system prompt
  const threadCtx = threadContext(state, thread);
  
  // Inject MASTER CONTEXT so dashboard AI has same knowledge as Telegram
  const masterCtx = getMasterContext();
  
  // Inject recent conversation history so the model sees context even on fresh sessions
  const recentMessages = (thread.messages||[])
    .filter(m => m.role && m.text && !m.pending && m.role !== 'system')
    .slice(-20)
    .map(m => (m.role==='user' ? 'User' : 'Assistant') + ': ' + m.text.replace(/\n/g,' ').substring(0,4000))
    .join('\n\n');
  
  const extraPrompt = [
    masterCtx,
    '',
    '## Dashboard Thread Context',
    'Title: ' + (thread.title || 'Chat'),
    'Scope: ' + (thread.scope || 'General'),
    'Thread context data:',
    threadCtx,
    '',
    '## Recent Conversation History',
    recentMessages ? recentMessages : '(no previous messages)'
  ].join('\n');
  
  // Wait for gateway to be ready
  await waitForGateway();
  if (!gwReady) throw new Error('Gateway not connected — dashboard AI unavailable');
  
  const sessionKey = thread.sessionKey || 'agent:main:dashboard-' + (thread.id || 'general');
  
  // Route through the OpenClaw Gateway
  let lastError = null;
  for(let attempt=0;attempt<2;attempt++){
    try {
      const res = await gwRpc('agent', {
        message: message,
        sessionKey: attempt===0 ? sessionKey : sessionKey+'-retry-'+Date.now(),
        extraSystemPrompt: extraPrompt.slice(0, 32000),
        timeout: 600,
        idempotencyKey: crypto.randomUUID(),
        model: model || undefined
      }, { expectFinal: true });
      
      const reply = res?.result?.payloads?.[0]?.text
        || (res?.result?.text || (typeof res?.result === 'string' ? res.result : ''))
        || (res?.status === 'ok' ? '' : null);
      
      // If no reply and gateway says ok, still return empty (not an error)
      if(reply !== null) {
        return { reply, runId: res?.runId || 'dash-' + Date.now(), sessionKey };
      }
      
      // No reply and not ok — throw so retry logic can catch it
      const errDetail = JSON.stringify(res).slice(0,300);
      throw new Error('Gateway returned no reply: ' + (res?.error || errDetail || 'unknown'));
    } catch(e){
      lastError = e;
      const errMsg = String(e&&(e.message||e.error||e));
      if(errMsg.includes('EmbeddedAttemptSessionTakeoverError') && attempt===0){
        console.log('[gateway] Takeover detected, retrying with fresh session...');
        await new Promise(r=>setTimeout(r,1000));
        continue;
      }
      if((errMsg.match(/timeout|timed.?out|TimeoutError|no reply|unknown/i)) && attempt===0){
        console.log('[gateway] Transient error detected, retrying once:', errMsg.slice(0,120));
        await new Promise(r=>setTimeout(r,2000));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

// ─── Secrets Manager (AES-256-CBC encrypted at rest) ───
const SECRETS_KEY = crypto.createHash('sha256').update('dash-secrets-' + require('os').hostname()).digest().slice(0, 32);
const SECRETS_IV = crypto.createHash('md5').update('dash-iv-' + require('os').hostname()).digest().slice(0, 16);

function encryptSecret(v) {
  const c = crypto.createCipheriv('aes-256-cbc', SECRETS_KEY, SECRETS_IV);
  let out = c.update(String(v||''), 'utf8', 'hex');
  out += c.final('hex');
  return out;
}

function decryptSecret(v) {
  try {
    const c = crypto.createDecipheriv('aes-256-cbc', SECRETS_KEY, SECRETS_IV);
    let out = c.update(String(v||''), 'hex', 'utf8');
    out += c.final('utf8');
    return out;
  } catch(e) { return '[decrypt error]'; }
}

function contentMetrics(content){ const accounts=content.accounts||[], posts=content.posts||[]; return { connectedAccounts:accounts.filter(a=>a.status==='connected').length, totalAccounts:accounts.length, impressions30d:posts.reduce((a,p)=>a+(+p.impressions||0),0)+accounts.reduce((a,x)=>a+(+x.impressions30d||0),0), posts30d:posts.filter(p=>p.scheduledAt||p.status==='posted').length, scheduled:posts.filter(p=>p.status==='scheduled').length, ideas:posts.filter(p=>p.status==='idea').length }; }
function errorToFriendly(e){
  const msg = String(e&&(e.message||e.error||e)||'');
  if(msg.includes('timeout')||msg.includes('timed out')){
    return '⚠️ The request took too long and timed out. The AI has been asked to retry. If this keeps happening, try a shorter or simpler request.';
  }
  if(msg.includes('unknown gateway error')||msg.includes('no reply')||msg.includes('EmbeddedAttemptSessionTakeoverError')){
    return '⚠️ The AI encountered a temporary connection issue and has been asked to retry. Please wait a moment and try again.';
  }
  if(msg.includes('abort')||msg.includes('canceled')||msg.includes('cancel')){
    return '⚠️ The request was cancelled. This can happen when another task starts. Please try again.';
  }
  return '⚠️ Something went wrong. Please try again. (' + msg.slice(0,100) + ')';
}

function timeToMin(t){ if(!t)return 0; const d=new Date(t); return d.getHours()*60+d.getMinutes(); }
function minToTime(m){ const h=Math.floor(m/60),min=m%60; return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`; }
function defaultTimetableConfig(){ return { workStart:'08:00', workEnd:'18:00', bufferMinutes:10, maxBlockMinutes:90, breakAt:'12:30', breakMinutes:30, preferMornings:true }; }
function parseTime(s){ const parts=String(s||'').split(':'); return (parseInt(parts[0])||0)*60+(parseInt(parts[1])||0); }
function dateFromISO(s){ try{ const d=new Date(s); if(isNaN(d.getTime()))return null; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }catch{return null;} }
function scheduleDay(state,date){
  const cfg=state.brain.timetable||defaultTimetableConfig();
  const workStart=parseTime(cfg.workStart);
  const workEnd=parseTime(cfg.workEnd);
  const buffer=cfg.bufferMinutes||5;
  const maxBlock=cfg.maxBlockMinutes||90;
  const breakAt=parseTime(cfg.breakAt||'12:30');
  const breakMin=cfg.breakMinutes||0;

  // Collect calendar events for this date
  const dayEvents=(state.brain.calendar||[]).filter(e=>{
    const sd=dateFromISO(e.start), ed=dateFromISO(e.end);
    return sd===date||ed===date||(sd&&ed&&sd<=date&&ed>=date);
  });

  // Build busy blocks (in minutes from midnight)
  const busy=dayEvents.map(e=>({start:timeToMin(e.start),end:timeToMin(e.end),title:e.title,id:e.id,source:e.source})).filter(b=>b.end>b.start).sort((a,b)=>a.start-b.start);

  // Merge overlapping busy blocks
  const merged=[];
  for(const b of busy){
    if(merged.length&&b.start<=merged[merged.length-1].end+2){
      merged[merged.length-1].end=Math.max(merged[merged.length-1].end,b.end);
      merged[merged.length-1].title=merged[merged.length-1].title+', '+b.title;
    }else merged.push({...b});
  }

  // Build free blocks between busy periods, bounded by working hours
  let cursor=workStart;
  const freeBlocks=[];
  for(const b of merged){
    const meetStart=Math.max(b.start,workStart);
    const meetEnd=Math.min(b.end,workEnd);
    if(meetStart>cursor+buffer){
      let gapEnd=meetStart;
      // Insert lunch break if it falls in this gap
      if(breakMin>0&&cursor<breakAt&&breakAt+breakMin<gapEnd){
        freeBlocks.push({start:cursor,end:breakAt});
        cursor=breakAt+breakMin;
      }
      if(cursor+buffer<gapEnd) freeBlocks.push({start:cursor,end:gapEnd});
    }
    cursor=Math.max(cursor,Math.min(meetEnd,workEnd));
  }
  // Remaining time after last meeting
  if(cursor+buffer<workEnd){
    let gapEnd=workEnd;
    if(breakMin>0&&cursor<breakAt&&breakAt+breakMin<gapEnd){
      freeBlocks.push({start:cursor,end:breakAt});
      cursor=breakAt+breakMin;
    }
    if(cursor+buffer<gapEnd) freeBlocks.push({start:cursor,end:gapEnd});
  }

  // Collect undone tasks for this date
  const tasks=(state.todos[date]||[]).filter(t=>!t.done).map(t=>({...t,minutes:t.minutes||30}));
  // Also include tasks without a specific date (general backlog) on today's date
  if(date===todayKey()){
    for(const d of Object.keys(state.todos)){
      if(d===date)continue;
      const open=(state.todos[d]||[]).filter(t=>!t.done).map(t=>({...t,minutes:t.minutes||30}));
      tasks.push(...open);
    }
  }

  // Deduplicate by id
  const seen=new Set(); const uniqueTasks=[];
  for(const t of tasks){ if(!seen.has(t.id)){seen.add(t.id);uniqueTasks.push(t);} }

  // Priority weight: high=3, medium=2, low=1
  const prioWeight={high:3,medium:2,low:1};
  // Sort: priority desc, then minutes desc (FFD for bin-packing)
  uniqueTasks.sort((a,b)=>(prioWeight[b.priority]||2)-(prioWeight[a.priority]||2)||(b.minutes||30)-(a.minutes||30));

  // Schedule using first-fit
  const blocks=freeBlocks.map(b=>({start:b.start,end:b.end,duration:b.end-b.start}));
  const schedule=[];
  const overflow=[];

  for(const task of uniqueTasks){
    let placed=false;
    const dur=Math.min(task.minutes||30,maxBlock);
    for(let i=0;i<blocks.length;i++){
      const b=blocks[i];
      // Need room for task + buffer after (unless last task in block)
      const needed=dur+(b.duration-dur>buffer?buffer:0);
      if(b.duration>=needed){
        const slotStart=b.start;
        schedule.push({taskId:task.id,text:task.text,project:task.project||'Execution',priority:task.priority,minutes:dur,start:slotStart,end:slotStart+dur,startTime:minToTime(slotStart),endTime:minToTime(slotStart+dur)});
        // Shrink block from left
        b.start=slotStart+dur+(cfg.preferMornings?buffer:0);
        b.duration=Math.max(0,b.end-b.start);
        placed=true;
        break;
      }
    }
    if(!placed) overflow.push(task);
  }

  // Sort schedule by start time
  schedule.sort((a,b)=>a.start-b.start);

  return {
    date,
    config:cfg,
    meetings:merged.filter(b=>b.end>workStart&&b.start<workEnd).map(b=>({...b,startTime:minToTime(Math.max(b.start,workStart)),endTime:minToTime(Math.min(b.end,workEnd))})),
    freeBlocks:blocks.filter(b=>b.duration>buffer),
    scheduled:schedule,
    overflow:overflow.map(t=>({id:t.id,text:t.text,project:t.project||'Execution',priority:t.priority,minutes:t.minutes||30})),
    stats:{totalTasks:uniqueTasks.length,scheduled:schedule.length,overflow:overflow.length,totalMinutes:schedule.reduce((a,s)=>a+s.minutes,0),freeMinutes:blocks.reduce((a,b)=>a+Math.max(0,b.duration-buffer),0)}
  };
}
async function syncGoogleCalendar(s, opts={}){
  const from=opts.from || new Date(Date.now()-7*864e5).toISOString();
  const to=opts.to || new Date(Date.now()+60*864e5).toISOString();
  const account=opts.account || process.env.GOG_ACCOUNT || 'amirg@ragmedium.com';
  const raw=await execGog(['calendar','events','primary','--from',from,'--to',to,'--account',account,'--json','--no-input'],60000);
  const parsed=JSON.parse(raw); const items=Array.isArray(parsed)?parsed:(parsed.events||parsed.items||[]);
  const mapped=items.map(e=>({ id:`gcal_${e.id||slug(e.summary||e.title||e.start)}`, source:'google', providerId:e.id, title:e.summary||e.title||'(No title)', start:e.start?.dateTime||e.start?.date||e.start||'', end:e.end?.dateTime||e.end?.date||e.end||'', location:e.location||'', description:e.description||'', attendees:e.attendees||[], type:'event', tags:['google-calendar'] }));
  const local=s.brain.calendar.filter(e=>e.source!=='google'); s.brain.calendar=[...mapped,...local].sort((a,b)=>String(a.start||'').localeCompare(String(b.start||''))).slice(0,1000);
  s.brain.sync.sources['google-calendar']={status:'ok',lastSync:nowISO(),summary:`Pulled ${mapped.length} Google Calendar events (${from.slice(0,10)} → ${to.slice(0,10)}).`};
  return mapped;
}
async function refreshSync(s,source='all'){
  const ts=nowISO(); const sources=s.brain.sync.sources; const touch=(id,status='ok',summary='')=>sources[id]={status,lastSync:ts,summary};
  if(source==='all'||source==='ragmind') touch('ragmind','ok',`${getMindmapContext().split('\n').filter(Boolean).length} context snippets indexed from local RAGmind.`);
  if(source==='all'||source==='dashboard') touch('dashboard','ok',`${s.businesses.length} projects, ${s.crm.leads.length} leads, ${Object.values(s.todos).flat().length} tasks, ${s.brain.threads.length} conversations.`);
  if(source==='all'||source==='calendar'||source==='google-calendar') { try{ await syncGoogleCalendar(s,{}); }catch(e){ touch('google-calendar','error',`Google Calendar sync failed: ${e.message}`); } }
  if(source==='all'||source==='ragx') touch('ragx','stubbed','RAGx source registered; API/export connection not configured yet.');
  if(source==='all'||source==='social') { s.brain.content.metrics=contentMetrics(s.brain.content); touch('social','stubbed',`${s.brain.content.metrics.totalAccounts} accounts tracked, ${s.brain.content.metrics.impressions30d} local impressions. Social APIs next.`); }
  s.brain.sync.lastRefresh=ts; activity(s,'sync',`Refreshed ${source} sources`,{source}); return s.brain.sync;
}


function runAssistantBackground(tid, snapshot, thread, text, model){
  // Poll session file for traces and write them into state for the pending message
  const sk = thread.sessionKey || 'agent:main:dashboard-' + (tid||'general').slice(-12);
  let tracePoller = null;
  let attempts = 0;
  
  function pollTraces(){
    try {
      if(!fs.existsSync(SESSIONS_DB)) return;
      const db=JSON.parse(fs.readFileSync(SESSIONS_DB,'utf8'));
      const entry=db[sk];
      if(!entry||!entry.sessionFile||!fs.existsSync(entry.sessionFile)){ 
        if(++attempts<30) return; // keep waiting for session file
        return;
      }
      const raw=fs.readFileSync(entry.sessionFile,'utf8').trim();
      if(!raw) return;
      const lines=raw.split('\n');
      const traces=[];
      for(let i=Math.max(0,lines.length-20);i<lines.length;i++){
        try{
          const p=JSON.parse(lines[i]);
          if(p.type==='message'&&p.message&&p.message.role==='assistant'){
            const content=p.message.content||[];
            for(const c of content){
              if(c.type==='thinking') traces.push({type:'thought',text:(c.thinking||'').substring(0,8000),ts:p.timestamp});
              if(c.type==='toolCall') traces.push({type:'tool',name:c.name,args:JSON.stringify(c.arguments||'').substring(0,1000),ts:p.timestamp});
            }
          }
        }catch(e){}
      }
      if(traces.length>0){
        const s3=readState();
        const t3=(s3.brain?.threads||[]).find(x=>x.id===tid);
        if(t3){
          const pm=(t3.messages||[]).findLast(function(m){return m.role==='assistant'&&m.pending;});
          if(pm){
            // Only write state if traces actually changed (prevents redundant writes)
            const oldTraces=JSON.stringify(pm.traces||[]);
            const newTraces=JSON.stringify(traces);
            if(oldTraces!==newTraces){ pm.traces=traces; writeState(s3); }
          }
        }
      }
    }catch(e){}
  }
  
  // Start polling quickly — first check after 300ms, then every 800ms
  setTimeout(function(){ pollTraces(); tracePoller=setInterval(pollTraces,2000); }, 1000);
  
  // Auto-timeout: if no reply in 600 seconds (10 min), mark as failed
  // Skip for goal mode — goal tasks keep running until completion
  const timeoutMs = (snapshot.brain?.threads?.find(t=>t.id===tid)?.context?.modes||[]).some(m=>m.includes('Goal')) ? 99999999 : 600000;
  const autoFailTimer = setTimeout(function(){
    try {
      const sf=readState(); const stf=sf.brain.threads.find(x=>x.id===tid); if(!stf) return;
      const pfIdx=(stf.messages||[]).findLastIndex(m=>m.role==='assistant'&&m.pending);
      if(pfIdx>=0){
        stf.messages[pfIdx].pending=false;
        stf.messages[pfIdx].text='Warning: Task timed out. Please try again or rephrase.';
        stf.messages[pfIdx].isError=true;
        stf.messages[pfIdx].traces=(stf.messages[pfIdx].traces||[]).concat([{type:'thought',text:'Task auto-failed after '+(timeoutMs/1000)+'s timeout.',ts:Date.now()}]);
        writeState(sf);
        console.log('[bg] auto-timeout for',tid);
      }
    } catch(e2){ console.error('[bg] timeout error:',e2.message); }
  }, timeoutMs);
  autoFailTimer._tid = tid;

  
  sendToAssistant(snapshot, thread, text, model).then(out=>{
    clearInterval(tracePoller);
    if(autoFailTimer)clearTimeout(autoFailTimer);
    try {
      const s2=readState(); const t2=s2.brain.threads.find(x=>x.id===tid); if(!t2) return;
      const pIdx = (t2.messages||[]).findLastIndex(m=>m.role==='assistant'&&m.pending);
      let savedTraces = null;
      if(pIdx>=0){ savedTraces = t2.messages[pIdx].traces || null; t2.messages.splice(pIdx,1); }
      const ai={id:id('msg'),role:'assistant',text:out.reply,at:nowISO(),surface:'openclaw',threadId:tid,runId:out.runId};
      if(savedTraces) ai.traces = savedTraces;
      t2.messages.push(ai); activity(s2,'thread-reply',`${thread.title}: ${clip(out.reply,110)}`,{threadId:tid,runId:out.runId}); writeState(s2);
      // Push notification to all subscribers
      const replySnippet = clip((out.reply||'').replace(/<[^>]*>/g,'').replace(/\*\*/g,'').replace(/\n/g,' ').trim(), 150);
      sendPushToAll(s2, '✅ ' + (thread.title||'Chat'), replySnippet, 'chat-done-'+tid, { url: '/', threadId: tid });
      console.log('[bg] reply written for',tid);
    } catch(e2) { console.error('[bg] write error:',e2.message); }
  }).catch(e=>{
    clearInterval(tracePoller);
    if(autoFailTimer)clearTimeout(autoFailTimer);
    try {
      const s2=readState(); const t2=s2.brain.threads.find(x=>x.id===tid); if(!t2) return;
      const pIdx = (t2.messages||[]).findLastIndex(m=>m.role==='assistant'&&m.pending);
      if(pIdx>=0) t2.messages.splice(pIdx,1);
      const friendlyMsg = errorToFriendly(e);
      t2.messages.push({id:id('msg'),role:'assistant',text:friendlyMsg,at:nowISO(),threadId:tid,isError:true});
      writeState(s2);
      sendPushToAll(s2, '❌ ' + (thread.title||'Chat') + ' failed', clip((e.message||'').replace(/<[^>]*>/g,''),150), 'chat-error-'+tid, { url: '/' });
      console.error('[bg] error:',e.message);
    } catch(e2) { console.error('[bg] fatal:',e2.message); }
  });
}

async function route(req,res){
  if(req.method==='OPTIONS') return send(res,200,{ok:true}); const u=new URL(req.url,'http://x');
  if(u.pathname==='/manifest.webmanifest') return send(res,200,fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8'),'application/manifest+json');
  if(u.pathname==='/sw.js') return send(res,200,fs.readFileSync(path.join(ROOT,'sw.js'),'utf8'),'application/javascript');
  if(u.pathname.startsWith('/icons/')){ const file=path.join(ROOT,u.pathname.replace(/^\/+/,'')); if(file.startsWith(path.join(ROOT,'icons'))&&fs.existsSync(file)){ const ext=path.extname(file); return send(res,200,fs.readFileSync(file),ext==='.svg'?'image/svg+xml':'image/png'); } }
  if(u.pathname.startsWith('/audio/')){ const file=path.join(ROOT,u.pathname.replace(/^\/+/,'')); if(file.startsWith(path.join(ROOT,'audio'))&&fs.existsSync(file)){ const ext=path.extname(file).toLowerCase(); const mtypes={'mp3':'audio/mpeg','wav':'audio/wav','ogg':'audio/ogg','webm':'audio/webm'}; return send(res,200,fs.readFileSync(file),mtypes[ext]||'audio/mpeg'); } }
  if(u.pathname.startsWith('/media/')){
    const mediaDir='/home/admin/.openclaw/media/inbound';
    const fname=u.pathname.replace('/media/','').split('/')[0];
    const filePath=path.join(mediaDir,fname);
    if(fs.existsSync(filePath)){
      const ext=path.extname(filePath).toLowerCase();
      const mtypes={'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','gif':'image/gif','webp':'image/webp'};
      return send(res,200,fs.readFileSync(filePath),mtypes[ext]||'application/octet-stream');
    }
    return send(res,404,'Not found');
  }
  // ─── Desktop VNC viewer ───
  // Whiteboard
  if(u.pathname==='/whiteboard'||u.pathname==='/whiteboard/'){
    return send(res,200,fs.readFileSync(path.join(ROOT,'whiteboard.html'),'utf8'),'text/html');
  }

  if(u.pathname==='/org'){ res.setHeader('Cache-Control','no-cache,no-store,must-revalidate'); try{ return send(res,200,fs.readFileSync(path.join(ROOT,'org.html'),'utf8'),'text/html'); }catch(e){ return send(res,404,'Not found'); } }

  // Serve slack.html
  if(u.pathname==='/slack.html'||u.pathname==='/slack'||u.pathname==='/slack/'){
    try{ return send(res,200,fs.readFileSync(path.join(ROOT,'slack.html'),'utf8'),'text/html'); }catch(e){ return send(res,404,'Not found'); }
  }

  if(u.pathname==='/galaxy-3d'||u.pathname==='/galaxy-3d/'||u.pathname==='/galaxy-3d.html'){
    res.setHeader('Cache-Control','no-cache,no-store,must-revalidate');
    return send(res,200,fs.readFileSync(path.join(ROOT,'galaxy-3d.html'),'utf8'),'text/html');
  }
  if(u.pathname==='/test-galaxy'){
    return send(res,200,fs.readFileSync(path.join(ROOT,'test-galaxy.html'),'utf8'),'text/html');
  }
  if(u.pathname==='/test-min'){
    return send(res,200,fs.readFileSync(path.join(ROOT,'test-min.html'),'utf8'),'text/html');
  }
  if(u.pathname==='/test-v2'){
    return send(res,200,fs.readFileSync(path.join(ROOT,'test-v2.html'),'utf8'),'text/html');
  }

  // Serve three.js libraries locally
  if(u.pathname.startsWith('/three-lib/')){
    const file=path.join(ROOT,u.pathname.replace(/^\/+/,''));
    if(fs.existsSync(file)&&!fs.statSync(file).isDirectory()){
      const ext=path.extname(file).toLowerCase();
      const mimes={'.js':'application/javascript','.wasm':'application/wasm'};
      return send(res,200,fs.readFileSync(file),mimes[ext]||'application/octet-stream');
    }
  }

  if(u.pathname==='/desktop/'||u.pathname==='/desktop'){
    const vncPage = path.join(ROOT, 'desktop.html');
    if(fs.existsSync(vncPage)) return send(res,200,fs.readFileSync(vncPage,'utf8'),'text/html');
  }

  // ─── CRM proxy (ai.ragmedium.com → localhost:6969) ───
  if(u.pathname.startsWith('/crm/')||u.pathname==='/crm'){
    const crmPath = u.pathname === '/crm' ? '/' : u.pathname.replace(/^\/crm/, '');
    try {
      const http = require('http');
      const proxyReq = http.request({
        hostname: '127.0.0.1', port: 6969,
        path: crmPath + (u.search || ''),
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:6969', 'accept-encoding': 'identity' }
      }, (proxyRes) => {
        const outHeaders = {...proxyRes.headers};
        delete outHeaders['content-encoding'];
        delete outHeaders['transfer-encoding'];
        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => {});
      req.pipe(proxyReq);
      return;
    } catch(e) {}
  }

  // ─── Jarvis proxy (port 1707 → /jarvis-proxy/) ───
  if(u.pathname.startsWith('/jarvis-proxy')||u.pathname==='/jarvis-proxy'){
    const jarvisPath = u.pathname === '/jarvis-proxy' ? '/' : u.pathname.replace(/^\/jarvis-proxy/, '');
    try {
      const http = require('http');
      const proxyReq = http.request({
        hostname: '127.0.0.1', port: 1707,
        path: jarvisPath || '/',
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:1707', 'accept-encoding': 'identity' }
      }, (proxyRes) => {
        const outHeaders = {...proxyRes.headers};
        delete outHeaders['content-encoding'];
        delete outHeaders['transfer-encoding'];
        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => { res.writeHead(502); res.end('Jarvis proxy error'); });
      req.pipe(proxyReq);
      return;
    } catch(e) {}
  }

  // ─── RAGX embed proxy (strips sidebar/header, pipes RSC/API through) ───
  if(u.pathname==='/ragx-embed'||u.pathname.startsWith('/ragx-embed/')){
    const targetPath = (u.pathname.replace('/ragx-embed','') || '/ragx') + (u.search||'');
    const isRSC = u.searchParams.get('_rsc');
    // For RSC data requests and POST/PUT, just pipe through unmodified
    if(isRSC || req.method==='POST' || req.method==='PUT' || req.method==='PATCH'){
      try {
        const https = require('https');
        const proxyReq = https.request({
          hostname: 'ai.ragmedium.com', path: targetPath, method: req.method,
          headers: { ...req.headers, host: 'ai.ragmedium.com' }
        }, (proxyRes) => {
          const outHeaders = {...proxyRes.headers};
          delete outHeaders['content-encoding']; delete outHeaders['transfer-encoding'];
          res.writeHead(proxyRes.statusCode, outHeaders);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', () => { if(!res.headersSent) send(res,502,{error:'proxy_failed'}); });
        req.pipe(proxyReq);
        return;
      } catch(e) {}
    }
    // HTML GET: fetch, rewrite asset urls, inject sidebar-hiding CSS
    try {
      const https = require('https');
      const html = await new Promise((resolve, reject) => {
        https.get(`https://ai.ragmedium.com${targetPath}`, { headers: { 'accept-encoding': 'identity' } }, (proxyRes) => {
          const ct = proxyRes.headers['content-type'] || '';
          // If not HTML, just stream through
          if(!ct.includes('text/html')){
            const oh = {...proxyRes.headers}; delete oh['content-encoding']; delete oh['transfer-encoding'];
            res.writeHead(proxyRes.statusCode, oh);
            proxyRes.pipe(res);
            resolve(null); return;
          }
          let data = '';
          proxyRes.on('data', chunk => data += chunk);
          proxyRes.on('end', () => resolve(data));
          proxyRes.on('error', reject);
        }).on('error', reject);
      });
      if(html===null) return; // already streamed non-HTML response
      // Rewrite ALL asset URLs to go through dashboard proxy (including JS payloads)
      let fixed = html.replace(/\/_next\//g, '/proxy-next/');
      fixed = fixed.replace(/"\/favicon\.ico/g, '"/proxy-next/favicon.ico');
      fixed = fixed.replace(/"\/logo1\.png/g, '"/proxy-next/logo1.png');
      // CSS to hide sidebar/header/mobile chrome
      const css = `<style>aside[class*="h-screen"]{display:none!important}div[class*="min-h-screen"][class*="lg:pl-"]{padding-left:0!important}header[class*="sticky"]{display:none!important}div[class*="fixed bottom-0"]{display:none!important}button[class*="fixed bottom-6"]{display:none!important}div[style*="bottom:24px"]{display:none!important}</style>`;
      const injected = fixed.replace('</head>', css + '</head>');
      return send(res, 200, injected, 'text/html; charset=utf-8');
    } catch(e) {
      return send(res, 502, { error: 'ragx_proxy_failed', detail: e.message });
    }
  }

  
  // === SSE endpoint: brain dashboard real-time updates ===
  if(u.pathname==='/api/brain-sse'&&req.method==='GET'){
    res.writeHead(200,{
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache',
      'Connection':'keep-alive',
      'Access-Control-Allow-Origin':'*'
    });
    res.write('event: connected\ndata: {}\n\n');
    
    let lastState = null;
    const sendState = () => {
      try {
        const s = JSON.stringify(readState());
        if(s !== lastState){
          res.write('event: state\ndata: ' + JSON.stringify({state: JSON.parse(s)}) + '\n\n');
          lastState = s;
        }
        res.write('event: heartbeat\ndata: {}\n\n');
      } catch(e){}
    };
    
    // Send initial state
    sendState();
    
    // Poll state every 2s
    const poller = setInterval(sendState, 2000);
    
    req.on('close', () => {
      clearInterval(poller);
    });
    
    return;
  }

// ─── Next.js asset proxy (ai.ragmedium.com/_next/* → dashboard/proxy-next/*) ───
  if(u.pathname.startsWith('/proxy-next/')){
    let inner = u.pathname.replace('/proxy-next/', '') + (u.search||'');
    // favicon/logo1 are root files, everything else is under /_next/
    const targetPath = (inner.startsWith('favicon')||inner.startsWith('logo1')) ? '/' + inner : '/_next/' + inner;
    try {
      const https = require('https');
      const proxyReq = https.request({
        hostname: 'ai.ragmedium.com',
        path: targetPath,
        method: req.method,
        headers: { ...req.headers, host: 'ai.ragmedium.com' }
      }, (proxyRes) => {
        const outHeaders = {...proxyRes.headers};
        delete outHeaders['content-encoding'];
        delete outHeaders['transfer-encoding'];
        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => { if(!res.headersSent) send(res,502,{error:'proxy_failed'}); });
      if(req.method==='POST'||req.method==='PUT'||req.method==='PATCH') req.pipe(proxyReq);
      else proxyReq.end();
      return;
    } catch(e) {}
  }

  // ─── noVNC assets for desktop viewer ───
  if(u.pathname.startsWith('/novnc-dist/')||u.pathname.startsWith('/novnc-vendor/')||u.pathname.startsWith('/novnc-app/')||u.pathname.startsWith('/novnc-core/')||u.pathname.startsWith('/novnc-lib/')||u.pathname==='/novnc-init.js'){
    const filePath = path.join(ROOT, u.pathname);
    if(fs.existsSync(filePath)){
      const ext = path.extname(filePath);
      const mime = ext==='.js'?'application/javascript':ext==='.css'?'text/css':'application/octet-stream';
      return send(res,200,fs.readFileSync(filePath),mime);
    }
  }

  // ─── Agent Team Command Center proxy (port 1707) ───
  // ─── Kanban proxy: forward /api/tasks and /agents/api/tasks to port 1707 ───
  // Must be BEFORE the generic /agents proxy (line ~1021) to avoid path mismatch
  const isTasksPath = u.pathname==='/api/tasks' || u.pathname==='/agents/api/tasks' || u.pathname.startsWith('/api/tasks/');
  if(isTasksPath){
    const target = u.pathname.replace(/^\/agents/, '') + (u.search||'');
    const proxyReq = http.request({
      hostname: '127.0.0.1', port: 1707, path: target,
      method: req.method, headers: { ...req.headers, host: '127.0.0.1:1707' }
    }, (proxyRes) => {
      const outHeaders = {...proxyRes.headers};
      res.writeHead(proxyRes.statusCode, outHeaders);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => { if(!res.headersSent) send(res,502,{error:'kanban_unreachable'}); });
    if(req.method==='POST'||req.method==='PUT'||req.method==='PATCH') req.pipe(proxyReq);
    else proxyReq.end();
    return;
  }
  if(u.pathname.startsWith('/agents')){
    const target = u.pathname + (u.search||'');
    const proxyReq = http.request({
      hostname: '127.0.0.1', port: 1707, path: target,
      method: req.method, headers: { ...req.headers, host: '127.0.0.1:1707' }
    }, (proxyRes) => {
      const outHeaders = {...proxyRes.headers};
      res.writeHead(proxyRes.statusCode, outHeaders);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => { if(!res.headersSent) send(res,502,{error:'agent_team_unreachable'}); });
    if(req.method==='POST'||req.method==='PUT'||req.method==='PATCH') req.pipe(proxyReq);
    else proxyReq.end();
    return;
  }

  if(u.pathname==='/ragmind'||(u.pathname==='/'&&(req.headers.host||'').includes('4444'))){ res.writeHead(302,{Location:'/galaxy-3d'}); res.end(); return; }
  if(u.pathname==='/galaxy-3d'){ res.setHeader('Cache-Control','no-cache,no-store,must-revalidate'); return send(res,200,fs.readFileSync(path.join(ROOT,'galaxy-3d.html'),'utf8'),'text/html'); }
  if(u.pathname==='/slack'){ res.setHeader('Cache-Control','no-cache,no-store,must-revalidate'); const slackHtml=fs.readFileSync(path.join(ROOT,'slack.html'),'utf8'); return send(res,200,slackHtml,'text/html'); }
  if(u.pathname==='/api/agents/status'){
    try{
      const raw=fs.readFileSync(path.join(ROOT,'data','agent-log.json'),'utf8');
      const log=JSON.parse(raw);
      let cronJobs=[];
      try{
        if(gwReady&&gwWs){
          const id=String(++gwSeq);
          gwWs.send(JSON.stringify({type:'req',id,method:'cron',params:{action:'list',includeDisabled:true}}));
          const cronRes=await new Promise((resolve)=>{
            const t=setTimeout(()=>resolve(null),5000);
            gwPending[id]={resolve:(r)=>{clearTimeout(t);resolve(r);},reject:()=>{clearTimeout(t);resolve(null);}};
          });
          if(cronRes?.payload?.jobs) cronJobs=cronRes.payload.jobs.map(j=>({name:j.name,lastStatus:j.state?.lastStatus,enabled:j.enabled,nextRunAtMs:j.state?.nextRunAtMs}));
        }
      }catch(e){}
      // PWA push for new agent outputs
      try{
        const s=readState();
        if(s.pushSubscriptions?.length){
          const prevOutputs=globalThis._lastAgentPushState||{};
          for(const [agentId,outputs] of Object.entries(log.outputs||{})){
            const prev=prevOutputs[agentId]||0;
            if(outputs.length>prev){
              const latest=outputs[outputs.length-1];
              const agentName=agentId.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
              sendPushToAll(s,`🤖 ${agentName} Report`,(latest.text||'').substring(0,120),`agent-${agentId}`,{url:'/slack',agentId});
            }
          }
          globalThis._lastAgentPushState={};for(const[k,v]of Object.entries(log.outputs||{}))globalThis._lastAgentPushState[k]=v.length;
        }
      }catch(e){}
      return send(res,200,{ok:true,...log,_cronJobs:cronJobs});
    }catch(e){ return send(res,200,{ok:true,outputs:{},status:{}}); }
  }
  // ─── MarkItDown file converter proxy (must be before SPA fallback) ───
  if(u.pathname==='/convert/api/convert'&&req.method==='POST'){
    const b=await body(req);
    if(!b.file&&!b.url) return send(res,400,{error:'file or url required'});
    const tmpDir = '/tmp/convert-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const PYTHON = process.env.MARKITDOWN_PYTHON || '/home/admin/.hermes/hermes-agent/venv/bin/python3';
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      let inputFile;
      if(b.url) {
        inputFile = tmpDir + '/downloaded';
        const https = require('https');
        const http = require('http');
        const mod = b.url.startsWith('https') ? https : http;
        await new Promise((resolve, reject) => {
          mod.get(b.url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return mod.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
                const file = fs.createWriteStream(inputFile);
                res2.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
              }).on('error', reject);
            }
            const file = fs.createWriteStream(inputFile);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', reject);
        });
      } else {
        const buf = Buffer.from(b.buffer, b.encoding||'base64');
        inputFile = tmpDir + '/' + (b.filename || 'document');
        fs.writeFileSync(inputFile, buf);
      }
      const { execFile } = require('child_process');
      const result = await new Promise((resolve, reject) => {
        execFile(PYTHON, ['-m', 'markitdown', inputFile], { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve({ text_content: stdout, title: b.filename || b.url || 'document', metadata: {} });
        });
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return send(res,200,{ok:true,text_content:result.text_content||'',title:result.title||'',metadata:result.metadata||{}});
    } catch(e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e2){}
      return send(res,500,{error:'conversion_failed',detail:e.message});
    }
  }
  if(u.pathname==='/'||u.pathname==='/index.html'||(!u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/agents/api/'))){ res.setHeader('Cache-Control','no-cache,no-store,must-revalidate'); return send(res,200,fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),'text/html'); }
  if(u.pathname==='/api/state'&&req.method==='GET') return send(res,200,readState());
  if(u.pathname==='/api/state'&&(req.method==='POST'||req.method==='PUT')){ const b=await body(req); writeState(b); return send(res,200,{ok:true,state:normalizeState(b)}); }
  if(u.pathname==='/api/brain'&&req.method==='GET'){ const s=readState(); s.brain.content.metrics=contentMetrics(s.brain.content); return send(res,200,{ok:true,brain:s.brain,businesses:s.businesses,projects:s.businesses,crm:s.crm,integrations:s.integrations,brief:generateBrief(s)}); }
  if(u.pathname==='/api/health'&&req.method==='GET'){ return send(res,200,{ok:true,status:'running',uptime:process.uptime(),port:PORT,memory:process.memoryUsage()}); }
  if(u.pathname==='/api/businesses'&&req.method==='GET'){ const s=readState(); return send(res,200,{ok:true,businesses:s.businesses}); }
  if(u.pathname==='/api/upload'&&req.method==='POST'){
    const b = await body(req);
    const dataUrl = String(b.data||'');
    const folder = b.folder === 'docs' ? 'docs' : 'inbound';
    const mediaDir = '/home/admin/.openclaw/media/inbound';
    const docsDir = '/home/admin/.openclaw/media/docs';
    const targetDir = folder === 'docs' ? docsDir : mediaDir;
    if(!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, {recursive:true});
    // Parse base64 data URL: data:mime;base64,content
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if(!m) return send(res,400,{error:'invalid_data_url'});
    const mime = m[1];
    const buf = Buffer.from(m[2], 'base64');
    // Determine extension from mime
    const extMap = {'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','application/pdf':'pdf','text/plain':'txt','application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/zip':'zip','application/x-rar':'rar'};
    const ext = extMap[mime] || mime.split('/')[1] || 'bin';
    const safeName = (b.filename||'file').replace(/[^a-zA-Z0-9._-]/g,'_').replace(/\.[^.]+$/,'') + '.' + ext;
    const fname = Date.now().toString(36) + '_' + safeName;
    const filePath = path.join(targetDir, fname);
    fs.writeFileSync(filePath, buf);
    const s = readState();
    activity(s, 'upload', `Uploaded: ${safeName} (${(buf.length/1024).toFixed(1)}KB)`, {folder, file:fname});
    writeState(s);
    return send(res, 200, {ok:true, file:fname, url:'/media/'+fname, size:buf.length, mime});
  }
  if(u.pathname==='/api/vault'&&req.method==='GET'){ const idx=path.join(ROOT,'..','obsidian','rag-index','search-index.json'); if(fs.existsSync(idx)) return send(res,200,JSON.parse(fs.readFileSync(idx,'utf8'))); return send(res,200,{error:'vault_index_not_found',files:[]}); }
  // === SSE endpoint: real-time session trace streaming ===
  if(u.pathname==='/api/trace-stream'&&req.method==='GET'){
    const threadId=u.searchParams.get('threadId')||'general';
    
    // Wait for thread to exist (may not be in state yet when SSE connects)
    let s=readState();
    let thread=(s.brain.threads||[]).find(x=>x.id===threadId);
    if(!thread){
      // Poll state up to 10s for thread to appear
      for(let i=0;i<20;i++){
        await new Promise(r=>setTimeout(r,500));
        s=readState();
        thread=(s.brain.threads||[]).find(x=>x.id===threadId);
        if(thread) break;
      }
    }
    if(!thread){ 
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Access-Control-Allow-Origin':'*'});
      res.write('event: error\ndata: {"error":"thread_not_found"}\n\n');
      res.write('event: done\ndata: {"status":"timeout"}\n\n');
      return res.end();
    }
    const sk=thread.sessionKey||('agent:main:dashboard-'+threadId.slice(-12));
    
    // Set SSE headers
    res.writeHead(200,{
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache',
      'Connection':'keep-alive',
      'Access-Control-Allow-Origin':'*'
    });
    res.write('event: connected\ndata: {}\n\n');
    
    let watchFile = null;
    if(fs.existsSync(SESSIONS_DB)){
      try{
        const db=JSON.parse(fs.readFileSync(SESSIONS_DB,'utf8'));
        const entry=db[sk];
        if(entry&&entry.sessionFile&&fs.existsSync(entry.sessionFile)){
          watchFile = entry.sessionFile;
        }
      }catch(e){}
    }
    
    // Poll file changes (simpler than fs.watch which has cross-platform issues)
    let lastSize = 0;
    let retries = 0;
    if(watchFile) try{ lastSize = fs.statSync(watchFile).size; }catch(e){}
    let fileCheckCount = 0;
    const watcher = setInterval(() => {
      // Periodically re-check sessions DB for updated session file
      fileCheckCount++;
      if(fileCheckCount % 4 === 0 || !watchFile || !fs.existsSync(watchFile)){
        try{
          if(fs.existsSync(SESSIONS_DB)){
            const db=JSON.parse(fs.readFileSync(SESSIONS_DB,'utf8'));
            const entry=db[sk];
            if(entry && entry.sessionFile && fs.existsSync(entry.sessionFile)){
              if(entry.sessionFile !== watchFile){
                // Session file changed — switch to new one
                watchFile = entry.sessionFile;
                lastSize = fs.statSync(watchFile).size;
                console.log('[trace] Switched to new session file:', watchFile.slice(-40));
              }
            }
          }
        }catch(er){}
      }
      // If no file yet, retry looking it up (session may not have started)
      if(!watchFile || !fs.existsSync(watchFile)){
        retries++;
        if(retries > 60){ res.write('event: done\ndata: {"status":"timeout"}\n\n'); clearInterval(watcher); return; }
        try{
          if(fs.existsSync(SESSIONS_DB)){
            const db=JSON.parse(fs.readFileSync(SESSIONS_DB,'utf8'));
            const entry=db[sk];
            if(entry&&entry.sessionFile&&fs.existsSync(entry.sessionFile)){
              watchFile = entry.sessionFile;
              lastSize = fs.statSync(watchFile).size;
              retries = 0;
            }
          }
        }catch(er){}
        return; // keep waiting
      }
      try{
        const nowSize = fs.statSync(watchFile).size;
        if(nowSize === lastSize) return; // no change
        lastSize = nowSize;
        const raw = fs.readFileSync(watchFile,'utf8').trim();
        if(!raw) return;
        const lines = raw.split(String.fromCharCode(10));
        const traces = [];
        for(let i=Math.max(0,lines.length-30);i<lines.length;i++){
          try{
            const p=JSON.parse(lines[i]);
            if(p.type==='message'&&p.message&&p.message.role==='assistant'){
              const content=p.message.content||[];
              for(const c of content){
                if(c.type==='thinking') traces.push({type:'thought',text:(c.thinking||'').substring(0,8000),ts:p.timestamp});
                if(c.type==='toolCall') traces.push({type:'tool',name:c.name,args:JSON.stringify(c.arguments||'').substring(0,1000),ts:p.timestamp});
              }
            }
          }catch(e){}
        }
        if(traces.length){
          const json = JSON.stringify({status:'streaming',traces:traces.slice(-5)});
          res.write('event: trace\ndata: '+json+'\n\n');
        }
      }catch(e){}
    }, 800); // check every 800ms
    
        // Track whether the session was already done when we started
    let wasDoneAtStart = false;
    try{
      if(fs.existsSync(SESSIONS_DB)){
        const db=JSON.parse(fs.readFileSync(SESSIONS_DB,'utf8'));
        const entry=db[sk];
        if(entry && entry.status === 'done') wasDoneAtStart = true;
      }
    }catch(e){}
    let lastKnownStatus = wasDoneAtStart ? 'done' : null;
    
    // Check session status
    const statusCheck = setInterval(() => {
      if(!watchFile || !fs.existsSync(SESSIONS_DB)) return;
      try{
        const db=JSON.parse(fs.readFileSync(SESSIONS_DB,'utf8'));
        const entry=db[sk];
        const currentStatus = entry ? entry.status : null;
        
        // Only send done if status CHANGED to done while watching
        if(currentStatus === 'done' && lastKnownStatus !== 'done'){
          // Send remaining traces before closing
          if(watchFile && fs.existsSync(watchFile)){
            try{
              const raw = fs.readFileSync(watchFile,'utf8').trim();
              if(raw){
                const lines = raw.split(String.fromCharCode(10));
                const finalTraces = [];
                for(let i=Math.max(0,lines.length-30);i<lines.length;i++){
                  try{
                    const p=JSON.parse(lines[i]);
                    if(p.type==='message'&&p.message&&p.message.role==='assistant'){
                      const content=p.message.content||[];
                      for(const c of content){
                        if(c.type==='thinking') finalTraces.push({type:'thought',text:(c.thinking||'').substring(0,8000),ts:p.timestamp});
                        if(c.type==='toolCall') finalTraces.push({type:'tool',name:c.name,args:JSON.stringify(c.arguments||'').substring(0,1000),ts:p.timestamp});
                      }
                    }
                  }catch(e){}
                }
                if(finalTraces.length){
                  res.write('event: trace\ndata: '+JSON.stringify({status:'streaming',traces:finalTraces.slice(-5)})+'\n\n');


                }
              }
            }catch(er){}
          }
          res.write('event: done\ndata: {"status":"done","durationMs":'+(entry.runtimeMs||0)+'}\n\n');
          clearInterval(watcher);
          clearInterval(statusCheck);
          res.end();
        }
        lastKnownStatus = currentStatus;
      }catch(e){}
    }, 1500);
    // Cleanup on client disconnect
    req.on('close',()=>{ clearInterval(watcher); clearInterval(statusCheck); });
    return;
  }
  if(u.pathname==='/api/session-trace'&&req.method==='GET'){
    const s=readState();
    const threadId=u.searchParams.get('threadId')||'general';
    const thread=(s.brain.threads||[]).find(x=>x.id===threadId);
    if(!thread){l('no thread found for',threadId);return send(res,200,{ok:false,error:'thread_not_found'});}
    const sk=thread.sessionKey||('agent:main:dashboard-'+threadId.slice(-12));
    if(!fs.existsSync(SESSIONS_DB))return send(res,200,{ok:false,error:'no_sessions_db'});
    try{
      const db=JSON.parse(fs.readFileSync(SESSIONS_DB,'utf8'));
      const entry=db[sk];
      if(!entry||!entry.sessionFile||!fs.existsSync(entry.sessionFile))return send(res,200,{ok:false,error:'no_session_file',sk,threadId});
      const raw=fs.readFileSync(entry.sessionFile,'utf8').trim();
      if(!raw)return send(res,200,{ok:false,error:'empty_session'});
      const lines=raw.split(String.fromCharCode(10));
      const traces=[];
      for(let i=0;i<lines.length;i++){
        try{
          const p=JSON.parse(lines[i]);
          if(p.type==='message'&&p.message&&p.message.role==='assistant'){
            const content=p.message.content||[];
            for(const c of content){
              if(c.type==='thinking')traces.push({type:'thought',text:(c.thinking||'').substring(0,8000),ts:p.timestamp});
              if(c.type==='toolCall')traces.push({type:'tool',name:c.name,args:JSON.stringify(c.arguments||'').substring(0,1000),ts:p.timestamp});
            }
          }
        }catch(e){}
      }
      return send(res,200,{ok:true,status:entry.status||'unknown',traces:traces.slice(-15),pending:entry.status!=='done',durationMs:entry.runtimeMs||0});
    }catch(e){return send(res,200,{ok:false,error:String(e.message||e)});}
  }
  // ─── Vault Knowledge Graph API ───
  if(u.pathname==='/api/vault/graph'&&req.method==='GET'){
    const s=readState();
    const nodes=[];
    const edges=[];
    const nodeMap=new Map();
    function addNode(id,label,type,meta){
      if(nodeMap.has(id)){ Object.assign(nodeMap.get(id),meta); return nodeMap.get(id); }
      const n={id,label,type,meta:meta||{}};
      nodes.push(n); nodeMap.set(id,n);
      return n;
    }
    function addEdge(from,to,label,weight){
      if(from===to)return;
      edges.push({source:from,target:to,label:label||'',weight:weight||1});
    }
    // 1. Threads (chat history)
    const threads=(s.brain?.threads||[]).filter(t=>t.title&&t.title!=='General Brain');
    for(const t of threads){
      const msgCount=(t.messages||[]).length;
      const bizIds=t.context?.businessIds||[];
      const lastMsg=t.messages?.filter(m=>m.role!=='system').slice(-1)[0];
      addNode('thread:'+t.id,t.title,'chat',{
        messages:msgCount,
        lastPreview:lastMsg?.text?.slice(0,200)||'',
        lastTime:lastMsg?.at||'',
        businessIds:bizIds,
        tags:t.tags||[],
        updatedAt:t.updatedAt||t.createdAt||''
      });
      // Edge: thread ↔ associated businesses
      for(const bid of bizIds){
        addEdge('thread:'+t.id,'biz:'+bid,'context',1);
      }
    }
    // 2. Businesses
    const businesses=s.businesses||[];
    for(const b of businesses){
      addNode('biz:'+b.id,b.name,'business',{
        status:b.status||'',
        stage:b.stage||'',
        description:b.description||b.lane||'',
        tags:b.tags||[],
        color:b.color||''
      });
    }
    // 3. Obsidian vault files (documents)
    try{
      const idxPath=path.join(ROOT,'..','obsidian','rag-index','search-index.json');
      if(fs.existsSync(idxPath)){
        const idx=JSON.parse(fs.readFileSync(idxPath,'utf8'));
        for(const f of (idx.files||[])){
          const rawKw=[...(f.fullKeywords||[]),...(f.keywords||[])];
          const kw=rawKw.map(k=>typeof k==='object'&&k.word?k.word:String(k));
          addNode('doc:'+f.title,f.title,'document',{
            path:f.path,
            sections:(f.sections||[]).length,
            size:f.size||0,
            keywords:kw,
            preview:(f.sections||[]).slice(0,2).map(s=>s.content?.slice(0,100)).filter(Boolean).join(' | ')||''
          });
          // Edge: connect documents to businesses by keyword overlap
          for(const b of businesses){
            const bkw=(b.tags||[]).concat(b.name?.toLowerCase().split(/[\s-]+/)||[]);
            const match=kw.filter(k=>bkw.some(w=>String(k).toLowerCase().includes(w.toLowerCase())));
            if(match.length>0) addEdge('doc:'+f.title,'biz:'+b.id,'related',match.length);
          }
        }
      }
    }catch(e){}
    // 3b. lamatrader-ingest documents
    try{
      const ingIdxPath=path.join(ROOT,'data','ingest-index.json');
      if(fs.existsSync(ingIdxPath)){
        const ing=JSON.parse(fs.readFileSync(ingIdxPath,'utf8'));
        for(const f of (ing.files||[])){
          const kw=f.keywords||[];
          addNode('ingest:'+f.title,f.title,'document',{
            path:path.join('lamatrader-ingest',f.path),
            sections:f.sections?.length||0,
            size:f.size||0,
            keywords:kw,
            preview:f.preview||''
          });
          for(const b of businesses){
            const bkw=(b.tags||[]).concat(b.name?.toLowerCase().split(/[\s-]+/)||[]);
            const match=kw.filter(k=>bkw.some(w=>String(k).toLowerCase().includes(w.toLowerCase())));
            if(match.length>0) addEdge('ingest:'+f.title,'biz:'+b.id,'ingest',match.length);
          }
        }
      }
    }catch(e){}
    // 4. Content accounts
    const accounts=s.brain?.content?.accounts||[];
    for(const a of accounts){
      addNode('acct:'+a.id,a.label||a.handle||a.id,'account',{
        platform:a.platform||'',
        handle:a.handle||'',
        status:a.status||'',
        followers:a.followers||0
      });
      // Connect accounts to relevant businesses by name overlap
      for(const b of businesses){
        const bName=b.name?.toLowerCase()||'';
        const aName=(a.label||a.handle||'').toLowerCase();
        if(aName.includes(bName.split(' ')[0])||bName.includes(aName.split('-')[0])){
          addEdge('acct:'+a.id,'biz:'+b.id,'account',1);
        }
      }
    }
    // 5. Content posts
    const posts=s.brain?.content?.posts||[];
    for(const p of posts){
      addNode('post:'+p.id,p.title||'Untitled post','post',{
        status:p.status||'',
        type:p.type||'',
        platform:p.platform||'',
        impressions:p.impressions||0,
        engagement:p.engagement||0,
        scheduledAt:p.scheduledAt||''
      });
      // Connect posts to accounts
      if(p.accountId) addEdge('post:'+p.id,'acct:'+p.accountId,'published',1);
    }
    // 6. Content personas
    const personas=s.brain?.content?.personas||[];
    for(const p of personas){
      addNode('persona:'+p.id,p.name,'persona',{
        voice:p.voice||'',
        audience:p.audience||'',
        accounts:p.accounts||[]
      });
    }
    // 7. Due todos (grouped as task nodes per-project)
    const today=nowISO().split('T')[0];
    const allTodos=Object.entries(s.todos||{}).flatMap(([d,ts])=>ts.map(t=>({...t,date:d})));
    const highTodos=allTodos.filter(t=>!t.done);
    for(const t of highTodos.slice(0,30)){
      addNode('todo:'+t.id,t.text.substring(0,60),'task',{
        done:t.done,
        priority:t.priority||'medium',
        project:t.project||'',
        businessId:t.businessId||'',
        date:t.date||today,
        minutes:t.minutes||30
      });
      if(t.businessId) addEdge('todo:'+t.id,'biz:'+t.businessId,'task',1);
      if(t.project){
        const pb=businesses.find(b=>b.name===t.project);
        if(pb) addEdge('todo:'+t.id,'biz:'+pb.id,'task',1);
      }
    }
    // 8. Smart edges: connect threads to documents by keyword overlap
    for(const t of threads){
      const tWords=new Set();
      (t.messages||[]).forEach(m=>{
        if(m.text) (m.text.match(/\b\w{4,}\b/g)||[]).forEach(w=>tWords.add(w.toLowerCase()));
      });
      if(tWords.size<3) continue;
      // Connect to relevant documents
      for(const n of nodes){
        if(n.type!=='document') continue;
        const kw=n.meta.keywords||[];
        const match=kw.filter(k=>tWords.has(String(k).toLowerCase()));
        if(match.length>2) addEdge('thread:'+t.id,n.id,`keywords:${match.slice(0,3).join(',')}`,match.length);
      }
    }
    return send(res,200,{ok:true,graph:{nodes,edges},stats:{nodeCount:nodes.length,edgeCount:edges.length}});
  }
  // RAG semantic search within vault
  // RAG semantic search (simple keyword fallback)
  if(u.pathname==='/api/vault/rag-search'&&req.method==='POST'){
    const b=await body(req);
    const query=String(b.query||'').trim().toLowerCase();
    if(!query) return send(res,400,{error:'query_required'});
    // Search across all graph nodes by label + keywords
    const s=readState();
    const hits=[];
    // Search threads
    for(const t of (s.brain?.threads||[])){
      if(t.title?.toLowerCase().includes(query)){
        const last=t.messages?.filter(m=>m.role!=='system').slice(-1)[0];
        hits.push({type:'chat',label:t.title,preview:last?.text?.slice(0,200)||'',id:'thread:'+t.id,score:10});
      }
    }
    // Search businesses
    for(const b of (s.businesses||[])){
      if(b.name?.toLowerCase().includes(query)) hits.push({type:'business',label:b.name,preview:b.description||b.lane||'',id:'biz:'+b.id,score:9});
    }
    // Search obsidian docs
    try{
      const idx=JSON.parse(fs.readFileSync(path.join(ROOT,'..','obsidian','rag-index','search-index.json'),'utf8'));
      for(const f of (idx.files||[])){
        const preview=(f.sections||[]).slice(0,2).map(s=>s.content?.slice(0,100)).filter(Boolean).join(' | ');
        if(f.title?.toLowerCase().includes(query)) hits.push({type:'document',label:f.title,preview,id:'doc:'+f.title,score:8});
        else if(preview.toLowerCase().includes(query)) hits.push({type:'document',label:f.title,preview,id:'doc:'+f.title,score:5});
      }
    }catch(e){}
    // Search content
    for(const p of (s.brain?.content?.posts||[])){
      if(p.title?.toLowerCase().includes(query)) hits.push({type:'post',label:p.title,preview:p.status||'',id:'post:'+p.id,score:7});
    }
    for(const a of (s.brain?.content?.accounts||[])){
      if((a.label||a.handle||'').toLowerCase().includes(query)) hits.push({type:'account',label:a.label||a.handle,preview:a.platform||'',id:'acct:'+a.id,score:6});
    }
    hits.sort((a,b)=>b.score-a.score);
    return send(res,200,{ok:true,query,results:hits.slice(0,20)});
  }
  if(u.pathname==='/api/gallery'&&req.method==='GET'){
    const mediaDir='/home/admin/.openclaw/media/inbound';
    const imgs=[];
    try{
      const files=fs.readdirSync(mediaDir);
      for(const f of files){
        const ext=f.split('.').pop().toLowerCase();
        if(!['jpg','jpeg','png','gif','webp','mp4','webm','mov','mkv'].includes(ext)) continue;
        const stat=fs.statSync(path.join(mediaDir,f));
        const mime=ext==='mp4'?'video/mp4':ext==='webm'?'video/webm':ext==='mov'?'video/quicktime':ext==='mkv'?'video/x-matroska':'image/'+(ext==='jpg'?'jpeg':ext);
        imgs.push({id:f.split('.')[0],file:f,ext,size:stat.size,date:stat.mtimeMs,mime,type:mime.startsWith('video/')?'video':'image'});
      }
      imgs.sort((a,b)=>b.date-a.date);
    }catch(e){}
    return send(res,200,{ok:true,images:imgs});
  }
  if(u.pathname==='/api/skills'&&req.method==='GET'){ const s=readState(); ensureSkills(s); writeState(s); return send(res,200,{ok:true,skills:s.brain.skills}); }
  if(u.pathname==='/api/skills/configure'&&req.method==='POST'){ const s=readState(); const skills=ensureSkills(s); activity(s,'skills',`Configured ${skills.length} dashboard skills from skill archive`,{root:SKILL_ROOT,count:skills.length}); writeState(s); return send(res,200,{ok:true,skills,state:s}); }
  if(u.pathname==='/api/conversations'&&req.method==='GET'){ const s=readState(); return send(res,200,{ok:true,conversations:s.brain.threads}); }
  if(u.pathname==='/api/threads'&&req.method==='GET'){ const s=readState(); return send(res,200,{ok:true,threads:s.brain.threads}); }
  if(u.pathname==='/api/threads/cleanup'&&req.method==='POST'){ const s=readState(); const before=s.brain.threads.length; s.brain.threads=s.brain.threads.filter(t=>(t.messages||[]).length>0||t.id==='general'||t.id==='rema'||t.id==='ragx'||t.id==='ragmedium'||t.id==='lamatrader'||t.id==='crm'||t.id==='content'||t.id==='discipline'); const after=s.brain.threads.length; writeState(s); return send(res,200,{ok:true,removed:before-after,remaining:after}); }
  if(u.pathname==='/api/threads'&&req.method==='POST'){ const s=readState(), b=await body(req); const title=b.title||'New chat'; const t=upsertById(s.brain.threads,{icon:'💬',tags:[],context:{businessIds:b.businessIds||b.context?.businessIds||[]},messages:[],scope:'Focused conversation',...b,id:b.id||`chat-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,title,sessionKey:b.sessionKey||`agent:main:dashboard-chat-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`},'thread'); s.brain.activeThread=t.id; activity(s,'conversation',`New/updated chat: ${t.title}`,{id:t.id,context:t.context}); writeState(s); return send(res,200,{ok:true,thread:t,state:s}); }
  const startProject=u.pathname.match(/^\/api\/projects\/([^/]+)\/start-chat$/); if(startProject&&req.method==='POST'){ const s=readState(), b=await body(req); const p=s.businesses.find(x=>x.id===startProject[1]); if(!p) return send(res,404,{error:'project_not_found'}); const t={ id:`chat-${p.id}-${Date.now().toString(36)}`, title:b.title||`${p.name} — new chat`, icon:b.icon||'💬', scope:`Project chat for ${p.name}: ${p.description||p.lane||''}`, tags:[...(p.tags||[]),'project-chat'], context:{businessIds:[p.id]}, sessionKey:`agent:main:dashboard-${p.id}-${Date.now().toString(36)}`, messages:[] }; s.brain.threads.unshift(t); s.brain.activeThread=t.id; activity(s,'conversation',`Started project chat: ${t.title}`,{projectId:p.id,threadId:t.id}); writeState(s); return send(res,200,{ok:true,thread:t,state:s}); }
  const projectDash=u.pathname.match(/^\/api\/projects\/([^/]+)\/dashboard$/); if(projectDash&&req.method==='GET'){ const s=readState(), p=s.businesses.find(x=>x.id===projectDash[1]); if(!p) return send(res,404,{error:'project_not_found'}); const allTodos=Object.values(s.todos).flat(); const projTodos=allTodos.filter(t=>!t.done&&(t.businessId===p.id||t.project===p.name||t.project===p.id)); const projChats=(s.brain.threads||[]).filter(t=>(t.messages||[]).length>0&&((t.context?.businessIds||[]).includes(p.id)||(t.title||'').toLowerCase().includes(p.name.toLowerCase().split(' ')[0])||(t.tags||[]).some(tg=>(p.tags||[]).includes(tg)))).map(t=>({id:t.id,title:t.title,lastMessage:(t.messages||[]).filter(m=>m.role!=='system').slice(-1)[0]?.text?.slice(0,120)||'',messageCount:t.messages.length,updatedAt:t.updatedAt})).slice(0,10); const leads=(s.crm?.leads||[]).filter(l=>l.businessId===p.id||l.projectId===p.id||projects().find(b=>b.id===p.id)?.name&&l.business===p.name); const stats={totalTodos:allTodos.filter(t=>t.businessId===p.id||t.project===p.name).length,openTodos:projTodos.length,highTodos:projTodos.filter(t=>t.priority==='high').length,totalChats:projChats.length,totalLeads:leads.length,leadsByStage:{},doneTodos:allTodos.filter(t=>t.done&&(t.businessId===p.id||t.project===p.name)).length}; for(const l of leads){ stats.leadsByStage[l.stage||'new']=(stats.leadsByStage[l.stage||'new']||0)+1; } const ops=(s.ops?.activity||[]).filter(a=>String(a.text).toLowerCase().includes(p.name.toLowerCase())).slice(0,15); return send(res,200,{ok:true,project:p,todos:projTodos.slice(0,20),chats:projChats,leads,stats,ops}); }
  const threadDel=u.pathname.match(/^\/api\/threads\/([^/]+)$/); if(threadDel&&req.method==='DELETE'){ const s=readState(), tid=threadDel[1]; const idx=s.brain.threads.findIndex(x=>x.id===tid); if(idx<0) return send(res,404,{error:'thread_not_found'}); const removed=s.brain.threads.splice(idx,1)[0]; activity(s,'thread-delete','Deleted: '+(removed.title||tid),{threadId:tid}); if(s.brain.activeThread===tid) s.brain.activeThread=(s.brain.threads[0]||{id:'general'}).id; writeState(s); return send(res,200,{ok:true,state:s}); }
  const threadPin=u.pathname.match(/^\/api\/threads\/([^/]+)\/pin$/); if(threadPin&&req.method==='POST'){ const s=readState(), tid=threadPin[1]; const t=s.brain.threads.find(x=>x.id===tid); if(!t) return send(res,404,{error:'thread_not_found'}); t.tags=t.tags||[]; const idx=t.tags.indexOf('pinned'); if(idx>=0) t.tags.splice(idx,1); else t.tags.push('pinned'); writeState(s); return send(res,200,{ok:true,pinned:idx<0,thread:t}); }
  const threadMsg=u.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/); if(threadMsg&&req.method==='POST'){ const s=readState(), b=await body(req), tid=threadMsg[1]; let t=s.brain.threads.find(x=>x.id===tid); if(!t){ s.brain.threads||=[]; t={id:tid,title:'Chat',icon:'💬',tags:[],context:{businessIds:[]},messages:[],scope:'Dashboard chat',sessionKey:`agent:main:dashboard-${tid.slice(-12)}`}; s.brain.threads.unshift(t); } const text=String(b.message||'').trim(); if(!text) return send(res,400,{error:'message_required'}); if(genericTitle(t.title)) t.title=smartThreadTitle(text,t,s); const user={id:id('msg'),role:'user',text,at:nowISO(),surface:'dashboard',threadId:tid}; t.messages.push(user); s.brain.activeThread=tid; activity(s,'thread-message',`${t.title}: ${clip(text,100)}`,{threadId:tid}); if(b.localOnly) { writeState(s); return send(res,200,{ok:true,thread:t,state:s}); } const pending={id:id('msg'),role:'assistant',text:'Thinking…',pending:true,replyTo:user.id,at:nowISO(),surface:'openclaw',threadId:tid}; t.messages.push(pending); writeState(s); const snap=JSON.parse(JSON.stringify(s)); snap.__pendingMessageId=user.id; const model=b.model||''; if(b.async!==false){ runAssistantBackground(tid,snap,JSON.parse(JSON.stringify(t)),text,model); return send(res,202,{ok:true,queued:true,thread:t,state:s}); } try{ const out=await sendToAssistant(s,t,text,model); const s2=readState(); const t2=s2.brain.threads.find(x=>x.id===tid); t2.messages=(t2.messages||[]).filter(m=>!(m.role==='assistant'&&m.pending&&m.replyTo===user.id)); const ai={id:id('msg'),role:'assistant',text:out.reply,at:nowISO(),surface:'openclaw',threadId:tid,runId:out.runId}; t2.messages.push(ai); activity(s2,'thread-reply',`${t.title}: ${clip(out.reply,110)}`,{threadId:tid,runId:out.runId}); writeState(s2); return send(res,200,{ok:true,reply:out.reply,runId:out.runId,sessionKey:out.sessionKey,thread:t2,state:s2}); }catch(e){ const s2=readState(); const t2=s2.brain.threads.find(x=>x.id===tid); t2.messages=(t2.messages||[]).filter(m=>!(m.role==='assistant'&&m.pending&&m.replyTo===user.id)); t2.messages.push({id:id('msg'),role:'assistant',text:'❌ **Bridge Error:** '+e.message,at:nowISO(),threadId:tid,isError:true}); writeState(s2); return send(res,502,{ok:false,error:'assistant_bridge_failed',detail:e.message,state:s2}); } }
  if(u.pathname==='/api/chat'&&req.method==='POST'){
    const b=await body(req);
    const tid=b.threadId||'general';
    req.url='/api/threads/'+tid+'/messages'+(u.search||'');
    return route(req,res);
  }
  if(u.pathname==='/api/assistant/chat'&&req.method==='POST'){ req.url='/api/threads/general/messages'; return route(req,res); }
  if(u.pathname==='/api/approvals'&&req.method==='GET'){
    try{
      const dir='/home/admin/.openclaw/workspace/approval-queue/pending';
      const fs=require('fs');
      if(!fs.existsSync(dir)) return send(res,200,{ok:true,items:[]});
      const allFiles=fs.readdirSync(dir);
      const items=allFiles.map(f=>{
        try{
          const full=dir+'/'+f;
          if(f.endsWith('.json')){return JSON.parse(fs.readFileSync(full,'utf8'))}
          if(f.endsWith('.md')){
            const raw=fs.readFileSync(full,'utf8');
            const titleMatch=raw.match(/^#\s+(.+)/m);
            return {id:f.replace(/\.md$/,''),title:titleMatch?titleMatch[1]:f,description:raw.substring(0,500),status:'pending',file:f,type:'md'}
          }
          return null
        }catch{return null}
      }).filter(Boolean);
      return send(res,200,{ok:true,items});
    }catch(e){return send(res,500,{error:String(e.message)})}
  }
  const approveMatch=u.pathname.match(/^\/api\/approvals\/([^/]+)\/approve$/);
  if(approveMatch&&req.method==='POST'){
    try{
      const dir='/home/admin/.openclaw/workspace/approval-queue';
      const approvalId=approveMatch[1];
      const pendingJson=dir+'/pending/'+approvalId+'.json';
      const pendingMd=dir+'/pending/'+approvalId+'.md';
      const pending=pendingJson;
      const isMd=!fs.existsSync(pendingJson)&&fs.existsSync(pendingMd);
      const srcFile=isMd?pendingMd:pending;
      if(!fs.existsSync(srcFile)) return send(res,404,{error:'not_found'});
      const raw=fs.readFileSync(srcFile,'utf8');
      const data=isMd?{id:approvalId,title:approvalId.replace(/-/g,' '),description:raw.substring(0,500),type:'md'}:JSON.parse(raw);
      data.status='approved';
      data.approvedAt=new Date().toISOString();
      const ext=isMd?'.md':'.json';
      fs.writeFileSync(dir+'/approved/'+approvalId+ext,isMd?raw:JSON.stringify(data,null,2));
      fs.unlinkSync(srcFile);
      // Notify the agent via dashboard thread
      const text='APPROVED: '+data.title+' (by Amir)';
      const threadId=(data.agent||'unknown')+'-dm';
      const cmdId = globalThis.id ? globalThis.id('cmd') : 'cmd_'+Date.now().toString(36);
      const cmd={id:cmdId,text,threadId,status:'approved',createdAt:nowISO()};
      const s=readState();
      let t=s.brain.threads.find(x=>x.id===threadId);
      if(t){const msgId = globalThis.id ? globalThis.id('msg') : 'msg_'+Date.now().toString(36); t.messages.push({id:msgId,role:'assistant',text:'✅ '+text,at:nowISO(),surface:'approval',threadId});}
      writeState(s);
      return send(res,200,{ok:true,approved:data});
    }catch(e){return send(res,500,{error:String(e.message)})}
  }
  const declineMatch=u.pathname.match(/^\/api\/approvals\/([^/]+)\/decline$/);
  if(declineMatch&&req.method==='POST'){
    try{
      const dir='/home/admin/.openclaw/workspace/approval-queue';
      const id=declineMatch[1];
      const pendingJson=dir+'/pending/'+id+'.json';
      const pendingMd=dir+'/pending/'+id+'.md';
      const pending=pendingJson;
      const isMd=!fs.existsSync(pendingJson)&&fs.existsSync(pendingMd);
      const srcFile=isMd?pendingMd:pending;
      if(!fs.existsSync(srcFile)) return send(res,404,{error:'not_found'});
      const raw=fs.readFileSync(srcFile,'utf8');
      const data=isMd?{id,title:id.replace(/-/g,' '),description:raw.substring(0,500),type:'md'}:JSON.parse(raw);
      data.status='declined';
      data.declinedAt=new Date().toISOString();
      const ext=isMd?'.md':'.json';
      fs.writeFileSync(dir+'/declined/'+id+ext,isMd?raw:JSON.stringify(data,null,2));
      fs.unlinkSync(srcFile);
      const text='DECLINED: '+data.title+' (by Amir)';
      const threadId=(data.agent||'unknown')+'-dm';
      const s=readState();
      let t=s.brain.threads.find(x=>x.id===threadId);
      if(t){t.messages.push({id:id('msg'),role:'assistant','text':'❌ '+text,at:nowISO(),surface:'approval',threadId});}
      writeState(s);
      return send(res,200,{ok:true,declined:data});
    }catch(e){return send(res,500,{error:String(e.message)})}
  }
  if(u.pathname==='/api/commands'&&req.method==='POST'){ const s=readState(), b=await body(req); const command={id:id('cmd'),text:String(b.text||b.command||'').trim(),threadId:b.threadId||'general',status:'queued',target:b.target||'assistant',createdAt:nowISO(),tags:b.tags||[]}; if(!command.text) return send(res,400,{error:'command_required'}); s.brain.commands.unshift(command); activity(s,'command',command.text,{threadId:command.threadId}); s.brain.activeThread=command.threadId; if(b.send!==false){ let t=s.brain.threads.find(x=>x.id===command.threadId); if(!t){ s.brain.threads||=[]; t={id:command.threadId,title:'Chat',icon:'💬',tags:[],context:{businessIds:[]},messages:[],scope:'Dashboard chat',sessionKey:`agent:main:dashboard-${command.threadId.slice(-12)}`}; s.brain.threads.unshift(t); } t.context=t.context||{}; if(b.modes&&b.modes.length)t.context.modes=b.modes; if(genericTitle(t.title)) t.title=smartThreadTitle(command.text,t,s); const user={id:id('msg'),role:'user',text:command.text,at:nowISO(),surface:'dashboard',threadId:command.threadId}; t.messages.push(user); activity(s,'thread-message',`${t.title}: ${clip(command.text,100)}`,{threadId:command.threadId}); const pending={id:id('msg'),role:'assistant',text:'Thinking…',pending:true,replyTo:user.id,at:nowISO(),surface:'openclaw',threadId:command.threadId}; t.messages.push(pending); writeState(s); const snap=JSON.parse(JSON.stringify(s)); const model=b.model||''; runAssistantBackground(command.threadId,snap,JSON.parse(JSON.stringify(t)),command.text,model); return send(res,200,{ok:true,command,queued:true,thread:t,state:s}); } writeState(s); return send(res,200,{ok:true,command,state:s}); }
  if(u.pathname==='/api/ops/brief'&&req.method==='GET'){ const s=readState(); return send(res,200,{ok:true,brief:generateBrief(s,u.searchParams.get('date')||todayKey())}); }
  if(u.pathname==='/api/ops/inbox'&&req.method==='POST'){ const s=readState(), b=await body(req); const item={id:id('note'),text:String(b.text||'').trim(),project:b.project||'',urgency:b.urgency||'normal',source:b.source||'dashboard',createdAt:nowISO(),tags:b.tags||[]}; if(!item.text) return send(res,400,{error:'text_required'}); s.ops.inbox.unshift(item); activity(s,'ops-note',item.text,{project:item.project}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/ai/suggest'&&req.method==='POST'){ const s=readState(), b=await body(req); return send(res,200,{ok:true,suggestions:generateSuggestions(s,b.prompt||'')}); }
  if(u.pathname==='/api/todos'&&req.method==='GET'){ const s=readState(), date=u.searchParams.get('date')||todayKey(); return send(res,200,{ok:true,date,todos:s.todos[date]||[]}); }
  if(u.pathname==='/api/todos'&&req.method==='POST'){ const s=readState(), b=await body(req); const date=b.date||todayKey(); s.todos[date] ||= []; const t={id:id('todo'),text:String(b.text||'').trim(),done:false,priority:b.priority||'medium',project:b.project||'',businessId:b.businessId||'',tags:b.tags||[],stage:b.stage||'today',minutes:b.minutes||30,createdAt:nowISO(),source:b.source||'manual'}; if(!t.text) return send(res,400,{error:'text_required'}); s.todos[date].push(t); activity(s,'task',`Added task: ${t.text}`,{project:t.project,date}); writeState(s); sendPushToAll(s, '📋 New task', clip(String(b.text||''),150), 'todo-new', { url: '/', todoId: t.id }); return send(res,200,{ok:true,todo:t,state:s}); }
  if(u.pathname==='/api/todos/bulk'&&req.method==='POST'){ const s=readState(), b=await body(req), date=b.date||todayKey(); s.todos[date] ||= []; for(const x of b.todos||[]) if(x.text) s.todos[date].push({id:id('todo'),done:false,priority:'medium',minutes:30,createdAt:nowISO(),source:'bulk',...x,text:String(x.text).trim()}); activity(s,'tasks',`Added ${(b.todos||[]).length} tasks`,{date}); sendPushToAll(s, '📋 New tasks', `Added ${(b.todos||[]).length} new tasks`, 'todos-bulk', { url: '/' }); writeState(s); return send(res,200,{ok:true,state:s}); }
  if(u.pathname==='/api/todos/reorder'&&req.method==='POST'){ const s=readState(), b=await body(req), date=b.date||todayKey(); const order=Array.isArray(b.order)?b.order:[]; const cur=s.todos[date]||[]; const by=new Map(cur.map(t=>[t.id,t])); const next=order.map(x=>by.get(x)).filter(Boolean); for(const t of cur) if(!order.includes(t.id)) next.push(t); s.todos[date]=next; activity(s,'priority','Reordered dashboard priority queue',{date}); writeState(s); return send(res,200,{ok:true,state:s}); }
  const todoPatch=u.pathname.match(/^\/api\/todos\/([^/]+)$/); if(todoPatch&&req.method==='PATCH'){ const s=readState(), b=await body(req), tid=todoPatch[1]; for(const date of Object.keys(s.todos)){ const t=(s.todos[date]||[]).find(x=>x.id===tid); if(t){ Object.assign(t,b,{updatedAt:nowISO()}); if('done'in b){ t.doneAt=b.done?nowISO():null; if(b.done) sendPushToAll(s, '🎉 Task completed', clip(String(t.text||''),150), 'todo-done-'+tid, { url: '/', todoId: tid }); } writeState(s); return send(res,200,{ok:true,todo:t,state:s}); } } return send(res,404,{error:'not_found'}); }
  if(todoPatch&&req.method==='DELETE'){ const s=readState(), tid=todoPatch[1]; for(const date of Object.keys(s.todos)){ const n=s.todos[date].length; s.todos[date]=s.todos[date].filter(x=>x.id!==tid); if(s.todos[date].length!==n){ writeState(s); return send(res,200,{ok:true,state:s}); } } return send(res,404,{error:'not_found'}); }
  const nn=u.pathname.match(/^\/api\/nonnegotiables\/([^/]+)$/); if(nn&&req.method==='PATCH'){ const s=readState(), b=await body(req), date=b.date||todayKey(); s.metrics.nonnegotiables[date] ||= {}; s.metrics.nonnegotiables[date][nn[1]]=!!b.done; writeState(s); return send(res,200,{ok:true,brief:generateBrief(s,date),state:s}); }
  if(u.pathname==='/api/checkin'&&req.method==='POST'){ const s=readState(), b=await body(req); const date=b.date||todayKey(); s.metrics.dailyCheckin||={}; s.metrics.dailyCheckin[date]||={}; s.metrics.dailyCheckin[date][b.field]=b.value; writeState(s); return send(res,200,{ok:true,checkin:s.metrics.dailyCheckin[date]}); }
  if(u.pathname==='/api/businesses'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.businesses,b,'biz'); activity(s,'business',`Updated business: ${item.name}`,{id:item.id}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  const bizPatch=u.pathname.match(/^\/api\/businesses\/([^/]+)$/); if(bizPatch&&req.method==='PATCH'){ const s=readState(), b=await body(req); const item=s.businesses.find(x=>x.id===bizPatch[1]); if(!item)return send(res,404,{error:'not_found'}); Object.assign(item,b,{updatedAt:nowISO()}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/crm/leads'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.crm.leads,{stage:'new',tags:[],...b},'lead'); activity(s,'lead',`Updated lead: ${item.company||item.name||item.id}`,{id:item.id,stage:item.stage}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  const leadPatch=u.pathname.match(/^\/api\/crm\/leads\/([^/]+)$/); if(leadPatch&&req.method==='PATCH'){ const s=readState(), b=await body(req); const item=s.crm.leads.find(x=>x.id===leadPatch[1]); if(!item)return send(res,404,{error:'not_found'}); Object.assign(item,b,{updatedAt:nowISO()}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/crm/clients'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.crm.clients,{stage:'prospect',tags:[],...b},'client'); activity(s,'client',`Updated client: ${item.company||item.name||item.id}`,{id:item.id,stage:item.stage}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/reminders'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.brain.reminders,{done:false,priority:'medium',tags:[],...b,text:String(b.text||'').trim()},'rem'); if(!item.text)return send(res,400,{error:'text_required'}); activity(s,'reminder',`Reminder: ${item.text}`,{dueAt:item.dueAt}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  const remPatch=u.pathname.match(/^\/api\/reminders\/([^/]+)$/); if(remPatch&&req.method==='PATCH'){ const s=readState(), b=await body(req); const item=s.brain.reminders.find(x=>x.id===remPatch[1]); if(!item)return send(res,404,{error:'not_found'}); Object.assign(item,b,{updatedAt:nowISO()}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/calendar'&&req.method==='GET'){ const s=readState(); return send(res,200,{ok:true,calendar:s.brain.calendar}); }
  
  if(u.pathname==='/api/calendar/gateway-sync'&&req.method==='POST'){ const s=readState(), b=await body(req); try{ const items=b.items||b.events||(b.value?b.value:[]); const mapped=items.map(e=>({ id:'gcal_'+(e.id||e.iCalUID||slug(e.summary||e.title||e.start||Date.now())), source:'google', providerId:e.id, title:e.summary||e.title||'(No title)', start:e.start?.dateTime||e.start?.date||e.start||'', end:e.end?.dateTime||e.end?.date||e.end||'', location:e.location||'', description:e.description||'', attendees:e.attendees||[], type:'event', tags:['google-calendar'] })); const local=s.brain.calendar.filter(e=>e.source!=='google'); s.brain.calendar=[...mapped,...local].sort((a,b)=>String(a.start||'').localeCompare(String(b.start||''))).slice(0,1000); s.brain.sync.sources['google-calendar']={status:'ok',lastSync:nowISO(),summary:'Gateway sync: pulled '+mapped.length+' events.'}; s.brain.sync.lastCalendarSync=nowISO(); writeState(s); return send(res,200,{ok:true,count:mapped.length,state:s}); }catch(e){ s.brain.sync.sources['google-calendar']={status:'error',lastSync:nowISO(),summary:e.message}; writeState(s); return send(res,502,{ok:false,error:'gateway_sync_failed',detail:e.message,state:s}); } }
  if(u.pathname==='/api/calendar/sync'&&req.method==='POST'){ const s=readState(), b=await body(req); try{ const events=await syncGoogleCalendar(s,b); activity(s,'calendar-sync',`Pulled ${events.length} Google Calendar events`,{}); writeState(s); return send(res,200,{ok:true,events,state:s}); }catch(e){ s.brain.sync.sources['google-calendar']={status:'error',lastSync:nowISO(),summary:e.message}; writeState(s); return send(res,502,{ok:false,error:'calendar_sync_failed',detail:e.message,state:s}); } }
  if(u.pathname==='/api/calendar'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.brain.calendar,{type:'event',source:'local',tags:[],...b,title:String(b.title||'').trim()},'cal'); if(!item.title)return send(res,400,{error:'title_required'}); activity(s,'calendar',`Calendar: ${item.title}`,{start:item.start}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  const calPatch=u.pathname.match(/^\/api\/calendar\/([^/]+)$/); if(calPatch&&req.method==='PATCH'){ const s=readState(), b=await body(req); const item=s.brain.calendar.find(x=>x.id===calPatch[1]); if(!item)return send(res,404,{error:'not_found'}); Object.assign(item,b,{updatedAt:nowISO()}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/content'&&req.method==='GET'){ const s=readState(); s.brain.content.metrics=contentMetrics(s.brain.content); writeState(s); return send(res,200,{ok:true,content:s.brain.content}); }
  if(u.pathname==='/api/content/accounts'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.brain.content.accounts,{status:'planned',...b},'acct'); s.brain.content.metrics=contentMetrics(s.brain.content); activity(s,'content-account',`Updated content account: ${item.platform||''} ${item.handle||item.id}`,{id:item.id}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/content/personas'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.brain.content.personas,{accounts:[],...b},'persona'); activity(s,'content-persona',`Updated persona: ${item.name}`,{id:item.id}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/content/platforms'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.brain.content.platforms,{formats:[],status:'planned',...b},'platform'); activity(s,'content-platform',`Updated platform: ${item.name}`,{id:item.id}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/content/engine'&&req.method==='POST'){ const s=readState(), b=await body(req); s.brain.content.engine={...(s.brain.content.engine||{}),...b}; activity(s,'content-engine','Updated content engine settings',{}); writeState(s); return send(res,200,{ok:true,engine:s.brain.content.engine,state:s}); }
  if(u.pathname==='/api/content/plan'&&req.method==='POST'){ const s=readState(), b=await body(req); s.brain.content.personalPlan={...(s.brain.content.personalPlan||{}),...b}; activity(s,'content-plan','Updated personal content plan',{}); writeState(s); return send(res,200,{ok:true,plan:s.brain.content.personalPlan,state:s}); }
  if(u.pathname==='/api/content/posts'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.brain.content.posts,{status:'idea',type:'post',impressions:0,engagement:0,...b},'post'); s.brain.content.metrics=contentMetrics(s.brain.content); activity(s,'content-post',`Updated content item: ${item.title}`,{id:item.id,status:item.status}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  const postPatch=u.pathname.match(/^\/api\/content\/posts\/([^/]+)$/); if(postPatch&&req.method==='PATCH'){ const s=readState(), b=await body(req); const item=s.brain.content.posts.find(x=>x.id===postPatch[1]); if(!item)return send(res,404,{error:'not_found'}); Object.assign(item,b,{updatedAt:nowISO()}); s.brain.content.metrics=contentMetrics(s.brain.content); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/payments'&&req.method==='GET'){ const s=readState(); const projectId=u.searchParams.get('projectId'); const payments=projectId?(s.payments||[]).filter(p=>p.projectId===projectId):(s.payments||[]); return send(res,200,{ok:true,payments}); }
  if(u.pathname==='/api/payments'&&req.method==='POST'){ const s=readState(), b=await body(req); const payment={id:id('pay'),projectId:b.projectId||'',amount:parseFloat(b.amount)||0,type:b.type||'nonrecurring',status:b.status||'paid',description:b.description||'',date:b.date||(b.status==='upcoming'||b.status==='pipeline'?'':nowISO().split('T')[0]),expectedDate:b.expectedDate||b.date||'',recurringInterval:b.recurringInterval||null,createdAt:nowISO()}; s.payments.unshift(payment); activity(s,'payment',`Payment: £${payment.amount} ${payment.status} — ${payment.description||'Untitled'}`,{projectId:payment.projectId,status:payment.status}); writeState(s); return send(res,200,{ok:true,payment,state:s}); }
  const payPatch=u.pathname.match(/^\/api\/payments\/([^/]+)$/); if(payPatch&&req.method==='PATCH'){ const s=readState(), b=await body(req), pid=payPatch[1]; const pay=s.payments.find(x=>x.id===pid); if(!pay)return send(res,404,{error:'not_found'}); Object.assign(pay,b,{updatedAt:nowISO()}); writeState(s); return send(res,200,{ok:true,payment:pay,state:s}); }
  if(payPatch&&req.method==='DELETE'){ const s=readState(), pid=payPatch[1]; const idx=s.payments.findIndex(x=>x.id===pid); if(idx<0)return send(res,404,{error:'not_found'}); const removed=s.payments.splice(idx,1)[0]; activity(s,'payment',`Deleted payment: £${removed.amount}`,{id:removed.id}); writeState(s); return send(res,200,{ok:true,state:s}); }
  if(u.pathname==='/api/payments/stats'&&req.method==='GET'){ const s=readState(); const pays=s.payments||[]; const mrr=pays.filter(p=>p.type==='recurring'&&p.status==='paid').reduce((a,p)=>a+Number(p.amount||0),0); const paid=pays.filter(p=>p.status==='paid'); const paid30d=paid.filter(p=>p.date&&p.date>=new Date(Date.now()-30*864e5).toISOString().split('T')[0]).reduce((a,p)=>a+Number(p.amount||0),0); const paidTotal=paid.reduce((a,p)=>a+Number(p.amount||0),0); const upcoming=pays.filter(p=>p.status==='upcoming').reduce((a,p)=>a+Number(p.amount||0),0); const pipeline=pays.filter(p=>p.status==='pipeline').reduce((a,p)=>a+Number(p.amount||0),0); const byProject={}; for(const biz of s.businesses||[]){ const pp=pays.filter(p=>p.projectId===biz.id); if(pp.length){ byProject[biz.id]={name:biz.name,paid:pp.filter(p=>p.status==='paid').reduce((a,p)=>a+Number(p.amount||0),0),upcoming:pp.filter(p=>p.status==='upcoming').reduce((a,p)=>a+Number(p.amount||0),0),pipeline:pp.filter(p=>p.status==='pipeline').reduce((a,p)=>a+Number(p.amount||0),0),mrr:pp.filter(p=>p.type==='recurring'&&p.status==='paid').reduce((a,p)=>a+Number(p.amount||0),0),count:pp.length}; } } return send(res,200,{ok:true,stats:{mrr,paid30d,paidTotal,upcoming,pipeline,total:pays.reduce((a,p)=>a+Number(p.amount||0),0)},byProject,payments:pays}); }
  if(u.pathname==='/api/integrations'&&req.method==='POST'){ const s=readState(), b=await body(req); const item=upsertById(s.integrations,b,'int'); activity(s,'integration',`Updated integration: ${item.name}`,{id:item.id,status:item.status}); writeState(s); return send(res,200,{ok:true,item,state:s}); }
  if(u.pathname==='/api/sync/refresh'&&req.method==='POST'){ const s=readState(), b=await body(req); const sync=await refreshSync(s,b.source||'all'); writeState(s); return send(res,200,{ok:true,sync,state:s}); }
  if(u.pathname==='/api/timetable/config'&&req.method==='GET'){ const s=readState(); return send(res,200,{ok:true,config:s.brain.timetable||defaultTimetableConfig()}); }
  if(u.pathname==='/api/timetable/config'&&req.method==='POST'){ const s=readState(), b=await body(req); s.brain.timetable={...(s.brain.timetable||defaultTimetableConfig()),...b}; activity(s,'timetable-config','Updated timetable preferences',{}); writeState(s); return send(res,200,{ok:true,config:s.brain.timetable,state:s}); }
  if(u.pathname==='/api/timetable'&&req.method==='GET'){ const s=readState(); const date=u.searchParams.get('date')||todayKey(); const plan=scheduleDay(s,date); return send(res,200,{ok:true,date,timetable:plan}); }
  if(u.pathname==='/api/timetable'&&req.method==='POST'){ const s=readState(), b=await body(req); const date=b.date||todayKey(); if(b.manualSchedule){ s.brain.timetable.schedules ||= {}; s.brain.timetable.schedules[date]=b.manualSchedule; activity(s,'timetable-manual',`Saved manual timetable for ${date}`,{date}); writeState(s); return send(res,200,{ok:true,date,state:s}); } const plan=scheduleDay(s,date); return send(res,200,{ok:true,date,timetable:plan}); }
  if(u.pathname==='/api/mindmap'&&req.method==='GET') return send(res,200,{ok:true,context:getMindmapContext(),url:'http://100.111.98.27:4444/'});
  // ─── OpenCode Workspace API ───
  if(u.pathname==='/api/opencode/status'&&req.method==='GET'){
    return send(res,200,{ok:true,running:opencodeRunning,port:1703,proxyPort:1704,url:`http://100.111.98.27:1704`});
  }
  if(u.pathname==='/api/opencode/restart'&&req.method==='POST'){
    stopOpenCode();
    stopOCProxy();
    setTimeout(()=>{startOpenCode();startOCProxy();},500);
    return send(res,200,{ok:true,message:'OpenCode + proxy restarting'});
  }

  // ─── Secrets API ───
  if(u.pathname==='/api/secrets'&&req.method==='GET'){ const s=readState(); return send(res,200,{ok:true,secrets:s.secrets||[]}); }
  if(u.pathname==='/api/secrets'&&req.method==='POST'){ const s=readState(), b=await body(req); if(!b.project||!b.key||!b.value)return send(res,400,{error:'project, key, and value required'});
    const val=b.value; let secret={id:id('sec'),project:b.project,key:b.key,value:encryptSecret(val),notes:b.notes||'',tags:b.tags||[],type:b.type||'api-key',createdAt:nowISO(),updatedAt:nowISO()};
    s.secrets.unshift(secret); activity(s,'secrets',`Saved: ${b.project}/${b.key}`,{project:b.project}); writeState(s);
    return send(res,200,{ok:true,secret:{...secret,value:'[encrypted]'},state:s}); }
  const secMatch=u.pathname.match(/^\/api\/secrets\/([^/]+)$/);
  if(secMatch&&req.method==='DELETE'){ const s=readState(), id=secMatch[1]; const idx=(s.secrets||[]).findIndex(x=>x.id===id); if(idx<0)return send(res,404,{error:'not_found'});
    const removed=s.secrets.splice(idx,1)[0]; activity(s,'secrets',`Deleted: ${removed.project}/${removed.key}`,{id}); writeState(s);
    return send(res,200,{ok:true,state:s}); }
  if(secMatch&&req.method==='PATCH'){ const s=readState(), b=await body(req), id=secMatch[1]; const sec=(s.secrets||[]).find(x=>x.id===id); if(!sec)return send(res,404,{error:'not_found'});
    if(b.value){ b.value=encryptSecret(b.value); } Object.assign(sec,b,{updatedAt:nowISO()}); writeState(s);
    return send(res,200,{ok:true,secret:{...sec,value:'[encrypted]'},state:s}); }
  if(u.pathname==='/api/secrets/decrypt'&&req.method==='POST'){ const s=readState(), b=await body(req), sec=(s.secrets||[]).find(x=>x.id===b.id);
    if(!sec)return send(res,404,{error:'not_found'}); return send(res,200,{ok:true,id:sec.id,value:decryptSecret(sec.value)}); }

  if(u.pathname==='/api/email/check'&&req.method==='POST'){
    // Use Gateway to check Gmail via Kaneki
    const ctx = getMindmapContext();
    const sampleEmails = [
      {from:'GitHub',subject:'Re: odysseus — new issue opened #42',preview:'New feature request: dark mode toggle...',time:'2m ago',urgent:false},
      {from:'Asana',subject:'Task assigned: UI review',preview:'You have been assigned to review the latest design...',time:'15m ago',urgent:false},
      {from:'Amir Gulubayli',subject:'Content Empire - Q2 planning',preview:'Hey, we need to finalize the roadmap for next quarter...',time:'1h ago',urgent:true},
      {from:'Cloudflare',subject:'Analytics report: ai.ragmedium.com',preview:'Your site received 1,234 visits in the last 7 days...',time:'3h ago',urgent:false},
      {from:'Tailscale',subject:'New device connected',preview:'A new device has joined your tailnet: VPS-node-2',time:'1d ago',urgent:false},
    ];
    return send(res,200,{ok:true,messages:sampleEmails});
  }
  // ─── Goal-Driven Mode API ───
  if(u.pathname==='/api/goals'&&req.method==='GET'){ const s=readState(); return send(res,200,{ok:true,goals:s.brain.goals||[]}); }
  if(u.pathname==='/api/goals'&&req.method==='POST'){ const s=readState(),b=await body(req); const goal={id:id('goal'),title:clip((b.title||b.text||'Goal').trim(),100),description:(b.description||b.text||'').trim(),status:'planning',tasks:[],questions:[],plan:'',createdAt:nowISO(),updatedAt:nowISO(),currentTaskIdx:0,errorCount:0,lastRunAt:null}; if(!goal.description)return send(res,400,{error:'description_required'}); s.brain.goals||=[]; s.brain.goals.unshift(goal); activity(s,'goal',`Goal created: ${goal.title}`,{goalId:goal.id}); writeState(s); 
    // Auto-generate plan via AI
    (async function(){
      try{
        const planPrompt='You are a goal planner. Create a structured plan for this goal.\nGoal: '+goal.title+'\nDescription: '+goal.description.slice(0,1000)+'\n\nReturn ONLY a JSON array of task objects in this exact format (no markdown, no explanation):\n[{\\"title\\":\\"Task name\\",\\"description\\":\\"What to do\\",\\"estimatedMinutes\\":30}]\nBreak it into 3-8 concrete, actionable tasks. Each task should be something an AI agent can execute autonomously.';
        const out=await sendToAssistant(JSON.parse(JSON.stringify(s)),{id:'goal-planner-'+goal.id,title:'Goal Planner'},planPrompt,'');
        let tasks=[];
        try{ tasks=JSON.parse(out.reply.replace(/\n/g,' ').replace(/\\`\`\`json?/g,'').replace(/\\`\`\`/g,'').trim()); }catch(e){}
        if(!Array.isArray(tasks)||!tasks.length) tasks=[{title:'Work on: '+goal.title,description:goal.description.slice(0,300),estimatedMinutes:60}];
        const s2=readState(); const g2=(s2.brain.goals||[]).find(x=>x.id===goal.id);
        if(g2){g2.tasks=tasks.map(function(t,i){return{id:'gtask_'+i,title:t.title||'Task '+(i+1),description:t.description||'',estimatedMinutes:t.estimatedMinutes||30,done:false,skipped:false,result:''};}); g2.plan=out.reply.slice(0,2000); g2.status='planned'; writeState(s2);}
      }catch(e){console.error('[goal] plan error:',e.message);}
    })();
    return send(res,200,{ok:true,goal,state:s}); }
  if(u.pathname==='/api/goals'&&req.method==='DELETE'){ const s=readState(),b=await body(req); s.brain.goals=(s.brain.goals||[]).filter(g=>g.id!==b.id); writeState(s); return send(res,200,{ok:true,state:s}); }
  const goalDetail=u.pathname.match(/^\/api\/goals\/([^/]+)$/);
  if(goalDetail&&req.method==='GET'){ const s=readState(); const g=(s.brain.goals||[]).find(x=>x.id===goalDetail[1]); if(!g)return send(res,404,{error:'goal_not_found'}); return send(res,200,{ok:true,goal:g}); }
  if(goalDetail&&req.method==='PATCH'){ const s=readState(),b=await body(req); const g=(s.brain.goals||[]).find(x=>x.id===goalDetail[1]); if(!g)return send(res,404,{error:'goal_not_found'}); Object.assign(g,b,{updatedAt:nowISO()}); writeState(s); return send(res,200,{ok:true,goal:g,state:s}); }
  // Goal: add clarification question
  if(u.pathname==='/api/goals/'+goalDetail+'/ask'&&req.method==='POST'){ const s=readState(),b=await body(req); const g=(s.brain.goals||[]).find(x=>x.id===goalDetail[1]); if(!g)return send(res,404,{error:'goal_not_found'}); g.status='clarifying'; g.questions.push({q:b.question||'',a:null,askedAt:nowISO()}); writeState(s); return send(res,200,{ok:true,goal:g,state:s}); }
  // Goal: answer a question
  if(u.pathname==='/api/goals/'+goalDetail+'/answer'&&req.method==='POST'){ const s=readState(),b=await body(req); const g=(s.brain.goals||[]).find(x=>x.id===goalDetail[1]); if(!g)return send(res,404,{error:'goal_not_found'}); const q=g.questions.find(x=>x.q===b.question); if(q)q.a=b.answer; const allAnswered=g.questions.every(x=>x.a); if(allAnswered)g.status='planned'; writeState(s); return send(res,200,{ok:true,goal:g,state:s}); }
  // Goal: confirm plan and start execution
  if(u.pathname==='/api/goals/'+goalDetail+'/start'&&req.method==='POST'){ const s=readState(),b=await body(req); const g=(s.brain.goals||[]).find(x=>x.id===goalDetail[1]); if(!g)return send(res,404,{error:'goal_not_found'}); g.status='running'; g.tasks=b.tasks||g.tasks||[]; g.currentTaskIdx=0; g.lastRunAt=nowISO(); g.errorCount=0; writeState(s); runGoalEngine(goalDetail[1]); return send(res,200,{ok:true,goal:g,state:s}); }
  // Goal: reset
  if(u.pathname==='/api/goals/'+goalDetail+'/reset'&&req.method==='POST'){ const s=readState(); const g=(s.brain.goals||[]).find(x=>x.id===goalDetail[1]); if(!g)return send(res,404,{error:'goal_not_found'}); g.status='clarifying'; g.tasks=[]; g.questions=[]; g.plan=''; g.currentTaskIdx=0; g.errorCount=0; writeState(s); return send(res,200,{ok:true,goal:g,state:s}); }

  // ─── Push Notification Subscription API ───
  if(u.pathname==='/api/notifications/vapid-key'&&req.method==='GET'){
    return send(res,200,{ok:true, publicKey: VAPID_PUBLIC});
  }
  if(u.pathname==='/api/notifications/subscribe'&&req.method==='POST'){
    const s=readState(), b=await body(req);
    if(!b.endpoint) return send(res,400,{error:'endpoint_required'});
    s.pushSubscriptions = s.pushSubscriptions || [];
    // Replace existing subscription for same endpoint
    const idx = s.pushSubscriptions.findIndex(x => x.endpoint === b.endpoint);
    const sub = { endpoint: b.endpoint, keys: b.keys || {}, userAgent: req.headers['user-agent']||'', createdAt: nowISO(), lastActive: nowISO() };
    if(idx >= 0){ s.pushSubscriptions[idx] = sub; }
    else { s.pushSubscriptions.push(sub); }
    activity(s, 'push-subscribe', 'Push notification subscription updated', { endpoint: b.endpoint.slice(0,40)+'...' });
    writeState(s);
    return send(res,200,{ok:true});
  }
  if(u.pathname==='/api/notifications/unsubscribe'&&req.method==='POST'){
    const s=readState(), b=await body(req);
    if(!b.endpoint) return send(res,400,{error:'endpoint_required'});
    s.pushSubscriptions = (s.pushSubscriptions || []).filter(x => x.endpoint !== b.endpoint);
    writeState(s);
    return send(res,200,{ok:true});
  }
  // Internal: send push notification to all subscribers
  if(u.pathname==='/api/notifications/send'&&req.method==='POST'){
    const s=readState(), b=await body(req);
    const payload = JSON.stringify({
      title: b.title || 'Amir Command',
      body: b.body || '',
      tag: b.tag || 'dashboard-notif',
      data: b.data || {},
      icon: '/icons/icon-192.png',
      requireInteraction: b.requireInteraction || false
    });
    const subs = s.pushSubscriptions || [];
    const results = [];
    for(const sub of subs){
      try{
        await webpush.sendNotification(sub, payload);
        results.push({ endpoint: sub.endpoint.slice(0,40)+'...', status: 'sent' });
      }catch(e){
        if(e.statusCode === 410 || e.statusCode === 404){
          // Subscription expired — remove it
          s.pushSubscriptions = s.pushSubscriptions.filter(x => x.endpoint !== sub.endpoint);
          results.push({ endpoint: sub.endpoint.slice(0,40)+'...', status: 'expired_removed' });
        } else {
          results.push({ endpoint: sub.endpoint.slice(0,40)+'...', status: 'error: '+e.message });
        }
      }
    }
    if(results.some(r => r.status === 'expired_removed')) writeState(s);
    return send(res,200,{ok:true, results});
  }
  if(u.pathname==='/api/notifications/subscriptions'&&req.method==='GET'){
    const s=readState();
    const subs = (s.pushSubscriptions||[]).map(x => ({ endpoint: x.endpoint.slice(0,40)+'...', userAgent: x.userAgent, lastActive: x.lastActive, createdAt: x.createdAt }));
    return send(res,200,{ok:true, subscriptions: subs, count: subs.length});
  }
  
  // TEAM SLACK API
  if(u.pathname==='/api/slack/channels'&&req.method==='GET'){
    const dir='/home/admin/.openclaw/workspace/team-slack';
    const channels=fs.readdirSync(dir).filter(f=>fs.statSync(dir+'/'+f).isDirectory()).map(ch=>{
      const msgs=fs.readdirSync(dir+'/'+ch).filter(f=>f.endsWith('.json')).sort().slice(-50);
      return {id:ch,name:ch,count:msgs.length,last:msgs[msgs.length-1]||null};
    });
    return send(res,200,{ok:true,channels});
  }
  if(u.pathname.match(/^\/api\/slack\/([^/]+)$/)&&req.method==='GET'){
    const ch=u.pathname.split('/')[3];
    const dir='/home/admin/.openclaw/workspace/team-slack/'+ch;
    if(!fs.existsSync(dir))return send(res,404,{error:'channel_not_found'});
    const limit=parseInt(u.query?.limit||'50',10);
    const msgs=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort().slice(-limit).map(f=>{try{return JSON.parse(fs.readFileSync(dir+'/'+f,'utf8'))}catch{return null}}).filter(Boolean);
    return send(res,200,{ok:true,channel:ch,messages:msgs});
  }
  if(u.pathname.match(/^\/api\/slack\/([^/]+)$/)&&req.method==='POST'){
    const ch=u.pathname.split('/')[3];
    const dir='/home/admin/.openclaw/workspace/team-slack/'+ch;
    if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
    const b=await body(req);
    const msg={id:Date.now().toString(36)+'-'+crypto.randomBytes(2).toString('hex'),channel:ch,agent:b.agent||'unknown',text:String(b.text||'').trim(),timestamp:new Date().toISOString(),tags:b.tags||[]};
    if(!msg.text)return send(res,400,{error:'text_required'});
    fs.writeFileSync(dir+'/'+msg.id+'.json',JSON.stringify(msg,null,2));
    return send(res,200,{ok:true,message:msg});
  }

  // ─── Nonnegotiables GET ───
  if(u.pathname==='/api/nonnegotiables'&&req.method==='GET'){ const s=readState(); const date=u.searchParams.get('date')||todayKey(); return send(res,200,{ok:true,date,nonnegotiables:s.ops.nonnegotiables||defaultNonnegotiables(),done:s.metrics.nonnegotiables[date]||{}}); }

  return send(res,404,{error:'not_found'});
}

// ─── Goal Engine: autonomous execution loop ───
const activeGoalLoops={};
function runGoalEngine(goalId){
  if(activeGoalLoops[goalId])return; // already running
  activeGoalLoops[goalId]=true;
  
  function tick(){
    const s=readState();
    const g=(s.brain.goals||[]).find(x=>x.id===goalId);
    if(!g||g.status!=='running'){ delete activeGoalLoops[goalId]; return; }
    
    const task=g.tasks[g.currentTaskIdx];
    if(!task||task.done){
      // Check if all tasks done
      g.currentTaskIdx++;
      if(g.currentTaskIdx>=g.tasks.length){
        const allDone=g.tasks.every(t=>t.done||t.skipped);
        if(allDone){ g.status='verifying'; writeState(s); }
        else { delete activeGoalLoops[goalId]; return; }
      }
    }
    
    // Execute current task via gateway
    const msg=`[Goal: ${g.title}] Task: ${g.tasks[g.currentTaskIdx]?.title||'Continue working'}\nGoal context: ${g.description.slice(0,500)}\nStatus: We are working autonomously toward a goal. Complete the current task. If blocked, note it and try another approach. Do NOT stop until all tasks are done. When you finish a task, say TASK_DONE:<task_name> and move to the next.`;
    const thread={id:tid, title:'Goal: '+g.title, sessionKey:'agent:main:dashboard-goal-'+goalId.slice(-10), messages:[]};
    sendToAssistant(s,thread,msg,'').then(out=>{
      const s2=readState(); const g2=(s2.brain.goals||[]).find(x=>x.id===goalId);
      if(!g2||g2.status!=='running'){ delete activeGoalLoops[goalId]; return; }
      
      // Check for TASK_DONE marker
      const reply=out.reply||'';
      if(reply.includes('TASK_DONE')&&g2.tasks[g2.currentTaskIdx]){
        g2.tasks[g2.currentTaskIdx].done=true;
        g2.tasks[g2.currentTaskIdx].result=reply.slice(0,500);
        g2.currentTaskIdx++;
      }
      // Check for question
      if(reply.includes('QUESTION:')){
        g2.status='blocked';
        g2.lastQuestion=reply.replace(/.*QUESTION:\s*/,'').split('\n')[0].slice(0,300);
      }
      g2.lastRunAt=nowISO();
      writeState(s2);
      
      // Schedule next tick (2s penalty between tasks)
      setTimeout(tick,2000);
    }).catch(e=>{
      const s2=readState(); const g2=(s2.brain.goals||[]).find(x=>x.id===goalId);
      if(g2){g2.errorCount=(g2.errorCount||0)+1; if(g2.errorCount>5){g2.status='failed';delete activeGoalLoops[goalId];} writeState(s2);}
      setTimeout(tick,5000);
    });
  }
  tick();
}

// ─── OpenCode Process Management ───
let opencodeProc = null;
let opencodeRunning = false;
function startOpenCode(){
  if(opencodeProc) { stopOpenCode(); }
  const env = { ...process.env };
  const envFile = path.join(ROOT, 'opencode.env');
  try {
    const raw = fs.readFileSync(envFile, 'utf8');
    for(const line of raw.split(/\r?\n/)){
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if(m) env[m[1]] = m[2].replace(/^['"]|['"]$/g,'');
    }
  } catch(e){}
  const cors = ['--cors','http://100.111.98.27:1702','--cors','http://localhost:1702'];
  opencodeProc = require('child_process').spawn('/home/admin/.nvm/versions/node/v22.22.0/bin/opencode', [
    'web', '--port','1703','--hostname','0.0.0.0', ...cors
  ], { cwd: path.join(ROOT,'..'), env, stdio: ['pipe','pipe','pipe'], detached: false });
  opencodeProc.stdout.on('data', d => { const s = d.toString(); if(!opencodeRunning && (s.includes('Local access:') || s.includes('Network access:'))) { opencodeRunning = true; console.log('[opencode] Ready on :1703'); } });
  opencodeProc.stderr.on('data', d => {});
  opencodeProc.on('exit', c => { opencodeRunning = false; opencodeProc = null; console.log('[opencode] Exited:', c); });
  opencodeProc.on('error', e => { opencodeRunning = false; opencodeProc = null; console.error('[opencode] Error:', e.message); });
  // Fallback: check port directly after 3s
  setTimeout(()=>{
    if(!opencodeRunning){
      const c = require('http').request({hostname:'127.0.0.1',port:1703,path:'/',method:'GET',timeout:2000}, r => { if(r.statusCode) { opencodeRunning = true; console.log('[opencode] Port check OK'); } });
      c.on('error',()=>{}); c.end();
    }
  }, 3000);
  console.log('[opencode] Starting...');
}
function stopOpenCode(){
  if(opencodeProc) { try { opencodeProc.kill('SIGTERM'); } catch(e){} opencodeProc = null; opencodeRunning = false; }
}

// ─── OpenCode Proxy ───
let ocProxyProc = null;
function startOCProxy(){
  if(ocProxyProc) { try { ocProxyProc.kill('SIGTERM'); } catch(e){} ocProxyProc = null; }
  ocProxyProc = require('child_process').spawn('node', [path.join(ROOT,'oc-proxy.js')], {
    cwd: ROOT, stdio: 'inherit', detached: false
  });
  ocProxyProc.on('exit', c => { ocProxyProc = null; console.log('[oc-proxy] Exited:', c); });
  ocProxyProc.on('error', e => console.error('[oc-proxy] Error:', e.message));
}
function stopOCProxy(){
  if(ocProxyProc) { try { ocProxyProc.kill('SIGTERM'); } catch(e){} ocProxyProc = null; }
}

// ─── KasmVNC Desktop Proxy ───
let kasmProxyProc = null;
function startKasmProxy(){
  if(kasmProxyProc) { try { kasmProxyProc.kill('SIGTERM'); } catch(e){} kasmProxyProc = null; }
  kasmProxyProc = require('child_process').spawn('node', [path.join(ROOT,'kasm-proxy.js')], {
    cwd: ROOT, stdio: 'inherit', detached: false
  });
  kasmProxyProc.on('exit', c => { kasmProxyProc = null; console.log('[kasm-proxy] Exited:', c); });
  kasmProxyProc.on('error', e => console.error('[kasm-proxy] Error:', e.message));
}

const server = http.createServer((req,res)=>route(req,res).catch(e=>send(res,500,{error:'server_error',detail:String(e.message||e)})));

// ─── Startup: recover stale pending messages (orphaned by restart) ───
function recoverStalePending(){
  try {
    const s = readState();
    const now = Date.now();
    const STALE_MS = 900000; // 15 min — longer than any normal request
    let recovered = 0;
    for(const t of s.brain.threads||[]){
      for(const m of t.messages||[]){
        if(m.pending && m.at && (now - new Date(m.at).getTime()) > STALE_MS){
          m.pending = false;
          m.isError = true;
          m.text = '⚠️ Server restarted while processing — tap send to retry';
          recovered++;
        }
      }
    }
    if(recovered > 0){
      writeState(s);
      console.log(`[recovery] cleared ${recovered} stale pending messages`);
    }
  } catch(e){
    console.error('[recovery] error:', e.message);
  }
}

server.listen(PORT,HOST,()=>{
  console.log(`Mastermind dashboard http://${HOST}:${PORT}`);
  recoverStalePending();
  startOpenCode();
  startOCProxy();
  startKasmProxy();
});
