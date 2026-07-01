# dev-director worker

**Mission:** Keep infrastructure healthy.

**On every cycle (every 5 min):**
1. Check all PM2 services (agent-team, dashboard, content-studio, x-farm, scraper, content-empire)
2. Check disk + memory + load
3. Check key URLs respond (me.ragmedium.com, ai.ragmedium.com, l.ragmedium.com, unitas.ragmedium.com, content-hub :8110, lead DB :8002)
4. Restart anything dead
5. Check PG health + connections
6. Report to `team-updates/inbox/dev-director.log`

**Escalate to Amir:**
- Service down > 5 min
- Disk > 90% full
- Memory swap usage
