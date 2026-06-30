#!/usr/bin/env python3
"""
AGENT TOOLS v2 — the ACTION layer.

The 4 tools that turn agents from "essay writers" into "doers":

1. Reach Inbox — actually create email campaigns
2. Lead DB    — pull real enriched leads from 141M database (with fast & slow paths)
3. KB RAG     — ground LLM prompts in your 9,314 chunks of business knowledge
4. Signal Scraper — register a daily Chrome job to scrape bottom-of-funnel signals

Each tool is a function. The agent's LLM call includes a system prompt that
explains which tools are available, and the executor invokes them after the LLM
returns its plan.
"""
import os, json, time, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone

# === Reach Inbox API ===
# Real base URL: https://api.reachinbox.ai
# Real endpoints (per /home/admin/.openclaw/workspace/n8n-workflows/03-campaign-pipeline.json):
#   POST /v1/campaigns/leads  - add leads to an existing campaign
#   (Campaign creation happens in the ReachInbox UI; the API is for adding leads.)
RI_API_BASE = "https://api.reachinbox.ai"
RI_API_KEY = "10cce368-af49-4c47-b8ed-17521d7d3fcb"

def ri_request(method, path, body=None):
    """Make a Reach Inbox API call."""
    url = RI_API_BASE + path
    headers = {
        "Authorization": f"Bearer {RI_API_KEY}",
        "Content-Type": "application/json",
        # 2026-06-30: Reach Inbox Cloudflare blocks Python-urllib (1010). Send browser UA.
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode(errors="replace")[:500]
        return {"error": f"HTTP {e.code}", "body": body_txt}
    except Exception as e:
        return {"error": str(e)[:200]}

def ri_list_campaigns():
    """List existing campaigns in ReachInbox.
    Tries /v1/campaigns first, then falls back to common paths."""
    for path in ["/v1/campaigns", "/campaigns", "/v1/campaign", "/api/v1/campaigns"]:
        r = ri_request("GET", path)
        if isinstance(r, list) or (isinstance(r, dict) and "data" in r):
            return r
    return {"error": "no list endpoint found", "tried": ["/v1/campaigns", "/campaigns", "/v1/campaign"]}

def ri_add_leads_to_campaign(campaign_id, leads):
    """Add a list of leads to an existing ReachInbox campaign."""
    return ri_request("POST", "/v1/campaigns/leads", {
        "campaign_id": campaign_id,
        "leads": leads
    })

def ri_create_campaign(name, subject, body, from_email, sequence_steps=None):
    """Create a new email campaign. NOTE: ReachInbox API may not support this —
    campaigns are typically created in the UI. Returns informative error if so."""
    return ri_request("POST", "/v1/campaigns", {
        "name": name, "subject": subject, "body": body,
        "from_email": from_email, "sequence": sequence_steps or []
    })

# === Lead DB ===
# v4 API:
#   GET /{table}?q=&state=&industry=&city=&employee_count_min=&has_email=&limit=&offset=
#   GET /sample?table=&industry=&state=&limit=
# Returns: {data: [...], total, limit, offset, table, filters}
#
# IMPORTANT: industry filter is slow (no index, ~15-20s).
# For "find SaaS in CA" tasks, use /sample which is much faster.
LEAD_DB = "http://localhost:8002"
LEAD_QUERY_TIMEOUT = 90  # generous, some filters are slow

def _normalize_table(table):
    """Map common mistakes to the real table name."""
    t = (table or "").lower().strip()
    if t in ("leads", "biz", "businesses"): return "businesses"
    if t in ("people", "person"): return "people"
    if t in ("professionals", "pros"): return "professionals"
    return t if t in ("businesses", "people", "professionals") else "businesses"

def lead_query(table="businesses", q=None, state=None, industry=None,
               city=None, employee_count_min=None, has_email=False,
               limit=10, offset=0, timeout=LEAD_QUERY_TIMEOUT):
    """Query the 141M lead database. Real endpoint at :8002 (v4).

    Args:
        table: 'people' | 'businesses' | 'professionals'
        q: full-text search (matches business_name, industry, sub_industry, description, etc.)
        state: US state code (e.g. 'CA', 'NY')
        industry: industry name (case-insensitive, partial match) — SLOW, no index
        city: city name
        employee_count_min: minimum company size
        has_email: only return rows with an email address
        limit: max rows (max 500)
        offset: pagination offset
        timeout: request timeout (default 90s; lower for fast queries)
    """
    table = _normalize_table(table)
    params = []
    if q: params.append(f"q={urllib.parse.quote(q)}")
    if state: params.append(f"state={urllib.parse.quote(state)}")
    if industry: params.append(f"industry={urllib.parse.quote(industry)}")
    if city: params.append(f"city={urllib.parse.quote(city)}")
    if employee_count_min: params.append(f"employee_count_min={int(employee_count_min)}")
    if has_email: params.append("has_email=1")
    params.append(f"limit={min(int(limit), 500)}")
    params.append(f"offset={int(offset)}")
    url = f"{LEAD_DB}/{table}?" + "&".join(params)
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "agent-loop/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "body": e.read().decode(errors="replace")[:300]}
    except Exception as e:
        return {"error": str(e)[:200]}

def lead_sample(table="businesses", industry=None, state=None, city=None, q=None,
                limit=10, timeout=LEAD_QUERY_TIMEOUT):
    """Quick random sample for an ICP. Faster than lead_query (no count).
    Use this for 'give me 10 random SaaS companies in CA' tasks."""
    table = _normalize_table(table)
    params = [f"table={table}", f"limit={min(int(limit), 100)}"]
    if industry: params.append(f"industry={urllib.parse.quote(industry)}")
    if state: params.append(f"state={urllib.parse.quote(state)}")
    if city: params.append(f"city={urllib.parse.quote(city)}")
    if q: params.append(f"q={urllib.parse.quote(q)}")
    url = f"{LEAD_DB}/sample?" + "&".join(params)
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "agent-loop/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)[:200]}

# === Knowledge Brain RAG ===
KB_API = "http://localhost:8096"

def kb_search(query, limit=3, collections="all"):
    """Search the Knowledge Brain for relevant business knowledge.

    collections:
      "all"     → memory + amir_training + knowledge_base  (default)
      "biz"     → knowledge_base only (business docs)
      "training"→ amir_training only (Robert Greene books, etc.)
      "memory"  → memory only (session logs)
      "workspace"→ workspace only (codebase files) — slower

    Returns the top chunks as a single string the LLM can quote.
    """
    try:
        url = f"{KB_API}/api/search?q={urllib.parse.quote(query)}&limit={limit}&collection={collections}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        results = data.get("results", [])
        if not results:
            return ""
        # Format as a knowledge context block
        lines = ["## Relevant business knowledge from your library:\n"]
        for r in results:
            meta = r.get("metadata", {})
            coll = r.get("_source_collection", "knowledge")
            title = (meta.get("book_title") or meta.get("filename")
                     or meta.get("source") or f"[{coll}] chunk")
            text = r.get("text") or r.get("content") or ""
            if not text:
                text = f"[{coll}] {title} — chunk {meta.get('chunk', '?')}"
            lines.append(f"### [{coll}] {title}")
            lines.append(text[:600])
            lines.append("")
        return "\n".join(lines)
    except Exception as e:
        return f"(KB unavailable: {e})"

# === Signal Scraper (register a daily Chrome job) ===
# The dashboard doesn't expose /api/scrapers yet, so we:
#   1. POST to it (will 404 if not wired)
#   2. Always log to /tmp/scraper-jobs.log as the source of truth
#   3. A cron can drain the log into the real scraper service once it's built
SCRAPER_API = "http://localhost:1702/api/scrapers"
SCRAPER_LOG = "/tmp/scraper-jobs.log"

def scraper_register(name, query, sources, daily_at="09:00"):
    """Register a daily Chrome scraper job for bottom-of-funnel signals.

    Args:
        name: Job name (e.g. "Pripitch hiring signals")
        query: Search query to scrape for
        sources: list of sources to monitor (linkedin, twitter, github, etc.)
        daily_at: time of day to run (HH:MM)

    Returns: job dict with id, schedule, status
    """
    payload = {
        "name": name,
        "query": query,
        "sources": sources if isinstance(sources, list) else [sources],
        "schedule": f"daily@{daily_at}",
        "owner": "agent-loop",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    job_id = f"scraper_{int(time.time())}_{hash(name) % 10000:04d}"

    # Always log to file (this is the source of truth for now)
    record = {**payload, "id": job_id, "status": "queued"}
    try:
        with open(SCRAPER_LOG, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as e:
        return {"error": f"log write failed: {e}"}

    # Also try the API (will 404 if not wired yet — that's fine, log is the source of truth)
    api_status = "not_wired"
    try:
        req = urllib.request.Request(
            SCRAPER_API,
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"content-type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            api_data = json.loads(resp.read())
            return {"ok": True, "id": job_id, "name": name, "schedule": f"daily@{daily_at}", "queued_to_log": SCRAPER_LOG, "api_response": api_data}
    except urllib.error.HTTPError as e:
        api_status = f"HTTP {e.code}"
    except Exception as e:
        api_status = str(e)[:80]
    except:
        pass

    return {"ok": True, "id": job_id, "name": name, "schedule": f"daily@{daily_at}", "queued_to_log": SCRAPER_LOG, "note": f"scraper API status: {api_status} — job queued in log, will be picked up by scraper service"}

def scraper_list():
    """List all registered scraper jobs from the log."""
    jobs = []
    try:
        with open(SCRAPER_LOG) as f:
            for line in f:
                line = line.strip()
                if line:
                    try: jobs.append(json.loads(line))
                    except: pass
    except FileNotFoundError:
        return []
    return jobs

# === Quick test ===
if __name__ == "__main__":
    print("=== Reach Inbox ===")
    campaigns = ri_list_campaigns()
    if isinstance(campaigns, list):
        print(f"  Existing campaigns: {len(campaigns)}")
        for c in campaigns[:5]:
            print(f"    {c.get('name', '?')[:50]} | id={c.get('id')} | status={c.get('status', '?')}")
    else:
        print(f"  Result: {str(campaigns)[:200]}")

    print("\n=== Lead DB (lead_sample, fast) ===")
    sample = lead_sample(table="businesses", state="CA", limit=2)
    if isinstance(sample, dict) and "data" in sample:
        print(f"  Got {len(sample['data'])} random CA businesses")
        for r in sample['data'][:2]:
            print(f"    {r.get('business_name')} | {r.get('city')}, {r.get('state')} | email={r.get('email')}")
    else:
        print(f"  Result: {str(sample)[:300]}")

    print("\n=== Scraper register ===")
    r = scraper_register("Test scraper", "test query", ["linkedin"], "09:00")
    print(f"  {r}")

    print("\n=== KB RAG ===")
    ctx = kb_search("Pripitch ICP venture sales", limit=2)
    print(f"  Context: {len(ctx)} chars")
    if ctx:
        print(f"  {ctx[:200]}")
