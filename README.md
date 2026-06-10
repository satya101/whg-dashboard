# WHG Firmware & Health Reporting Dashboard

## Architecture

```
Gmail (daily CSV attachments)
        ↓  [Google Apps Script - runs 6am daily]
GitHub Repo (whg-dashboard-data / data/fleet.json)
        ↓  [Netlify fetches at page load]
Dashboard (netlify URL)
```

## Setup Steps (in order)

1. **GitHub**: Create repo `whg-dashboard` → push this folder
2. **Netlify**: Connect repo → auto-deploys on push
3. **Google Apps Script**: Paste `gmail-to-github.gs` → set trigger → add secrets
4. **Done**: Dashboard auto-updates every morning

## Files

- `index.html` — The dashboard (fetches data from GitHub at runtime)
- `gmail-to-github.gs` — Google Apps Script (paste into script.google.com)
- `data/fleet.json` — Auto-generated daily by the script (seed file included)
- `netlify.toml` — Netlify config
