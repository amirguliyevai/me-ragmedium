#!/usr/bin/env python3
"""
AMIR BRIEFING — every 15 min, send a JARVIS-style summary to Telegram.

Reports:
- All blocked tasks (need Amir's attention)
- All open questions (from agent_messages priority=high)
- Today's completed tasks
- Any new approvals pending
- Agent activity stats
"""
import os, json, urllib.request
from datetime import datetime

AGENT_API = 'https://me.ragmedium.com/agents/api'
DASH_API  = 'https://me.ragmedium.com/api'
LOG = '/tmp/briefing.log'

def log(*a):
    msg = ' '.join(str(x) for x in a)
    line = f"[{datetime.now().isoformat()[:19]}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, 'a') as f: f.write(line+'\n')
    except: pass

def api(path, base=AGENT_API):
    try:
        req = urllib.request.Request(base + path)
        return json.loads(urllib.request.urlopen(req, timeout=10).read())
    except Exception as e:
        return {'error': str(e)}

def fetch_tasks():
    """Try agent-team first (live), fall back to galaxy."""
    t = api('/tasks')
    if isinstance(t, dict): t = t.get('tasks', [])
    if t: return t
    # Fallback: galaxy
    try:
        d = json.loads(urllib.request.urlopen('https://me.ragmedium.com/api/galaxy/tasks', timeout=8).read())
        return d
    except: return []

def main():
    log("briefing starting")
    # Get tasks
    tasks = fetch_tasks()
    blocked = [t for t in tasks if t.get('status') == 'blocked']
    in_progress = [t for t in tasks if t.get('status') == 'in_progress']
    done = [t for t in tasks if t.get('status') == 'done']
    # Get high-priority messages (questions for Amir)
    msgs = api('/messages?agent_id=Amir') or []
    # Normalize — message field may be a string (raw JSON) or already parsed
    questions = []
    for m in msgs:
        if not isinstance(m, dict): continue
        body = m.get('message')
        if isinstance(body, str):
            try: body = json.loads(body)
            except: body = {}
        if not isinstance(body, dict): body = {}
        if body.get('priority') == 'high':
            questions.append(m)
    # Approvals
    approvals = api('/approvals', base=DASH_API)
    pending_approvals = [a for a in (approvals.get('items',[]) if isinstance(approvals, dict) else []) if a.get('status') == 'pending']
    # Agents online
    agents = api('/agents')
    if not isinstance(agents, list): agents = []
    active_agents = [a for a in agents if a.get('is_active') or a.get('status') == 'active']

    lines = []
    lines.append(f"🤖 **AMIR BRIEFING** · {datetime.now().strftime('%H:%M %b %d')}")
    lines.append("")
    lines.append(f"📊 **STATUS**")
    lines.append(f"  · {len(active_agents)}/122 agents active")
    lines.append(f"  · {len(in_progress)} tasks in progress")
    lines.append(f"  · {len(blocked)} blocked · {len(pending_approvals)} pending approvals")
    lines.append("")

    if blocked:
        lines.append(f"🚨 **BLOCKED ({len(blocked)})**")
        for t in blocked[:8]:
            title = t.get('title','?')[:60]
            agent = (t.get('assigned_agent_name') or t.get('assigned_to') or 'unassigned')
            proj = t.get('lane','?')
            lines.append(f"  · `{agent}` on **{title}** [{proj}]")
        if len(blocked) > 8: lines.append(f"  · ...and {len(blocked)-8} more")
        lines.append("")

    if questions:
        lines.append(f"❓ **QUESTIONS ({len(questions)})**")
        for m in questions[:5]:
            body = m.get('message',{}) if isinstance(m.get('message'), dict) else {}
            lines.append(f"  · {body.get('from_agent','?')}: {body.get('text', m.get('text',''))[:80]}")
        if len(questions) > 5: lines.append(f"  · ...and {len(questions)-5} more")
        lines.append("")

    if pending_approvals:
        lines.append(f"🔐 **APPROVALS ({len(pending_approvals)})**")
        for a in pending_approvals[:5]:
            lines.append(f"  · {a.get('title','?')[:70]}")
        if len(pending_approvals) > 5: lines.append(f"  · ...and {len(pending_approvals)-5} more")
        lines.append("")

    if done:
        lines.append(f"✅ **RECENTLY DONE**")
        for t in done[:5]:
            lines.append(f"  · {t.get('title','?')[:60]}")
        lines.append("")

    msg = "\n".join(lines)
    log(f"briefing: {len(active_agents)} active, {len(blocked)} blocked, {len(questions)} Qs, {len(pending_approvals)} approvals")
    # Save the latest briefing
    with open('/tmp/last-briefing.txt', 'w') as f: f.write(msg)
    # Push to dashboard notification system via agent-team /api/notify
    # Include @Amir so it triggers a push notification
    try:
        notification = {
            'title': f'🤖 Briefing · {datetime.now().strftime("%H:%M")}',
            'message': f"@Amir\n\n{msg[:1800]}",
            'source': 'briefing-15min',
            'priority': 'high'
        }
        urllib.request.urlopen(urllib.request.Request(
            'https://me.ragmedium.com/agents/api/notify',
            data=json.dumps(notification).encode(),
            method='POST',
            headers={'content-type': 'application/json'}
        ), timeout=8)
        log("notified dashboard via /api/notify")
    except Exception as e:
        log(f"notify err: {e}")
    # Also save to public file for the dashboard
    try:
        open('/home/admin/.openclaw/workspace/agent-team/public/notifications.json', 'r+')  # ensure exists
    except FileNotFoundError:
        os.makedirs('/home/admin/.openclaw/workspace/agent-team/public', exist_ok=True)
        open('/home/admin/.openclaw/workspace/agent-team/public/notifications.json', 'w').write('[]')
    print(msg)
    return msg

if __name__ == '__main__':
    main()
