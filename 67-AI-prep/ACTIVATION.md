# Activation Guide

## What activation does

When you run `bash /home/admin/67 - AI/activate-team.sh`, the following happens:

1. Pre-flight checks (Lead DB up? Content Hub up? Gmail OAuth valid?)
2. Updates `SHARED-STATE.md` timestamp
3. Spawns the 8 standing agents (listed below)
4. Each agent writes its first output to `team-updates/inbox/` within 5 minutes
5. Chief of Staff agent aggregates + sends you a Telegram update

## Pre-activation checklist (DO BEFORE running activate)

- [ ] Refresh Gmail OAuth: `gog auth add amirg@ragmedium.com --services gmail,drive`
- [ ] Create your LinkedIn account (if you want social outreach to work)
- [ ] Create your X account (if you want X content to work)
- [ ] Decide which ICP queue goes FIRST: London training / RAGmedium agencies / LamaTrader hedge funds / Rima FL homeowners

## Agents that will spawn

| Agent | Scope | Blocker |
|---|---|---|
| `lamatrader-lead` | LamaTrader + LamaBroker lead gen | ReachInbox API down |
| `outreach-head` | RAGmedium email/LinkedIn | Gmail + LinkedIn |
| `content-director` | Content Empire (X/IG/LinkedIn/etc) | X + LinkedIn accounts |
| `grademy-lead` | Grademy.work | none |
| `rema-exteriors-lead` | Rima FL homeowners (SMS + Gmail) | Gmail |
| `ventures-pm` | SyneticX + Halalbooking + PriPitch | none |
| `dev-director` | Infrastructure health | none |
| `chief-of-staff` | Aggregator + Telegram pings | none |

## What you should see post-activation

Within 5 minutes: 8 entries appear in `/home/admin/.openclaw/workspace/team-updates/inbox/`
Within 15 minutes: A Telegram update from Chief of Staff summarizing status
Within 30 minutes: Lead pulls begin populating your `67 - AI/<business>/<icp>/raw/` folders

## To pause / stop

```
pm2 stop agent-continuous   # stops new task assignments
pkill -f "agent-continuous"  # force stop everything
```

## To re-activate

```
bash /home/admin/67 - AI/activate-team.sh
```

The script is idempotent — it can be run multiple times safely.
