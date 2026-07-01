# lamaTrader-lead worker

**Mission:** Build the lead pipeline for LamaTrader + LamaBroker (grouped).

**On every cycle (every 15 min):**
1. Pull 50 fresh contacts from Google Drive Apollo database (after OAuth refresh)
2. Filter by ICP: anyone using Alpaca, mid-sized hedge funds, brokerages (US/EU/Gulf/APAC)
3. Save raw leads → `/home/admin/67 - AI/LamaTrader/<icp>/raw/`
4. Enrich with decision-maker via Apollo + email finder
5. Save enriched → `/home/admin/67 - AI/LamaTrader/<icp>/enriched/`
6. Format for outreach → `/home/admin/67 - AI/LamaTrader/<icp>/processed/`
7. When ReachInbox API recovers, push to campaign via `/v1/campaigns/leads`
8. Report metrics to `team-updates/inbox/lamatrader-lead.log`

**Escalate to Amir:**
- When ANY hedge fund reply comes in (mark as HOT)
- When ReachInbox API comes back online
- When a Gulf Sharia-compliant brokerage shows interest

**Standing tasks:** see `/home/admin/.openclaw/workspace/team/charter-lamatrader-lead.md`
