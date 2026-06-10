/**
 * WHG Dashboard — Gmail → GitHub Data Pipeline
 * =============================================
 * Paste this entire file into https://script.google.com
 * Then set a daily time-based trigger on runDailyUpdate()
 *
 * ── REQUIRED Script Properties ──────────────────────────────────────────────
 * Go to: Project Settings (⚙️) → Script Properties → Add property
 *
 *   GITHUB_TOKEN   → GitHub personal access token (scope: repo → contents write)
 *   GITHUB_OWNER   → Your GitHub username          e.g.  rocco-whg
 *   GITHUB_REPO    → Repo name                     e.g.  whg-dashboard
 *   GITHUB_BRANCH  → Branch name                   e.g.  main
 *
 * ── HOW EMAILS ARE FOUND ────────────────────────────────────────────────────
 *
 *  Vehicle / Firmware CSV
 *    Gmail label : FirmwareReport
 *    Subject     : "Scheduled Report: Data Export Vehicle"
 *    Look-back   : 7 days
 *
 *  Account CSV
 *    Gmail label : FirmwareReport          (same label)
 *    Subject     : "Scheduled Report: Data Export Account"
 *    Look-back   : 30 days  (in case it arrives less frequently)
 *
 *  Both searches target the FirmwareReport label so they never pick up
 *  unrelated emails with similar subjects from the rest of your inbox.
 *
 * ── OPTIONAL Script Properties (leave blank to use defaults) ────────────────
 *   GMAIL_LABEL            → Gmail label name  (default: FirmwareReport)
 *   GMAIL_SUBJECT_FIRMWARE → subject keyword   (default: Data Export Vehicle)
 *   GMAIL_SUBJECT_ACCOUNT  → subject keyword   (default: Data Export Account)
 *   DATA_PATH              → JSON path in repo (default: data/fleet.json)
 */

// ─── ARCHIVED PRODUCTS (excluded from all output) ───────────────────────────

const ARCHIVED_PRODUCTS = new Set([
  'QUEST FLEET STD', 'MYAUDI TRACK CUSTOMER', 'QTRAQ CUSTOMER 12V 3 WIRE',
  'QTRAQ CUSTOMER 12V', 'QTRAQ CUSTOMER 24V', 'MYAUDI TRACK DEALER', 'QTRAQ',
  'GTRAQ CUSTOMER 12V', 'GTRAQ CUSTOMER 12V 3 WIRE', 'GTRAQ CUSTOMER 24V 3 WIRE',
  'TRACKA DEALER', 'TRACKA ENHANCED 3 YEAR', 'TRACKA ENHANCED 5 YEAR', 'GENTRACKER',
  'QTRAQ CUSTOMER 24V 3 WIRE', 'GTRAQ', 'CU01 DEALER', 'CATM1 24V 3 WIRE',
  'GENTRACK-DEALER', 'STOLEN VEHICLE RECOVERY 36 MTHS'
]);

// ─── MAIN ENTRY POINT ────────────────────────────────────────────────────────

/**
 * Set a daily time-based trigger on this function.
 * Recommended: 6:00 AM AEST (set timezone in Apps Script trigger settings)
 */
function runDailyUpdate() {
  const props = PropertiesService.getScriptProperties().getAll();

  const GITHUB_TOKEN  = props.GITHUB_TOKEN;
  const GITHUB_OWNER  = props.GITHUB_OWNER;
  const GITHUB_REPO   = props.GITHUB_REPO;
  const GITHUB_BRANCH = props.GITHUB_BRANCH || 'main';
  const DATA_PATH     = props.DATA_PATH      || 'data/fleet.json';

  // Gmail search config — matches your actual email setup
  const LABEL          = props.GMAIL_LABEL            || 'FirmwareReport';
  const FW_SUBJECT     = props.GMAIL_SUBJECT_FIRMWARE || 'Data Export Vehicle';
  const ACCT_SUBJECT   = props.GMAIL_SUBJECT_ACCOUNT  || 'Data Export Account';

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    Logger.log('ERROR: Missing required Script Properties (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO).');
    Logger.log('Go to Project Settings → Script Properties and add them.');
    return;
  }

  Logger.log('=== WHG Dashboard Update ===');
  Logger.log('Started: ' + new Date().toISOString());
  Logger.log('Gmail label: ' + LABEL);

  // ── 1. Find latest CSV attachments from Gmail ──────────────────────────────
  const firmwareCsv = getLatestAttachmentFromLabel(LABEL, FW_SUBJECT,   '.csv', 7);
  const accountCsv  = getLatestAttachmentFromLabel(LABEL, ACCT_SUBJECT, '.csv', 30);

  if (!firmwareCsv) {
    Logger.log('❌ No firmware CSV found in label "' + LABEL + '" with subject "' + FW_SUBJECT + '" in the last 7 days.');
    Logger.log('Check that the scheduled report email has arrived and is labelled correctly.');
    return;
  }

  Logger.log('✅ Firmware CSV  : ' + firmwareCsv.name + ' (' + formatBytes(firmwareCsv.size) + ')  — from: ' + firmwareCsv.date);

  if (accountCsv) {
    Logger.log('✅ Account CSV   : ' + accountCsv.name  + ' (' + formatBytes(accountCsv.size)  + ')  — from: ' + accountCsv.date);
  } else {
    Logger.log('⚠️  Account CSV not found in last 30 days — account names may fall back to IDs.');
  }

  // ── 2. Parse CSVs ─────────────────────────────────────────────────────────
  const firmwareRows = parseCsv(firmwareCsv.content);
  const accountRows  = accountCsv ? parseCsv(accountCsv.content) : [];
  Logger.log('Firmware rows parsed : ' + firmwareRows.length);
  Logger.log('Account rows parsed  : ' + accountRows.length);

  // ── 3. Build account lookup { accountId → accountName } ───────────────────
  const accountMap = buildAccountMap(accountRows);
  Logger.log('Account map entries  : ' + Object.keys(accountMap).length);

  // ── 4. Process into clean fleet records ───────────────────────────────────
  const fleetData = processFleetData(firmwareRows, accountMap);
  Logger.log('Fleet records output : ' + fleetData.records.length);

  // ── 5. Build JSON payload ─────────────────────────────────────────────────
  const payload = {
    meta: {
      updatedAt:    new Date().toISOString(),
      firmwareFile: firmwareCsv.name,
      firmwareDate: firmwareCsv.date.toISOString(),
      accountFile:  accountCsv ? accountCsv.name : 'not found — using cached data',
      totalRecords: fleetData.records.length,
    },
    records: fleetData.records
  };

  // ── 6. Push to GitHub ─────────────────────────────────────────────────────
  const commitMsg = 'data: daily fleet update ' +
    Utilities.formatDate(new Date(), 'Australia/Sydney', 'yyyy-MM-dd HH:mm') + ' AEST';

  const success = pushToGithub(
    JSON.stringify(payload),
    DATA_PATH,
    GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH,
    commitMsg
  );

  if (success) {
    Logger.log('✅ data/fleet.json updated on GitHub successfully.');
    Logger.log('Dashboard will reflect new data on next page load.');
  } else {
    Logger.log('❌ GitHub push failed — check error above.');
  }
}

// ─── GMAIL HELPERS ───────────────────────────────────────────────────────────

/**
 * Search within a specific Gmail label for the most recent email whose
 * subject contains subjectKeyword, then return its first CSV attachment.
 *
 * Using label: in the query pins the search to your FirmwareReport folder,
 * so it never accidentally matches unrelated emails in your inbox.
 */
function getLatestAttachmentFromLabel(label, subjectKeyword, extension, maxAgeDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const dateStr = Utilities.formatDate(cutoff, 'UTC', 'yyyy/MM/dd');

  // Gmail search: label scopes to the folder, subject and date narrow it down
  const query = 'label:' + label +
                ' subject:"' + subjectKeyword + '"' +
                ' has:attachment' +
                ' after:' + dateStr;

  Logger.log('Gmail query: ' + query);

  let threads;
  try {
    threads = GmailApp.search(query, 0, 20);
  } catch (e) {
    Logger.log('Gmail search error: ' + e.message);
    Logger.log('Hint: If the label name has spaces, Gmail uses hyphens — e.g. "my-label".');
    return null;
  }

  Logger.log('Threads found: ' + threads.length);
  if (!threads.length) return null;

  // Walk threads newest-first (GmailApp.search returns newest first by default)
  for (const thread of threads) {
    const messages = thread.getMessages().reverse(); // newest message in thread first
    for (const msg of messages) {
      const attachments = msg.getAttachments();
      for (const att of attachments) {
        if (att.getName().toLowerCase().endsWith(extension)) {
          return {
            name:    att.getName(),
            size:    att.getSize(),
            content: att.getDataAsString('UTF-8'),
            date:    msg.getDate()
          };
        }
      }
    }
  }

  Logger.log('Threads found but no ' + extension + ' attachment present.');
  return null;
}

// ─── CSV PARSER ──────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

/** Handles quoted fields containing commas */
function splitCsvLine(line) {
  const result = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// ─── DATA PROCESSING ─────────────────────────────────────────────────────────

function buildAccountMap(accountRows) {
  const map = {};
  for (const row of accountRows) {
    const id   = (row['AccountId']   || '').trim();
    const name = (row['AccountName'] || '').trim();
    if (id && name) map[id] = name;
  }
  return map;
}

function getSimType(mobile) {
  if (!mobile) return 'Unknown';
  if (mobile.startsWith('+882'))                               return 'Onomondo Sim';
  if (mobile.startsWith('+11'))                                return 'Aeries Sim';
  if (mobile.startsWith('+614') || mobile.startsWith('+61'))  return 'Telstra';
  return 'Other';
}

function normaliseFirmware(fw) {
  if (!fw) return '';
  return fw.trim().split(/\s+/)[0]; // "XX.XX XX.XX" → take first token only
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  } catch (e) {
    return null;
  }
}

function processFleetData(firmwareRows, accountMap) {
  const records = [];
  for (const row of firmwareRows) {
    const product = (row['Product'] || '').trim();
    if (ARCHIVED_PRODUCTS.has(product)) continue;

    const accountId    = (row['AccountId'] || '').trim();
    const mobile       = (row['Device_Mobile'] || '').trim();
    const lastReported = (row['Device_LastReported'] || '').trim();

    records.push({
      account:      accountMap[accountId] || accountId || 'Unknown',
      accountId:    accountId,
      licence:      (row['RegNo'] || '').trim(),
      imei:         (row['Device_Serial'] || '').trim(),
      sim:          mobile,
      simType:      getSimType(mobile),
      lastReported: lastReported,
      daysSince:    daysSince(lastReported),
      product:      product,
      firmware:     normaliseFirmware(row['Device_FirmwareVersion'] || ''),
    });
  }
  return { records };
}

// ─── GITHUB API ──────────────────────────────────────────────────────────────

function pushToGithub(content, filePath, token, owner, repo, branch, commitMessage) {
  const apiBase = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + filePath;
  const headers = {
    'Authorization': 'token ' + token,
    'Accept':        'application/vnd.github.v3+json',
    'User-Agent':    'WHG-Dashboard-GAS'
  };

  // Fetch existing SHA so GitHub allows the update (required for existing files)
  let sha = null;
  try {
    const getResp = UrlFetchApp.fetch(apiBase + '?ref=' + branch, {
      method: 'get', headers: headers, muteHttpExceptions: true
    });
    if (getResp.getResponseCode() === 200) {
      sha = JSON.parse(getResp.getContentText()).sha;
      Logger.log('Existing file SHA: ' + sha.slice(0, 10) + '…');
    }
  } catch (e) {
    Logger.log('SHA fetch skipped (new file?): ' + e.message);
  }

  const encoded = Utilities.base64Encode(Utilities.newBlob(content, 'application/json').getBytes());
  const body    = { message: commitMessage, content: encoded, branch: branch };
  if (sha) body.sha = sha;

  const putResp = UrlFetchApp.fetch(apiBase, {
    method: 'put', headers: headers,
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const code = putResp.getResponseCode();
  Logger.log('GitHub PUT → HTTP ' + code);
  if (code === 200 || code === 201) return true;

  Logger.log('GitHub error body: ' + putResp.getContentText().slice(0, 500));
  return false;
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ─── MANUAL TEST HELPERS ─────────────────────────────────────────────────────
// Run these individually from the Apps Script editor to diagnose issues
// before setting the automated trigger.

/** Step 1 — confirm the label exists and emails are found */
function testGmailSearch() {
  const LABEL = PropertiesService.getScriptProperties().getProperty('GMAIL_LABEL') || 'FirmwareReport';
  Logger.log('--- Testing Gmail label: ' + LABEL + ' ---');

  const fw = getLatestAttachmentFromLabel(LABEL, 'Data Export Vehicle', '.csv', 7);
  Logger.log('Firmware CSV : ' + (fw ? fw.name + ' (' + formatBytes(fw.size) + ') dated ' + fw.date : 'NOT FOUND'));

  const ac = getLatestAttachmentFromLabel(LABEL, 'Data Export Account', '.csv', 30);
  Logger.log('Account CSV  : ' + (ac ? ac.name + ' (' + formatBytes(ac.size) + ') dated ' + ac.date : 'NOT FOUND'));
}

/** Step 2 — confirm CSV parsing and record count (no GitHub write) */
function testProcessingOnly() {
  const LABEL = PropertiesService.getScriptProperties().getProperty('GMAIL_LABEL') || 'FirmwareReport';
  const fw = getLatestAttachmentFromLabel(LABEL, 'Data Export Vehicle', '.csv', 7);
  const ac = getLatestAttachmentFromLabel(LABEL, 'Data Export Account', '.csv', 30);

  if (!fw) { Logger.log('No firmware CSV — run testGmailSearch first.'); return; }

  const fwRows   = parseCsv(fw.content);
  const acctRows = ac ? parseCsv(ac.content) : [];
  const acctMap  = buildAccountMap(acctRows);
  const data     = processFleetData(fwRows, acctMap);

  Logger.log('Records processed: ' + data.records.length);
  Logger.log('Sample record    : ' + JSON.stringify(data.records[0], null, 2));

  // SIM type breakdown
  const simCounts = {};
  data.records.forEach(r => { simCounts[r.simType] = (simCounts[r.simType] || 0) + 1; });
  Logger.log('SIM breakdown    : ' + JSON.stringify(simCounts));
}

/** Step 3 — full end-to-end including GitHub push */
function testFullPipeline() {
  runDailyUpdate();
}
