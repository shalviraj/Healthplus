// Pure data logic shared by the UI, the PDF export and the Sheet sync.
// No DOM or storage access here, so it can be unit-tested in Node.

export const CHECKPOINTS = [
  { id: "bbf", name: "Before Breakfast", short: "Fasting" },
  { id: "abf", name: "After Breakfast", short: "PP" },
  { id: "bl", name: "Before Lunch", short: "Before Lunch" },
  { id: "bd", name: "Before Dinner", short: "Before Dinner" },
];

export const MEDS = ["Steroid", "Tac", "VIRFOLI", "Bactrim DS", "Faronam 200", "Udiliv 300"];
export const LABS = ["T0", "Creatinine", "Sodium", "Potassium", "Urea", "Phosphorus", "Calcium", "HB", "Platelet"];

export const LOW_SUGAR = 70;

// ---------- dates (always local calendar dates as YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, "0");
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (iso, n) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const todayISO = () => toISO(new Date());
export const ddmmyyyy = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
export const parseDDMMYYYY = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
};
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function dayNumber(iso, day1) {
  if (!day1 || iso < day1) return "";
  return String(Math.round((fromISO(iso) - fromISO(day1)) / 86400000) + 1);
}

// ---------- day records ----------
export function blankDay(date) {
  const checkpoints = {};
  CHECKPOINTS.forEach((c) => (checkpoints[c.id] = {}));
  // bpHistoric: BP-Highest/Lowest text pulled in from the Sheet for a day that
  // has no per-checkpoint BP on this phone (see dayFromSheetRow). bpHighest/
  // bpLowest fall back to it only when no checkpoint has a real reading.
  return { date, intake: "", output: "", meds: {}, labs: {}, checkpoints, bpHistoric: null };
}

export const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== "";
export const hasMeds = (day) => !!day && MEDS.some((m) => hasValue(day.meds?.[m]));
export const labsFilled = (day) => LABS.filter((l) => hasValue(day?.labs?.[l])).length;
export const cpLogged = (cp) => !!cp && (hasValue(cp.sugar) || hasValue(cp.sys) || hasValue(cp.weight));

export function num(v) {
  if (!hasValue(v)) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function bpText(cp) {
  if (!cp || !hasValue(cp.sys)) return "";
  return hasValue(cp.dia) ? `${cp.sys}/${cp.dia}` : String(cp.sys);
}

// Readings in chronological order (Before BF → Before Dinner) that have a systolic value.
function bpReadings(day) {
  return CHECKPOINTS.map((c) => day?.checkpoints?.[c.id]).filter((cp) => num(cp?.sys) !== null);
}

// Highest systolic of the day; a tie keeps the earlier checkpoint. Falls back
// to a Sheet-imported summary (bpHistoric) when no checkpoint has a reading.
export function bpHighest(day) {
  let best = null;
  for (const cp of bpReadings(day)) if (!best || num(cp.sys) > num(best.sys)) best = cp;
  if (best) return bpText(best);
  return day?.bpHistoric?.highest || "";
}

// Lowest systolic of the day; a tie keeps the earlier checkpoint. Blank when
// there is only one reading (it is already shown as the highest), or falls
// back to a Sheet-imported summary when no checkpoint has a reading.
export function bpLowest(day) {
  const readings = bpReadings(day);
  if (!readings.length) return day?.bpHistoric?.lowest || "";
  if (readings.length < 2) return "";
  let best = null;
  for (const cp of readings) if (!best || num(cp.sys) < num(best.sys)) best = cp;
  return bpText(best);
}

// ---------- insulin chart ----------
// chart: [{ min, max, units }] with inclusive bounds.
export function normalizeChart(rows) {
  return rows
    .map((r) => ({ min: num(r.min), max: num(r.max), units: num(r.units) }))
    .filter((r) => r.min !== null && r.units !== null)
    .sort((a, b) => a.min - b.min);
}

// Returns { units, note }; units is "" when there is nothing to suggest.
export function suggestInsulin(sugar, chart) {
  const s = num(sugar);
  if (s === null || !chart?.length) return { units: "", note: chart?.length ? "" : "Set up the insulin chart on Home" };
  const rows = normalizeChart(chart);
  if (s < rows[0].min) return { units: "0", note: "Below chart range" };
  for (const r of rows) {
    if (s >= r.min && (r.max === null || s <= r.max)) return { units: String(r.units), note: `Range ${r.min}–${r.max ?? "+"}` };
  }
  const top = rows[rows.length - 1];
  if (top.max !== null && s > top.max) return { units: String(top.units), note: "Above chart range — check with doctor" };
  return { units: "", note: "No matching range" };
}

// ---------- export rows (Sheet + PDF) ----------
const cpv = (day, id, field) => day?.checkpoints?.[id]?.[field] ?? "";

export const ROWS = [
  { label: "Day", get: (d, ctx) => dayNumber(d.date, ctx.day1) },
  { label: "Intake", get: (d) => d.intake },
  { label: "Output", get: (d) => d.output },
  { label: "Weight", get: (d) => cpv(d, "bbf", "weight") },
  { label: "BP Before BF", get: (d) => bpText(d.checkpoints?.bbf) },
  { label: "BP After BF", get: (d) => bpText(d.checkpoints?.abf) },
  { label: "BP Before Lunch", get: (d) => bpText(d.checkpoints?.bl) },
  { label: "BP Before Dinner", get: (d) => bpText(d.checkpoints?.bd) },
  { label: "Fasting BS", get: (d) => cpv(d, "bbf", "sugar") },
  { label: "PP", get: (d) => cpv(d, "abf", "sugar") },
  { label: "Before Lunch", get: (d) => cpv(d, "bl", "sugar") },
  { label: "Before Dinner", get: (d) => cpv(d, "bd", "sugar") },
  ...MEDS.map((m) => ({ label: m, get: (d) => d.meds?.[m] ?? "" })),
  ...LABS.map((l) => ({ label: l, get: (d) => d.labs?.[l] ?? "" })),
];

// Returns a table: first row is ["Date", dd/mm/yyyy...], then one row per ROWS entry.
export function buildTable(dates, dayMap, ctx) {
  const header = ["Date", ...dates.map(ddmmyyyy)];
  const body = ROWS.map((r) => [r.label, ...dates.map((iso) => String(r.get(dayMap[iso] || blankDay(iso), ctx) ?? ""))]);
  return [header, ...body];
}

// The reverse of buildTable's ROWS mapping: turns one Sheet column (label →
// text, as read for a single date) into a day record for local storage, for
// a date the phone has no entry for yet (see sheets.js's pull-down on sync).
// Per-checkpoint BP isn't in the Sheet (only the day's Highest/Lowest), so it
// stays blank; bpHighest/bpLowest fall back to bpHistoric for such a day.
const CP_BP_LABEL = { bbf: "BP Before BF", abf: "BP After BF", bl: "BP Before Lunch", bd: "BP Before Dinner" };
const CP_SUGAR_LABEL = { bbf: "Fasting BS", abf: "PP", bl: "Before Lunch", bd: "Before Dinner" };

// Field-level merge of two Day objects: every value already present in
// `base` is kept as-is; a field `base` has nothing for is filled in from
// `extra`. This is the building block for both sync directions — which
// side is `base` decides who wins a field both sides have:
//   mergeDay(localDay, sheetDay)  → local wins   (download from Sheet)
//   mergeDay(sheetDay, localDay)  → Sheet wins   (upload to Sheet)
// It's safe to call for every date on every sync: it never overwrites a
// real value on the `base` side, only fills fields `base` left blank.
export function mergeDay(base, extra) {
  const day = {
    ...blankDay(base.date), ...base,
    checkpoints: { ...blankDay(base.date).checkpoints, ...base.checkpoints },
    meds: { ...base.meds }, labs: { ...base.labs },
  };
  const fill = (obj, key, val) => { if (!hasValue(obj[key]) && hasValue(val)) obj[key] = val; };

  fill(day, "intake", extra.intake);
  fill(day, "output", extra.output);
  CHECKPOINTS.forEach((c) => {
    const cp = extra.checkpoints?.[c.id] || {};
    fill(day.checkpoints[c.id], "weight", cp.weight);
    fill(day.checkpoints[c.id], "sugar", cp.sugar);
    if (hasValue(cp.sys) && !hasValue(day.checkpoints[c.id].sys)) {
      day.checkpoints[c.id].sys = cp.sys;
      day.checkpoints[c.id].dia = cp.dia || "";
    }
  });
  MEDS.forEach((m) => fill(day.meds, m, extra.meds?.[m]));
  LABS.forEach((l) => fill(day.labs, l, extra.labs?.[l]));
  if (!day.bpHistoric && extra.bpHistoric) day.bpHistoric = extra.bpHistoric;
  return day;
}

// Turns one Sheet column (label → text, as read for a single date) into a
// plain day record, with no merging — just what that column says. "N/A" is
// a placeholder some Sheet rows use for a blank cell (a Google Sheets
// CSV-import quirk needed a non-empty cell there), so it's treated as blank.
export function sheetRowToDay(date, byLabel) {
  const day = blankDay(date);
  const get = (label) => { const v = byLabel[label] ?? ""; return v === "N/A" ? "" : v; };
  const set = (obj, key, val) => { if (hasValue(val)) obj[key] = val; };

  set(day, "intake", get("Intake"));
  set(day, "output", get("Output"));
  set(day.checkpoints.bbf, "weight", get("Weight"));
  CHECKPOINTS.forEach((c) => {
    set(day.checkpoints[c.id], "sugar", get(CP_SUGAR_LABEL[c.id]));
    const bp = get(CP_BP_LABEL[c.id]);
    if (hasValue(bp)) {
      const [sys, dia] = String(bp).split("/");
      day.checkpoints[c.id].sys = sys || "";
      day.checkpoints[c.id].dia = dia || "";
    }
  });
  MEDS.forEach((m) => set(day.meds, m, get(m)));
  LABS.forEach((l) => set(day.labs, l, get(l)));
  const highest = get("BP-Highest"), lowest = get("BP-Lowest");
  if (highest || lowest) day.bpHistoric = { highest, lowest };
  return day;
}

// Local wins, Sheet fills blanks — the shape the old single Sync button
// used. Kept as a thin wrapper over sheetRowToDay + mergeDay for callers
// (and tests) that want the Sheet-column-to-local-day conversion in one call.
export function dayFromSheetRow(date, byLabel, base) {
  const sheetDay = sheetRowToDay(date, byLabel);
  return base ? mergeDay(base, sheetDay) : sheetDay;
}
