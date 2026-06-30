#!/usr/bin/env python3
"""
ELITE AGENT CONTEXT BUILDER

Loads for every agent task:
1. ALL skills available on the system (~/.hermes/skills/) — full content
2. RAG Knowledge Brain — semantic search for the task
3. Initiative context (initiative name, goal, lead agent)
4. Project context (venture)
5. ReachInbox API cheat sheet (verified)
6. Peer agents available + their assignments

This is what every agent "sees" before completing a task.
"""
import os, sys, json, glob, urllib.request, urllib.parse
from pathlib import Path

KB_API = "http://localhost:8096"
SKILLS_DIR = Path("/home/admin/.hermes/skills")
ACTIVE_DIR = Path("/home/admin/.openclaw/workspace/.hermes/skills")  # if exists

def http_get(url, timeout=5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)[:200]}

def load_skills(max_chars=800):
    """Load all available skill files (~/.hermes/skills/*/SKILL.md)."""
    skills = []
    for skills_dir in [SKILLS_DIR, ACTIVE_DIR]:
        if not skills_dir.exists():
            continue
        for f in skills_dir.rglob("SKILL.md"):
            try:
                content = f.read_text()
                # Strip frontmatter
                if content.startswith("---"):
                    parts = content.split("---", 2)
                    if len(parts) >= 3:
                        content = parts[2].strip()
                # Truncate
                if len(content) > max_chars:
                    content = content[:max_chars] + "\n... (truncated)"
                rel = str(f.relative_to(skills_dir))
                skills.append(f"## SKILL: {rel}\n{content}")
            except Exception as e:
                pass
    return "\n\n---\n\n".join(skills) if skills else ""

def load_kb(query, limit=3):
    """Search KB for relevant chunks."""
    url = f"{KB_API}/api/search?q={urllib.parse.quote(query)}&limit={limit}&collection=knowledge"
    d = http_get(url)
    chunks = []
    for r in d.get("results", []):
        text = r.get("text") or r.get("content") or ""
        src = r.get("metadata", {}).get("source", "?")
        chunks.append(f"[{src}] {text}")
    return "\n\n".join(chunks) if chunks else "(no KB results)"

REACHINBOX_CHEATSHEET = """\
# REACHINBOX API CHEAT SHEET (verified Jun 30, 2026)

Base URL: https://api.reachinbox.ai
Account: amirg@ragmedium.com | Tier 4 plan (active till 2029-12-29)
Workspace: 2ebd64c2-3f07-486a-9b51-2144c72d05a5
Auth: Authorization: Bearer <RI_API_KEY>
Cloudflare blocks Python-urllib — ALWAYS send User-Agent: Mozilla/5.0...

## VERIFIED ENDPOINTS
- GET /api/v1/account → {user details, plan, workspace}

## KNOWN UNSTABLE
- GET /api/v1/campaigns → 500 (server bug, retry or work around via UI)
- POST /v1/campaigns → NOT SUPPORTED via API — campaigns created via UI only

## WORKING WORKFLOWS
1. Add leads to existing campaign:
   POST /v1/campaigns/leads
   {campaign_id, leads: [{email, first_name, last_name, ...}]}

2. List email accounts:
   GET /v1/account (or use account details)

3. For campaign creation, USE THE UI or n8n workflows
   (n8n has working campaign creation flow)
"""

def build_system_prompt(agent_name, team, task_title, task_desc, initiative_name=None, project=None):
    """Build the FULL elite agent system prompt."""
    parts = []

    # Identity
    parts.append(f"YOU ARE: {agent_name} | Division: {team} | Venture: {project or 'RAG Empire'}")
    parts.append("Working for Amir Gulubayli (amir@ragmedium.com). He's the boss.")
    parts.append("")
    parts.append("## YOUR MINDSET")
    parts.append("- ACT, don't write essays. Every task should produce a deliverable.")
    parts.append("- Use real tools (write the ```json tool_call {}``` block).")
    parts.append("- If a tool fails 3x, escalate to @Amir with @Kaneki_Ken tagged.")
    parts.append("- Check the KB first if unsure.")
    parts.append("")

    # Initiative context
    if initiative_name or project:
        parts.append("## INITIATIVE CONTEXT")
        if project:
            parts.append(f"Project (Venture): {project}")
        if initiative_name:
            parts.append(f"Goal: {initiative_name}")
        parts.append("")

    # KB context for this specific task
    parts.append("## KNOWLEDGE FROM YOUR LIBRARY")
    parts.append(f"_(top 3 most relevant chunks for: {task_title})_")
    parts.append(load_kb(f"{task_title} {task_desc}", limit=3))
    parts.append("")

    # All skills
    skills = load_skills(max_chars=600)
    if skills:
        parts.append("## ALL SKILLS AVAILABLE TO YOU")
        parts.append(skills)
        parts.append("")

    # ReachInbox cheat sheet
    if team == "leadgen" or "email" in task_title.lower() or "campaign" in task_title.lower() or "outbound" in task_title.lower():
        parts.append(REACHINBOX_CHEATSHEET)
        parts.append("")

    # Tools spec
    parts.append("## TOOLS YOU CAN CALL")
    parts.append("""\
To do real work, end your output with a ```json``` block like:
```json
{"tool": "ri_add_leads_to_campaign", "args": {"campaign_id": 123, "leads": [{"email": "x@y.com", "first_name": "John"}]}}
```

Available tools:
- `ri_create_campaign(name, subject, body, from_email)` → may return error (UI-only)
- `ri_add_leads_to_campaign(campaign_id, leads)` → adds to existing campaign
- `ri_list_campaigns()` → list current campaigns
- `lead_query(table, q, state, industry, has_email, limit)` → search 141M-lead DB
- `lead_sample(table, industry, state, limit)` → random sample (fast)
- `scraper_register(name, query, sources, daily_at)` → register daily Chrome scraper
- `kb_search(query, limit)` → semantic search KB (already injected above)

For writing tasks, OUTPUT YOUR WORK (text) and SKIP the tool block.
""")

    return "\n".join(parts)

if __name__ == "__main__":
    # Test
    sys.path.insert(0, "/home/admin/.hermes/scripts")
    prompt = build_system_prompt(
        agent_name="LG-01 (Outreach)",
        team="leadgen",
        task_title="Create Q3 SaaS outbound campaign in ReachInbox",
        task_desc="Send 500 SaaS prospects in CA a 3-step cold email sequence",
        initiative_name="Q3 SaaS Outbound Campaign",
        project="prpitch"
    )
    print(f"Built system prompt: {len(prompt)} chars")
    print("---PREVIEW (first 1500 chars)---")
    print(prompt[:1500])
    print("---")
    print(prompt[-1500:])
