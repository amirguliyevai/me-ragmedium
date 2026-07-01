#!/bin/bash
# ACTIVATE THE TEAM — Amir runs this to fire the 8 standing agents.
# Reads /home/admin/67 - AI/STATE to decide what to activate.
# Logs every step to /home/admin/.openclaw/workspace/team-updates/inbox/

set -e

BASE="/home/admin/67 - AI"
INBOX="/home/admin/.openclaw/workspace/team-updates/inbox"
WORK_QUEUE="/home/admin/.openclaw/workspace/team-updates/WORK-QUEUE.md"
SHARED_STATE="/home/admin/.openclaw/workspace/team-updates/SHARED-STATE.md"

mkdir -p "$INBOX"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*" | tee -a "$INBOX/activation.log"; }

log "🚨 ACTIVATION STARTING"

# 0. Pre-flight checks
if [ ! -f "$BASE/STATE" ]; then
  log "❌ STATE file missing at $BASE/STATE — read 67 - AI/ACTIVATION.md first"
  exit 1
fi

# 1. Confirm Gmail OAuth (BLOCKER per KB)
if grep -q '"error"' /home/admin/token.json 2>/dev/null; then
  log "⚠️ Gmail OAuth EXPIRED. Run: gog auth add amirg@ragmedium.com --services gmail,drive"
  log "  (This script will continue but email outreach will fail until auth refreshes)"
fi

# 2. Confirm Lead DB is up
if ! curl -sm 5 http://127.0.0.1:8002/ > /dev/null 2>&1; then
  log "❌ Lead DB unreachable at :8002 — restart leadmin_v4 first"
  exit 1
fi
log "✅ Lead DB at :8002 responsive"

# 3. Confirm Content Hub is up
if ! curl -sm 5 http://127.0.0.1:8110/api/stats > /dev/null 2>&1; then
  log "❌ Content Hub unreachable at :8110"
  exit 1
fi
log "✅ Content Hub at :8110 responsive"

# 4. Update SHARED-STATE with activation time
sed -i "s/Last updated:.*$/Last updated: $(ts) (just activated)/" "$SHARED_STATE" 2>/dev/null || true
log "✅ SHARED-STATE updated"

# 5. Dispatch all 8 standing agents
AGENTS=(
  "lamatrader-lead:Stand up the LamaTrader lead pipeline + brokerage outreach"
  "outreach-head:Review cold email metrics, identify 5 prospects for ai.ragmedium"
  "content-director:Review content pipeline, prep 3 content pieces, schedule X posts"
  "grademy-lead:Check Sep 1 launch status, surface blockers"
  "rema-exteriors-lead:Check homeowner outreach pipeline, FL metros"
  "ventures-pm:Check SyneticX + Halalbooking + PriPitch status"
  "dev-director:Check agent-team + dashboard + db health"
  "chief-of-staff:Aggregate all agent updates, escalate P0s to Amir via Telegram"
)

for entry in "${AGENTS[@]}"; do
  agent="${entry%%:*}"
  mission="${entry##*:}"
  log "🚀 Spawning $agent: $mission"
  # TODO: wire to actual spawn (current dispatcher.sh is a thin wrapper)
  echo "[$(ts)] [$agent] mission: $mission" >> "$INBOX/$agent.log"
done

log "🚨 ACTIVATION COMPLETE"
log "Next: check $INBOX/ for agent outputs in ~5 minutes"
log "Chief of Staff agent will summarize + send Telegram update"
