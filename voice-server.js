#!/usr/bin/env node
/**
 * Voice Call Server - HANDS-FREE calling system
 *
 * Real call experience with:
 * - Single mic capture via Web Audio API
 * - Energy-based Voice Activity Detection (VAD) — auto-flush on silence
 * - Groq whisper-large-v3-turbo for STT (fast, <500ms)
 * - Groq llama-3.3-70b-versatile for LLM (37ms typical)
 * - edge-tts for TTS (Aria voice, free)
 * - Live transcript streamed back
 * - Call log persisted to calls.jsonl
 *
 * Endpoints:
 *   GET  /health
 *   GET  /calls           — recent call log
 *   POST /api/voice/transcribe  — STT only (multipart)
 *   POST /api/voice/ask    — STT + LLM + TTS in one shot
 *   WS   /ws/voice         — full-duplex streaming
 */

const http = require('http');
const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

// ===== Config =====
const PORT = 8777;
const TEMP_DIR = '/tmp/voice-sessions';
const CALL_LOG_PATH = '/home/admin/.ragmedium/voice/calls.jsonl';

// Load Groq key
let GROQ_KEY = process.env.GROQ_API_KEY;
try {
  const cred = require('/home/admin/.ragmedium/credentials/groq-api-key.json');
  GROQ_KEY = GROQ_KEY || cred.groq_api_key;
} catch (e) {}

if (!GROQ_KEY) {
  console.error('[Voice] No GROQ_API_KEY found. Set env or /home/admin/.ragmedium/credentials/groq-api-key.json');
  process.exit(1);
}




// ===== Proactive Notification Tracker =====
// Tracks what I've told Amir so I don't repeat, and highlights what's NEW
const NOTIF_STATE_PATH = path.join(__dirname, '..', '.ragmedium', 'voice', 'notification-state.json');
const NOTIF_DIR = path.dirname(NOTIF_STATE_PATH);

function loadNotifState() {
  if (!fs.existsSync(NOTIF_DIR)) fs.mkdirSync(NOTIF_DIR, { recursive: true });
  try { return JSON.parse(fs.readFileSync(NOTIF_STATE_PATH, 'utf8')); }
  catch { return { lastSession: null, notifiedEmails: [], notifiedBlockers: [], lastNotifiedAt: Date.now() }; }
}

function saveNotifState(state) {
  if (!fs.existsSync(NOTIF_DIR)) fs.mkdirSync(NOTIF_DIR, { recursive: true });
  fs.writeFileSync(NOTIF_STATE_PATH, JSON.stringify(state, null, 2));
}

async function checkForUpdates(ctx) {
  const state = loadNotifState();
  const updates = [];
  const now = Date.now();
  
  // Check inbox for new emails since last check
  if (ctx.inbox && ctx.inbox.total > 0) {
    const lastEmailCheck = state.lastEmailCheck || 0;
    // If we have inbox stats, flag it if total changed significantly
    updates.push({ type: 'inbox', message: ctx.inbox.total + ' emails in your inbox, ' + (ctx.inbox.needs_attention || 0) + ' need attention.', severity: 'info' });
  }
  
  // Check for pending approvals across projects
  if (ctx.projects) {
    const proj = Array.isArray(ctx.projects) ? ctx.projects : (ctx.projects.projects || []);
    let pendingApprovals = 0;
    let stalledProjects = [];
    proj.forEach(function(p) {
      if (p.approvals_pending || (p.stats && p.stats.approvals_pending)) pendingApprovals += p.stats ? p.stats.approvals_pending : p.approvals_pending;
      if (p.status === 'stalled' || p.status === 'needs_attention' || p.status === 'on_hold') stalledProjects.push(p.name || p.id);
    });
    if (pendingApprovals > 0) {
      updates.push({ type: 'approvals', message: pendingApprovals + ' pending approvals across your projects.', severity: 'action' });
    }
    if (stalledProjects.length > 0) {
      updates.push({ type: 'stalled', message: stalledProjects.length + ' project(s) need attention: ' + stalledProjects.join(', ') + '.', severity: 'warning' });
    }
  }
  
  // Check team status
  if (ctx.agents && Array.isArray(ctx.agents)) {
    const busy = ctx.agents.filter(a => a.status === 'busy' || a.status === 'active').length;
    const idle = ctx.agents.filter(a => a.status === 'idle').length;
    if (idle > busy) {
      updates.push({ type: 'team', message: idle + ' agents are idle out of ' + ctx.agents.length + '. Want me to assign them tasks?', severity: 'question' });
    }
  }
  
  // Save state
  state.lastCheck = now;
  saveNotifState(state);
  
  return updates;
}
// ===== Real context from backend APIs =====
async function fetchEmpireContext() {
  const results = {};
  const promises = [
    fetchJSON('http://127.0.0.1:8100/api/inbox/stats', 'inbox', 3000),
    fetchJSON('http://127.0.0.1:8099/api/projects', 'projects', 3000),
    fetchJSON('http://127.0.0.1:8096/api/stats', 'brain', 3000),
    fetchJSON('http://127.0.0.1:1707/api/agents', 'agents', 3000),
    fetchJSON('http://127.0.0.1:1707/api/tasks', 'tasks', 3000),
  ];
  const settled = await Promise.allSettled(promises);
  for (const s of settled) {
    if (s.status === 'fulfilled') Object.assign(results, s.value);
  }
  return results;
}

function fetchJSON(url, key, timeout) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ [key]: JSON.parse(data) }); }
        catch { resolve({ [key]: null }); }
      });
    });
    req.on('error', () => resolve({ [key]: null }));
    req.on('timeout', () => { req.destroy(); resolve({ [key]: null }); });
  });
}

function formatContext(ctx) {
  let s = '';
  if (ctx.inbox) {
    const i = ctx.inbox;
    const count = typeof i.total === 'number' ? i.total : (i.messages ? i.messages.length : '?');
    s += 'Inbox: ' + count + ' emails. ';
  }
  if (ctx.projects) {
    const proj = Array.isArray(ctx.projects) ? ctx.projects : (ctx.projects.projects || []);
    if (Array.isArray(proj) && proj.length) {
      const active = proj.filter(p => p.status !== 'archived');
      s += 'Active projects (' + active.length + '): ' + active.map(p => p.name || p.id).join(', ') + '. ';
    }
  }
  if (ctx.brain) {
    s += 'Knowledge base: ' + (ctx.brain.amir_training || 0) + ' chunks, ' + (ctx.brain.total_docs || 0) + ' docs. ';
  }
  return s || 'No live data available.';
}
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(CALL_LOG_PATH))) fs.mkdirSync(path.dirname(CALL_LOG_PATH), { recursive: true });

// ===== Primary LLM: local opencode web (me — Hermes agent) =====
// Falls back to Groq if opencode is unavailable
function hermesChat(messages, opts) {
  return new Promise((resolve, reject) => {
    const lastUser = messages.filter(m => m.role === 'user').pop();
    const prompt = lastUser ? lastUser.content : 'hello';
    const { exec } = require('child_process');
    const model = 'deepseek-chat';
    const escaped = prompt.replace(/"/g, '\"');
    exec('opencode run "' + escaped + '" --model ' + model + ' 2>/dev/null', {
      cwd: '/home/admin/.openclaw/workspace',
      timeout: 20000,
      maxBuffer: 50 * 1024,
    }, (error, stdout, stderr) => {
      if (error) { reject(error); return; }
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const response = lines.length > 0 ? lines[lines.length - 1].trim() : '';
      if (response) resolve(response);
      else reject(new Error('Empty response from opencode'));
    });
  });
}


// ===== Groq API =====
// ===== REAL HERMES AGENT =====
// Spawns the actual Hermes agent via CLI — full context, memory, skills
async function hermesChat(messages, opts) {
  return new Promise((resolve, reject) => {
    const lastMsg = messages && messages.length > 0 ? messages[messages.length - 1] : null;
    const query = (lastMsg && lastMsg.content) || '';
    if (!query) { resolve(''); return; }
    
    // Use bash wrapper to provide a proper environment
    const escaped = query.replace(/'/g, "'\\''");
    const fullCmd = 'hermes chat -q ' + "'" + escaped + "' --cli --quiet --source voice-call --skills ''";
    const child = spawn('bash', ['-c', fullCmd], {
      env: { ...process.env, HERMES_ACCEPT_HOOKS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (c) => stdout += c);
    child.stderr.on('data', (c) => stderr += c);
    
    child.on('close', (code) => {
      // Strip warning lines and session_id from output
      let out = stdout.trim();
      out = out.replace(/^Warning:.*\n?/gm, '').replace(/^session_id:.*\n?/gm, '').trim();
      if (code === 0 && out) {
        resolve(out);
      } else {
        reject(new Error('hermes exit=' + code + ' stderr=' + stderr.slice(0, 200)));
      }
    });
    
    child.on('error', reject);
  });
}

// Groq LLM — fallback ONLY
function groqChatFallback(messages, opts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: opts?.model || 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: opts?.temperature || 0.7,
      max_tokens: opts?.max_tokens || 500,
    });
    const req = https.request({
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GROQ_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Groq ${res.statusCode}: ${data}`));
        } else {
          try {
            const j = JSON.parse(data);
            resolve(j.choices?.[0]?.message?.content || '');
          } catch (e) { reject(e); }
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Groq Whisper STT — accepts WAV, MP3, M4A, WebM, OGG
function groqStt(audioBuffer, filename) {
  return new Promise((resolve, reject) => {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, { filename: filename || 'audio.wav', contentType: 'audio/wav' });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'en');
    form.append('response_format', 'json');
    const opts = {
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: Object.assign({
        'Authorization': 'Bearer ' + GROQ_KEY,
      }, form.getHeaders()),
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Groq STT ${res.statusCode}: ${data}`));
        } else {
          try {
            resolve(JSON.parse(data).text || '');
          } catch (e) { reject(e); }
        }
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

// ===== Sanitize text for TTS (strip markdown, tables, symbols) =====
function sanitizeForTTS(text) {
  if (!text) return '';
  return text
    .replace(/\|/g, ' ')           // table pipes
    .replace(/-{3,}/g, ' ')          // horizontal rules
    .replace(/[\*_~`#]/g, '')      // bold, italic, strikethrough, code, headings
    .replace(/\[\d+\]/g, '')     // reference links [1], [2]
    .replace(/:\/\/[^\s]+/g, '') // URLs
    .replace(/\n{2,}/g, ' ')       // multiple newlines -> space
    .replace(/\s{2,}/g, ' ')       // multiple spaces -> single
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // emojis
    .trim();
}

// ===== TTS via edge-tts =====
async function textToSpeech(text, outputPath, voice) {
  return new Promise((resolve, reject) => {
    voice = voice || 'en-GB-RyanNeural';
    const proc = spawn('/home/admin/.hermes/hermes-agent/venv/bin/python3', ['-c', `
import asyncio
from edge_tts import Communicate
import sys

async def main():
    tts = Communicate("""${text.replace(/"/g, '\\"').replace(/\n/g, ' ')}""", voice="${voice}")
    await tts.save("${outputPath}")

asyncio.run(main())
`]);
    let stderr = '';
    proc.stderr.on('data', (d) => stderr += d);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts exit ${code}: ${stderr}`));
    });
  });
}

// ===== Audio conversion =====
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error'].concat(args));
    let stderr = '';
    proc.stderr.on('data', (d) => stderr += d);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr}`));
    });
  });
}

// Convert uploaded audio to 16kHz mono WAV for Groq Whisper
async function normalizeToWav(inputPath, outputPath) {
  await runFfmpeg([
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-f', 'wav',
    outputPath,
  ]);
}

// ===== Call Log =====
function logCall(entry) {
  try {
    fs.appendFileSync(CALL_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (e) { console.error('[Voice] Log error:', e.message); }
}

// ===== HTTP Server =====
const httpServer = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, groq_configured: !!GROQ_KEY }));
    return;
  }

  // GET /calls — recent call log (last 50)
  if (req.method === 'GET' && req.url.startsWith('/calls')) {
    try {
      const lines = fs.existsSync(CALL_LOG_PATH)
        ? fs.readFileSync(CALL_LOG_PATH, 'utf-8').split('\n').filter(l => l).slice(-50)
        : [];
      const calls = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ calls, count: calls.length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/voice/transcribe — multipart upload, returns text
  if (req.method === 'POST' && req.url === '/api/voice/transcribe') {
    try {
      const chunks = [];
      let boundary = '';
      const ct = req.headers['content-type'] || '';
      const m = ct.match(/boundary=(.+)$/);
      if (!m) throw new Error('No boundary in Content-Type');
      boundary = m[1];

      let buf = Buffer.alloc(0);
      for await (const chunk of req) buf = Buffer.concat([buf, chunk]);

      const boundaryBuf = Buffer.from('--' + boundary);
      const parts = [];
      let start = -1;
      let pos = 0;
      while ((pos = buf.indexOf(boundaryBuf, pos + 1)) !== -1) {
        if (start >= 0) parts.push({ start: start, end: pos });
        start = pos + boundaryBuf.length;
      }
      // Get filename + content
      let fileBuf = null;
      let filename = 'audio.wav';
      // Search ALL parts for any file upload (filename= OR Content-Type audio/*)
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const seg = buf.slice(p.start, p.end - 2);
        const headerEnd = seg.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const header = seg.slice(0, headerEnd).toString('utf-8');
        // Match either filename= OR audio content-type
        const isFile = header.includes('filename=') || /content-type:\s*audio\//i.test(header);
        if (isFile) {
          const fm = header.match(/filename="([^"]+)"/);
          if (fm) filename = fm[1];
          fileBuf = seg.slice(headerEnd + 4);
          break;
        }
      }
      if (!fileBuf || fileBuf.length === 0) throw new Error('No audio file in request');

      const tmpIn = path.join(TEMP_DIR, crypto.randomUUID() + '_' + filename);
      const tmpWav = path.join(TEMP_DIR, crypto.randomUUID() + '.wav');
      fs.writeFileSync(tmpIn, fileBuf);
      // Normalize
      try {
        await normalizeToWav(tmpIn, tmpWav);
      } catch (e) {
        // Maybe browser already sent wav — try direct
        fs.copyFileSync(tmpIn, tmpWav);
      }
      const normalizedBuf = fs.readFileSync(tmpWav);
      let rawTranscript = await groqStt(normalizedBuf, 'audio.wav');
      try { fs.unlinkSync(tmpIn); } catch {}
      try { fs.unlinkSync(tmpWav); } catch {}
      
      // Skip VAD false positives: silence, filler words, noise, gibberish
      const filler = ['thank you', 'thanks', 'okay', 'ok', 'bye', 'hello', 'hi', 'yeah', 
        'uh', 'um', 'oh', 'hmm', 'nope', 'yep', 'welcome', "you're welcome", 'ah', 'ha'];
      if (rawTranscript) {
        const t = rawTranscript.trim().toLowerCase();
        const isGibberish = t.length < 4 || filler.includes(t) ||
          /^(.)\1{2,}$/.test(t) ||
          /^[^aeiou]{4,}$/.test(t) ||
          (t.split(/\s+/).length === 1 && t.length < 5);
        if (isGibberish || (t.length >= 6 && !isRealSentence(t))) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ transcript: rawTranscript || '', ai_response: '', audio: '' }));
          return;
        }
      }
      
      // STT pre-correction: fix transcription errors with a quick LLM pass
      let transcript = rawTranscript;
      if (rawTranscript && rawTranscript.length > 3) {
        try {
          const correction = await groqChatFallback([
            { role: 'system', content: 'You correct STT transcription errors. Fix garbled words, names (Waterspring, Unitas, Synetic, Cinematic, Halal, Meridian, Grademy, LamaTrader, Ragmedium, PrePitch, Rima, Forge, Quill). Return ONLY the corrected text. No explanation.' },
            { role: 'user', content: rawTranscript },
          ], { temperature: 0.1, max_tokens: 100 });
          if (correction && correction.length > 3) transcript = correction;
        } catch (e) { /* use raw transcript */ }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ transcript, text: transcript }));
    } catch (e) {
      console.error('[Voice] Transcribe error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/voice/think — returns cached Hermes-generated small talk audio
  if (req.method === 'GET' && req.url === '/api/voice/think') {
    (async () => {
      try {
        var cachePath = '/home/admin/.ragmedium/voice/smalltalk/cache.json';
        var clipIdx = 0;
        try {
          var cacheRaw = fs.readFileSync(cachePath, 'utf8');
          var cache = JSON.parse(cacheRaw);
          if (cache.clips && cache.clips.length > 0) {
            clipIdx = Math.floor(Math.random() * cache.clips.length);
            var clip = cache.clips[clipIdx];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ audio: clip.b64, text: clip.text, audio_mime: 'audio/mpeg' }));
            return;
          }
        } catch (e) { /* cache not ready */ }
        // Fallback: generate a quick clip on the fly
        var fallbackText = 'One moment, checking the empire status.';
        var tmpMp3 = path.join(TEMP_DIR, crypto.randomUUID() + '.mp3');
        await textToSpeech(fallbackText, tmpMp3);
        var audioB64 = fs.readFileSync(tmpMp3).toString('base64');
        try { fs.unlinkSync(tmpMp3); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ audio: audioB64, text: fallbackText, audio_mime: 'audio/mpeg' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // POST /api/voice/ask — single-shot: { audio_base64 OR text } → { transcript, ai_text, audio_b64 }
  if (req.method === 'POST' && req.url === '/api/voice/ask') {
    try {
      let body = '';
      for await (const c of req) body += c;
      const reqData = JSON.parse(body);
      let transcript = (reqData.text || '').trim();
      
      // Sentence detection: only pass real sentences to Hermes
      function isRealSentence(t) {
        if (!t || t.length < 6) return false;
        var words = t.trim().split(/\s+/);
        if (words.length < 3) return false;
        // Must contain at least one verb-like word
        var verbs = ['is','am','are','was','were','be','been','being','have','has','had','do','does','did',
          'will','would','can','could','shall','should','may','might','need','want','get','got','go','went',
          'make','made','take','took','tell','told','ask','asked','see','saw','know','knew','think','thought',
          'say','said','use','used','find','found','give','gave','work','worked','call','called',
          'whats','whats?','whos','wheres','hows','whys','im','youre','hes','shell','theyll','well',
          'dont','doesnt','didnt','wont','wouldnt','cant','couldnt','shouldnt','isnt','arent','wasnt',
          'wheres','whats','whos','hows','what','who','where','why','how','when'];
        // Strip common filler words before checking for verb
        var cleanWords = words.filter(function(w) { 
          return ['yo','hey','hi','hello','bro','man','dude','uh','um','ah','oh','ok','okay','bye','thanks','thank'].indexOf(w.toLowerCase()) < 0;
        });
        if (cleanWords.length < 2) return false;
        var foundVerb = cleanWords.some(function(w) { return verbs.indexOf(w.toLowerCase()) >= 0; });
        // Also pass if 3+ meaningful words exist (some questions might not have a standard verb)
        return foundVerb || cleanWords.length >= 3;
      }
      
      // Filler filter: skip short, gibberish, or nonsense transcripts
      const filler = ['thank you', 'thanks', 'okay', 'ok', 'bye', 'hello', 'hi', 'yeah',
        'uh', 'um', 'oh', 'hmm', 'nope', 'yep', 'welcome', "you're welcome", 'ah', 'ha', 'yo', 'hey'];
      if (transcript) {
        const t = transcript.trim().toLowerCase();
        const isGibberish = t.length < 4 || filler.includes(t) ||
          /^(.)\1{2,}$/.test(t) ||        // "aaaa", "hhhh"
          /^[^aeiou]{4,}$/.test(t) ||      // "sdkjfskdjf" (no vowels)
          t.split(/\s+/).length === 1 && t.length < 5; // single short word
        var f = t;
        if (isGibberish || (t.length >= 6 && !isRealSentence(t))) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ transcript: transcript, ai_response: '', audio: '' }));
          return;
        }
      }
      
      const ctxPromise = fetchEmpireContext();
      const persona = reqData.persona || "You are Jarvis, the Hermes agent — Amir's right-hand AI for the RAG Medium empire. You have live data below. Be natural, proactive, conversational. Ask follow-ups. Be concise. You're his COO on a voice call.";

      // If audio_base64 provided, transcribe first
      if (!transcript && reqData.audio_base64) {
        const audioBuf = Buffer.from(reqData.audio_base64, 'base64');
        const tmpIn = path.join(TEMP_DIR, crypto.randomUUID() + '.wav');
        const tmpWav = path.join(TEMP_DIR, crypto.randomUUID() + '.wav');
        fs.writeFileSync(tmpIn, audioBuf);
        try {
          await normalizeToWav(tmpIn, tmpWav);
        } catch {
          fs.copyFileSync(tmpIn, tmpWav);
        }
        transcript = await groqStt(fs.readFileSync(tmpWav), 'audio.wav');
        try { fs.unlinkSync(tmpIn); } catch {}
        try { fs.unlinkSync(tmpWav); } catch {}
      }

      if (!transcript) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No input (text or audio_base64 required)' }));
        return;
      }

      const empireCtx = await ctxPromise;
      
      // Build rich context string from live API data
      let contextNote = '[Empire Data] ';
      const inbox = empireCtx && empireCtx.inbox;
      if (inbox && inbox.total != null) {
        contextNote += 'Inbox: ' + inbox.total + ' emails (' + (inbox.by_category?.direct || '?') + ' direct, ' + (inbox.meetings || 0) + ' meetings). ';
        if (inbox.needs_attention) contextNote += inbox.needs_attention + ' need attention. ';
      }
      const rawProj = empireCtx && empireCtx.projects;
      const proj = rawProj && (Array.isArray(rawProj) ? rawProj : rawProj.projects);
      if (proj && Array.isArray(proj)) {
        contextNote += 'Projects (' + proj.length + ' active): ';
        proj.forEach(function(p) {
          if (p.status !== 'archived') {
            contextNote += p.name;
            const stats = p.stats || p;
            const tasks = stats.tasks_in_progress || stats.tasks_total ? 
              ' tasks:' + (stats.tasks_done || 0) + '/' + (stats.tasks_total || '?') + ' done' : '';
            const inProg = stats.tasks_in_progress ? ' in-progress:' + stats.tasks_in_progress : '';
            const planned = stats.tasks_planned ? ' planned:' + stats.tasks_planned : '';
            contextNote += ' [' + (p.status || 'active') + tasks + inProg + planned + ']';
            if (p.description) contextNote += ': ' + p.description.substring(0, 60);
            contextNote += '. ';
          }
        });
        contextNote = contextNote.replace(/, $/, '. ');
      }
      // Agent team status
      const agents = empireCtx && empireCtx.agents;
      if (agents && Array.isArray(agents)) {
        const active = agents.filter(a => a.status === 'active' || a.status === 'idle');
        const teams = {};
        active.forEach(a => {
          const teamName = a.team || a.division || a.agent_type || 'general';
          teams[teamName] = (teams[teamName] || 0) + 1;
        });
        contextNote += 'Team (' + active.length + ' agents online): ';
        for (const [team, count] of Object.entries(teams)) {
          contextNote += team + '=' + count + ', ';
        }
        contextNote = contextNote.replace(/, $/, '. ');
      }
      const tasks = empireCtx && empireCtx.tasks;
      if (tasks && Array.isArray(tasks)) {
        contextNote += 'Tasks: ' + tasks.length + ' running. ';
      }
      const brain = empireCtx && empireCtx.brain;
      if (brain) {
        contextNote += 'KB: ' + (brain.amir_training || 0) + ' chunks. ';
      }
      if (!contextNote.includes('Inbox') && !contextNote.includes('Projects') && !contextNote.includes('KB')) {
        contextNote += 'No live data available.';
      }
      console.log('[Voice] Context:', contextNote);
      
      // Check for proactive notifications
      let updatesNote = '';
      try {
        const updates = await checkForUpdates(empireCtx);
        if (updates.length > 0) {
          updatesNote = '\n[Action Items] ';
          updates.forEach(function(u) {
            updatesNote += '[' + u.severity + '] ' + u.message + ' ';
          });
          console.log('[Voice] Updates:', updates.length, 'items');
        }
      } catch (e) { console.warn('[Voice] Updates check failed:', e.message); }

      // Build messages array: persona + context + updates + history + current question
      const history = (reqData.history || []).slice(-10);
      const messages = [
        { role: 'system', content: persona },
        { role: 'user', content: 'Here is the current verified data from your empire:\n' + contextNote + updatesNote },
      ];
      // Insert conversation history (skip oldest to keep context fresh)
      for (const h of history) {
        messages.push({ role: h.role || 'user', content: h.content });
      }
      messages.push({ role: 'user', content: transcript });
      
      console.log('[Voice] History:', history.length, 'turns');
      let aiResponse;
      try {
        aiResponse = await hermesChat(messages);
      } catch (e) {
        console.error('[Voice] Hermes agent failed:', e.message);
        aiResponse = 'Apologies Amir, I had a glitch. One moment.';
      }

      const cleanResponse = sanitizeForTTS(aiResponse);

      // TTS
      const tmpMp3 = path.join(TEMP_DIR, crypto.randomUUID() + '.mp3');
      await textToSpeech(cleanResponse, tmpMp3);
      const audioB64 = fs.readFileSync(tmpMp3).toString('base64');
      try { fs.unlinkSync(tmpMp3); } catch {}

      // Log call
      const callEntry = {
        timestamp: new Date().toISOString(),
        transcript,
        ai_response: aiResponse,
        persona: persona.substring(0, 80),
      };
      logCall(callEntry);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        transcript,
        ai_response: cleanResponse,
        audio: audioB64,
        audio_mime: 'audio/mpeg',
      }));
    } catch (e) {
      console.error('[Voice] Ask error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end();
});

// ===== WebSocket for streaming =====
const wss = new WebSocket.Server({ server: httpServer });
const sessions = new Map();

wss.on('connection', (ws) => {
  const sid = crypto.randomUUID();
  sessions.set(sid, {
    startTime: Date.now(),
    chunks: [],
    transcript: '',
    audioChunks: [],
    processing: false,
    persona: 'You are Jarvis, Amir\'s AI assistant. Concise, direct, and helpful.',
  });
  ws.send(JSON.stringify({ type: 'connected', sessionId: sid, message: 'Connected' }));
  console.log(`[Voice] Session ${sid.substring(0, 8)} connected`);

  ws.on('message', async (data) => {
    const session = sessions.get(sid);
    if (!session) return;

    if (Buffer.isBuffer(data) && data.length > 100) {
      // Audio chunk - assume opus or raw pcm (browser side handles encoding)
      session.audioChunks.push(data);
      session.chunks.push(data);
    } else if (typeof data === 'string' || (Buffer.isBuffer(data) && data[0] === 0x7b)) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }

      if (msg.type === 'audio_end' && !session.processing) {
        session.processing = true;
        try {
          const buffer = Buffer.concat(session.chunks);
          if (buffer.length < 100) {
            ws.send(JSON.stringify({ type: 'error', error: 'No audio captured' }));
            session.processing = false;
            return;
          }
          const tmpIn = path.join(TEMP_DIR, sid + '_in.wav');
          const tmpWav = path.join(TEMP_DIR, sid + '_norm.wav');
          fs.writeFileSync(tmpIn, buffer);
          try { await normalizeToWav(tmpIn, tmpWav); }
          catch { fs.copyFileSync(tmpIn, tmpWav); }
          const normalized = fs.readFileSync(tmpWav);

          ws.send(JSON.stringify({ type: 'status', status: 'transcribing' }));
          const transcript = await groqStt(normalized, 'audio.wav');
          ws.send(JSON.stringify({ type: 'transcript', text: transcript }));
          session.transcript = transcript;

          ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));
          let aiResponse;
          try {
            aiResponse = await hermesChat([
              { role: 'system', content: session.persona },
              { role: 'user', content: transcript },
            ]);
          } catch (e) {
            console.warn('[Voice] HermesChat WS failed, Groq fallback:', e.message);
            aiResponse = await groqChat([
              { role: 'system', content: session.persona },
              { role: 'user', content: transcript },
            ]);
          }
          ws.send(JSON.stringify({ type: 'ai_text', text: aiResponse }));

          ws.send(JSON.stringify({ type: 'status', status: 'speaking' }));
          const tmpMp3 = path.join(TEMP_DIR, sid + '.mp3');
          await textToSpeech(sanitizeForTTS(aiResponse), tmpMp3);
          const audioBuf = fs.readFileSync(tmpMp3);
          ws.send(audioBuf);
          ws.send(JSON.stringify({ type: 'audio_end' }));

          logCall({
            timestamp: new Date().toISOString(),
            sessionId: sid,
            transcript,
            ai_response: aiResponse,
            mode: 'ws',
          });
          session.audioChunks = []; session.chunks = [];
        } catch (e) {
          console.error(`[Voice] WS error:`, e.message);
          ws.send(JSON.stringify({ type: 'error', error: e.message }));
        } finally {
          session.processing = false;
        }
      } else if (msg.type === 'config' && msg.persona) {
        session.persona = msg.persona;
      }
    }
  });

  ws.on('close', () => {
    sessions.delete(sid);
    console.log(`[Voice] Session ${sid.substring(0, 8)} disconnected`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Voice] Server running on http://0.0.0.0:${PORT}`);
  console.log(`[Voice] Groq: ${GROQ_KEY ? 'configured ✓' : 'MISSING'}`);
  console.log(`[Voice] Call log: ${CALL_LOG_PATH}`);
});
