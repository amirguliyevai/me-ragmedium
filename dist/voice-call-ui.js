/**
 * Voice Call UI Injector
 * Adds floating "Call AI" button and call overlay to dashboard
 */
(function() {
  let voiceClient = null;
  let callActive = false;

  const STYLES = `
.voice-fab{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#18e0ff,#ff5cc8);border:none;cursor:pointer;z-index:1000;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(24,224,255,.4);transition:.2s}
.voice-fab:hover{transform:scale(1.1)}
.voice-fab.active{background:linear-gradient(135deg,#ff4466,#ffb020);animation:pulse-fab 1.5s infinite}
.voice-fab svg{width:24px;height:24px;fill:#fff}
@keyframes pulse-fab{0%,100%{box-shadow:0 4px 20px rgba(24,224,255,.4)}50%{box-shadow:0 4px 30px rgba(24,224,255,.7)}}

.voice-overlay{display:none;position:fixed;inset:0;z-index:2000;background:rgba(5,7,13,.95);backdrop-filter:blur(8px);align-items:center;justify-content:center;flex-direction:column}
.voice-overlay.open{display:flex}
.voice-call-box{background:#0a0e17;border:1px solid #1a2438;border-radius:16px;padding:32px;width:360px;max-width:90vw;text-align:center}
.voice-avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#0f1520,#1a2438);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:32px;border:2px solid #18e0ff}
.voice-avatar.listening{border-color:#2fe08a;animation:pulse-avatar 1s infinite}
.voice-avatar.speaking{border-color:#ff5cc8;animation:pulse-avatar .5s infinite}
@keyframes pulse-avatar{0%,100%{box-shadow:0 0 0 0 rgba(47,224,138,.4)}50%{box-shadow:0 0 0 15px rgba(47,224,138,0)}}
.voice-status{font-size:14px;color:#cfe6f5;margin-bottom:8px;min-height:20px}
.voice-transcript{font-size:11px;color:#5b6b82;max-height:120px;overflow-y:auto;margin-bottom:20px;text-align:left;padding:8px;background:rgba(255,255,255,.03);border-radius:8px}
.voice-end-btn{width:48px;height:48px;border-radius:50%;background:#ff4466;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;margin:0 auto;transition:.2s}
.voice-end-btn:hover{background:#ff6688;transform:scale(1.1)}
.voice-end-btn svg{width:20px;height:20px;fill:#fff}
.voice-title{font-size:12px;color:#5b6b82;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}
`;

  const SVG_MIC = `<svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
  const SVG_END = `<svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>`;

  function init() {
    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    // Create FAB button
    const fab = document.createElement('button');
    fab.className = 'voice-fab';
    fab.id = 'voiceFab';
    fab.innerHTML = SVG_MIC;
    fab.onclick = toggleCall;
    document.body.appendChild(fab);

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'voice-overlay';
    overlay.id = 'voiceOverlay';
    overlay.innerHTML = `
      <div class="voice-call-box">
        <div class="voice-title">Agent Command</div>
        <div class="voice-avatar" id="voiceAvatar">🤖</div>
        <div class="voice-status" id="voiceStatus">Tap to connect</div>
        <div class="voice-transcript" id="voiceTranscript"></div>
        <button class="voice-end-btn" id="voiceEndBtn" onclick="window._voiceEndCall()">
          ${SVG_END}
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Initialize voice client
    voiceClient = new VoiceClient();
    voiceClient.onStatus = (status, message) => {
      const avatar = document.getElementById('voiceAvatar');
      const statusEl = document.getElementById('voiceStatus');
      avatar.className = 'voice-avatar';
      if (status === 'recording') avatar.classList.add('listening');
      if (status === 'thinking' || status === 'speaking' || status === 'transcribing') avatar.classList.add('speaking');
      statusEl.textContent = message || status;
    };
    voiceClient.onTranscript = (text) => {
      const el = document.getElementById('voiceTranscript');
      el.innerHTML += `<div style="color:#2fe08a;margin-bottom:4px">You: ${text}</div>`;
      el.scrollTop = el.scrollHeight;
    };
    voiceClient.onAiText = (text) => {
      const el = document.getElementById('voiceTranscript');
      el.innerHTML += `<div style="color:#18e0ff;margin-bottom:4px">AI: ${text}</div>`;
      el.scrollTop = el.scrollHeight;
    };
    voiceClient.onError = (msg) => {
      const statusEl = document.getElementById('voiceStatus');
      statusEl.textContent = msg;
      statusEl.style.color = '#ff4466';
    };
  }

  window._voiceEndCall = function() {
    if (voiceClient) {
      voiceClient.stopRecording();
      voiceClient.disconnect();
    }
    callActive = false;
    const fab = document.getElementById('voiceFab');
    fab.classList.remove('active');
    const overlay = document.getElementById('voiceOverlay');
    overlay.classList.remove('open');
    const transcript = document.getElementById('voiceTranscript');
    transcript.innerHTML = '';
  };

  function toggleCall() {
    if (callActive) {
      window._voiceEndCall();
      return;
    }
    callActive = true;
    const fab = document.getElementById('voiceFab');
    fab.classList.add('active');
    const overlay = document.getElementById('voiceOverlay');
    overlay.classList.add('open');

    // Start recording
    voiceClient.connect().then(() => {
      voiceClient.startRecording();
    }).catch(err => {
      console.error('Voice connect error:', err);
      const statusEl = document.getElementById('voiceStatus');
      statusEl.textContent = 'Connection failed. Check server.';
    });
  }

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
