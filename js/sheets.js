// Google Sheets sync using Google Identity Services (token client) and the
// Sheets REST API. The whole chart is rewritten from a merge of what is
// already in the Sheet and what is on the phone, keyed by date, so syncing
// again never duplicates a day and days missing from the phone are kept.
import { ROWS, buildTable, parseDDMMYYYY, dateRange, dayFromSheetRow } from "./model.js";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_KEY = "hp.gtoken";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

let gisPromise;
export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new Error("Could not load Google sign-in. Check your connection."));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

function savedToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (t && t.expires > Date.now() + 60_000) return t.access_token;
  } catch {}
  return null;
}

export function signOut() {
  const t = savedToken();
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
}

async function getToken(clientId) {
  const cached = savedToken();
  if (cached) return cached;
  await loadGis();
  let hadConsent = false;
  try { hadConsent = localStorage.getItem(TOKEN_KEY + ".consented") === "1"; } catch {}
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: resp.access_token, expires: Date.now() + (resp.expires_in || 3600) * 1000 }));
          localStorage.setItem(TOKEN_KEY + ".consented", "1");
        } catch {}
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err?.message || "Google sign-in was closed")),
    });
    client.requestAccessToken({ prompt: hadConsent ? "" : "consent" });
  });
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    throw new Error("Google sign-in expired. Tap Sync again.");
  }
  if (!res.ok) {
    let msg = `Sheets error ${res.status}`;
    try { msg = (await res.json()).error.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

const colLetter = (n) => {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Sheet cells are plain text; send clean numbers as numbers so the Sheet can chart them.
const cell = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

export async function syncToSheet({ clientId, sheetId, days, ctx }) {
  if (!clientId) throw new Error("Google sign-in is not set up (config.js).");
  if (!sheetId) throw new Error("No Google Sheet is set (config.js).");
  const token = await getToken(clientId);

  const meta = await api(token, `${sheetId}?fields=sheets.properties`);
  const props = meta.sheets[0].properties;
  const title = props.title.replace(/'/g, "''");
  const gid = props.sheetId;

  // Read what is already there and index it by date → label → value.
  const existing = await api(token, `${sheetId}/values/${encodeURIComponent(`'${title}'`)}?majorDimension=COLUMNS`);
  const cols = existing.values || [];
  const labels = (cols[0] || []).map((l) => String(l).trim());
  const sheetDays = {};
  for (const col of cols.slice(1)) {
    const iso = parseDDMMYYYY(col[0]);
    if (!iso) continue;
    const byLabel = {};
    labels.forEach((l, i) => i > 0 && (byLabel[l] = col[i] ?? ""));
    sheetDays[iso] = byLabel;
  }

  // Phone data wins for any date it has.
  const local = {};
  days.forEach((d) => (local[d.date] = d));
  const allDates = [...new Set([...Object.keys(sheetDays), ...Object.keys(local)])].sort();
  if (!allDates.length) throw new Error("Nothing to sync yet.");
  const dates = dateRange(allDates[0], allDates[allDates.length - 1]);

  const table = buildTable(dates, local, ctx);
  // Fill columns for dates only the Sheet knows about.
  dates.forEach((iso, j) => {
    if (local[iso] || !sheetDays[iso]) return;
    ROWS.forEach((r, i) => (table[i + 1][j + 1] = sheetDays[iso][r.label] ?? ""));
  });

  // Pad with blanks so any old, wider/taller content is overwritten.
  const width = Math.max(table[0].length, cols.length);
  const height = Math.max(table.length, labels.length);
  const grid = Array.from({ length: height }, (_, i) =>
    Array.from({ length: width }, (_, j) => (table[i] && table[i][j] !== undefined ? cell(table[i][j]) : ""))
  );

  const requests = [];
  const { rowCount, columnCount } = props.gridProperties;
  if (columnCount < width) requests.push({ appendDimension: { sheetId: gid, dimension: "COLUMNS", length: width - columnCount } });
  if (rowCount < height) requests.push({ appendDimension: { sheetId: gid, dimension: "ROWS", length: height - rowCount } });
  if (requests.length) await api(token, `${sheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });

  await api(token, `${sheetId}/values/${encodeURIComponent(`'${title}'!A1:${colLetter(width - 1)}${height}`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: grid }),
  });

  await api(token, `${sheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: formatRequests(gid, table.length, table[0].length) }) });

  // Pull down dates the Sheet has that this phone doesn't, so history entered
  // elsewhere (or seeded directly into the Sheet) shows up when you browse to
  // that date. Never touches a date the phone already has.
  const imported = Object.keys(sheetDays)
    .filter((iso) => !local[iso])
    .map((iso) => dayFromSheetRow(iso, sheetDays[iso]));

  return { days: dates.length, imported };
}

function formatRequests(gid, rows, cols) {
  const all = { sheetId: gid, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: cols };
  const black = { style: "SOLID", color: { red: 0, green: 0, blue: 0 } };
  return [
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } },
    {
      repeatCell: {
        range: all,
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP", textFormat: { bold: false, fontFamily: "Arial", fontSize: 10 }, backgroundColor: { red: 1, green: 1, blue: 1 } } },
        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat,backgroundColor)",
      },
    },
    {
      repeatCell: {
        range: { ...all, endColumnIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: "LEFT", textFormat: { bold: true, fontFamily: "Times New Roman", fontSize: 10 }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } } },
        fields: "userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)",
      },
    },
    {
      repeatCell: {
        range: { ...all, endRowIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { bold: true, fontFamily: "Times New Roman", fontSize: 10 }, backgroundColor: { red: 0.886, green: 0.906, blue: 0.949 } } },
        fields: "userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)",
      },
    },
    { updateBorders: { range: all, top: black, bottom: black, left: black, right: black, innerHorizontal: black, innerVertical: black } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: 1, endIndex: cols }, properties: { pixelSize: 115 }, fields: "pixelSize" } },
  ];
}
