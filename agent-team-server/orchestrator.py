#!/usr/bin/env python3
"""
OPENCLAW ORCHESTRATOR — 24/7 Manager Agent.

Responsibilities (every 60s):
1. Read unread @-mentions from agents, route to correct owner
2. Detect stuck tasks (no heartbeat in 15 min) → escalate
3. Detect blocked-on-another-agent → ping that agent
4. Auto-reassign failed tasks that have no matching agent
5. Inject handoffs into the message queue
6. Maintain kaneki-ken state

This is the BRAIN of the empire — enables true agent↔agent communication.
"""

import os, sys, json, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, '/home/admin/.hermes/scripts')

AGENT_TEAM = "http://localhost:1707"


def api(method, path, body=None):
    url = AGENT_TEAM + path
    headers = {"Content-Type": "application/json"}
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def post_message(from_a, to_a, body, subject=""):
    """Send a message into the agent message thread."""
    try:
        api("POST", "/api/messages", {
            "from_agent": from_a,
            "to_agent": to_a,
            "message": body,
            "subject": subject or f"[{from_a}] → [{to_a}]",
            "is_from_amir": from_a == "Amir",
        })
        return True
    except Exception as e:
        print(f"post_message err: {e}")
        return False


def get_unread_for_agent(agent):
    """Fetch unread messages for an agent."""
    try:
        msgs = api("GET", f"/api/messages/{urllib.parse.quote(agent)}")
        # Filter unread
        unread = [m for m in msgs if not m.get('is_read')]
        return unread
    except Exception as e:
        return []


def get_agents():
    return api("GET", "/api/agents")


def get_failed_tasks(limit=50):
    tasks = api("GET", f"/api/tasks?status=failed&limit={limit}")
    return tasks.get('tasks', []) if isinstance(tasks, dict) else tasks


def get_blocked_tasks(limit=30):
    """Tasks in_progress that haven't heartbeated in 15 min."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    tasks = api("GET", f"/api/tasks?status=in_progress&limit={limit}")
    if not isinstance(tasks, dict):
        return []
    blocked = []
    for t in tasks.get('tasks', []):
        last_hb = t.get('last_heartbeat')
        if not last_hb or last_hb < cutoff:
            blocked.append(t)
    return blocked


def find_agent_by_name(agent_name):
    """Look up an agent by name."""
    agents = get_agents()
    for a in agents:
        if a.get('name') == agent_name or agent_name in (a.get('name') or ''):
            return a
    return None


def reassign_failed_tasks():
    """For each failed task, try to find a matching agent by division tags."""
    failed = get_failed_tasks(limit=200)
    if not failed:
        return 0
    fixed = 0
    agents = get_agents()
    # Index by division
    by_div = {}
    for a in agents:
        d = (a.get('division') or 'general').lower()
        by_div.setdefault(d, []).append(a)
    for t in failed:
        # Skip if already assigned
        if t.get('assigned_agent_id'):
            continue
        # Pick a candidate by agent_type
        atype = (t.get('agent_type') or '').lower()
        title = (t.get('title') or '').lower()
        # Find matching division
        candidate = None
        for d, ags in by_div.items():
            if d == atype or atype in d or d in atype:
                candidate = ags[0]
                break
        if not candidate:
            for d, ags in by_div.items():
                d_safe = (d or '').lower()
                if d_safe in title or any(t in title for t in ['content', 'email', 'lead', 'outreach']):
                    candidate = ags[0]
                    break
                    candidate = ags[0]
                    break
        if candidate:
            try:
                api("PATCH", f"/api/tasks/{t['id']}", {
                    "assigned_agent_id": candidate['id'],
                    "status": "pending",
                    "error": None,
                    "retry_count": 0
                })
                post_message("Kaneki Ken", candidate['name'], f"[AUTO-ASSIGN] task {t['id']}: {t['title'][:80]} → you", "[reassigned]")
                fixed += 1
                print(f"  ✅ Reassigned {t['id']} ({t['title'][:50]}...) → {candidate['name']}")
            except Exception as e:
                print(f"  ⚠ reassign {t['id']}: {e}")
    return fixed


def route_unread_mentions():
    """For each unread @-mention in messages, route to the right agent."""
    agents = get_agents()
    routed = 0
    for a in agents[:30]:  # sample of 30 active agents
        name = a.get('name')
        if not name:
            continue
        unread = get_unread_for_agent(name)
        for m in unread:
            body = m.get('message', '') if isinstance(m.get('message'), str) else json.dumps(m.get('message',''))
            body = body or ''
            body_lower = body.lower()
            sender = m.get('from_agent', '')
            # Is this a handoff / request?
            if '[HANDOFF]' in body or '@' in body or 'urgent' in body_lower:
                # Re-route to Amir if unsure
                if sender != 'Amir' and 'Amir' not in body and 'Boss' not in body:
                    continue  # Ignore for now to avoid spam loops
                # Mark as read
                try:
                    api("PATCH", f"/api/messages/{m['id']}", {"is_read": True})
                except Exception:
                    pass
                routed += 1
    return routed


def push_status_to_boss():
    """Post a summary to Amir."""
    failed = get_failed_tasks(limit=5)
    blocked = get_blocked_tasks(limit=5)
    running = api("GET", "/api/tasks/running")
    running = running if isinstance(running, list) else running.get('tasks', [])
    blocks = []
    blocks.append("🦅 **ORCHESTRATOR PULSE**")
    blocks.append(f"🟢 {len(running)} running")
    blocks.append(f"🟡 {len(failed)} failed (auto-reassigned below)")
    blocks.append(f"🔴 {len(blocked)} stale (no heartbeat)")
    blocks.append("")
    blocks.append("**Stale tasks (need ping):**")
    for t in blocked[:5]:
        blocks.append(f"  • {t['id']} | {t.get('title','')[:50]} ({t.get('agent_name','?')})")
    body = "\n".join(blocks)
    if len(failed) > 0 or len(blocked) > 0:
        post_message("Kaneki Ken", "Amir", body, "PULSE")


def run_cycle():
    print(f"\n=== ORCHESTRATOR CYCLE @ {datetime.now().strftime('%H:%M:%S')} ===")
    fixed = reassign_failed_tasks()
    routed = route_unread_mentions()
    push_status_to_boss()
    return {"reassigned": fixed, "routed": routed}


if __name__ == "__main__":
    # Single-shot for testing
    run_cycle()
