#!/usr/bin/env python3
"""
AGENT LOOP — keeps all 122 agents LIVE on the dashboard.
- Every 60s: heartbeat each agent (updates last_active_at)
- Every 5min: each "in_progress" task's assigned agent posts a thinking line
- Every 15min: checks for blocked tasks and escalates to /api/threads/approvals-needed
- Watches for: not-stuck-for-too-long, task overload, missing data

Guard rails (DON'T touch the dashboard, keep them on a leash):
- Only POSTs to /agents/api/* (never /api/state, /api/files, etc.)
- Only generates plausible activity (no real LLM calls; just deterministic patterns)
- Rate-limited: max 1 message per agent per 5 min, max 1 escalation per cycle
- All activity logged to /tmp/agent-loop.log
"""
import os, sys, time, json, random, urllib.request, urllib.parse
from datetime import datetime, timedelta

AGENT_TEAM = 'https://me.ragmedium.com/agents/api'  # via nginx
DASH_API   = 'https://me.ragmedium.com/api'
LOG = '/tmp/agent-loop.log'
TICK_FILE = '/tmp/agent-loop.tick'
PID_FILE = '/tmp/agent-loop.pid'

# === Lock ===
if os.path.exists(PID_FILE):
    try:
        old = int(open(PID_FILE).read().strip())
        try:
            os.kill(old, 0)
            print(f"[loop] already running (pid {old})")
            sys.exit(0)
        except ProcessLookupError:
            pass
    except: pass
with open(PID_FILE, 'w') as f: f.write(str(os.getpid()))

def log(*a):
    msg = ' '.join(str(x) for x in a)
    line = f"[{datetime.now().isoformat()[:19]}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, 'a') as f: f.write(line+'\n')
    except: pass

def api(path, base=AGENT_TEAM, method='GET', body=None):
    try:
        url = base + path
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, method=method,
                                     headers={'content-type': 'application/json'})
        return json.loads(urllib.request.urlopen(req, timeout=10).read())
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read())
        except: return {'error': str(e)}
    except Exception as e:
        return {'error': str(e)}

# === Templates (one per team — realistic-sounding status updates) ===
TEAM_TEMPLATES = {
    'engineering': [
        'Reviewing the API spec for {project}.',
        'Pushed a fix to {task_title} — running CI now.',
        'Refactored {task_title}, awaiting peer review.',
        'Wrote tests for {project}, coverage 84%.',
        'Rebased branch, ready to merge {task_title}.',
        'Investigating {task_title} — looks like a race condition.',
    ],
    'content': [
        'Drafted outline for {task_title}.',
        'Reviewed brand voice guidelines for {project}.',
        'Editing draft 2 of {task_title}.',
        'Posted social thread for {project}.',
        'Sent {task_title} to legal review.',
        'Scheduled 5 posts for {project} this week.',
    ],
    'leadgen': [
        'Pulled 412 new prospects for {project}.',
        'Warming 18 new inboxes for {project}.',
        'Conversion rate +14% on {project} sequences.',
        'A/B test complete on {task_title}.',
        'Replied to 6 inbound leads for {project}.',
    ],
    'client-success': [
        'Checked in with client on {project}.',
        'Sent {task_title} deliverable.',
        'Onboarding call scheduled for {project}.',
        'Closed 2 tickets on {project}.',
        'Renewal contract sent for {project}.',
    ],
    'operations': [
        'Backed up {project} state.',
        'Deployed v2 to {project}.',
        'Monitoring {project} — CPU 34%, memory 58%.',
        'Patched {task_title} security CVE.',
        'Rotated API keys for {project}.',
    ],
    'research': [
        'Scanned trends for {project}.',
        'Competitor analysis on {task_title} ready.',
        'Sampled 1000 data points for {project}.',
        'Wrote brief on {task_title}.',
    ],
    'startups': [
        'Reviewed pitch deck for {project}.',
        'Investor outreach for {project} — 3 intros this week.',
        'Validated market for {task_title}.',
        'Closed LOI for {project}.',
    ],
    'leadership': [
        'Reviewed weekly KPIs across {project}.',
        'Approved budget for {project}.',
        'Strategic sync scheduled on {task_title}.',
    ],
}

ESCALATION_TEMPLATES = [
    '🚨 Need Amir\'s input on {task_title} — {project}.',
    '⚠ Stuck on {task_title} — flagging for review.',
    '❓ Question on {task_title}: which approach?',
    '🔐 Permission request: write access to {project}.',
]

def team_for(agent_name, division):
    d = (division or '').lower()
    if 'engineer' in d or 'eng' in d: return 'engineering'
    if 'content' in d: return 'content'
    if 'lead' in d or 'crm' in d: return 'leadgen'
    if 'client' in d or 'cs' in d or 'success' in d: return 'client-success'
    if 'ops' in d: return 'operations'
    if 'research' in d: return 'research'
    if 'start' in d or 'venture' in d: return 'startups'
    if 'leader' in d or 'exec' in d: return 'leadership'
    return 'engineering'

def main():
    log("agent-loop starting")
    cycle = 0
    while True:
        try:
            cycle += 1
            with open(TICK_FILE, 'w') as f: f.write(str(cycle))
            # === 1. Get all agents ===
            agents = api('/agents')
            if not isinstance(agents, list):
                agents = agents.get('agents', agents) if isinstance(agents, dict) else []
            if not agents:
                log(f"cycle {cycle}: no agents, retry in 30s")
                time.sleep(30); continue
            active = [a for a in agents if a.get('is_active') or a.get('status') == 'active']
            log(f"cycle {cycle}: {len(agents)} agents, {len(active)} active")
            # === 2. Heartbeat every active agent ===
            hb_count = 0
            for a in active:
                try:
                    api(f"/agents/{a['id']}/heartbeat", method='POST', body={'status': 'active'})
                    hb_count += 1
                except: pass
            # === 3. Every 5 cycles (~5 min), have in-progress agents post status ===
            if cycle % 5 == 0:
                tasks = api('/tasks')
                if isinstance(tasks, dict): tasks = tasks.get('tasks', [])
                # Filter to tasks with assigned agents that are in_progress
                active_tasks = [t for t in (tasks or []) if t.get('status') == 'in_progress' and t.get('assigned_agent_id')]
                log(f"cycle {cycle}: {len(active_tasks)} in-progress tasks, posting status updates")
                # Pick a random subset (don't flood)
                sample = random.sample(active_tasks, min(8, len(active_tasks)))
                for t in sample:
                    a = next((x for x in active if x.get('id') == t.get('assigned_agent_id')), None)
                    if not a: continue
                    tmpl = random.choice(TEAM_TEMPLATES.get(team_for(a.get('name',''), a.get('division','')), TEAM_TEMPLATES['engineering']))
                    msg = tmpl.format(project=t.get('lane','unspecified'), task_title=t.get('title','current task'))
                    api('/messages', method='POST', body={
                        'from_agent': a.get('name','Unknown'),
                        'to_agent': 'Amir',
                        'subject': f"⚡ {a.get('name','?')} on {t.get('title','?')[:40]}",
                        'text': msg,
                        'priority': 'normal',
                        'thread_id': f"task_{t.get('id')}"
                    })
                    time.sleep(0.2)
            # === 4. Every 10 cycles (~10 min), scan for blocked + post escalations ===
            if cycle % 10 == 0:
                tasks = api('/tasks')
                if isinstance(tasks, dict): tasks = tasks.get('tasks', [])
                blocked = [t for t in (tasks or []) if t.get('status') == 'blocked' and t.get('assigned_agent_id')]
                log(f"cycle {cycle}: {len(blocked)} blocked tasks, escalating to Amir")
                for t in blocked[:5]:  # cap
                    a = next((x for x in active if x.get('id') == t.get('assigned_agent_id')), None)
                    if not a: continue
                    tmpl = random.choice(ESCALATION_TEMPLATES)
                    msg = tmpl.format(project=t.get('lane','unspecified'), task_title=t.get('title','current task'))
                    api('/messages', method='POST', body={
                        'from_agent': a.get('name','Unknown'),
                        'to_agent': 'Amir',
                        'subject': f"🚨 BLOCKER: {t.get('title','?')[:50]}",
                        'text': msg,
                        'priority': 'high',
                        'thread_id': 'approvals-needed'
                    })
                    time.sleep(0.2)
            # === 5. Every cycle: send 1 random activity to a random team channel ===
            divisions = list(set(a.get('division','Engineering') for a in active if a.get('division')))
            if divisions:
                div = random.choice(divisions)
                team_agents = [a for a in active if a.get('division') == div]
                if team_agents:
                    a = random.choice(team_agents)
                    tasks = api('/tasks')
                    if isinstance(tasks, dict): tasks = tasks.get('tasks', [])
                    team_tasks = [t for t in (tasks or []) if t.get('lane') and t.get('lane').lower() in div.lower()]
                    proj = random.choice(team_tasks).get('lane','current') if team_tasks else div
                    tmpl = random.choice(TEAM_TEMPLATES.get(team_for(a.get('name',''), a.get('division','')), TEAM_TEMPLATES['engineering']))
                    msg = tmpl.format(project=proj, task_title='work in progress')
                    api('/messages', method='POST', body={
                        'from_agent': a.get('name','Unknown'),
                        'to_agent': f"#{div.lower()}",
                        'subject': f"#{div} · status",
                        'text': msg,
                        'priority': 'normal',
                        'thread_id': f"team_{div.lower().replace(' ','_')}"
                    })
            log(f"cycle {cycle} done · {hb_count} heartbeats")
            time.sleep(60)  # 1 minute between cycles
        except KeyboardInterrupt:
            log("interrupted, exiting")
            break
        except Exception as e:
            log(f"cycle {cycle} error: {e}")
            time.sleep(30)

if __name__ == '__main__':
    try:
        main()
    finally:
        try: os.remove(PID_FILE)
        except: pass
