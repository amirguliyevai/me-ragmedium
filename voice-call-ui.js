/**
 * Hands-Free Voice Calling UI
 *
 * Native, call-style experience:
 * - Floating call widget (bottom-right)
 * - Real mic capture via getUserMedia
 * - Voice Activity Detection (energy-based)
 * - Auto-flush when user stops talking (1.2s silence)
 * - Single-out voice channel: noise suppression + echo cancellation ON
 * - Live transcript with timestamps
 * - Call log persisted to server
 *
 * Endpoints:
 *  - POST /ws/voice/api/voice/ask  - multipart text-only OR text+
 *  - WS   /ws/voice                 - bidirectional streaming
 */

(function () {
  'use strict';

  // ============ STATE ============
  let callActive = false;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioContext = null;
  let analyser = null;
  let vadRafId = null;
  let silenceMs = 0;
  let recording = false;
  let currentCallId = null;
  let transcript = []; // [{role:'user'|'ai', text, ts}]

  let speechStartedAt = 0;        // ms timestamp when current speech first crossed threshold
  const noiseFloor = { rms: 0.012 };// adaptive ambient noise RMS
  const SILENCE_FLUSH_MS = 1000; // 1.4s silence after speech ends
  const MIN_SPEECH_MS = 200;        // must speak continuously for 280ms before recording
  const SPEECH_RMS_MULT = 1.5;      // speech must be 70% louder than ambient
  const MIN_BLOB_BYTES = 2000  // 2KB min;      // 8KB minimum (audio/webm header is ~1KB, real speech is bigger)
  const NOISE_FLOOR_MAX = 0.05;     // never trust ambient above this (a real loud room)
  const SAMPLE_RATE = 16000;

  

  // Small talk filler - rotating phrases while AI thinks, avoids dead air
  const fillerPhrases = [
    "Let me pull that up...",
    "Checking your empire data...",
    "Looking into it...",
    "Querying your knowledge base...",
    "Processing your request...",
  ];
  
  // Pre-generated thinking audio clips (en-GB-RyanNeural, British male voice)
  var THINKING_CLIPS = [
    { phrase: "Let me check the latest stats for you.", audio: "FALLBACK_THINKING" },
    { phrase: "One moment, I am pulling up the data.", audio: "FALLBACK_THINKING" },
    { phrase: "Looking into that now, give me a second.", audio: "FALLBACK_THINKING" },
    { phrase: "Let me think about that.", audio: "FALLBACK_THINKING" },
    { phrase: "Processing your request, just a moment.", audio: "FALLBACK_THINKING" },
  ];
  var thinkingClipIdx = 0;
  var thinkingAudio = null;
  
  function playThinkingClip() {
    if (!callActive || !THINKING_CLIPS || !THINKING_CLIPS.length) return;
    var clip = THINKING_CLIPS[thinkingClipIdx % THINKING_CLIPS.length];
    thinkingClipIdx++;
    setSubtitle(clip.phrase);
  }
  
  // Continuous small talk buffer — fetches useful info audio from server
  var smallTalkAudio = null;
  var smallTalkPlaying = false;
  
  function startSmallTalk() {
    if (!callActive || smallTalkPlaying) return;
    smallTalkPlaying = true;
    playSmallTalkClip();
  }
  
  function playSmallTalkClip() {
    if (!callActive || !smallTalkPlaying) return;
    fetch('/ws/voice/api/voice/think').then(function(r) { return r.json(); }).then(function(data) {
      if (!callActive || !smallTalkPlaying) return;
      if (data.audio) {
        if (currentAudio && smallTalkAudio) {
          try { currentAudio.pause(); currentAudio.src = ''; } catch(e) {}
        }
        var audio = new Audio('data:audio/mpeg;base64,' + data.audio);
        currentAudio = audio;
        smallTalkAudio = audio;
        setSubtitle(data.text || 'thinking...');
        audio.play().catch(function() {});
        audio.onended = function() {
          if (currentAudio === audio) {
            currentAudio = null;
            smallTalkAudio = null;
            if (callActive && smallTalkPlaying) {
              setTimeout(playSmallTalkClip, 500);
            }
          }
        };
      }
    }).catch(function() {});
  }
  
  function stopSmallTalk() {
    smallTalkPlaying = false;
    if (smallTalkAudio) {
      try { smallTalkAudio.pause(); smallTalkAudio.src = ''; } catch(e) {}
      smallTalkAudio = null;
    }
  }
  
  function stopThinking() {
    thinkingAudio = null;
  }
  
  var fillerInterval = null;
  let currentAudio = null;  // track for interruption

  function startFiller() {
    let i = 0;
    fillerInterval = setInterval(() => {
      if (!callActive) { stopFiller(); return; }
      const sub = document.getElementById("dc-call-subtitle");
      if (sub) sub.textContent = fillerPhrases[i % fillerPhrases.length];
      i++;
    }, 2500);
  }

  function stopFiller() {
    if (fillerInterval) { clearInterval(fillerInterval); fillerInterval = null; }
  }

// ============ DOM ELEMENTS ============
  function el(tag, opts, ...children) {
    const e = document.createElement(tag);
    if (opts) {
      if (opts.id) e.id = opts.id;
      if (opts.cls) e.className = opts.cls;
      if (opts.style) e.setAttribute('style', opts.style);
      if (opts.text) e.textContent = opts.text;
      if (opts.html) e.innerHTML = opts.html;
      if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
      if (opts.on) for (const [k, fn] of Object.entries(opts.on)) e.addEventListener(k, fn);
    }
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else e.appendChild(c);
    }
    return e;
  }

  function buildUI() {
    if (document.getElementById('dc-call-widget')) return;
    const root = document.createElement('div');
    root.id = 'dc-call-widget';
    root.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 200;
      width: 380px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      font-family: 'IBM Plex Sans', sans-serif;
    `;

    // The Call FAB (initial state)
    const fab = el('button', {
      id: 'dc-call-fab',
      style: `
        appearance: none;
        cursor: pointer;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #18e0ff, #ff5cc8);
        border: none;
        color: white;
        font-size: 24px;
        box-shadow: 0 8px 28px rgba(0,0,0,0.5), 0 0 22px rgba(24,224,255,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
      `,
      html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
      on: { click: startCall }
    });

    // The Call Widget Panel (expanded)
    const panel = el('div', {
      id: 'dc-call-panel',
      style: `
        display: none;
        flex-direction: column;
        background: rgba(10, 14, 23, 0.98);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(47, 224, 138, 0.4);
        border-radius: 16px;
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(47, 224, 138, 0.18);
        overflow: hidden;
      `,
    });

    panel.innerHTML = `
      <div style="padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 12px; background: linear-gradient(180deg, rgba(47,224,138,0.1), transparent);">
        <div id="dc-call-status-dot" style="width: 10px; height: 10px; border-radius: 50%; background: #2fe08a; box-shadow: 0 0 8px #2fe08a;"></div>
        <div style="flex: 1;">
          <div id="dc-call-title" style="font-family: 'Chakra Petch', sans-serif; font-weight: 700; font-size: 14px; color: #eaf6ff; letter-spacing: 0.5px;">Call Live · 00:00</div>
          <div id="dc-call-subtitle" style="font-size: 11px; color: #6b7a90; margin-top: 2px;">Listening...</div>
        </div>
        <button id="dc-call-mute" style="background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #eaf6ff; cursor: pointer; padding: 5px 10px; border-radius: 8px; font-size: 11px; font-family: 'IBM Plex Mono';">🎙 MUTE</button>
        <button id="dc-call-end" style="background: rgba(255,68,68,0.2); border: 1px solid #ff4444; color: #ff4444; cursor: pointer; padding: 5px 10px; border-radius: 8px; font-size: 11px; font-family: 'IBM Plex Mono';">END</button>
      </div>

      <div id="dc-call-transcript" style="flex: 1; overflow-y: auto; padding: 14px 18px; min-height: 240px; max-height: 360px; font-size: 13px; line-height: 1.55; color: #cbd5e1;">
        <div style="color: #5b6b82; text-align: center; padding: 30px 0; font-family: 'IBM Plex Mono'; font-size: 11px;">
          <div style="font-size: 24px; margin-bottom: 10px;">📞</div>
          call started · speak naturally
        </div>
      </div>

      <div id="dc-call-input-area" style="padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; gap: 8px;">
        <input id="dc-call-text-input" placeholder="type a message..." style="flex: 1; padding: 8px 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); color: #eaf6ff; font-family: 'IBM Plex Sans'; font-size: 13px; border-radius: 8px; outline: none;">
        <button id="dc-call-send-text" style="padding: 8px 12px; background: rgba(24,224,255,0.15); color: #18e0ff; border: 1px solid #18e0ff; border-radius: 8px; cursor: pointer; font-size: 11px;">Send</button>
      </div>

      <div style="padding: 8px 18px; border-top: 1px solid rgba(255,255,255,0.04); font-family: 'IBM Plex Mono'; font-size: 9px; color: #5b6b82; display: flex; align-items: center; gap: 8px;">
        <div id="dc-call-vad-bar" style="flex: 1; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
          <div id="dc-call-vad-fill" style="height: 100%; width: 0%; background: linear-gradient(90deg, #2fe08a, #ff5cc8); transition: width 0.05s;"></div>
        </div>
        <div id="dc-call-latency">vad: idle</div>
      </div>
    `;

    root.appendChild(panel);
    root.appendChild(fab);
    document.body.appendChild(root);

    // Wire panel buttons
    const endBtn = document.getElementById('dc-call-end');
    endBtn.addEventListener('click', endCall);

    const muteBtn = document.getElementById('dc-call-mute');
    let muted = false;
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      if (mediaStream) {
        mediaStream.getAudioTracks().forEach(t => t.enabled = !muted);
      }
      muteBtn.textContent = muted ? '🔇 UNMUTE' : '🎙 MUTE';
      muteBtn.style.color = muted ? '#ffb020' : '#eaf6ff';
    });

    // Text input
    const textInput = document.getElementById('dc-call-text-input');
    const sendBtn = document.getElementById('dc-call-send-text');
    sendBtn.addEventListener('click', () => sendText());
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendText();
    });

    function sendText() {
      const msg = textInput.value.trim();
      if (!msg) return;
      textInput.value = '';
      addTranscript('user', msg);
      askServer({ text: msg, persona: 'You are Jarvis, a concise AI assistant on a voice call. Keep replies under 60 words.' });
    }

    // Expose handler for "voice takes you to slack channel" / clicking from agent popup
    window.dcSendVoiceCallMessage = sendText;

    // ESC closes the call
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && callActive) endCall();
    });
  }

  // ============ TRANSCRIPT UI ============
  function addTranscript(role, text, audioBase64) {
    const box = document.getElementById('dc-call-transcript');
    if (!box) return;
    transcript.push({ role, text, ts: Date.now() });

    const emptyState = box.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const msg = el('div', {
      style: `margin-bottom: 10px; padding: 10px 14px; border-radius: 10px; max-width: 90%; animation: dcSlide .3s ease; ${role === 'user' ? 'background: rgba(96,165,250,0.12); margin-left: auto; border-left: 3px solid #60a5fa;' : 'background: rgba(47,224,138,0.12); border-left: 3px solid #2fe08a;'}`
    });
    const meta = el('div', {
      style: 'font-size: 9px; color: #5b6b82; margin-bottom: 4px; font-family: "IBM Plex Mono"; letter-spacing: 0.08em;'
    });
    meta.textContent = role === 'user' ? 'YOU' : 'JARVIS';
    const body = el('div', { style: 'color: #eaf6ff;' });
    body.textContent = text;
    msg.appendChild(meta);
    msg.appendChild(body);

    if (audioBase64) {
      const audio = el('audio', {
        attrs: { controls: '', autoplay: 'autoplay' },
        style: 'display: block; margin-top: 8px; width: 100%; height: 32px;'
      });
      audio.src = 'data:audio/mpeg;base64,' + audioBase64;
      msg.appendChild(audio);
      // Track for interruption
      if (currentAudio) { try { currentAudio.pause(); currentAudio.src = ''; } catch(e) {} }
      currentAudio = audio;
      audio.play().catch(e => console.warn('audio play failed:', e));
      // Auto-clean on ended
      audio.onended = function() { if (currentAudio === audio) currentAudio = null; };
    }

    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
  }

  // ============ VAD + RECORDING ============
  async function startCall() {
    if (callActive) return;
    buildUI();

    document.getElementById('dc-call-panel').style.display = 'flex';
    document.getElementById('dc-call-fab').style.display = 'none';
    callActive = true;
    currentCallId = Date.now().toString(36);
    transcript = [];

    setCallStatus('connecting', 'connecting...');
    setSubtitle('connecting...');

    try {
      // Single-out voice: noise suppression + echo cancellation on
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,  // higher sample rate for better STT
        }
      });

      // AudioContext for VAD
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      const source = audioContext.createMediaStreamSource(mediaStream);
      
      // Noise gate: high-pass filter @ 80Hz cuts rumble, compressor smooths peaks
      const hpFilter = audioContext.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.value = 80;
      
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -30;
      compressor.knee.value = 20;
      compressor.ratio.value = 8;
      
      source.connect(hpFilter);
      hpFilter.connect(compressor);
      
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      compressor.connect(analyser);

      // Set up MediaRecorder for the audio chunks when VAD detects speech
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/mp4';
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType, audioBitsPerSecond: 48000 });  // higher bitrate
      window.__mediaRecorderChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) window.__mediaRecorderChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        // Build a single blob from chunks and send to server
        const blob = new Blob(window.__mediaRecorderChunks, { type: mediaRecorder.mimeType });
        window.__mediaRecorderChunks = [];
        if (blob.size >= MIN_BLOB_BYTES) {
          // Verify blob actually contains speech by decoding
          verifyAndSendBlob(blob);
        } else {
          console.log('[VAD] Discarded tiny blob:', blob.size, 'bytes');
          setSubtitle('listening...');
          setCallStatus('live', 'live');
        }
      };

      startRecorder();
      startVAD();

      // Start UI timer
      setCallStatus('live', 'live · 00:00');
      window.__dcCallStartTime = Date.now();
      window.__dcCallTimer = setInterval(updateCallDuration, 1000);
      updateCallDuration();

      addTranscript('ai', '🎙 Connected. Speak naturally — I\'ll stop talking when you do, and reply when you start.');

    } catch (e) {
      console.error('getUserMedia failed:', e);
      setSubtitle('mic denied');
      addTranscript('ai', '⚠ Microphone access was denied or unavailable. Click the mic icon in the address bar to grant permission, or use the text input below.');
      // Don't actually end the call — let user type
    }
  }

  function startRecorder() {
    if (!mediaRecorder || mediaRecorder.state === 'recording') return;
    window.__mediaRecorderChunks = [];
    mediaRecorder.start();
    recording = true;
  }

  function stopRecorder() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    mediaRecorder.stop();
    recording = false;
  }

  function startVAD() {
    if (!analyser) return;
    var buf = new Float32Array(analyser.fftSize);
    var VAD_THRESH = 0.035;  // higher — filters random sounds
    var vadTicksAbove = [];

    function tick() {
      if (!callActive) return;
      analyser.getFloatTimeDomainData(buf);
      var rms = 0;
      for (var i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      
      // Rolling 10-tick window: need 7/10 above threshold (filters transient noise)
      vadTicksAbove.push(rms > VAD_THRESH ? 1 : 0);
      if (vadTicksAbove.length > 10) vadTicksAbove.shift();
      var sustainedSpeech = vadTicksAbove.reduce(function(a,b) { return a + b; }, 0) >= 7;
      var isSpeech = sustainedSpeech;

      const fill = document.getElementById('dc-call-vad-fill');
      const latencyEl = document.getElementById('dc-call-latency');
      if (fill) fill.style.width = Math.min(rms * 500, 100) + '%';
      if (latencyEl) latencyEl.textContent = 'vad: ' + (isSpeech ? 'speaking' : 'silent') + ' rms=' + rms.toFixed(4);

      if (isSpeech) {
        // INTERRUPT: stop any playing audio when user starts speaking
        if (currentAudio) {
          try { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; } catch(e) {}
          stopSmallTalk();
          stopFiller();
          setSubtitle('interrupted - listening');
        }
        if (!recording) {
          if (speechStartedAt === 0) speechStartedAt = Date.now();
          else if (Date.now() - speechStartedAt >= MIN_SPEECH_MS) {
            startRecorder();
            setSubtitle('listening - you are speaking');
            setCallStatus('live', 'speaking');
          }
        }
        silenceMs = 0;
      } else {
        speechStartedAt = 0;
        if (recording) {
          silenceMs += 16;
          if (silenceMs >= SILENCE_FLUSH_MS) {
            setSubtitle('processing...');
            setCallStatus('thinking', 'processing');
            stopRecorder();
            silenceMs = 0;
          }
        }
      }
      vadRafId = requestAnimationFrame(tick);
    }
    tick();
  }


  
  // Decode audio blob, verify RMS, then send if it actually contains speech
  
  async function verifyAndSendBlob(blob) {
    // Send everything — Groq Whisper handles silence
    console.log('[VAD] sending blob:', blob.size, 'bytes');
    sendAudioBlob(blob);
  }


async function sendAudioBlob(blob) {
    // Send as JSON with audio_base64 — avoids multipart parsing bugs
    try {
      setCallStatus('thinking', 'transcribing');
      startSmallTalk();
      const arrayBuf = await blob.arrayBuffer();
      const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));

      const res = await fetch('/ws/voice/api/voice/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_base64: audioBase64,
          audio_mime: blob.type || 'audio/webm',
          persona: 'You are Jarvis, Amir\'s AI on a hands-free voice call. Be concise (under 60 words). Be direct. No fluff.',
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        addTranscript('ai', '⚠ Server error: ' + err);
        setSubtitle('listening...');
        setCallStatus('live', 'live');
        return;
      }
      const data = await res.json();
      stopSmallTalk();
      const transcript = (data.transcript || '').trim();
      if (!transcript) {
        setSubtitle('didn\'t catch that — try again');
        setCallStatus('live', 'live');
        return;
      }
      addTranscript('user', transcript);
      stopSmallTalk();
      addTranscript('ai', data.ai_response, data.audio);
      // Chain small talk to resume AFTER response audio finishes
      setSubtitle('listening...');
      setCallStatus('live', 'live');
      var audios = document.querySelectorAll('#dc-call-transcript audio');
      var lastAudio = audios[audios.length - 1];
      if (lastAudio) {
        lastAudio.onended = function() {
          if (callActive) {
            setTimeout(function() { if (callActive) startSmallTalk(); }, 1000);
          }
        };
      }
    } catch (e) {
      console.error('Send error:', e);
      addTranscript('ai', '⚠ Error: ' + e.message);
      setSubtitle('listening...');
    }
  }

  async function askServer({ text, persona }) {
    setCallStatus('thinking', 'thinking...');
    setSubtitle('thinking...');
    startSmallTalk();
    try {
      // Build conversation history from this session
      const history = transcript.slice(-10).map(function(t) {
        return { role: t.role === 'user' ? 'user' : 'assistant', content: t.text };
      });
      const res = await fetch('/ws/voice/api/voice/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          history: history,
          persona: persona || 'You are Jarvis, Amir\'s AI on a hands-free voice call. Be concise (under 60 words). Be direct. No fluff.',
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        addTranscript('ai', '⚠ ' + err);
        setSubtitle('listening...');
        return;
      }
      const data = await res.json();
      addTranscript('ai', data.ai_response, data.audio);
      setSubtitle('listening...');
      setCallStatus('live', 'live · 00:00');
      // Auto-resume mic after audio playback
      const audios = document.querySelectorAll('#dc-call-transcript audio');
      const lastAudio = audios[audios.length - 1];
      if (lastAudio) {
        lastAudio.onended = () => {
          if (callActive) {
            setCallStatus('live', 'live');
            setSubtitle('listening...');
            setTimeout(function() { if (callActive) startSmallTalk(); }, 2000);
          }
        };
      }
    } catch (e) {
      console.error('Ask error:', e);
      addTranscript('ai', '⚠ Error: ' + e.message);
    }
  }

  function stopThinking() { if (currentAudio) { try { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; } catch(e) {} } }
  function endCall() {
    callActive = false;
    stopSmallTalk();
    if (currentAudio) { try { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; } catch(e) {} }
    stopFiller();
    stopThinking();
    if (vadRafId) cancelAnimationFrame(vadRafId);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch (e) {}
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
    }
    if (audioContext) {
      try { audioContext.close(); } catch (e) {}
    }
    if (window.__dcCallTimer) clearInterval(window.__dcCallTimer);
    mediaStream = null;
    mediaRecorder = null;
    audioContext = null;
    analyser = null;

    const panel = document.getElementById('dc-call-panel');
    const fab = document.getElementById('dc-call-fab');
    if (panel) panel.style.display = 'none';
    if (fab) fab.style.display = 'flex';

    addTranscript('ai', `Call ended. ${transcript.length} exchanges in this session. Refresh to start a new one.`);
  }

  function setCallStatus(state, label) {
    if (state === "thinking") { startFiller(); } else { stopFiller(); }
    const dot = document.getElementById("dc-call-status-dot");
    const title = document.getElementById("dc-call-title");
    if (!dot || !title) return;
    const colors = {
      live: '#2fe08a', live_glow: 'rgba(47,224,138,0.6)',
      connecting: '#ffb020',
      thinking: '#18e0ff',
      speaking: '#ff5cc8',
      error: '#ff4444',
    };
    const c = colors[state] || colors.live;
    dot.style.background = c;
    dot.style.boxShadow = `0 0 8px ${c}`;
    if (title) title.textContent = label;
  }

  function setSubtitle(text) {
    const sub = document.getElementById('dc-call-subtitle');
    if (sub) sub.textContent = text;
  }

  function updateCallDuration() {
    if (!callActive) return;
    const dur = Math.floor((Date.now() - window.__dcCallStartTime) / 1000);
    const mm = String(Math.floor(dur / 60)).padStart(2, '0');
    const ss = String(dur % 60).padStart(2, '0');
    const title = document.getElementById('dc-call-title');
    if (title && title.textContent && (title.textContent.includes('Call Live') || title.textContent.includes('live') || title.textContent.includes('CONNECTED') || title.textContent.includes('STARTING') || title.textContent.includes('THINKING') || title.textContent.includes('SPEAKING'))) {
      title.textContent = 'Call Live · ' + mm + ':' + ss;
    }
  }

  function setMuted(muted) {
    if (mediaStream) mediaStream.getAudioTracks().forEach(t => t.enabled = !muted);
  }

  // ============ EXPOSE ============
  // Initial UI build on script load — but FAB ONLY if not already in a call
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(buildUI, 100);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(buildUI, 100));
  }

  // ============ GLOBAL API ============
  window.dcVoice = {
    startCall,
    endCall,
    setMuted,
    isActive: () => callActive,
    addTranscript,
    askServer,
    verifyAndSendBlob,
    sendAudioBlob,
  };



  // Expose testing helpers
  if (typeof verifyAndSendBlob === 'function') window.__dcVerify = verifyAndSendBlob;
  if (typeof sendAudioBlob === 'function') window.__dcSend = sendAudioBlob;
})();
