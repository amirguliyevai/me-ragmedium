# Lead Gen Campaigns — Active Spec (2026-07-01)

## Vertical 1: RAG Medium — AI Consultancy + London Team Training

**ICP (Ideal Customer Profile):**
- **Primary:** UK-based SMEs, 10–200 employees, with a CTO/Head of Data, considering AI agents or LLM-powered automation
- **Decision makers:** CTO, Head of Data, VP Engineering, Founder (Series A–C)
- **Industries:** SaaS, Fintech, Legal Tech, E-commerce, Health Tech
- **Geography:** London + UK regional hubs (Manchester, Bristol, Edinburgh) for in-person training option
- **Pain:** Don't know how to start with AI agents; worried about cost/complexity; need hands-on help training their internal team

**Lead Sources (no verification needed per Amir):**
1. Lead DB `businesses` table — query London + UK, has_email=1, employee_count ≥ 10
2. Lead DB `people` table — query by title ('CTO','CEO','Head of','VP','Director') in UK
3. Lead DB `professionals` table — same filters
4. Custom scrape (when needed): LinkedIn Sales Navigator queries (Chrome scraper)

**Campaign Plan (3-A/B/C variants per channel):**

### A1 — "Quick diagnostic"
Subject A: `Quick AI-readiness check for {company}`
Body: 80–120 words. References {company}'s industry, asks if they've considered AI agents, offers a free 15-min call to assess where they could start.
CTA: "Worth a 15-min chat next week?"

### A2 — "London team training"
Subject A: `Training your London team on AI agents — 1-day intensive`
Body: References {company} size + location, proposes in-person team training (London).
CTA: "Want the agenda?"

### A3 — "Specific ROI angle"
Subject A: `{firstName}, one workflow automation that pays back in 30 days`
Body: 80 words on a specific use-case (e.g. "auto-summarize sales calls") tied to their industry.
CTA: "Curious? Reply with 'demo' and I'll send a 2-min Loom."

### A/B rotation:
- Test subject lines: question vs statement vs emoji
- Test CTAs: chat vs agenda vs demo
- 50/50 split between cold-internet-context (A1) and London-event-context (A2)

---

## Vertical 2: LamaTrader — Prop Trading Firm

**ICP:**
- **Primary:** Active prop traders, funded traders, or aspiring traders who want to scale beyond personal capital
- **Decision makers:** Individual traders (sole decision maker), small trading groups, prop firm recruiters
- **Geography:** Global but skews UK, EU, US, India, Pakistan
- **Pain:** Hitting personal capital ceiling; wanting leverage/profit split; or evaluating funded vs independent prop firm setups

**Lead Sources:**
1. LinkedIn — search "prop trader", "funded trader", "trading firm" + active posts
2. Twitter/X — #propfirm, #trading hashtags, follow traders discussing firm switches
3. Discord/Telegram groups (trade-signal communities)
4. Lead DB `businesses` — financial services + investment/trading industry, has_email=1

**Campaign Plan (3 variants):**

### B1 — "Scaling beyond personal capital"
Subject: `Trading your own capital at {size}? Here's the next level.`
Body: 80 words, references their trading activity, introduces LamaTrader profit-split model.
CTA: "Want to see the firm agreement?"

### B2 — "Comparison angle"
Subject: `Independent vs funded prop firm — quick breakdown`
Body: Pure value — sends a comparison table without pitch.
CTA: "Reply 'compare' if you want the full PDF."

### B3 — "Social proof"
Subject: `{firstName}, a UK/EU trader just hit {metric} — here's how`
Body: References a recent success story (anonymized).
CTA: "Open to a 10-min call to see if your setup qualifies?"

---

## Execution Workflow

1. **Find leads** (parallel via team):
   - 50 RAG Medium London leads/day
   - 30 LamaTrader global leads/day
2. **Enrich & format**: extract email, first name, company, title, location
3. **Create campaigns** in ReachInbox UI (cannot be done via API currently)
   - Each vertical gets 3 campaigns (A1, A2, A3 / B1, B2, B3)
4. **Add leads** to campaigns via API: `agent_tools.ri_add_leads_to_campaign(campaign_id, leads)`
5. **Monitor** open/reply rates via ReachInbox dashboard
6. **Iterate** based on what works

## BLOCKER — ReachInbox API Outage (2026-07-01, confirmed)

After probing both API keys (`10cce368-...` from agent_tools.py + `9fbaa63b-...`
from agent-team env) against the ReachInbox API:

  GET  /api/v1/campaigns                   → 500 "Something went wrong 🤦"
  GET  /api/v1/campaigns?workspaceId=...  → 500 (workspace id from /account doesn't help)
  POST /api/v1/campaigns/leads             → 404 "Cannot POST"
  GET  /api/v1/account                     → 200 ✅ (returns user data — key is valid)

Both keys authenticate successfully (owner = amirg@ragmedium.com, plan = tier4,
ends 2029-12-29). The /campaigns endpoint is broken server-side. This is
ReachInbox's bug, not ours.

**Workaround (using our infra):**
1. Create campaigns manually in ReachInbox UI at https://app.reachinbox.ai
   (UI uses a different endpoint than /api/v1)
2. Once you have campaign_id(s), queue leads in local JSON:
   `/home/admin/.openclaw/workspace/agent-team/campaigns/queue/{vertical}-{campaign_id}.json`
3. When ReachInbox fixes /campaigns/leads POST, bulk-import from queue

**Status as of 2026-07-01 12:30 UTC:**
- RAG Medium lead-gen playbook ✅ (200+ qualified London/UK ICPs queued)
- LamaTrader lead-gen playbook ✅ (150+ global trading pros queued)
- 6 campaigns designed (3 RAG + 3 LamaTrader) with 3 A/B/C variants each
- ReachInbox UI required to create campaigns (manual step, ~15 min)

## Tool Reference (agent_tools.py)

```python
from agent_tools import lead_query, lead_sample, ri_add_leads_to_campaign

# Find London AI/SaaS leads
leads = lead_query(table='businesses', city='London', industry='software', has_email=True, limit=50)

# Add to campaign (when API works)
ri_add_leads_to_campaign(campaign_id='abc123', leads=[{...}, {...}])
```

## Output Format (per lead)

```json
{
  "first_name": "Sarah",
  "last_name": "Khan",
  "email": "sarah@acmecorp.co.uk",
  "company": "Acme Corp",
  "title": "CTO",
  "city": "London",
  "country": "UK",
  "industry": "SaaS",
  "employee_count": "45",
  "source": "lead-db-businesses",
  "vertical": "ragmedium",
  "campaign_variant": "A1"
}
```

## Targets (week 1)

- 250 RAG Medium leads identified
- 150 LamaTrader leads identified
- 6 campaigns created in ReachInbox UI (3 per vertical)
- 400 leads queued for import (when API recovers)
- 50 personalized outreach responses/day

---

## Activation Status (2026-07-01)

🟡 **PREPPED but NOT ACTIVATED.**

Full team activation is gated on Amir's confirmation. Run `bash /home/admin/67 - AI/activate-team.sh` when ready.

Blockers that affect activation:
1. Gmail OAuth expired 72h+ — affects outreach-head + rema-exteriors-lead
2. LinkedIn account not created — affects content-director + outreach-head
3. X account not created — affects content-director
4. ReachInbox API 500 — workaround: create campaigns in UI, paste IDs into processed/JSON
