# 1B-Lead Database Audit (Drive + on-disk)

## Google Drive folders (from KB / chat history)

| Folder | Contents |
|---|---|
| `1lcDauhzNaOagTrwZpQOdI7g-nON0t3ai` | Main leads collection (1.5-2B total across subfolders) |
| `1y0YkKgZOPs9B8DmyUFm98q_U_iGGxCpK` | Shared folder #2 (duplicate files expected) |
| `1eEt2mbMPhezMfWB-GwQJtt-2vLkP0BKL` | Shared folder #3 (BIGGGGG Apollo files) |
| `19UgRBYs3MLpiwJGMewEIquKur4xrcwMo` | All unzipped individual files (hundreds/thousands) |

## On-disk (already downloaded via gogcli)

`/home/admin/.config/gogcli/drive-downloads/`
- `1Vm0CYRcav5hpypUSlWqs5UVMFbEjAZw0_105k Apollo leads (1).csv` (143MB, 105K rows)
- `1jQ4u-Cl2Mgur-MmP9iK_4PEyzYVzxirm3Mlvi__nXu8_leadrocks_seo_services_california_2023_07_17.csv` (LeadRocks — SEO services CA)
- `1sWQzVYq1PgpQMNGjUnG3TVpbemtnE9nB_dataset_lead-scraper-apollo-zoominfo-lusha-ppe_2025-10-30_08-30-02-538.csv` (Apollo + ZoomInfo + Lusha PPE dataset)

## Source breakdown (per KB, deduped estimates)

| Source | Raw claimed | Deduped | Size on Drive |
|---|---|---|---|
| LinkedIn | 435M | ~400M | 55.8 GB |
| People DataLabs | 415M | ~400M | 29.6 GB |
| Apollo | ~100M | ~80M | 18.5 GB |
| Ninja Leads | 238K | ~200K | 135 MB |
| LeadRocks | 643 files | n/a | 118 MB |
| B2B Central DB | 105 files | n/a | 219 MB |
| USA Business Leads | 10M | n/a | 1.4 GB |
| High Quality B2B | 31M | n/a | 2.13 GB |
| Ultimate Ecommerce | 7.8M | n/a | 2.4 GB |
| Crunchbase (Almost Full) | 2.8M | n/a | 422 MB |
| Seamless | 1.5M | n/a | 1.4 GB |
| Fresh Apollo | 1.2M | n/a | 87 MB |
| LinkedIn/IG/Leads+others | ~4M | n/a | ~500 MB |
| Company Using X Tech | 10.1M | n/a | 202 MB |

## Lead DB we currently use (live, on VPS)

**`localhost:8002`** — `leadmin_v4.js` queries the `galaxy_agents` PostgreSQL database:

| Table | Rows | Indexes |
|---|---|---|
| businesses | 20.5M | pkey + city + state + industry_trgm + name_trgm + email + company + emp |
| people | 141M | pkey + email + phone + name + zip + source |
| professionals | 34.8M | pkey + email + source + company |

The people table has 2.07M phone numbers (perfect for Rima cold-call/SMS).
The businesses table has 19.9M emails (perfect for RAGmedium/LamaTrader email outreach).

## Auth needed

**Gmail OAuth** — currently EXPIRED (3+ days).
The token file `/home/admin/token.json` exists but is invalid.
The fix (per KB) is:
```bash
gog auth add amirg@ragmedium.com --services gmail,drive
```
This prints a Google link. Amir authenticates, I get full Drive + Gmail access.

## What I'll do once Gmail auth is refreshed

1. Sync the entire `19UgRBYs3MLpiwJGMewEIquKur4xrcwMo` folder (all unzipped files) to `/home/admin/67 - AI/_sources/`
2. Build a unified index across Apollo + LinkedIn + PDL + Crunchbase
3. Filter each business ICP against the combined pool
4. Dedup against the existing 141M Lead DB so we don't double-source
5. Save final clean lists per ICP folder (raw → enriched → processed → sent)

## Status

🟡 **BLOCKED on Gmail OAuth.** Everything else is prepped.
