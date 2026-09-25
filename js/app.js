import * as db from "./db.js";
import {
  CHECKPOINTS, MEDS, LABS, LOW_SUGAR,
  todayISO, addDays, fromISO, blankDay, hasMeds, hasValue, labsFilled, cpLogged,
  num, bpHighest, suggestInsulin, normalizeChart, dateRange,
} from "./model.js";
import { makePdf, fileName } from "./pdf.js";
import { syncToSheet, loadGis, signOut } from "./sheets.js";

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
let saveTimer = null;

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
function flashSaved() {
  const s = $("#saved");
  s.classList.add("show");
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => s.classList.remove("show"), 1200);
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
  return day;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
}
async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state.cur) return;
  try {
    await db.putDay(state.cur);
  } catch (err) {
    console.error(err);
    toast("Could not save on this phone: " + (err.message || err), 6000);
    return;
  }
  flashSaved();
  renderStrip();
  renderSnapshot();
}
async function flush() {
  if (saveTimer) await save();
}

// ---------- rendering ----------
function renderHeader() {
  $("#dateMain").textContent = fmtLong(state.date);
  $("#datePicker").value = state.date;
}

function renderHome() {
  const d = state.cur;
  $$("[data-home]").forEach((i) => (i.value = d[i.dataset.home] ?? ""));
  $$("[data-med]").forEach((i) => (i.value = d.meds[i.dataset.med] ?? ""));
  $$("[data-lab]").forEach((i) => (i.value = d.labs[i.dataset.lab] ?? ""));
  renderBadges();
  renderStrip();
  renderSnapshot();
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

function renderSnapshot() {
  const d = state.cur;
  const w = d.checkpoints.bbf.weight;
  let sugar = "", sugarAt = "";
  for (const c of [...CHECKPOINTS].reverse()) {
    if (hasValue(d.checkpoints[c.id].sugar)) { sugar = d.checkpoints[c.id].sugar; sugarAt = c.short; break; }
  }
  const logged = CHECKPOINTS.filter((c) => cpLogged(d.checkpoints[c.id])).length;
  const lowCls = num(sugar) !== null && num(sugar) < LOW_SUGAR ? ' style="color:var(--danger)"' : "";
  $("#snapshot").innerHTML = `<h3>${state.date === todayISO() ? "Today's snapshot" : "Snapshot"}</h3>
    <div class="snap">
      <div><b>${hasValue(w) ? esc(w) : "—"}</b><small>kg weight</small></div>
      <div><b${lowCls}>${hasValue(sugar) ? esc(sugar) : "—"}</b><small>${sugarAt ? `sugar · ${sugarAt}` : "sugar"}</small></div>
      <div><b>${logged}/4</b><small>checkpoints</small></div>
    </div>`;
}

function renderCp() {
  const c = CHECKPOINTS.find((x) => x.id === state.tab);
  const cp = state.cur.checkpoints[c.id];
  $("#cpTitle").textContent = c.short;
  $("#cpSub").textContent = c.name;
  $$("[data-cp]").forEach((i) => (i.value = cp[i.dataset.cp] ?? ""));
  $("#weightCard").hidden = c.id !== "bbf";
  renderSugarState(cp);
}

function renderSugarState(cp) {
  const s = num(cp.sugar);
  const low = s !== null && s < LOW_SUGAR;
  const flag = $("#sugarFlag");
  flag.textContent = low ? `Low sugar (below ${LOW_SUGAR}) — treat per doctor's advice` : "";
  flag.className = "flag" + (low ? " low" : "");
  $('[data-cp="sugar"]').classList.toggle("lowval", low);
  $("#insNote").textContent = hasValue(cp.sugar) ? suggestInsulin(cp.sugar, state.chart).note : "";
}

function render() {
  renderHeader();
  $("#view-home").hidden = state.tab !== "home";
  $("#view-cp").hidden = state.tab === "home";
  $$("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  if (state.tab === "home") renderHome();
  else renderCp();
}

async function setDate(iso) {
  await flush();
  state.date = iso;
  state.cur = await loadDay(iso);
  render();
}

// ---------- inputs ----------
const numeric = (v) => v.replace(/[^\d.]/g, "");

function buildLists() {
  $("#medsList").innerHTML = MEDS.map((m) => `<label><span>${m}</span><input type="text" data-med="${m}" autocomplete="off" placeholder="—"></label>`).join("");
  $("#labsList").innerHTML = LABS.map((l) => `<label><span>${l}</span><input type="text" data-lab="${l}" autocomplete="off" inputmode="decimal" placeholder="—"></label>`).join("");
}

function onInput(e) {
  const el = e.target;
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
  } else if (el.dataset.cp) {
    const field = el.dataset.cp;
    const cp = d.checkpoints[state.tab];
    el.value = numeric(el.value);
    cp[field] = el.value;
    if (field === "sugar") {
      cp.insSuggested = suggestInsulin(el.value, state.chart).units;
      $('[data-cp="insSuggested"]').value = cp.insSuggested;
      renderSugarState(cp);
    }
    if (field === "sys" && el.value.length >= 3 && num(el.value) >= 60) $('[data-cp="dia"]').focus();
  } else return;
  scheduleSave();
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
  if (state.tab !== "home") renderCp();
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
  await flush();
  const recs = await db.daysBetween(from, to);
  const map = Object.fromEntries(recs.map((r) => [r.date, r]));
  const doc = makePdf(dateRange(from, to), map, { day1: state.settings.day1 });
  doc.save(fileName(from, to, state.settings.name));
}

// ---------- Sheets ----------
async function doSync() {
  const btn = $("#syncBtn"), top = $("#syncTop");
  if (btn.disabled) return;
  btn.disabled = top.disabled = true;
  top.classList.add("spin");
  const label = btn.lastChild.textContent;
  btn.lastChild.textContent = "Syncing…";
  try {
    await flush();
    const res = await syncToSheet({
      clientId: state.settings.clientId,
      sheetId: state.settings.sheetId,
      days: await db.allDays(),
      ctx: { day1: state.settings.day1 },
    });
    toast(`Synced ${res.days} days to Google Sheets`);
  } catch (err) {
    toast(err.message || String(err), 4500);
  } finally {
    btn.disabled = top.disabled = false;
    top.classList.remove("spin");
    btn.lastChild.textContent = label;
  }
}

// ---------- settings / backup ----------
async function loadSettings() {
  const cfg = window.HP_CONFIG || {};
  const saved = await db.getKV("settings", {});
  state.settings = {
    day1: saved.day1 || cfg.day1 || "",
    name: saved.name || "",
    // Google connection comes only from config.js, not from Settings.
    clientId: cfg.googleClientId || "",
    sheetId: cfg.sheetId || "",
  };
  state.chart = await db.getKV("insulinChart", []);
}
function openSettings() {
  const s = state.settings;
  $("#setDay1").value = s.day1;
  $("#setName").value = s.name;
  $("#settingsDlg").showModal();
}
async function saveSettings() {
  state.settings = { ...state.settings, day1: $("#setDay1").value, name: $("#setName").value.trim() };
  await db.setKV("settings", { day1: state.settings.day1, name: state.settings.name });
  toast("Settings saved");
  renderHeader();
}
async function exportBackup() {
  await flush();
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
    $("#settingsDlg").close();
    await setDate(state.date);
    toast("Backup restored");
  } catch (err) {
    toast(err.message || "Could not read that file", 4000);
  }
}

async function eraseAll() {
  if (!confirm("Erase ALL daily entries on this phone? Settings and the insulin chart are kept. This cannot be undone.")) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await db.clearDays();
  $("#settingsDlg").close("cancel");
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
  $("#calBtn").onclick = pick;
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

  $("#syncBtn").onclick = doSync;
  $("#syncTop").onclick = doSync;

  $("#settingsBtn").onclick = openSettings;
  $("#settingsTop").onclick = openSettings;
  $("#settingsDlg").addEventListener("close", (e) => e.target.returnValue === "save" && saveSettings());
  $("#backupBtn").onclick = exportBackup;
  $("#restoreBtn").onclick = () => $("#restoreFile").click();
  $("#restoreFile").onchange = (e) => e.target.files[0] && restoreBackup(e.target.files[0]);
  $("#signOutBtn").onclick = () => { signOut(); toast("Signed out of Google"); };
  $("#eraseBtn").onclick = eraseAll;

  // Reset each dialog's result so closing with Esc/backdrop never re-applies the last action.
  $$("dialog").forEach((d) => d.addEventListener("cancel", () => (d.returnValue = "cancel")));
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => e.target === d && d.close("cancel")));

  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  window.addEventListener("pagehide", () => flush());
}

async function init() {
  buildLists();
  bind();
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
    flush().finally(() => location.reload());
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
}

init().catch((err) => {
  console.error(err);
  toast("Something went wrong while starting. Close and reopen the app. (" + (err.message || err) + ")", 8000);
});
