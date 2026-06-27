/**
 * Voice Call Client for PWA
 * Connects to voice-server WebSocket, captures mic, plays AI responses
 */
class VoiceClient {
  constructor() {
    this.ws = null;
    this.recorder = null;
    this.audioCtx = null;
    this.stream = null;
    this.connected = false;
    this.sessionId = null;
    this.onTranscript = null;
    this.onAiText = null;
    this.onStatus = null;
    this.onAudioEnd = null;
    this.onError = null;
    this.onConnected = null;
    this.status = 'idle';
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/voice`;
      
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.connected = true;
        if (this.onConnected) this.onConnected();
        resolve();
      };

      this.ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Audio buffer from AI
          await this.playAudio(event.data);
          if (this.onAudioEnd) this.onAudioEnd();
          return;
        }

        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'connected':
              this.sessionId = msg.sessionId;
              break;
            case 'status':
              this.status = msg.status;
              if (this.onStatus) this.onStatus(msg.status, msg.message);
              break;
            case 'transcript':
              if (this.onTranscript) this.onTranscript(msg.text);
              break;
            case 'ai_text':
              if (this.onAiText) this.onAiText(msg.text);
              break;
            case 'audio_end':
              this.status = 'idle';
              break;
            case 'error':
              this.status = 'error';
              if (this.onError) this.onError(msg.message);
              break;
          }
        } catch (e) {
          console.error('[VoiceClient] Parse error:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[VoiceClient] WS error:', err);
        reject(err);
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.status = 'idle';
      };
    });
  }

  async startRecording() {
    if (!this.connected) {
      await this.connect();
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 16000
        }
      });

      this.recorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(e.data);
        }
      };

      this.recorder.start(250); // Send chunks every 250ms
      this.status = 'recording';
    } catch (err) {
      console.error('[VoiceClient] Mic error:', err);
      if (this.onError) this.onError('Microphone access denied. Please allow mic permissions.');
    }
  }

  stopRecording() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'audio_end' }));
    }
    this.status = 'processing';
  }

  sendText(text) {
    if (!this.connected) {
      this.connect().then(() => this.sendText(text));
      return;
    }
    this.ws.send(JSON.stringify({ type: 'text', text }));
  }

  async playAudio(arrayBuffer) {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    try {
      const decoded = await this.audioCtx.decodeAudioData(arrayBuffer);
      const source = this.audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(this.audioCtx.destination);
      source.start();
      
      return new Promise((resolve) => {
        source.onended = resolve;
      });
    } catch (err) {
      console.error('[VoiceClient] Audio play error:', err);
    }
  }

  disconnect() {
    if (this.recorder) {
      this.recorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
    if (this.ws) {
      this.ws.close();
    }
    this.connected = false;
    this.status = 'idle';
  }
}

// Global instance
window.VoiceClient = VoiceClient;
