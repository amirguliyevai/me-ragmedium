# 67 - AI Workspace Prep — GitHub Reference

This folder is the **git-tracked reference** of the prep work done in `/home/admin/67 - AI/`.

The actual workspace lives at `/home/admin/67 - AI/` (outside git). This folder contains:
- README, audit docs, activation script, worker specs

## Files

| File | Purpose |
|---|---|
| `README.md` | Folder structure overview |
| `LEAD-DB-AUDIT.md` | Audit of 1B-lead sources (Apollo, LinkedIn, PDL, etc.) |
| `OAUTH-REFRESH-NEEDED.md` | Step-by-step Gmail re-auth instructions |
| `ACTIVATION.md` | User-facing activation guide |
| `STATE.json` | Full prep checklist + blocker list |
| `activate-team.sh` | The single command that fires all 8 agents |
| `workers/*.md` | Per-agent mission specs |
| `platforms.json` | Content Empire platform config (13 platforms incl. Pinterest + Bluesky) |

## Activation

When Amir confirms:
```bash
bash /home/admin/67 - AI/activate-team.sh
```

This spawns the 8 standing agents (lamatrader-lead, outreach-head, content-director, grademy-lead, rema-exteriors-lead, ventures-pm, dev-director, chief-of-staff) and starts the continuous work queue.

See `ACTIVATION.md` for the full guide.
