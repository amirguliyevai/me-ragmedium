# Gmail + Drive OAuth Refresh — Required Steps

**Status:** Auth EXPIRED. `token.json` has `"error": "invalid_grant"`.

## For Amir (5 minutes)

Open a terminal on the VPS and run:

```bash
gog auth add amirg@ragmedium.com --services gmail,drive,calendar
```

This will print a Google OAuth URL. **Open it in your browser**, sign in to `amirg@ragmedium.com`, approve the scopes (Gmail + Drive + Calendar full access), and paste the resulting code back into the terminal.

Once authed, I can:
1. Pull the 1B-lead Google Drive databases (Apollo, LinkedIn, People DataLabs, Crunchbase)
2. Read/write Gmail (for the ai.ragmedium outreach system)
3. Sync Calendar (for the dashboard calendar page)
4. Bypass the warmup-sender SMTP auth issue by routing through real Gmail APIs

## What I built meanwhile (preparation)

While you re-auth, the prep work is done:
- ✅ Folder structure: `/home/admin/67 - AI/` with project × ICP × pipeline structure
- ✅ Lead DB audit: `67 - AI/LEAD-DB-AUDIT.md` documents every available database
- ✅ Content calendar wiring: prepped to plug into dashboard
- ✅ Production pipeline UI: prepped
- ✅ Agent team autonomy: prepped, ready to fire on activation

## After you auth

I'll run (autonomously):
```bash
# 1. Index the entire Drive leads collection
gog drive ls --folder 19UgRBYs3MLpiwJGMewEIquKur4xrcwMo --recursive > /home/admin/67 - AI/_sources/drive-index.json
gog drive ls --folder 1lcDauhzNaOagTrwZpQOdI7g-nON0t3ai --recursive >> /home/admin/67 - AI/_sources/drive-index.json

# 2. Sync unzipped CSVs (filter to leads/csv)
gog drive sync 19UgRBYs3MLpiwJGMewEIquKur4xrcwMo --filter "*.csv,*.json" /home/admin/67 - AI/_sources/csv/

# 3. Test the auth
gog gmail labels list  # just to confirm Gmail access works
```

Estimated sync: 5-30 minutes depending on file count (the index already shows hundreds/thousands of files in those folders).
