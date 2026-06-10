/**
 * WHG Dashboard — Gmail → GitHub Data Pipeline
 * =============================================
 * Paste this entire file into https://script.google.com
 * Set a daily time-based trigger on runDailyUpdate() — recommended 11pm AEST
 * (files arrive 9–11pm, so 11pm ensures they're always present)
 *
 * ── REQUIRED Script Properties ──────────────────────────────────────────────
 * Project Settings (⚙️) → Script Properties → Add property
 *
 *   GITHUB_TOKEN   → GitHub personal access token (scope: repo → contents write)
 *   GITHUB_OWNER   → Your GitHub username          e.g.  rocco-whg
 *   GITHUB_REPO    → Repo name                     e.g.  whg-dashboard
 *   GITHUB_BRANCH  → Branch name                   e.g.  main
 *
 * ── HOW EMAILS ARE FOUND ────────────────────────────────────────────────────
 *
 *  Vehicle / Firmware file
 *    Gmail label : FirmwareReport
 *    Subject     : "Scheduled Report: Data Export Vehicle"
 *    Formats     : .csv  OR  .xlsx  (whichever is attached — both handled)
 *    Look-back   : 2 days
 *
 *  Account file
 *    Gmail label : FirmwareReport
 *    Subject     : "Scheduled Report: Data Export Account"
 *    Formats     : .csv  OR  .xlsx  (whichever is attached — both handled)
 *    Look-back   : 7 days
 *
 * ── OPTIONAL Script Properties ──────────────────────────────────────────────
 *   GMAIL_LABEL            → Gmail label name  (default: FirmwareReport)
 *   GMAIL_SUBJECT_FIRMWARE → subject keyword   (default: Data Export Vehicle)
 *   GMAIL_SUBJECT_ACCOUNT  → subject keyword   (default: Data Export Account)
 *   DATA_PATH              → JSON path in repo (default: data/fleet.json)
 */

// ─── ARCHIVED PRODUCTS ───────────────────────────────────────────────────────

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
 * Trigger this daily at 11pm–midnight AEST.
 * Files arrive 9–11pm, so this ensures they are always present before processing.
 */
function runDailyUpdate() {
  const sp = PropertiesService.getScriptProperties();

  const GITHUB_TOKEN  = sp.getProperty('GITHUB_TOKEN');
  const GITHUB_OWNER  = sp.getProperty('GITHUB_OWNER');
  const GITHUB_REPO   = sp.getProperty('GITHUB_REPO');
  const GITHUB_BRANCH = sp.getProperty('GITHUB_BRANCH') || 'main';
  const DATA_PATH     = sp.getProperty('DATA_PATH')      || 'data/fleet.json';

  const LABEL        = sp.getProperty('GMAIL_LABEL')            || 'FirmwareReport';
  const FW_SUBJECT   = sp.getProperty('GMAIL_SUBJECT_FIRMWARE') || 'Data Export Vehicle';
  const ACCT_SUBJECT = sp.getProperty('GMAIL_SUBJECT_ACCOUNT')  || 'Data Export Account';

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    Logger.log('ERROR: Missing required Script Properties (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO).');
    return;
  }

  Logger.log('=== WHG Dashboard Update ===');
  Logger.log('Started : ' + new Date().toISOString());
  Logger.log('Label   : ' + LABEL);

  // ── 1. Fetch attachments (csv or xlsx, whichever arrives) ─────────────────
  const firmwareAtt = getLatestAttachment(LABEL, FW_SUBJECT,   2);
  const accountAtt  = getLatestAttachment(LABEL, ACCT_SUBJECT, 7);

  if (!firmwareAtt) {
    Logger.log('❌ No firmware file found (tried .csv and .xlsx) in "' + LABEL +
               '" with subject "' + FW_SUBJECT + '" in the last 2 days.');
    Logger.log('Check the email arrived tonight and is labelled correctly.');
    return;
  }

  Logger.log('✅ Firmware file : ' + firmwareAtt.name +
             ' [' + firmwareAtt.format + '] (' + formatBytes(firmwareAtt.size) + ')' +
             '  — received: ' + firmwareAtt.date);

  if (accountAtt) {
    Logger.log('✅ Account file  : ' + accountAtt.name +
               ' [' + accountAtt.format + '] (' + formatBytes(accountAtt.size) + ')' +
               '  — received: ' + accountAtt.date);
  } else {
    Logger.log('⚠️  Account file not found in last 7 days — account names will fall back to IDs.');
  }

  // ── 2. Parse into row arrays ───────────────────────────────────────────────
  const firmwareRows = parseAttachment(firmwareAtt);
  const accountRows  = accountAtt ? parseAttachment(accountAtt) : [];

  Logger.log('Firmware rows parsed : ' + firmwareRows.length);
  Logger.log('Account rows parsed  : ' + accountRows.length);

  if (firmwareRows.length === 0) {
    Logger.log('❌ Firmware file parsed to 0 rows — aborting.');
    return;
  }

  // ── 3. Build account map { accountId → accountName } ──────────────────────
  const accountMap = buildAccountMap(accountRows);
  Logger.log('Account map entries  : ' + Object.keys(accountMap).length);

  // ── 4. Process fleet records ───────────────────────────────────────────────
  const fleetData = processFleetData(firmwareRows, accountMap);
  Logger.log('Fleet records output : ' + fleetData.records.length);

  // ── 5. Build JSON payload ─────────────────────────────────────────────────
  const payload = {
    meta: {
      updatedAt:    new Date().toISOString(),
      firmwareFile: firmwareAtt.name,
      firmwareDate: firmwareAtt.date.toISOString(),
      accountFile:  accountAtt ? accountAtt.name : 'not found — names may show as IDs',
      totalRecords: fleetData.records.length,
    },
    records: fleetData.records
  };

  // ── 6. Push to GitHub ─────────────────────────────────────────────────────
  const commitMsg = 'data: fleet update ' +
    Utilities.formatDate(new Date(), 'Australia/Sydney', 'yyyy-MM-dd HH:mm') + ' AEST';

  const success = pushToGithub(
    JSON.stringify(payload),
    DATA_PATH,
    GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH,
    commitMsg
  );

  Logger.log(success
    ? '✅ data/fleet.json pushed to GitHub. Dashboard live on next page load.'
    : '❌ GitHub push failed — see error above.');
}

// ─── GMAIL: FIND ATTACHMENT ──────────────────────────────────────────────────

/**
 * Searches the given Gmail label for the most recent email matching
 * subjectKeyword within maxAgeDays. Tries .csv first, then .xlsx.
 * Returns an attachment descriptor or null.
 */
function getLatestAttachment(label, subjectKeyword, maxAgeDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const dateStr = Utilities.formatDate(cutoff, 'UTC', 'yyyy/MM/dd');

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
    return null;
  }

  Logger.log('Threads found: ' + threads.length);
  if (!threads.length) return null;

  // Accepted extensions in preference order
  const ACCEPTED = ['.csv', '.xlsx'];

  // Walk threads newest-first
  for (const thread of threads) {
    const messages = thread.getMessages().reverse();
    for (const msg of messages) {
      const attachments = msg.getAttachments();

      // Try each accepted extension in order
      for (const ext of ACCEPTED) {
        for (const att of attachments) {
          const lname = att.getName().toLowerCase();
          if (lname.endsWith(ext)) {
            return {
              name:   att.getName(),
              size:   att.getSize(),
              bytes:  att.getBytes(),          // raw bytes — needed for xlsx
              format: ext === '.csv' ? 'csv' : 'xlsx',
              date:   msg.getDate()
            };
          }
        }
      }
    }
  }

  Logger.log('Threads found but no .csv or .xlsx attachment present.');
  return null;
}

// ─── PARSE ATTACHMENT → ROWS ─────────────────────────────────────────────────

/**
 * Dispatches to the correct parser based on attachment format.
 * Returns an array of plain objects { header: value, ... }
 */
function parseAttachment(att) {
  if (att.format === 'csv') {
    // Convert bytes to UTF-8 string
    const text = Utilities.newBlob(att.bytes).getDataAsString('UTF-8');
    return parseCsv(text);
  } else {
    return parseXlsx(att.bytes);
  }
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

// ─── XLSX PARSER ─────────────────────────────────────────────────────────────

/**
 * Parses an .xlsx file from raw bytes using the Apps Script Spreadsheet service.
 * Strategy: write bytes to a temp Drive file → open as Spreadsheet → read sheet 1
 * → delete temp file. No external libraries needed.
 */
function parseXlsx(bytes) {
  let tempFileId  = null;
  let tempSheetId = null;

  try {
    // 1. Write XLSX bytes to a temp Drive file
    const blob = Utilities.newBlob(
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'WHG_temp_import.xlsx'
    );
    const tempFile = DriveApp.createFile(blob);
    tempFileId = tempFile.getId();
    Logger.log('Temp XLSX created — id: ' + tempFileId);

    // 2. Import into Google Sheets via Drive API v2 (convert:true)
    //    Drive.Files.copy returns a File resource with an .id property.
    const sheetsFile = Drive.Files.copy(
      { title: 'WHG_temp_sheet', mimeType: 'application/vnd.google-apps.spreadsheet' },
      tempFileId,
      { convert: true }
    );
    tempSheetId = sheetsFile.id;
    Logger.log('Temp Sheets file — id: ' + tempSheetId);

    // 3. Give Drive a moment to finish the conversion before opening
    Utilities.sleep(3000);

    // 4. Open and read first sheet
    const ss    = SpreadsheetApp.openById(tempSheetId);
    const sheet = ss.getSheets()[0];
    const data  = sheet.getDataRange().getValues();
    Logger.log('Sheet dimensions: ' + data.length + ' rows x ' + (data[0] ? data[0].length : 0) + ' cols');

    if (data.length < 2) {
      Logger.log('XLSX sheet appears empty after conversion.');
      return [];
    }

    // 5. Row 1 = headers, remaining rows = data
    const headers = data[0].map(h => String(h).trim());
    Logger.log('Headers found: ' + headers.filter(Boolean).join(', '));

    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.every(cell => cell === '' || cell === null || cell === undefined)) continue;
      const obj = {};
      headers.forEach((h, idx) => {
        let val = row[idx];
        if (val instanceof Date) {
          // Sheets returns dates as Date objects — normalise to the same
          // "yyyy-MM-dd HH:mm:ss" string format used by the CSV export
          val = Utilities.formatDate(val, 'Australia/Sydney', 'yyyy-MM-dd HH:mm:ss');
        } else {
          val = (val === null || val === undefined) ? '' : String(val).trim();
        }
        obj[h] = val;
      });
      rows.push(obj);
    }

    Logger.log('XLSX rows parsed: ' + rows.length);
    return rows;

  } catch (e) {
    Logger.log('XLSX parse error: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return [];
  } finally {
    // Always delete both temp files — even if an error occurred
    try { if (tempFileId)  DriveApp.getFileById(tempFileId).setTrashed(true);  } catch(e) { Logger.log('Cleanup error (xlsx): ' + e.message); }
    try { if (tempSheetId) DriveApp.getFileById(tempSheetId).setTrashed(true); } catch(e) { Logger.log('Cleanup error (sheet): ' + e.message); }
  }
}

// ─── DATA PROCESSING ─────────────────────────────────────────────────────────

function buildAccountMap(rows) {
  const map = {};
  for (const row of rows) {
    const id   = (row['AccountId']   || '').trim();
    const name = (row['AccountName'] || '').trim();
    if (id && name) map[id] = name;
  }
  return map;
}

function getSimType(mobile) {
  if (!mobile) return 'Unknown';
  if (mobile.startsWith('+882'))                              return 'Onomondo Sim';
  if (mobile.startsWith('+11'))                               return 'Aeries Sim';
  if (mobile.startsWith('+614') || mobile.startsWith('+61')) return 'Telstra';
  return 'Other';
}

function normaliseFirmware(fw) {
  if (!fw) return '';
  return fw.trim().split(/\s+/)[0];
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    return isNaN(diff) ? null : diff;
  } catch (e) { return null; }
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
    Logger.log('SHA fetch skipped: ' + e.message);
  }

  const encoded = Utilities.base64Encode(
    Utilities.newBlob(content, 'application/json').getBytes()
  );
  const body = { message: commitMessage, content: encoded, branch: branch };
  if (sha) body.sha = sha;

  const putResp = UrlFetchApp.fetch(apiBase, {
    method: 'put', headers: headers,
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const code = putResp.getResponseCode();
  Logger.log('GitHub PUT → HTTP ' + code);
  if (code === 200 || code === 201) return true;

  Logger.log('GitHub error: ' + putResp.getContentText().slice(0, 500));
  return false;
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024)    return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ─── TEST HELPERS ─────────────────────────────────────────────────────────────

/**
 * TEST 1 — Check Gmail finds the files (no parsing, no GitHub write)
 * Run this first to confirm emails and attachments are reachable.
 */
function testGmailSearch() {
  const LABEL = PropertiesService.getScriptProperties().getProperty('GMAIL_LABEL') || 'FirmwareReport';
  Logger.log('=== testGmailSearch (label: ' + LABEL + ') ===');

  const fw = getLatestAttachment(LABEL, 'Data Export Vehicle', 2);
  if (fw) {
    Logger.log('✅ Firmware : ' + fw.name + ' [' + fw.format + '] ' + formatBytes(fw.size) + ' — ' + fw.date);
  } else {
    Logger.log('❌ Firmware : NOT FOUND — check label and that email arrived in last 2 days');
  }

  const ac = getLatestAttachment(LABEL, 'Data Export Account', 7);
  if (ac) {
    Logger.log('✅ Account  : ' + ac.name + ' [' + ac.format + '] ' + formatBytes(ac.size) + ' — ' + ac.date);
  } else {
    Logger.log('❌ Account  : NOT FOUND — check label and that email arrived in last 7 days');
  }
}

/**
 * TEST 2 — Parse files and check row counts (no GitHub write)
 * Run after testGmailSearch passes.
 */
function testProcessingOnly() {
  const LABEL = PropertiesService.getScriptProperties().getProperty('GMAIL_LABEL') || 'FirmwareReport';
  Logger.log('=== testProcessingOnly ===');

  const fw = getLatestAttachment(LABEL, 'Data Export Vehicle', 2);
  const ac = getLatestAttachment(LABEL, 'Data Export Account', 7);

  if (!fw) { Logger.log('No firmware file found — run testGmailSearch first.'); return; }

  const fwRows   = parseAttachment(fw);
  const acctRows = ac ? parseAttachment(ac) : [];
  const acctMap  = buildAccountMap(acctRows);
  const data     = processFleetData(fwRows, acctMap);

  Logger.log('Records processed : ' + data.records.length);
  Logger.log('Sample record     : ' + JSON.stringify(data.records[0], null, 2));

  const simCounts = {};
  data.records.forEach(r => { simCounts[r.simType] = (simCounts[r.simType] || 0) + 1; });
  Logger.log('SIM breakdown     : ' + JSON.stringify(simCounts));

  const prodCounts = {};
  data.records.forEach(r => { prodCounts[r.product] = (prodCounts[r.product] || 0) + 1; });
  Logger.log('Product breakdown : ' + JSON.stringify(prodCounts));
}

/**
 * TEST 3 — Full end-to-end including GitHub push
 * Run after testProcessingOnly passes.
 */
function testFullPipeline() {
  runDailyUpdate();
}
