# WHG Dashboard — Full Setup Guide
### Gmail → GitHub → Netlify automated pipeline

---

## What you'll end up with

```
Your Gmail (daily CSV emails)
        ↓  automatically at 6am AEST
Google Apps Script (free, runs in your Google account)
        ↓  writes data/fleet.json
GitHub Repo (free, acts as your data store)
        ↓  Netlify reads at page load
Your Dashboard URL  e.g. https://whg-dashboard.netlify.app
```

Total cost: **$0**. Total setup time: **~25 minutes**.

---

## Step 1 — Create a GitHub Repository (5 min)

1. Go to https://github.com and sign in (create a free account if needed)
2. Click **New repository**
3. Name it `whg-dashboard`
4. Set visibility to **Public** *(required for free raw file access — see note below)*
5. Click **Create repository**

> **Private repo option**: If you need a private repo, you'll need to add a GitHub token
> to `index.html` as a URL parameter or use Netlify environment variables + a serverless
> function. The free public approach is simpler and recommended — the data contains no
> passwords or personally identifiable information.

### Upload the files to GitHub

Upload everything in this folder to the root of your repo:
- `index.html`
- `netlify.toml`
- `data/fleet.json`  ← put this inside a `data/` folder
- `gmail-to-github.gs` ← just for your reference, not served by Netlify

You can drag-and-drop files via the GitHub web UI, or use Git:

```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/whg-dashboard.git
git add .
git commit -m "Initial dashboard deploy"
git push -u origin main
```

---

## Step 2 — Update index.html with your GitHub username (1 min)

Open `index.html` and find these two lines near the top of the `<script>` section:

```javascript
const GITHUB_OWNER = 'YOUR_GITHUB_USERNAME';   // ← change this
const GITHUB_REPO  = 'whg-dashboard';          // ← leave as-is if repo name matches
```

Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username, then re-upload
(or push) the updated file.

---

## Step 3 — Deploy to Netlify (5 min)

1. Go to https://netlify.com and sign in with your GitHub account
2. Click **Add new site → Import an existing project**
3. Choose **GitHub** → select your `whg-dashboard` repo
4. Build settings — leave everything blank (no build command needed)
5. Click **Deploy site**

Netlify will give you a URL like `https://random-name-123.netlify.app`.

**To set a custom subdomain:**
- Go to Site settings → Domain management → Options → Edit site name
- Change it to something like `whg-dashboard` → your URL becomes `https://whg-dashboard.netlify.app`

Your dashboard is now live and showing the seed data. ✅

---

## Step 4 — Create a GitHub Personal Access Token (3 min)

The Apps Script needs permission to write `data/fleet.json` to your repo.

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Name: `WHG Dashboard Script`
4. Expiry: **No expiration** (or 1 year — you'll need to refresh it)
5. Scopes: tick only **`repo`** (the top-level checkbox)
6. Click **Generate token**
7. **Copy the token immediately** — you won't see it again

---

## Step 5 — Set Up Google Apps Script (10 min)

1. Go to https://script.google.com
2. Click **New project**
3. Name it `WHG Dashboard Pipeline`
4. Delete the default `function myFunction() {}` placeholder
5. Paste the entire contents of `gmail-to-github.gs` into the editor
6. Click 💾 Save

### Add Script Properties (your secrets)

1. Click the ⚙️ **Project Settings** gear icon (left sidebar)
2. Scroll down to **Script Properties**
3. Click **Add script property** and add these four required properties:

| Property | Value |
|---|---|
| `GITHUB_TOKEN` | the token you copied in Step 4 |
| `GITHUB_OWNER` | your GitHub username |
| `GITHUB_REPO` | `whg-dashboard` |
| `GITHUB_BRANCH` | `main` |

These four are all you need — the script already knows your exact Gmail setup:

| What it looks for | How it finds it |
|---|---|
| Firmware / Vehicle CSV | Label **FirmwareReport** + subject contains **"Data Export Vehicle"** |
| Account CSV | Label **FirmwareReport** + subject contains **"Data Export Account"** |

**Only add these if the defaults above ever change:**

| Property | Default |
|---|---|
| `GMAIL_LABEL` | `FirmwareReport` |
| `GMAIL_SUBJECT_FIRMWARE` | `Data Export Vehicle` |
| `GMAIL_SUBJECT_ACCOUNT` | `Data Export Account` |

### Test it manually first

1. In the script editor, select `testGmailSearch` from the function dropdown
2. Click ▶ **Run**
3. Click **Execution log** — you should see your CSV files found
4. If found, run `testProcessingOnly` — confirm records count looks right
5. Finally run `runDailyUpdate` — this does the full pipeline including the GitHub push

### Set the daily trigger

1. Click the ⏰ **Triggers** icon (left sidebar, looks like a clock)
2. Click **+ Add Trigger** (bottom right)
3. Settings:
   - Function to run: `runDailyUpdate`
   - Deployment: `Head`
   - Event source: `Time-driven`
   - Type: `Day timer`
   - Time: `6am to 7am` (AEST — adjust to your timezone)
4. Click **Save**

Google will ask you to authorise the script to access Gmail and make web requests.
Click through and approve — this is your own Google account authorising your own script.

---

## Step 6 — Verify the pipeline (2 min)

After running `runDailyUpdate` manually:

1. Go to your GitHub repo → click `data/fleet.json`
2. You should see it was updated seconds ago with today's data
3. Open your Netlify URL → click **⟳ Refresh Live Data**
4. The dashboard should now show today's data with the correct "Data updated" timestamp

---

## How it works daily (no action needed after setup)

```
6:00 AM AEST  →  Apps Script wakes up
                 Searches Gmail: label:FirmwareReport + subject "Scheduled Report: Data Export Vehicle" (last 7 days)
                 Searches Gmail: label:FirmwareReport + subject "Scheduled Report: Data Export Account" (last 30 days)
                 Parses CSVs, strips archived products, maps account names
                 Pushes data/fleet.json to GitHub via API
                 Netlify CDN serves updated file to dashboard on next load
```

---

## Troubleshooting

**"Could not load live data from GitHub"**
→ Check `GITHUB_OWNER` and `GITHUB_REPO` in `index.html` match your actual repo

**Apps Script: "No firmware CSV found"**
→ Check the email subject matches `GMAIL_QUERY_FIRMWARE` script property
→ The email must arrive within the last 7 days

**Apps Script: "GitHub PUT response code: 401"**
→ Token has expired or wrong scope — regenerate at github.com/settings/tokens

**Dashboard shows old data**
→ Click ⟳ Refresh Live Data button (bypasses browser cache)
→ Check the Apps Script execution log for errors

**"Aeries Sim" not showing**
→ Verify those SIM numbers start with `+11` in the raw CSV

---

## Updating the archived product list

Edit `gmail-to-github.gs` → find the `ARCHIVED_PRODUCTS` Set → add/remove entries.
Also update the `ARCHIVED` Set in `index.html` (for manual CSV uploads).

---

*Generated by WHG Dashboard Setup — June 2026*
