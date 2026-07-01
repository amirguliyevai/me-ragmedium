# 67 - AI Workspace

**Amir's AI ops hub** — prep folder for the team activation.

## Status

🟡 **PREP ONLY** — team is NOT yet activated. This folder exists to:
1. Organize leads by business × ICP × pipeline stage
2. Document every dataset, content asset, and integration
3. Prepare the activation script so team fires in one command

## Folder structure

```
67 - AI/
├── RAGmedium/           # Professional services outreach
├── LamaTrader/          # Trading UI (parent company)
├── LamaBroker/          # Brokerage ops (child of LamaTrader — grouped for execution)
├── Rima/                # Parent — brick-and-mortar AI (paused)
├── RimaExteriors/       # Active vertical — homeowner outreach
├── Pripitch/            # Pre-call SDR intel (Aug relaunch)
├── Grademy/             # EdTech (UCL pilot)
├── ContentEmpire/       # Content production + distribution
└── _clients/            # Client projects — NOT lead-gen
```

Each business folder has ICP sub-folders (e.g. `us-lawyers/`, `gulf-sharia-brokerages/`, `florida-naples-homeowners/`) and each ICP has the pipeline:
- `raw/`        — unprocessed leads
- `enriched/`   — enriched with title/phone/social
- `processed/`  — campaign-ready
- `sent/`       — pushed to outreach platform

## Activation

See `ACTIVATION.md` for the single command that fires the team.

## Cross-references

- Lead DB: `localhost:8002` (141M records)
- Content Hub: `/home/admin/.openclaw/workspace/content-hub/`
- Team charters: `/home/admin/.openclaw/workspace/team/`
- Work queue: `/home/admin/.openclaw/workspace/team-updates/WORK-QUEUE.md`
- Lead queue (current): `/home/admin/.openclaw/workspace/agent-team/campaigns/queue/`
