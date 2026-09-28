import * as db from "./db.js";
import {
  CHECKPOINTS, MEDS, LABS, LOW_SUGAR,
  todayISO, addDays, fromISO, blankDay, hasMeds, hasValue, labsFilled,
  num, bpHighest, suggestInsulin, normalizeChart, dateRange,
} from "./model.js";
import { makePdf, fileName } from "./pdf.js";
import { uploadToSheet, downloadFromSheet, loadGis, signOut } from "./sheets.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  date: todayISO(),
  tab: "home",
  cur: null,
  settings: {},
  chart: [],
  metric: pref("metric", "weight"),
};
let daySaveTimer = null;
let settingsSaveTimer = null;
let lastEditedEl = null; // the input a save should flash a checkmark next to

// ---------- small helpers ----------
function pref(key, fallback) {
  try { return localStorage.getItem("hp." + key) ?? fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem("hp." + key, value); } catch {}
}
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), ms);
}
// Shows the saved checkmark inside the field that was just edited, rather
// than in the header. Silently does nothing if that field isn't visible
// right now (e.g. a tab switch triggered the save for the previous tab).
function flashFieldSaved(el) {
  if (!el || !el.isConnected || el.closest("[hidden]")) return;
  const chip = $("#fieldCheck");
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  chip.style.left = `${r.right - 15}px`;
  chip.style.top = `${r.top + r.height / 2}px`;
  chip.classList.add("show");
  clearTimeout(flashFieldSaved.timer);
  flashFieldSaved.timer = setTimeout(() => chip.classList.remove("show"), 1100);
}
const fmtLong = (iso) => fromISO(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- data ----------
async function loadDay(date) {
  let day = await db.getDay(date);
  day = day ? { ...blankDay(date), ...day, checkpoints: { ...blankDay(date).checkpoints, ...day.checkpoints } } : blankDay(date);
  if (!hasMeds(day)) {
    const prev = await db.findBefore(date, hasMeds);
    if (prev) day.meds = { ...prev.meds };
  }
  if (!hasValue(day.intake) && hasValue(state.settings.waterDefault)) day.intake = state.settings.waterDefault;
  return day;
}

function scheduleDaySave() {
  clearTimeout(daySaveTimer);
  daySaveTimer = setTimeout(saveDay, 350);
}
async function saveDay() {
  clearTimeout(daySaveTimer);
  daySaveTimer = null;
  if (!state.cur) return;
  try {
    await db.putDay(state.cur);
  } catch (err) {
    console.error(err);
    toast("Could not save on this phone: " + (err.message || err), 6000);
    return;
  }
  flashFieldSaved(lastEditedEl);
  renderStrip();
}
async function flushDay() {
  if (daySaveTimer) await saveDay();
}

function scheduleSettingsSave() {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(saveSettingsNow, 350);
}
async function saveSettingsNow() {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = null;
  const { day1, name, waterDefault } = state.settings;
  try {
    await db.setKV("settings", { day1, name, waterDefault });
  } catch (err) {
    console.error(err);
    toast("Could not save on this phone: " + (err.message || err), 6000);
    return;
  }
  flashFieldSaved(lastEditedEl);
  renderHeader();
  if (state.cur && !hasValue(state.cur.intake) && hasValue(waterDefault)) {
    state.cur.intake = waterDefault;
    if (state.tab === "home") renderHome();
  }
}
async function flushSettings() {
  if (settingsSaveTimer) await saveSettingsNow();
}
async function flushAll() {
  await Promise.all([flushDay(), flushSettings()]);
}

// ---------- rendering ----------
function renderHeader() {
  $("#dateMain").textContent = fmtLong(state.date);
  $("#datePicker").value = state.date;
}

function renderHome() {
  const d = state.cur;
  $$("[data-home]").forEach((i) => (i.value = d[i.dataset.home] ?? ""));
  CHECKPOINTS.forEach((c) => {
    const cp = d.checkpoints[c.id];
    $$(`[data-cpid="${c.id}"]`).forEach((i) => (i.value = cp[i.dataset.cpfield] ?? ""));
    renderSugarNote(c.id, cp);
  });
  renderStrip();
}

function renderOccasional() {
  const d = state.cur;
  $$("[data-med]").forEach((i) => (i.value = d.meds[i.dataset.med] ?? ""));
  $$("[data-lab]").forEach((i) => (i.value = d.labs[i.dataset.lab] ?? ""));
  renderBadges();
}

function renderBadges() {
  const meds = MEDS.filter((m) => hasValue(state.cur.meds[m])).length;
  $("#medsBadge").textContent = `${meds}/${MEDS.length}`;
  const labs = labsFilled(state.cur);
  $("#labsBadge").textContent = labs ? `${labs} filled` : "";
}

async function renderStrip() {
  const from = addDays(state.date, -6);
  const recs = await db.daysBetween(from, state.date);
  const byDate = Object.fromEntries(recs.map((r) => [r.date, r]));
  if (state.cur) byDate[state.date] = state.cur;
  const today = todayISO();
  const units = { weight: "Weight · kg", bp: "Highest BP · mmHg", sugar: "Fasting sugar · mg/dL" };
  $("#trendUnit").textContent = units[state.metric];

  $("#strip").innerHTML = dateRange(from, state.date).map((iso) => {
    const d = byDate[iso];
    let v = "";
    if (d) {
      if (state.metric === "weight") v = d.checkpoints?.bbf?.weight ?? "";
      else if (state.metric === "bp") v = bpHighest(d);
      else v = d.checkpoints?.bbf?.sugar ?? "";
    }
    // BP is stacked (systolic over diastolic) so seven days fit across a phone.
    const [top, bottom] = String(v).split("/");
    const val = !hasValue(v) ? "—" : bottom !== undefined ? `${esc(top)}<i>${esc(bottom)}</i>` : esc(v);
    const dt = fromISO(iso);
    const cls = ["day", iso === today && "today", iso === state.date && "sel"].filter(Boolean).join(" ");
    return `<button class="${cls}" data-date="${iso}" aria-label="${dt.toDateString()}">
      <span class="dw">${dt.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3)}</span>
      <span class="dd">${dt.getDate()}</span>
      <span class="dv ${hasValue(v) ? "" : "empty"}">${val}</span>
    </button>`;
  }).join("");

  $$("#metricSeg button").forEach((b) => b.classList.toggle("on", b.dataset.metric === state.metric));
}

// Low-sugar flag or the suggested-insulin note, shown under a checkpoint's
// Sugar field (e.g. "Suggested 6 units · Range 200–249").
function renderSugarNote(id, cp) {
  cp = cp || state.cur.checkpoints[id];
  const note = $(`[data-sugar-note="${id}"]`);
  const input = $(`[data-cpid="${id}"][data-cpfield="sugar"]`);
  if (!note || !input) return;
  const low = num(cp.sugar) !== null && num(cp.sugar) < LOW_SUGAR;
  input.classList.toggle("lowval", low);
  note.classList.toggle("low", low);
  note.textContent = !hasValue(cp.sugar) ? ""
    : low ? `Low sugar (below ${LOW_SUGAR}) — treat per doctor's advice`
    : suggestedInsulinText(cp.sugar);
}

// One line combining the suggested dose and the insulin chart note, shown
// under the Sugar field (e.g. "Suggested 6 units · Range 200–249").
function suggestedInsulinText(sugar) {
  const { units, note } = suggestInsulin(sugar, state.chart);
  if (units === "") return note;
  const dose = `Suggested ${units} unit${units === "1" ? "" : "s"}`;
  return note ? `${dose} · ${note}` : dose;
}

function render() {
  renderHeader();
  $("#view-home").hidden = state.tab !== "home";
  $("#view-occasional").hidden = state.tab !== "occasional";
  $("#view-settings").hidden = state.tab !== "settings";
  $$("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  if (state.tab === "home") renderHome();
  else if (state.tab === "occasional") renderOccasional();
  else renderSettingsView();
}

async function setDate(iso) {
  await flushDay();
  state.date = iso;
  state.cur = await loadDay(iso);
  $("#clearDayBtn").textContent = `Clear entries for ${fmtLong(iso)}`;
  render();
}

// ---------- inputs ----------
const numeric = (v) => v.replace(/[^\d.]/g, "");

function buildLists() {
  $("#medsList").innerHTML = MEDS.map((m) => `<label><span>${m}</span><input type="text" data-med="${m}" autocomplete="off" placeholder="—"></label>`).join("");
  $("#labsList").innerHTML = LABS.map((l) => `<label><span>${l}</span><input type="text" data-lab="${l}" autocomplete="off" inputmode="decimal" placeholder="—"></label>`).join("");

  // Sugar and BP now show all four checkpoints at once (see the "Sugar/BP
  // layout" decision), so each row is tagged with which checkpoint it's for
  // (data-cpid) and which field within it (data-cpfield) instead of relying
  // on a "current tab" like the old per-time-of-day tabs did.
  $("#sugarList").innerHTML = CHECKPOINTS.map((c) => `
    <div class="cprow">
      <span class="cp-time">${c.short}</span>
      <div class="grid2">
        <label class="field">
          <span class="lbl">Sugar</span>
          <span class="inrow"><input class="num" type="text" inputmode="numeric" data-cpid="${c.id}" data-cpfield="sugar" placeholder="—"><em>mg/dL</em></span>
        </label>
        <label class="field">
          <span class="lbl">Insulin given</span>
          <span class="inrow"><input class="num" type="text" inputmode="decimal" data-cpid="${c.id}" data-cpfield="insGiven" placeholder="—"><em>units</em></span>
        </label>
      </div>
      <small class="sub" data-sugar-note="${c.id}"></small>
    </div>`).join("");

  $("#bpList").innerHTML = CHECKPOINTS.map((c) => `
    <div class="cprow">
      <span class="cp-time">${c.short}</span>
      <span class="inrow bp">
        <input class="num" type="text" inputmode="numeric" data-cpid="${c.id}" data-cpfield="sys" placeholder="Sys" aria-label="Systolic (${c.short})">
        <b>/</b>
        <input class="num" type="text" inputmode="numeric" data-cpid="${c.id}" data-cpfield="dia" placeholder="Dia" aria-label="Diastolic (${c.short})">
        <em>mmHg</em>
      </span>
    </div>`).join("");
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.setting) {
    let val = el.value;
    if (el.dataset.setting === "waterDefault") { val = numeric(val); el.value = val; }
    state.settings[el.dataset.setting] = val;
    lastEditedEl = el;
    scheduleSettingsSave();
    return;
  }
  const d = state.cur;
  if (!d) return;
  if (el.dataset.home) {
    el.value = numeric(el.value);
    d[el.dataset.home] = el.value;
  } else if (el.dataset.med) {
    d.meds[el.dataset.med] = el.value;
    renderBadges();
  } else if (el.dataset.lab) {
    d.labs[el.dataset.lab] = el.value;
    renderBadges();
  } else if (el.dataset.cpid) {
    const id = el.dataset.cpid, field = el.dataset.cpfield;
    const cp = d.checkpoints[id];
    el.value = numeric(el.value);
    cp[field] = el.value;
    if (field === "sugar") {
      cp.insSuggested = suggestInsulin(el.value, state.chart).units;
      renderSugarNote(id, cp);
    }
    if (field === "sys" && el.value.length >= 3 && num(el.value) >= 60) $(`[data-cpid="${id}"][data-cpfield="dia"]`).focus();
  } else return;
  lastEditedEl = el;
  scheduleDaySave();
}

// ---------- insulin chart ----------
function insRow(r = {}) {
  const v = (x) => (x === null || x === undefined ? "" : x);
  return `<div class="ins-row">
    <input type="text" inputmode="numeric" data-k="min" value="${v(r.min)}" placeholder="150">
    <input type="text" inputmode="numeric" data-k="max" value="${v(r.max)}" placeholder="199">
    <input type="text" inputmode="decimal" data-k="units" value="${v(r.units)}" placeholder="4">
    <button type="button" aria-label="Remove range">×</button>
  </div>`;
}
function openInsulin() {
  const rows = state.chart.length ? state.chart : [{}];
  $("#insRows").innerHTML = rows.map(insRow).join("");
  $("#insulinDlg").showModal();
}
async function saveInsulin() {
  const rows = $$("#insRows .ins-row").map((r) => Object.fromEntries($$("input", r).map((i) => [i.dataset.k, i.value])));
  state.chart = normalizeChart(rows);
  await db.setKV("insulinChart", state.chart);
  toast(state.chart.length ? `Insulin chart saved (${state.chart.length} ranges)` : "Insulin chart cleared");
  // The suggested-insulin note lives under each checkpoint's Sugar field on
  // Home; refresh it there since a new chart can change every suggestion.
  if (state.tab === "home") CHECKPOINTS.forEach((c) => renderSugarNote(c.id));
}

// ---------- PDF ----------
async function openPdf() {
  const today = todayISO();
  $("#pdfTo").value = today;
  $("#pdfFrom").value = addDays(today, -29);
  $("#pdfDlg").showModal();
}
async function setPdfRange(kind) {
  const today = todayISO();
  if (kind === "all") {
    const days = await db.allDays();
    $("#pdfFrom").value = days[0]?.date || today;
    $("#pdfTo").value = days.length ? (days[days.length - 1].date > today ? days[days.length - 1].date : today) : today;
  } else {
    $("#pdfTo").value = today;
    $("#pdfFrom").value = addDays(today, -(Number(kind) - 1));
  }
}
async function downloadPdf() {
  let from = $("#pdfFrom").value, to = $("#pdfTo").value;
  if (!from || !to) return;
  if (from > to) [from, to] = [to, from];
  if (!window.jspdf?.jsPDF) return toast("PDF tools are still loading — try again in a moment.");
  await flushDay();
  const recs = await db.daysBetween(from, to);
  const map = Object.fromEntries(recs.map((r) => [r.date, r]));
  const doc = makePdf(dateRange(from, to), map, { day1: state.settings.day1 });
  doc.save(fileName(from, to, state.settings.name));
}

// ---------- Sheets ----------
// Two one-way buttons instead of one two-way Sync, since more than one
// person (each on their own phone) uses this Sheet: "Upload" only fills
// Sheet cells that are still blank, "Download" only fills local fields
// that are still blank, so neither can silently overwrite what the other
// person already entered.
async function withSyncUI(btnId, topId, busyLabel, run) {
  const btn = $(btnId), top = $(topId);
  if (btn.disabled) return;
  btn.disabled = top.disabled = true;
  top.classList.add("spin");
  const label = btn.lastChild.textContent;
  btn.lastChild.textContent = busyLabel;
  try {
    await flushAll();
    await run();
  } catch (err) {
    toast(err.message || String(err), 4500);
  } finally {
    btn.disabled = top.disabled = false;
    top.classList.remove("spin");
    btn.lastChild.textContent = label;
  }
}

async function doUpload() {
  await withSyncUI("#uploadBtn", "#uploadTop", "Uploading…", async () => {
    const res = await uploadToSheet({
      clientId: state.settings.clientId,
      sheetId: state.settings.sheetId,
      days: await db.allDays(),
      ctx: { day1: state.settings.day1 },
    });
    toast(res.filled
      ? `Uploaded ${res.days} days · filled ${res.filled} blank cells in the Sheet`
      : `Uploaded to the Sheet · nothing new to fill in`);
  });
}

async function doDownload() {
  await withSyncUI("#downloadBtn", "#downloadTop", "Downloading…", async () => {
    const res = await downloadFromSheet({
      clientId: state.settings.clientId,
      sheetId: state.settings.sheetId,
      days: await db.allDays(),
      ctx: { day1: state.settings.day1 },
    });
    if (res.imported?.length) {
      await db.putDays(res.imported);
      state.cur = await loadDay(state.date);
      render();
    }
    toast(res.imported?.length
      ? `Downloaded ${res.imported.length} days' worth of new data from the Sheet`
      : `Downloaded from the Sheet · nothing new for this phone`);
  });
}

// ---------- settings / backup ----------
async function loadSettings() {
  const cfg = window.HP_CONFIG || {};
  const saved = await db.getKV("settings", {});
  state.settings = {
    day1: saved.day1 || cfg.day1 || "",
    name: saved.name || "",
    waterDefault: saved.waterDefault ?? "5000",
    // Google connection comes only from config.js, not from Settings.
    clientId: cfg.googleClientId || "",
    sheetId: cfg.sheetId || "",
  };
  state.chart = await db.getKV("insulinChart", cfg.insulinChart || []);
}
// ---------- theme ----------
const THEME_COLOR = { light: "#f3ede2", dark: "#14101f" };
function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const resolved = theme === "light" || theme === "dark" ? theme
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $$('meta[name="theme-color"]').forEach((m) => (m.content = THEME_COLOR[resolved]));
  $$("#themeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === theme));
}

function renderSettingsView() {
  const s = state.settings;
  $("#setDay1").value = s.day1;
  $("#setName").value = s.name;
  $("#setWater").value = s.waterDefault;
  $$("#themeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === (pref("theme", "system"))));
  $("#clearDayBtn").textContent = `Clear entries for ${fmtLong(state.date)}`;
}
async function exportBackup() {
  await flushAll();
  const data = { app: "healthplus", version: 1, exported: new Date().toISOString(), days: await db.allDays(), kv: { settings: state.settings, insulinChart: state.chart } };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `healthplus-backup-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "healthplus" || !Array.isArray(data.days)) throw new Error("Not a Healthplus backup file");
    if (!confirm(`Replace everything on this phone with ${data.days.length} days from the backup?`)) return;
    await db.replaceAll(data.days, data.kv);
    await loadSettings();
    await setDate(state.date);
    toast("Backup restored");
  } catch (err) {
    toast(err.message || "Could not read that file", 4000);
  }
}

async function clearDay() {
  const label = fmtLong(state.date);
  if (!confirm(`Clear all entries for ${label}? This cannot be undone.`)) return;
  clearTimeout(daySaveTimer);
  daySaveTimer = null;
  await db.deleteDay(state.date);
  state.tab = "home";
  await setDate(state.date);
  toast(`Entries for ${label} cleared`);
}

async function eraseAll() {
  if (!confirm("Erase ALL daily entries on this phone? Settings and the insulin chart are kept. This cannot be undone.")) return;
  clearTimeout(daySaveTimer);
  daySaveTimer = null;
  await db.clearDays();
  state.tab = "home";
  await setDate(todayISO());
  toast("All entries erased from this phone");
}

// ---------- wiring ----------
function bind() {
  document.addEventListener("input", onInput);
  $("#prevDay").onclick = () => setDate(addDays(state.date, -1));
  $("#nextDay").onclick = () => setDate(addDays(state.date, 1));
  const pick = () => {
    const p = $("#datePicker");
    try { p.showPicker(); } catch { p.focus(); p.click(); }
  };
  $("#dateLabel").onclick = pick;
  $("#datePicker").onchange = (e) => e.target.value && setDate(e.target.value);

  $("#tabbar").onclick = (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b || b.dataset.tab === state.tab) return;
    state.tab = b.dataset.tab;
    render();
    window.scrollTo({ top: 0 });
  };
  $("#metricSeg").onclick = (e) => {
    const b = e.target.closest("button[data-metric]");
    if (!b) return;
    state.metric = b.dataset.metric;
    setPref("metric", state.metric);
    renderStrip();
  };
  $("#strip").onclick = (e) => {
    const b = e.target.closest("[data-date]");
    if (b && b.dataset.date !== state.date) setDate(b.dataset.date);
  };

  $("#insulinBtn").onclick = openInsulin;
  $("#insAdd").onclick = () => $("#insRows").insertAdjacentHTML("beforeend", insRow());
  $("#insRows").onclick = (e) => e.target.closest(".ins-row button")?.closest(".ins-row").remove();
  $("#insulinDlg").addEventListener("close", (e) => e.target.returnValue === "save" && saveInsulin());

  $("#pdfBtn").onclick = openPdf;
  $("#pdfDlg .chips").onclick = (e) => e.target.dataset.range && setPdfRange(e.target.dataset.range);
  $("#pdfDlg").addEventListener("close", (e) => e.target.returnValue === "ok" && downloadPdf());

  $("#uploadBtn").onclick = doUpload;
  $("#uploadTop").onclick = doUpload;
  $("#downloadBtn").onclick = doDownload;
  $("#downloadTop").onclick = doDownload;

  $("#themeSeg").onclick = (e) => {
    const b = e.target.closest("button[data-theme]");
    if (!b) return;
    setPref("theme", b.dataset.theme);
    applyTheme(b.dataset.theme);
  };
  $("#backupBtn").onclick = exportBackup;
  $("#restoreBtn").onclick = () => $("#restoreFile").click();
  $("#restoreFile").onchange = (e) => e.target.files[0] && restoreBackup(e.target.files[0]);
  $("#signOutBtn").onclick = () => { signOut(); toast("Signed out of Google"); };
  $("#clearDayBtn").onclick = clearDay;
  $("#eraseBtn").onclick = eraseAll;

  // Reset each dialog's result so closing with Esc/backdrop never re-applies the last action.
  $$("dialog").forEach((d) => d.addEventListener("cancel", () => (d.returnValue = "cancel")));
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => e.target === d && d.close("cancel")));

  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushAll());
  window.addEventListener("pagehide", () => flushAll());
}

async function init() {
  buildLists();
  bind();
  applyTheme(pref("theme", "system"));
  await loadSettings();
  await setDate(todayISO());
  if (state.settings.clientId && navigator.onLine) loadGis().catch(() => {});
}

// Register the service worker first, so a broken start still picks up the next update.
// When a new version takes over, reload once so the page and its scripts always match.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    flushAll().finally(() => location.reload());
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
}

init().catch((err) => {
  console.error(err);
  toast("Something went wrong while starting. Close and reopen the app. (" + (err.message || err) + ")", 8000);
});
