# Agent Command Dashboard

**Live:** https://me.ragmedium.com

Amir's cyberpunk command center — control 63+ AI agents, monitor 25 projects, 141M leads, voice calling, knowledge base, and a full PWA installable on mobile.

## Stack
- **Backend:** Node.js (server.js, port 1702) — serves the dashboard + all `/api/*` endpoints
- **Frontend:** Pure HTML/CSS/JS (no framework, no build step) — `index.html`
- **Voice:** WebSocket on port 8777 — `voice-server.js` + `voice-call-ui.js` (Groq Whisper STT + DeepSeek V4 Flash LLM + edge-tts TTS)
- **Galaxy 3D:** Three.js (`galaxy-3d.html`)
- **PWA:** Service worker `sw.js`, manifest, APK via Capacitor
- **Auth:** Google OAuth (Gmail + Calendar scopes), 5 tokens refreshed by cron
- **DB:** PostgreSQL — `galaxy_agents` (63 rows), `tasks` (50+ rows), Lead DB (141M people)
- **Cron:** 15-min Google sync (Gmail + Calendar) — `~/.hermes/scripts/google-sync.py`

## Quick Start
```bash
npm install
node server.js   # http://localhost:1702
```

## Tabs
- **Main (6):** Overview · Board · Agents · Org · Activity · Slack · Galaxy
- **Side (14):** Todo · Calendar · Projects · Leads · RAGx · Content · Studio · Workspace · Docs · Gallery · Skills · KB · Inbox · Old

## Voice Calling
The phone FAB (bottom-right) opens a hands-free call. Uses VAD for sentence detection, Groq Whisper for STT, DeepSeek V4 Flash for LLM, edge-tts for TTS. Call any of the 63 agents.

## Live APIs (no hardcoded data)
- `/api/galaxy/agents` — 63 agents
- `/api/galaxy/tasks` — 50 tasks across 25 projects
- `/api/threads` — 66+ messages (Gmail + dashboard)
- `/api/calendar` — Google Calendar (when API enabled)
- `/api/leads/` — 141M people, 20.5M businesses, 34.8M professionals
- `/api/training/topics` — 65 knowledge base topics
- `/ws/voice/*` — voice server (STT/TTS/LLM)

## v3 (June 30, 2026)
Full cyberpunk dashboard rebuild with progress bars, mini calendar, mini inbox, all 63 agent DMs, real graphene knowledge base, resizable right rail, white side nav with icons, and the live voice call system wired up.

v49 backup at `/var/www/old-dashboard/index.html` (444KB).
