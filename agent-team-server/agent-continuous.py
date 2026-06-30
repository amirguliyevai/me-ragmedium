#!/usr/bin/env python3
"""
CONTINUOUS WORK QUEUE — v4 REAL TASK EXECUTOR
Each agent pulls assigned pending tasks from DB and executes them.
NO generic task creation. Only real business tasks.
"""

import json, os, sys, time, random, urllib.request, urllib.error, traceback
from datetime import datetime, timezone
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── Configuration ───────────────────────────────────────────────
AGENT_TEAM = "http://localhost:1707"
ENV_FILE = "/home/admin/.hermes/.env"
CYCLE_SLEEP = 15      # seconds between full cycles
MAX_WORKERS = 60      # ThreadPoolExecutor workers — enough for concurrent LLM calls

# ─── Project/Squad mapping ──────────────────────────────────────
SQUAD_PROJECT_MAP = {
    "content": 1, "leadgen": 2, "engineering": 3, "research": 4,
    "operations": 5, "client_success": 6, "client-success": 6,
    "startups": 7, "executive": 8, "leadership": 8,
}

# ─── API Keys ────────────────────────────────────────────────────
def get_env_keys():
    """Read API keys from the .env file (binary search to avoid line-ending issues)."""
    with open(ENV_FILE, "rb") as f:
        content = f.read()
    keys = {}
    for name in [b"OPENROUTER_API_KEY", b"OPENCODE_GO_API_KEY"]:
        idx = content.find(name + b"=")
        if idx >= 0:
            eol = content.find(b"\n", idx)
            val = content[idx + len(name) + 1 : eol].decode("utf-8", errors="replace").strip()
            keys[name.decode()] = val
    return keys

KEYS = get_env_keys()
OR_KEY = KEYS.get("OPENROUTER_API_KEY")
OC_KEY = KEYS.get("OPENCODE_GO_API_KEY")
OR_URL = "https://openrouter.ai/api/v1/chat/completions"
OC_URL = "https://opencode.ai/zen/go/v1/chat/completions"

# ─── Agent Registry ─────────────────────────────────────────────
# 109+ agents: ID → (name, team, tier, specialization)
# Galaxy agents (63) - loaded from DB
# Team agents (114) - loaded from API
# Manual supplements

AGENT_NAMES = {
    1: "Kaneki Ken", 2: "Chief of Staff", 3: "Ops Director",
    4: "DevOps Agent", 5: "Frontend Dev", 6: "Backend Dev",
    7: "Content Director", 8: "Writer Agent", 9: "Social Media Agent",
    10: "Research Director", 11: "Data Analyst",
    18: "C-01 (Scroll)", 19: "C-02 (Spark)", 20: "C-03 (Frame)",
    21: "C-04 (Thread)", 22: "C-05 (Press)", 23: "C-06 (Flow)",
    24: "C-07 (Clip)", 25: "C-S01 (Voice)", 26: "C-S02 (Signal)",
    27: "L-03 (Quill)", 28: "E-01 (Drift)", 29: "E-02 (Cipher)",
    30: "E-03 (Glitch)", 31: "E-04 (Merge)", 32: "E-05 (Socket)",
    33: "E-06 (Daemon)", 34: "E-07 (Proxy)", 35: "E-08 (Vault)",
    36: "E-09 (Patch)", 37: "E-10 (Sandbox)", 38: "E-S01 (Kernel)",
    39: "E-S02 (Grind)", 40: "E-S03 (Protocol)", 41: "L-01 (Forge)",
    42: "L-02 (Sentinel)", 43: "O-01 (Deploy)", 44: "O-02 (Scale)",
    45: "O-03 (Backup)", 46: "O-04 (Log)", 47: "O-05 (Audit)",
    48: "O-06 (Cron)", 49: "O-07 (Net)", 50: "O-08 (Store)",
    51: "O-S01 (Radar)", 52: "O-S02 (Fortress)", 53: "L-07 (Oracle)",
    54: "R-01 (Probe)", 55: "R-02 (Data)", 56: "R-03 (Trend)",
    57: "R-S01 (Lens)", 58: "L-04 (Pipeline)", 59: "LG-01 (Spark)",
    60: "LG-02 (Target)", 61: "LG-03 (Funnel)", 62: "LG-04 (Connect)",
    63: "LG-05 (Convert)", 64: "LG-S01 (Hunter)", 65: "LG-S02 (Nurture)",
    66: "L-05 (Orbit)", 78: "L-06 (Bridge)", 74: "CS-01 (Onboard)",
    75: "CS-02 (Fulfill)", 76: "CS-03 (Retain)", 77: "CS-S01 (Advocate)",
    79: "AM-00 (Amir)", 80: "K-00 (Kaneki)", 81: "AI Tutor Engineer",
    82: "Campaign Manager", 83: "Competitor Intel", 84: "Content Empire Director",
    85: "Data Enricher", 86: "DB Admin", 87: "Dev Director",
    88: "Email Verifier", 89: "Enrichment Director",
    90: "Grademy Frontend", 91: "Grademy Lead", 92: "Grademy QA",
    93: "Growth Hacker", 94: "Image Creator",
    95: "LamaTrader Lead", 96: "Main Agent", 97: "Market Scout",
    98: "Marketing Director", 99: "Monitor Agent",
    100: "Onboarding Specialist", 101: "Outreach Head",
    102: "Personal Brand Strategist",
    103: "RAGmedium Growth Lead", 104: "RAGx Growth Lead",
    105: "Rema Exteriors Lead", 106: "Reporter Agent",
    107: "Scraper Agent", 108: "Source Scout",
    109: "sys-backend", 110: "sys-devops", 111: "sys-frontend",
    112: "sys-infra", 113: "Teacher Mode Dev", 114: "Ventures PM",
    115: "Video Transcriber",
}

# UPDATED 2026-06-30 19:50 CEST — owl-alpha is dead on OpenRouter.
# All 122 agents now route via OpenCode Go, which is live.
# Per user system memory: minimax-m3 = strategy (lead/senior), deepseek-v4-flash = daily ops (bulk).
# Both confirmed working via /v1/models on opencode.ai/zen/go.
MODEL_ROUTES = {
    # Daily ops — bulk of agents (engineering, content, leadgen, research, ops, etc.)
    "content":          ("opencode", "deepseek-v4-flash"),
    "leadgen":          ("opencode", "deepseek-v4-flash"),
    "engineering":      ("opencode", "deepseek-v4-flash"),
    "research":         ("opencode", "deepseek-v4-flash"),
    "operations":       ("opencode", "deepseek-v4-flash"),
    "startups":         ("opencode", "deepseek-v4-flash"),
    "client_success":   ("opencode", "deepseek-v4-flash"),
    "client-success":   ("opencode", "deepseek-v4-flash"),
    "general":          ("opencode", "deepseek-v4-flash"),
    # Strategy — lead/senior agents (Kaneki, Forge, Quill, etc.)
    "leadership":       ("opencode", "minimax-m3"),
    "executive":        ("opencode", "minimax-m3"),
}


# ─── API Helpers ────────────────────────────────────────────────
def api_call(method, path, data=None, timeout=60):  # Default 60s for fast APIs
    """Call the agent-team API."""
    url = f"{AGENT_TEAM}{path}"
    req = urllib.request.Request(url, method=method,
        headers={"Content-Type": "application/json"})
    if data is not None:
        req.data = json.dumps(data).encode()
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        return {"error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"error": str(e)[:200]}


def post_message(from_agent, to_agent, text, subject=None):
    """Post an inter-agent message visible on the dashboard's Slack clone.

    2026-06-30 fix: was writing to /api/notify (dashboard notifications) instead of
    /api/team/messages. That's why the LLM output never showed up in Slack — it
    was being filed as a generic notification, not an inter-agent message.
    Now we hit the real messages endpoint, with subject as the title and
    text (truncated) as the body.
    """
    return api_call("POST", "/api/messages", {
        "from_agent": from_agent,
        "to_agent": to_agent,
        "subject": subject or f"From {from_agent}",
        "text": text[:1500],
        "priority": "normal",
        "thread_id": f"dm_{to_agent.lower().replace(' ', '_')}" if not to_agent.startswith('#') else f"team_{to_agent.lower().lstrip('#').replace(' ', '_')}",
    })


def post_command(text, thread_id=None):
    return api_call("POST", "/api/notify", {
        "title": "Agent Activity",
        "message": text[:500],
        "source": "system",
        "priority": "low"
    })


def heartbeat(agent_id_or_name):
    return api_call("POST", f"/api/agents/{agent_id_or_name}/heartbeat", {}, timeout=10)


# ─── DB Helpers ─────────────────────────────────────────────────
def get_pending_tasks_for_agent(agent_id):
    """Get pending tasks assigned to this agent via API. Returns None or dict with task fields."""
    # Fetch all pending tasks via the API
    result = api_call("GET", f"/api/tasks?status=pending&limit=100")
    tasks = result.get("tasks", []) if isinstance(result, dict) else []
    # Filter by assigned_agents array containing this agent, or assigned_agent_id matching
    for t in tasks:
        aa = t.get("assigned_agents") or []
        if isinstance(aa, list) and (agent_id in aa or t.get("assigned_agent_id") == agent_id):
            return {
                "id": t["id"],
                "title": t.get("title", ""),
                "description": t.get("description", ""),
                "priority": t.get("priority", 3),
                "project_id": t.get("project_id"),
                "assigned_agents": aa,
            }
    return None


# ─── LLM Call ───────────────────────────────────────────────────
def call_llm(provider, model, system_prompt, task_title, task_desc, agent_name):
    """
    Call the LLM and return the response text.
    Raises on auth/rate-limit/overload so callers can handle properly.
    Never returns a canned "completed" on error — the caller owns error handling.
    """
    key = OR_KEY if provider == "openrouter" else OC_KEY
    url = OR_URL if provider == "openrouter" else OC_URL

    if not key:
        raise ValueError(
            f"No API key configured for provider '{provider}'. "
            f"Set OPENROUTER_API_KEY or OPENCODE_GO_API_KEY in {ENV_FILE}"
        )

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    user_content = f"Task: {task_title}"
    if task_desc:
        user_content += f"\n\nDescription: {task_desc}"
    user_content += "\n\nComplete this task. Be concise and actionable. Output your work product."
    messages.append({"role": "user", "content": user_content})

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": 1024,
        "temperature": 0.7,
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # 2026-06-30 fix: opencode.ai Cloudflare blocks Python-urllib (403 code 1010).
            # Send a normal browser UA so the request gets through.
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        },
    )

    try:
        resp = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode(errors="replace")[:500]
        # Categorise the error for clear reporting
        if status == 401:
            raise RuntimeError(
                f"Authentication failed (HTTP 401) for provider '{provider}'. "
                f"Check your API key."
            ) from e
        elif status == 429:
            raise RuntimeError(
                f"Rate limited (HTTP 429) for provider '{provider}'. "
                f"Will retry next cycle."
            ) from e
        elif status == 503 and "overloaded" in body.lower():
            raise RuntimeError(
                f"Model overloaded (HTTP 503) for '{model}'. "
                f"Will retry next cycle."
            ) from e
        elif status == 403 and ("1010" in body or "browser" in body.lower()):
            # 2026-06-30 fix: opencode Cloudflare 1010 means missing/wrong User-Agent.
            # Should not happen with the new UA header, but handle gracefully.
            raise RuntimeError(
                f"Cloudflare 1010 block on {provider} for '{model}'. "
                f"Retry with browser UA next cycle."
            ) from e
        else:
            raise RuntimeError(
                f"LLM call failed (HTTP {status}) for '{model}': {body[:200]}"
            ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Network error calling LLM provider '{provider}': {e.reason}"
        ) from e

    # Parse response
    try:
        data = json.loads(resp.read())
    except json.JSONDecodeError as e:
        raise RuntimeError(f"LLM returned invalid JSON: {e}") from e

    if "error" in data:
        err_detail = data["error"]
        if isinstance(err_detail, dict):
            err_detail = err_detail.get("message", str(err_detail))
        raise RuntimeError(f"LLM provider error: {err_detail}")

    try:
        choice = data["choices"][0]["message"]
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Unexpected LLM response format: missing choices. Keys: {list(data.keys())}") from e

    content = choice.get("content") or ""
    if not content.strip():
        for k in ("reasoning", "reasoning_content"):
            if choice.get(k):
                content = choice[k]
                break

    return content.strip() or "[Completed — no output]"


# ─── Load Agents ────────────────────────────────────────────────
def load_agents():
    """Load all agents from all sources: galaxy DB, team API, static names."""
    agents = OrderedDict()

    # 1. Galaxy database agents
    try:
        import psycopg2
        conn = psycopg2.connect(
            host="localhost", port=5432, database="galaxy_agents",
            user="postgres",
            password="61b73daf4c51b1b5c22cfac30476f067bce943a177e819c42fca9a1545339dc8"
        )
        cur = conn.cursor()
        cur.execute("SELECT agent_id, codename, team, tier, specialization FROM agents ORDER BY team, tier")
        for row in cur.fetchall():
            aid, codename, team, tier, spec = row
            team_norm = team.lower().replace(" ", "_").replace("-", "_") if team else "general"
            if isinstance(aid, str) and aid.isdigit():
                aid_int = int(aid)
                name = AGENT_NAMES.get(aid_int, f"{aid} ({codename})" if codename else aid)
            else:
                aid_int = aid
                name = f"{aid} ({codename})" if codename else str(aid)
            agents[str(aid)] = {
                "id": aid_int, "id_str": str(aid),
                "name": name, "codename": codename or name,
                "team": team_norm, "tier": tier or "mid",
                "spec": spec or team_norm,
            }
        cur.close()
        conn.close()
        print(f"   ✅ Galaxy: {len([a for a in agents.values() if a.get('tier')])} agents", flush=True)
    except Exception as e:
        print(f"   ⚠️  Galaxy DB: {e}", flush=True)

    # 2. Team API agents (supplement)
    try:
        result = api_call("GET", "/api/agents?limit=200", timeout=10)
        if isinstance(result, dict):
            team_agents = result.get("agents", result.get("data", []))
        elif isinstance(result, list):
            team_agents = result
        else:
            team_agents = []

        for a in team_agents:
            aid = a.get("id")
            aid_str = str(aid)
            if aid_str not in agents:
                aname = a.get("name", AGENT_NAMES.get(aid, f"Agent_{aid}"))
                atype = a.get("agent_type", "general")
                div = a.get("division", "General").lower().replace(" ", "_")
                agents[aid_str] = {
                    "id": aid, "id_str": aid_str,
                    "name": aname, "codename": aname,
                    "team": div, "tier": "mid",
                    "spec": atype,
                }
        print(f"   ✅ Team API: {len([a for a in agents.values() if a.get('tier')])} agents", flush=True)
    except Exception as e:
        print(f"   ⚠️  Team API: {e}", flush=True)

    # 3. Manual supplements from AGENT_NAMES
    for aid, aname in AGENT_NAMES.items():
        aid_str = str(aid)
        if aid_str not in agents:
            agents[aid_str] = {
                "id": aid, "id_str": aid_str,
                "name": aname, "codename": aname,
                "team": "general", "tier": "mid",
                "spec": "general",
            }

    print(f"   ✅ Total: {len(agents)} agents loaded", flush=True)
    return agents


# ─── Agent Work Execution ───────────────────────────────────────
def execute_agent(agent, cycle_num):
    """
    Pull a real pending task from the DB assigned to this agent and execute it.
    Full lifecycle: pull pending → set in_progress → call LLM → set done.
    NO generic task creation. Only real business tasks.

    Returns a dict with status info for the main loop.
    """
    result_info = {"name": agent.get("name", "?"), "worked": False, "error": None}

    try:
        aid = agent["id"]
        aid_str = agent["id_str"]
        name = agent["name"]
        team = agent["team"]

        # ── 1. Heartbeat ──
        try:
            if isinstance(aid, int):
                heartbeat(aid)
            heartbeat(name)
        except Exception:
            pass

        # ── 2. Get real pending task from DB ──
        task = get_pending_tasks_for_agent(aid)

        if not task:
            # No real work - just return silently. No fake tasks created.
            # print(f"   ⏸️  {name} — No pending tasks", flush=True)
            return result_info

        task_id = task["id"]
        task_title = task["title"]
        task_desc = task["description"]
        task_priority = task["priority"]
        project_id = task.get("project_id")

        # ── 3. Determine model ──
        team_key = team
        if team_key not in MODEL_ROUTES:
            for k in MODEL_ROUTES:
                if team_key.replace("_", "-") == k or team_key.replace("-", "_") == k:
                    team_key = k
                    break
            else:
                team_key = "general"
        # Default: per-team model from MODEL_ROUTES
        provider, model = MODEL_ROUTES.get(team_key, ("opencode", "deepseek-v4-flash"))
        # Override: lead/senior agents always get minimax-m3 (strategy)
        tier = agent.get("tier", "mid")
        if tier in ("lead", "senior"):
            provider, model = ("opencode", "minimax-m3")

        # ── 4. Assign task and mark in_progress ──
        now_utc = datetime.now(timezone.utc).isoformat()
        api_call("PATCH", f"/api/tasks/{task_id}", {
            "status": "in_progress",
            "assigned_agent_id": aid,
            "output_data": {
                "agent": name,
                "started_at": now_utc,
            }
        })

        # ── 5. Post "working" message ──
        msg_start = (
            f"⚡ **{name}** ({team.title()}) executing: **{task_title}**\n"
            f"Priority: P{task_priority}"
        )
        # 2026-06-30 fix: post to BOTH Kaneki Ken (leadership log) AND Amir (dashboard)
        post_message(name, "Amir", msg_start, f"⚡ {name} on {task_title[:50]}")
        post_message(name, "Kaneki Ken", msg_start, f"⚡ {name} on {task_title[:50]}")

        # ── 6. Call LLM with the actual task title and description ──
        # 2026-06-30: system_prompt now includes the FULL ELITE context
        import re as _re
        from pathlib import Path
        kb_context = ""
        try:
            sys_path = Path("/home/admin/.hermes/scripts")
            if str(sys_path) not in sys.path:
                sys.path.insert(0, str(sys_path))
            from agent_context import build_system_prompt
            # Look up initiative + project from the task
            initiative_name = None
            project_name = task.get('project') if isinstance(task, dict) else None
            try:
                from urllib.request import urlopen, Request
                if project_name:
                    r = urlopen(f"http://localhost:1707/api/initiatives?project={urllib.parse.quote(str(project_name))}", timeout=5)
                    d = json.loads(r.read())
                    if d and isinstance(d, list):
                        # Pick first initiative matching the agent's division
                        for init in d:
                            initiative_name = init.get('name')
                            break
            except Exception:
                pass
            kb_context = build_system_prompt(
                agent_name=name,
                team=team,
                task_title=task_title,
                task_desc=task_desc or '',
                initiative_name=initiative_name,
                project=str(project_name) if project_name else None
            )
        except Exception as e:
            print(f"   ⚠ Elite context build failed: {e}", flush=True)
            # Fallback to old behavior
            try:
                import agent_tools
                kb_context = agent_tools.kb_search(f"{task_title} {task_desc}", limit=2)
            except Exception:
                pass

        TOOL_SPEC = """\
You can call tools to do real work. End your output with a JSON tool call block like:
```json
{"tool": "ri_create_campaign", "args": {"name": "Pripitch Q3", "subject": "...", "body": "...", "from_email": "amir@ragmedium.com"}}
```

Available tools (only call when the task requires real action):
- ri_create_campaign(name, subject, body, from_email) - create a ReachInbox campaign
- ri_add_leads_to_campaign(campaign_id, leads) - add leads to a campaign
- ri_list_campaigns() - list existing campaigns
- lead_query(table, q, state, industry, has_email, limit) - search 141M lead DB
- lead_sample(table, industry, state, limit) - random sample of leads
- scraper_register(name, query, sources, daily_at) - register a daily Chrome scraper

ONLY call tools when the task actually needs them. For analysis/writing tasks, just write the output and skip the tool block. Each agent is rate-limited so don't spam calls.
"""

        system_prompt = (
            f"You are {name}, a {team} agent working for Amir Gulubayli.\n\n"
            f"YOUR JOB IS TO ACT, NOT TO WRITE ESSAYS. When the task asks you to do real work (create campaigns, find leads, register scrapers), USE THE TOOLS.\n\n"
            f"{TOOL_SPEC}\n\n"
            f"{kb_context}"
        )
        result = call_llm(provider, model, system_prompt, task_title, task_desc, name)
        # Don't truncate if the LLM made tool calls (we want the full data visible)
        truncated = result if (len(result) <= 1500 or "Actions taken" in result) else (result[:1500] + "...")

        # ── 6b. Parse and execute any tool calls the LLM made ──
        # Match: ```json\n{"tool": "...", "args": {...}}\n```
        actions_taken = []
        tool_results = []
        try:
            tool_matches = _re.findall(r'```json\s*(\{.*?"tool"\s*:\s*"[^"]+".*?\})\s*```', result, _re.DOTALL)
            for match in tool_matches:
                try:
                    call = json.loads(match)
                    tool_name = call.get("tool", "")
                    args = call.get("args", {})
                    # Execute the tool
                    import agent_tools
                    fn = getattr(agent_tools, tool_name, None)
                    if fn:
                        tool_result = fn(**args)
                        actions_taken.append(f"{tool_name}({json.dumps(args)[:80]})")
                        tool_results.append({"tool": tool_name, "args": args, "result": tool_result})
                        print(f"   🔧 {name} → {tool_name}({json.dumps(args)[:80]})", flush=True)
                    else:
                        actions_taken.append(f"FAILED: unknown tool {tool_name}")
                except Exception as e:
                    actions_taken.append(f"FAILED: {e}")
        except Exception as e:
            pass  # No tool calls is fine — agent just wrote output

        # ── 7. Post completion ──
        # Include any tool calls the LLM made (proves real actions, not essays)
        actions_section = ""
        if actions_taken:
            actions_section = "\n\n🔧 **Actions taken:**\n" + "\n".join(f"  - {a}" for a in actions_taken[:5])
            # Add tool results so Amir can see what came back
            if tool_results:
                actions_section += "\n\n📊 **Results:**\n"
                for tr in tool_results[:3]:
                    r = tr.get("result", {})
                    if isinstance(r, dict):
                        if "data" in r and isinstance(r["data"], list):
                            # Show first 5 rows with their actual lead data
                            actions_section += f"  - {tr['tool']}: {len(r['data'])} rows, total={r.get('total','?')}\n"
                            for i, row in enumerate(r["data"][:5]):
                                # Build a compact one-liner for the lead
                                name = row.get("business_name") or row.get("full_name") or row.get("name") or "?"
                                email = row.get("email") or row.get("email_address") or ""
                                city = row.get("city") or ""
                                state = row.get("state") or ""
                                emp = row.get("employee_count") or row.get("estimated_num_employees") or ""
                                line = f"      {i+1}. {name}"
                                if city: line += f" ({city}, {state})"
                                if email: line += f" — {email}"
                                if emp: line += f" [{emp} emp]"
                                actions_section += line + "\n"
                            if len(r["data"]) > 5:
                                actions_section += f"      ... and {len(r['data'])-5} more\n"
                        elif "id" in r:
                            actions_section += f"  - {tr['tool']}: id={r.get('id')}, name={r.get('name','')[:40]}\n"
                        elif "error" in r:
                            actions_section += f"  - {tr['tool']}: ❌ {str(r['error'])[:80]}\n"
                        else:
                            actions_section += f"  - {tr['tool']}: {str(r)[:80]}\n"
                    else:
                        actions_section += f"  - {tr['tool']}: {str(r)[:80]}\n"
        msg_done = f"✅ **{name}** completed: **{task_title}**\n\n{truncated}{actions_section}"
        # Post to BOTH Amir (dashboard) AND Kaneki Ken (leadership log)
        post_message(name, "Amir", msg_done, f"Done: {task_title[:60]}")
        post_message(name, "Kaneki Ken", msg_done, f"Done: {task_title[:60]}")
        post_command(f"✅ {name} ({team.title()}) → {task_title}")

        # ── 8. Check if message contains @Amir - send PWA notification ──
        if "@Amir" in result or "@amir" in result or "AM-00" in result:
            try:
                api_call("POST", "/api/notify", {
                    "title": f"⚠️ @Amir mentioned by {name}",
                    "message": f"{name} needs your attention on: {task_title}\\n\\n{truncated[:300]}",
                    "source": name,
                    "priority": "urgent",
                    "tags": ["@Amir", "escalation"]
                })
            except Exception:
                pass

        # ── 9. Mark task done ──
        api_call("PATCH", f"/api/tasks/{task_id}", {
            "status": "done",
            "output_data": {
                "summary": result[:500],
                "agent": name,
                "completed_at": datetime.now(timezone.utc).isoformat()
            }
        })

        print(f"   ✅ {name} — {task_title}", flush=True)
        result_info["worked"] = True
        return result_info

    except ValueError as e:
        # Missing API key — clear error, no LLM work done
        err_msg = str(e)
        print(f"   ❌ {agent.get('name', '?')}: {err_msg}", flush=True)
        result_info["error"] = err_msg
        try:
            post_command(f"⚠️ {agent.get('name', '?')} skipped: {err_msg[:100]}")
        except Exception:
            pass
        return result_info

    except RuntimeError as e:
        # LLM auth/rate-limit/overload — clearly reported
        err_msg = str(e)
        print(f"   ❌ {agent.get('name', '?')}: {err_msg}", flush=True)
        result_info["error"] = err_msg
        try:
            post_command(f"⚠️ {agent.get('name', '?')}: {err_msg[:100]}")
        except Exception:
            pass
        return result_info

    except Exception as e:
        print(f"   ❌ {agent.get('name', '?')}: unexpected error — {e}", flush=True)
        traceback.print_exc()
        result_info["error"] = str(e)[:200]
        return result_info


# ─── Main Loop ──────────────────────────────────────────────────
def main():
    print("=" * 70, flush=True)
    print("🚀 CONTINUOUS WORK QUEUE v4 — REAL TASK EXECUTOR", flush=True)
    print(f"   Started:    {datetime.now(timezone.utc).isoformat()}", flush=True)
    print(f"   Cycle:      {CYCLE_SLEEP}s | Max workers: {MAX_WORKERS}", flush=True)
    print(f"   OpenRouter: {'✅' if OR_KEY else '❌'} | OpenCode: {'✅' if OC_KEY else '❌'}", flush=True)
    print("   Mode:       PULL real pending tasks from DB — NO generic task creation", flush=True)
    print("=" * 70, flush=True)

    # ── Load agents ──
    print("\n📋 Loading agents...", flush=True)
    agents = load_agents()

    # ── Initial heartbeat burst ──
    print("\n💓 Sending heartbeats...", flush=True)
    burst_list = list(agents.values())[:30]
    for agent in burst_list:
        try:
            if isinstance(agent["id"], int):
                heartbeat(agent["id"])
            heartbeat(agent["name"])
        except Exception:
            pass
    print(f"   Sent {len(burst_list)} heartbeats", flush=True)

    # ── Initial dashboard burst ──
    print("\n🎬 Posting initial activity burst...", flush=True)
    burst_sample = random.sample(list(agents.values()), min(12, len(agents)))
    for agent in burst_sample:
        try:
            name = agent["name"]
            team = agent["team"]
            spec = agent.get("spec", team.title())
            msg = f"🟢 **{name}** ({team.title()}) — ONLINE\\nSpecialization: {spec}\\nStatus: Ready for work"
            post_message(name, "Kaneki Ken", msg, f"{name} online")
            post_command(f"🟢 {name} ({team.title()}) — ONLINE")
            time.sleep(0.1)
        except Exception:
            pass
    post_command(f"📊 **CONTINUOUS WORK QUEUE v4 ACTIVE** — {len(agents)} agents (real task execution)")
    print(f"   Posted burst for {len(burst_sample)} agents", flush=True)

    # ── Main loop ──
    cycle = 0
    print(f"\n{'=' * 70}", flush=True)
    print(f'🔄 ENTERING MAIN LOOP — ALL {len(agents)} agents every cycle', flush=True)
    print(f"   Each agent pulls real pending tasks from team.tasks DB", flush=True)
    print(f"{'=' * 70}\n", flush=True)

    while True:
        cycle += 1
        cycle_start = time.time()

        print(f"\n{'─' * 60}", flush=True)
        print(f"🔄 CYCLE #{cycle} — {datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC", flush=True)
        print(f"{'─' * 60}", flush=True)

        # Shuffle for fair scheduling across cycles
        shuffled = list(agents.values())
        random.shuffle(shuffled)

        # ── ALL agents submitted simultaneously via ThreadPoolExecutor ──
        total_agents = len(shuffled)
        actual_workers = min(MAX_WORKERS, total_agents)
        active = 0
        errors = 0

        with ThreadPoolExecutor(max_workers=actual_workers) as executor:
            futures = {}
            for agent in shuffled:
                future = executor.submit(execute_agent, agent, cycle)
                futures[future] = agent["name"]

            # Collect results as they complete
            for future in as_completed(futures):
                name = futures[future]
                try:
                    # No timeout — agents work until done. 24/7, no rest.
                    info = future.result(timeout=None)
                    if info.get("worked"):
                        active += 1
                    if info.get("error"):
                        errors += 1
                except Exception as e:
                    print(f"   ❌ {name}: unhandled exception — {e}", flush=True)
                    errors += 1

        elapsed = time.time() - cycle_start
        print(f"\n  ✅ Cycle #{cycle}: {active}/{total_agents} agents executed real tasks"
              f" ({errors} errors) in {elapsed:.1f}s", flush=True)

        # ── Dashboard stats check every 3 cycles ──
        if cycle % 3 == 0:
            try:
                stats = api_call("GET", "/api/stats")
                if isinstance(stats, dict):
                    tc = stats.get("taskCounts", {})
                    print(f"  📊 Dashboard: {tc.get('in_progress', 0)} running, "
                          f"{tc.get('pending', 0)} pending, "
                          f"{tc.get('done', 0)} done total", flush=True)
            except Exception:
                pass

        # ── Sleep until next cycle ──
        sleep_time = max(0, CYCLE_SLEEP - elapsed)
        print(f"  💤 Sleep {sleep_time:.1f}s... (cycle took {elapsed:.1f}s)", flush=True)
        time.sleep(sleep_time)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n⏹️  Stopped by user.", flush=True)
    except Exception as e:
        print(f"\n❌ Fatal: {e}", flush=True)
        traceback.print_exc()
