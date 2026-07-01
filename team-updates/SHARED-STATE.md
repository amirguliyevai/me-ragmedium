# Team Shared State

> Last updated: 2026-07-01 14:45 CEST by Chief of Staff (PREP COMPLETE — awaiting activation)
> Activation script ready: `bash /home/admin/67 - AI/activate-team.sh`
> See `/home/admin/67 - AI/STATE.json` for full prep checklist.

## Empire Status: 🟡 PREP COMPLETE (not yet activated)

All 11 prep tasks DONE. Team NOT yet spawned. Activation is a single command when Amir confirms.

## Activation Command

```bash
bash /home/admin/67 - AI/activate-team.sh
```

This will:
1. Pre-flight check (Lead DB up, Content Hub up, Gmail OAuth valid)
2. Update this SHARED-STATE timestamp
3. Spawn 8 standing agents
4. Begin the continuous work queue

## Agents ready to spawn (8)

| Department | Agent | Charter |
|---|---|---|
| Cross-dept | chief-of-staff | `/home/admin/.openclaw/workspace/team/charter-chief-of-staff.md` |
| Content | content-director | `/home/admin/.openclaw/workspace/team/charter-content-empire.md` |
| Dev | dev-director | `/home/admin/.openclaw/workspace/team/charter-dev-director.md` |
| Grademy | grademy-lead | `/home/admin/.openclaw/workspace/team/charter-grademy-lead.md` |
| LamaTrader | lamatrader-lead | `/home/admin/.openclaw/workspace/team/charter-lamatrader-lead.md` |
| Outreach | outreach-head | `/home/admin/.openclaw/workspace/team/charter-outreach-head.md` |
| RimaExteriors | rema-exteriors-lead | `/home/admin/.openclaw/workspace/team/charter-rema-exteriors.md` |
| Ventures | ventures-pm | `/home/admin/.openclaw/workspace/team/charter-ventures-pm.md` |

## P0 Blockers for activation (per STATE.json)

1. **Gmail OAuth expired 72h+** — Run `gog auth add amirg@ragmedium.com --services gmail,drive`
2. **LinkedIn account not created** — blocks all social outreach + PriPitch marketing
3. **X account not created** — blocks X content posting
4. **ReachInbox /v1/campaigns 500** — their server-side bug, work around with UI

## Infrastructure Health

| Service | Status | Notes |
|---|---|---|
| Dashboard (1702) | ✅ Online | Wired to Content Hub (8110) via /api/content-calendar + /api/content-platforms |
| Agent Team (1707) | ✅ Online | All routes working |
| Content Hub (8110) | ✅ Online | New /api/platforms endpoint (13 platforms incl. Pinterest + Bluesky) |
| Lead DB (8002) | ✅ Online | 141M records, 6 indexes added (city, state, industry_trgm, etc.) |
| Unitas (:8110 prod → :9090) | ✅ Online | next start production mode (was 327% CPU in dev mode) |
| RAG-X APK | ✅ Signed v4.0 | /dist/agent-cmd-v7-signed.apk (3.9MB, v1+v2) |
| X-Farm | ✅ Online | 100 accounts warming (Day 5+) |
| Content Studio (1705) | ✅ Online | 2D uptime |
| MoneyPrinter (8080) | ✅ Online | 3D uptime |

## Prep work completed today (2026-07-01)

- [x] Folder structure: `/home/admin/67 - AI/` with project × ICP × pipeline dirs (50+ folders)
- [x] Lead DB audit: documented Drive folder links, 1B-lead sources
- [x] Gmail OAuth instructions: step-by-step for Amir
- [x] Content Calendar wired into dashboard: Calendar page now shows Content Hub calendar with toggles (All / Google events / Content / Deadlines)
- [x] Production Pipeline UI: Content Hub has new "Production" tab with download buttons + "Ready to edit" status
- [x] Pinterest + Bluesky configs: platforms.json with setup_steps, auth stubs created
- [x] Worker specs: 8 per-agent mission docs written
- [x] Activation script: `activate-team.sh` ready (idempotent, pre-flight checks)
- [x] STATE.json: full checklist + blocker list
- [x] ACTIVATION.md: user-facing guide

## Prep status (per STATE.json)

```
folder_structure          ✅ DONE
lead_db_audit             ✅ DONE
drive_folders_documented  ✅ DONE
oauth_instructions        ✅ DONE
content_calendar_dashboard ✅ DONE
production_pipeline_ui    ✅ DONE
platforms_pinterest_bluesky ✅ DONE
agent_charters_present    ✅ DONE
work_queue_present        ✅ DONE
dispatcher_protocol       ✅ DONE
agent_souls_present       ✅ DONE
activation_script_written ✅ DONE
```

## Standing tasks per department (per WORK-QUEUE.md)

All 8 departments have standing task lists. Will start executing upon activation.

## Current queue (already prepared)

- RAGmedium London + email: 2,500 leads → `agent-team/campaigns/queue/ragmedium-london-all.json`
- Rima FL Naples homeowners: 2,000 leads → `agent-team/campaigns/queue/rima-exteriors-naples-fl.json`
- Rima FL Miami homeowners: 2,000 leads → `agent-team/campaigns/queue/rima-exteriors-miami-fl.json`
- LamaTrader US financial services: 499 leads → `agent-team/campaigns/queue/lamatrader-financial-services.json`
- RAGmedium software & internet (marginal): 500 leads → `agent-team/campaigns/queue/ragmedium-software-internet-marginal.json`

Total: **7,499 leads queued**, ready for bulk-import once ReachInbox API recovers.

## Financial Snapshot

| Metric | Value |
|---|---|
| Active MRR | ~£2,100/mo |
| Monthly Gap | -£700/mo |
| Pipeline | £15,000 (SyneticX) + ~£4k (Waterspring) |
| Token Costs | £0 (Xiaomi plan) |

## Notes

- This prep-only state was completed without firing any agents (per Amir's directive)
- Activation is gated on Amir's confirmation
- 67 - AI/STATE.json has full audit trail
