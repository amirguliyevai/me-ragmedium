# 🏗️ INFRASTRUCTURE MAP — The Full Empire

## 🌐 VPS (100.111.98.27) — The Public Face

### Ports & Services
| Port | Service | Status | Purpose |
|------|---------|--------|---------|
| 80/443 | Nginx reverse proxy | ✅ | Routes to all services |
| 1702 | Productivity Dashboard | ✅ | **MASTER DASHBOARD** — Amir Command Center |
| 1703 | OpenCode | ✅ | AI coding workspace |
| 1704 | OpenCode Proxy | ✅ | Proxied access |
| 1705 | Content Studio | ❌ DOWN | ragmedium studio |
| 1707 | Agent Team Server | ✅ | Kanban + agent management |
| 18789 | OpenClaw Gateway | ✅ | Main AI gateway (local only) |
| 2088 | VNC/NoVNC | ✅ | Browser access |
| 2890 | Lead Database | ✅ | Muscle code lead DB |
| 3101 | Grademy App | ❌ DOWN | Next.js EdTech app |
| 4444 | RAGmind | ❌ DOWN | Mind map / knowledge base |
| 5900 | VNC Display | ✅ | Virtual desktop |
| 5432 | PostgreSQL | ✅ | Main database |
| 5434 | PostgreSQL (alt) | ❌ | Was used by agent-team |

### PM2 Processes
| ID | Name | Status | Purpose |
|----|------|--------|---------|
| 0 | agent-team | ❌ errored | Agent team server (:1707) |
| 1 | productivity-dashboard | ❌ errored | Dashboard (:1702) — actually running via another process |
| 2 | opencode | ✅ online | OpenCode coding agent |

### Running Node Processes
- `n8n` (pid 3965) — Workflow automation, running since Jun 16
- `next-server` (pid 4762) — Next.js app (v16.1.6)
- `next-server` (pid 6667) — Next.js app (v16.1.5) — likely Grademy or Calcom
- `terminal-server.js` (pid 4741) — Web terminal
- `calcom` (pid 6470) — Calendar app
- `x-farm` (20+ processes) — X/Twitter account farming proxies

### Python Processes
- `main.py` (pid 3499) — Main app server
- `/app/server.py` (pid 4923) — App server
- `x-farm/local-proxy.py` (20+ instances) — X account proxies

### Projects on VPS
| Project | Path | Purpose |
|---------|------|---------|
| Grademy | /home/admin/.openclaw/workspace/grademy.work/ | EdTech Next.js app |
| Calcom | /home/admin/calcom/ | Calendar scheduling |
| n8n | /home/admin/n8n/ | Workflow automation |
| OpenClaw | Gateway on :18789 | AI agent orchestration |
| RAGx | /home/admin/ragx/ | Outreach infrastructure |
| Lead DB | /home/admin/lead-database/ | Lead CRM |
| RAGmind | /home/admin/.openclaw/workspace/ragmind-deploy/ | Knowledge mindmap |
| Content Studio | /home/admin/studio.ragmedium.com/ | Content creation |
| X-Farm | /home/admin/x-farm/ | X/Twitter account warming |
| ScrapeGraph | /home/admin/scrapegraph-app/ | Web scraping |
| SMS-CRM | /home/admin/sms-crm/ | SMS campaigns |
| Cap App | /home/admin/cap-app/ | Capture app |
| Penpot | /home/admin/penpot/ | Design tool |
| AppFlowy | /home/admin/appflowy-cloud/ | Notion alternative |
| Cryptobot | /home/admin/cryptobot/ | Crypto trading |
| MegaRAG | /home/admin/megarag/ | Large-scale RAG |
| MiniRAG | /home/admin/minirag/ | Lightweight RAG |
| MarkItDown | /home/admin/markitdown-service/ | Document conversion |
| RAG Blog | /home/admin/rag-blog-server/ | Blog with RAG |
| RAGx Trader | /home/admin/ragxtrader/ | Trading + outreach |
| SMS | /home/admin/sms/ | SMS service |
| Snap | /home/admin/snap/ | Snapshot tool |
| Supabase | /home/admin/supabase-project/ | Database project |
| AI Playground | /home/admin/ai-playground/ | AI experiments |
| Jarvis | /home/admin/jarvis/ | Jarvis dashboard |
| Clawd | /home/admin/clawd/ | OpenClaw workspace |
| Chroma | /home/admin/chroma-setup/ | Vector DB setup |

## 🤖 AI AGENT EMPIRE (47 Agents)

### Executive Layer (owl-alpha)
| Agent | Role | Workspace | Reports To |
|-------|------|-----------|------------|
| kaneki-ken | Chief AI / Right-Hand Man | executive/kaneki-ken | Amir |
| chief-of-staff | Chief of Staff | executive/chief-of-staff | Kaneki |
| ops-director | Operations Director | operations/ops-director | Kaneki |
| research-director | Research Director | research/research-director | Kaneki |

### Project Teams
#### 🎓 Grademy (EdTech) — 6 agents
| Agent | Role | Model | Workspace |
|-------|------|-------|-----------|
| grademy-lead | Team Lead | owl-alpha | grademy/grademy-lead |
| grademy-qa | QA Engineer | flash | grademy/grademy-qa |
| teacher-mode-dev | Backend Dev | flash | grademy/teacher-mode-dev |
| onboarding-specialist | UX/Onboarding | flash | grademy/onboarding-specialist |
| ai-tutor-engineer | AI Engineer | flash | grademy/ai-tutor-engineer |
| grademy-frontend | Frontend Dev | flash | grademy/grademy-frontend |

#### 📈 LamaTrader (Fintech) — 5 agents
| Agent | Role | Workspace |
|-------|------|-----------|
| lamatrader-lead | Team Lead | lamatrader/lamatrader-lead |
| enrichment-director | Enrichment | lamatrader/enrichment-director |
| data-enricher | Data Enrichment | lamatrader/data-enricher |
| scraper-agent | Web Scraper | lamatrader/scraper-agent |
| email-verifier | Email Verification | lamatrader/email-verifier |

#### 📣 RAGx (Outreach) — 6 agents
| Agent | Role | Workspace |
|-------|------|-----------|
| ragx-growth-lead | Growth Lead | outreach/ragx-growth-lead |
| marketing-director | Marketing | outreach/marketing-director |
| campaign-manager | Campaigns | outreach/campaign-manager |
| growth-hacker | Growth | outreach/growth-hacker |
| source-scout | Source Scout | outreach/source-scout |
| outreach-head | Outreach Head | outreach/outreach-head |

#### 🎬 Content Empire — 5 agents
| Agent | Role | Workspace |
|-------|------|-----------|
| content-director | Director | content/content-director |
| writer-agent | Writer | content/writer-agent |
| social-media-agent | Social Media | content/social-media-agent |
| video-transcriber | Video | content/video-transcriber |
| image-creator | Image Gen | content/image-creator |

#### 🏠 Rema Exteriors — 2 agents
| Agent | Role | Workspace |
|-------|------|-----------|
| rema-exteriors-lead | Lead | rema-exteriors/rema-exteriors-lead |
| personal-brand-strategist | Brand | content/personal-brand-strategist |

#### 🎓 Grademy (EdTech) — additional
| Agent | Role | Workspace |
|-------|------|-----------|
| grademy-lead | Lead | grademy/grademy-lead |
| grademy-qa | QA | grademy/grademy-qa |

### Infrastructure Layer (owl-alpha)
| Agent | Role | Workspace |
|-------|------|-----------|
| sys-frontend | Frontend Maintainer | agents/sys-frontend |
| sys-backend | Backend Maintainer | agents/sys-backend |
| sys-infra | Infrastructure | agents/sys-infra |
| sys-devops | DevOps | agents/sys-devops |
| devops-agent | DevOps Agent | development/devops-agent |

### Support Agents
| Agent | Role | Workspace |
|-------|------|-----------|
| dev-director | Dev Director | development/dev-director |
| db-admin | DB Admin | development/db-admin |
| frontend-dev | Frontend Dev | development/frontend-dev |
| backend-dev | Backend Dev | development/backend-dev |
| ragmedium-growth-lead | RAGmedium Growth | marketing/ragmedium-growth-lead |
| ventures-pm | Ventures PM | operations/ventures-pm |
| monitor-agent | Monitor | operations/monitor-agent |
| reporter-agent | Reporter | operations/reporter-agent |
| competitor-intel | Competitor Intel | research/competitor-intel |
| market-scout | Market Scout | research/market-scout |
| data-analyst | Data Analyst | research/data-analyst |
| teacher-mode-dev | Teacher Mode | grademy/teacher-mode-dev |
| onboarding-specialist | Onboarding | grademy/onboarding-specialist |
| ai-tutor-engineer | AI Tutor | grademy/ai-tutor-engineer |
| grademy-frontend | Grademy Frontend | grademy/grademy-frontend |

## 📱 PLATFORMS & ACCOUNTS

### Amir's Platforms
| Platform | URL | Purpose |
|----------|-----|---------|
| ai.ragmedium.com | PWA Hub | Main dashboard (port 1702) |
| lamatrader.com | Live beta | Trading platform |
| grademy.work | EdTech | Study surface |
| ragx.io | Outreach | Email/SMS campaigns |
| reachinbox.io | 300 inboxes | Verified email sending |
| studio.ragmedium.com | Content Studio | Content creation |
| jarvis.local | Jarvis | Local dashboard |

### Social Media (Brogen X-Farm)
- 100+ X/Twitter accounts being warmed
- Local proxies on ports 18001-18100
- Content Empire manages posting

### Clients
| Client | Type | Status |
|--------|------|--------|
| Hollow Booking | Halal booking | Active |
| Waterspring | Welsh VC | Active |
| Unitas | PR Agency | Active |

## 🔧 SKILLS (100+ installed)
Key categories: web scraping, browser automation, data science, ML/AI, content generation, email, social media, GitHub, Notion, Airtable, OCR, PDF editing, video generation, image generation, music generation, calendar, maps, smart home, and 60+ more.

## 🔑 CRITICAL RULES
1. **1702 = Master Dashboard** — ALL UI goes through here
2. **Port 1707 = Agent Team Server** — Kanban + agent API
3. **Port 18789 = OpenClaw Gateway** — AI orchestration (local only)
4. **Port 4444 = RAGmind** — Knowledge base
5. **Port 3101 = Grademy App** — EdTech platform
6. **Port 1705 = Content Studio** — Content creation
7. **Workers use deepseek-v4-flash, Leads use owl-alpha**
8. **All agents report to their Lead, Leads report to Kaneki, Kaneki reports to Amir**
9. **Never show logs/tool output unless Amir requests it**
10. **YOLO mode = no asking permission for internal work**
