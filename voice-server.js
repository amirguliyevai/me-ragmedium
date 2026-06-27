#!/usr/bin/env node
/**
 * Voice Call WebSocket Server
 * Port: 8777
 * Receives audio from PWA, processes through STT -> AI -> TTS, sends back audio
 */
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = 8777;
const TEMP_DIR = '/tmp/voice-sessions';
const CLAUDE_API_KEY = require('/home/admin/.openclaw/credentials/claude-api-key.json').api_key;
const CLAUDE_URL = 'https://api-router.opustokens.workers.dev/v1/chat/completions';

// Ensure temp dir exists
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// HTTP server for health checks
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', connections: sessions.size }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// WebSocket server
const wss = new WebSocket.Server({ server: httpServer });

const sessions = new Map();

wss.on('connection', (ws, req) => {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    chunks: [],
    startTime: Date.now(),
    processing: false
  });
  console.log(`[Voice] Session connected: ${sessionId}`);

  // Send welcome
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  ws.on('message', async (data) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Check if it's a text control message
    if (typeof data === 'string' || (Buffer.isBuffer(data) && data[0] === 0x7b)) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'audio_end' && !session.processing) {
          session.processing = true;
          await processAudioSession(ws, sessionId, session);
          session.processing = false;
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        } else if (msg.type === 'text') {
          // Direct text message (no voice needed)
          await processTextMessage(ws, sessionId, session, msg.text);
        }
        return;
      } catch (e) {
        // Not JSON, treat as binary audio chunk
      }
    }

    // Binary audio chunk
    if (Buffer.isBuffer(data) && data.length > 100) {
      session.chunks.push(data);
    }
  });

  ws.on('close', () => {
    console.log(`[Voice] Session disconnected: ${sessionId}`);
    cleanupSession(sessionId);
    sessions.delete(sessionId);
  });

  ws.on('error', (err) => {
    console.error(`[Voice] Session error: ${err.message}`);
    sessions.delete(sessionId);
  });
});

async function processAudioSession(ws, sessionId, session) {
  const inputPath = path.join(TEMP_DIR, `${sessionId}_input.webm`);
  const mp3Path = path.join(TEMP_DIR, `${sessionId}_input.mp3`);
  const responsePath = path.join(TEMP_DIR, `${sessionId}_response.mp3`);

  try {
    // Send status
    ws.send(JSON.stringify({ type: 'status', status: 'transcribing', message: 'Hearing you...' }));

    // Write audio chunks to file
    const buffer = Buffer.concat(session.chunks);
    fs.writeFileSync(inputPath, buffer);
    session.chunks = [];

    // Convert WebM to MP3 (16kHz mono for Whisper)
    await runFFmpeg(inputPath, mp3Path);

    // Transcribe with faster-whisper (local)
    const transcript = await transcribe(mp3Path);
    if (!transcript || transcript.trim().length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: "I couldn't hear that. Try again?" }));
      return;
    }

    ws.send(JSON.stringify({ type: 'transcript', text: transcript }));

    // Get AI response
    ws.send(JSON.stringify({ type: 'status', status: 'thinking', message: 'Thinking...' }));
    const aiResponse = await getAIResponse(transcript);
    ws.send(JSON.stringify({ type: 'ai_text', text: aiResponse }));

    // Generate speech
    ws.send(JSON.stringify({ type: 'status', status: 'speaking', message: 'Responding...' }));
    await textToSpeech(aiResponse, responsePath);

    // Send audio back
    const audioBuffer = fs.readFileSync(responsePath);
    ws.send(audioBuffer);
    ws.send(JSON.stringify({ type: 'audio_end', message: 'Done' }));

    console.log(`[Voice] Processed: "${transcript}" -> "${aiResponse.substring(0, 50)}..."`);

  } catch (err) {
    console.error(`[Voice] Processing error: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: 'Processing failed. Try again?' }));
  } finally {
    cleanupFiles([inputPath, mp3Path, responsePath]);
  }
}

async function processTextMessage(ws, sessionId, session, text) {
  try {
    ws.send(JSON.stringify({ type: 'transcript', text }));
    ws.send(JSON.stringify({ type: 'status', status: 'thinking', message: 'Thinking...' }));
    const aiResponse = await getAIResponse(text);
    ws.send(JSON.stringify({ type: 'ai_text', text: aiResponse }));
    ws.send(JSON.stringify({ type: 'audio_end', message: 'Done' }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: 'Processing failed' }));
  }
}

async function transcribe(audioPath) {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [
      '-c',
      `
import sys
try:
    from faster_whisper import WhisperModel
    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, info = model.transcribe("${audioPath}", language="en")
    text = " ".join([s.text for s in segments])
    print(text.strip())
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    print("")
`
    ], { timeout: 120000 });

    let output = '';
    let error = '';

    python.stdout.on('data', (data) => { output += data.toString(); });
    python.stderr.on('data', (data) => { error += data.toString(); });

    python.on('close', (code) => {
      if (code !== 0 && !output.trim()) {
        reject(new Error(error || 'Transcription failed'));
      } else {
        resolve(output.trim());
      }
    });
  });
}

async function getAIResponse(message) {
  const response = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CLAUDE_API_KEY}`
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: 'You are Amir\'s AI assistant. Be concise, helpful, and direct. Respond in 1-3 sentences unless asked for more detail.'
        },
        { role: 'user', content: message }
      ]
    })
  });

  if (!response.ok) {
    return "I'm having trouble connecting right now. Try again in a moment.";
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function textToSpeech(text, outputPath) {
  return new Promise((resolve, reject) => {
    // Truncate long text for TTS
    const fs = require('fs');
    const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
    const pythonCode = `
import asyncio
import edge_tts, sys, json

async def main():
    data = json.loads(sys.argv[1])
    text = data["text"]
    output = data["output"]
    communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
    await communicate.save(output)
    print("OK")

asyncio.run(main())
`;
    fs.writeFileSync('/tmp/_tts_script.py', pythonCode);
    const python = spawn('python3', ['/tmp/_tts_script.py', JSON.stringify({text: truncated, output: outputPath})], { timeout: 30000 });

    python.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('TTS failed'));
    });
  });
}

function runFFmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'mp3', output, '-y'
    ], { timeout: 30000 });

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('FFmpeg conversion failed'));
    });
  });
}

function cleanupSession(sessionId) {
  const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(sessionId));
  files.forEach(f => {
    try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch(e) {}
  });
}

function cleanupFiles(files) {
  files.forEach(f => {
    try { fs.unlinkSync(f); } catch(e) {}
  });
}

// Cleanup old files every 5 minutes
setInterval(() => {
  const now = Date.now();
  const files = fs.readdirSync(TEMP_DIR);
  files.forEach(f => {
    const stat = fs.statSync(path.join(TEMP_DIR, f));
    if (now - stat.mtimeMs > 3600000) { // 1 hour
      try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch(e) {}
    }
  });
}, 300000);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Voice] Server listening on port ${PORT}`);
});

console.log(`[Voice] WebSocket voice server ready`);
