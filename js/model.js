// Pure data logic shared by the UI, the PDF export and the Sheet sync.
// No DOM or storage access here, so it can be unit-tested in Node.

export const CHECKPOINTS = [
  { id: "bbf", name: "Before Breakfast", short: "8am" },
  { id: "abf", name: "After Breakfast", short: "11am" },
  { id: "bl", name: "Before Lunch", short: "2pm" },
  { id: "bd", name: "Before Dinner", short: "8pm" },
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
  return { date, intake: "", output: "", meds: {}, labs: {}, checkpoints };
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

// Highest systolic of the day; a tie keeps the earlier checkpoint.
export function bpHighest(day) {
  let best = null;
  for (const cp of bpReadings(day)) if (!best || num(cp.sys) > num(best.sys)) best = cp;
  return best ? bpText(best) : "";
}

// Lowest systolic of the day; a tie keeps the earlier checkpoint. Blank when
// there is only one reading (it is already shown as the highest).
export function bpLowest(day) {
  const readings = bpReadings(day);
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
  { label: "BP-Highest", get: (d) => bpHighest(d) },
  { label: "BP-Lowest", get: (d) => bpLowest(d) },
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
