// Run with: node --test tests/   (uses placeholder data only)
import test from "node:test";
import assert from "node:assert/strict";
import { bpHighest, bpLowest, suggestInsulin, dayNumber, buildTable, blankDay, ROWS } from "../js/model.js";

const day = (bps) => {
  const d = blankDay("2026-01-10");
  ["bbf", "abf", "bl", "bd"].forEach((id, i) => { if (bps[i]) [d.checkpoints[id].sys, d.checkpoints[id].dia] = bps[i]; });
  return d;
};

test("BP highest/lowest by systolic, tie keeps the earlier reading", () => {
  const d = day([["130", "80"], ["140", "100"], ["140", "90"], ["117", "80"]]);
  assert.equal(bpHighest(d), "140/100");
  assert.equal(bpLowest(d), "117/80");
  const tie = day([["120", "85"], ["120", "70"]]);
  assert.equal(bpLowest(tie), "120/85");
});

test("single BP reading shows only as highest", () => {
  const d = day([["130", "80"]]);
  assert.equal(bpHighest(d), "130/80");
  assert.equal(bpLowest(d), "");
  assert.equal(bpHighest(blankDay("2026-01-01")), "");
});

test("insulin suggestion", () => {
  const chart = [{ min: 200, max: 249, units: 6 }, { min: 150, max: 199, units: 4 }];
  assert.equal(suggestInsulin("149", chart).units, "0");
  assert.equal(suggestInsulin("150", chart).units, "4");
  assert.equal(suggestInsulin("199", chart).units, "4");
  assert.equal(suggestInsulin("249", chart).units, "6");
  assert.equal(suggestInsulin("300", chart).units, "6");
  assert.match(suggestInsulin("300", chart).note, /Above/);
  assert.equal(suggestInsulin("", chart).units, "");
  assert.equal(suggestInsulin("180", []).units, "");
});

test("day number counts from Day 1", () => {
  assert.equal(dayNumber("2026-08-11", "2026-08-11"), "1");
  assert.equal(dayNumber("2026-08-25", "2026-08-11"), "15");
  assert.equal(dayNumber("2026-11-01", "2026-08-11"), "83");
  assert.equal(dayNumber("2026-08-10", "2026-08-11"), "");
});

test("export table has all four BP rows plus highest/lowest", () => {
  const d = day([["130", "80"], ["140", "100"], ["124", "80"], ["117", "80"]]);
  d.checkpoints.bbf.sugar = "181";
  d.meds.Tac = "3mg BD";
  const t = buildTable(["2026-01-10", "2026-01-11"], { "2026-01-10": d }, { day1: "2026-01-01" });
  const row = (label) => t.find((r) => r[0] === label);
  assert.deepEqual(t[0], ["Date", "10/01/2026", "11/01/2026"]);
  assert.deepEqual(row("Day"), ["Day", "10", "11"]);
  assert.deepEqual(row("BP Before BF").slice(1), ["130/80", ""]);
  assert.deepEqual(row("BP After BF").slice(1), ["140/100", ""]);
  assert.deepEqual(row("BP Before Lunch").slice(1), ["124/80", ""]);
  assert.deepEqual(row("BP Before Dinner").slice(1), ["117/80", ""]);
  assert.equal(row("BP-Highest")[1], "140/100");
  assert.equal(row("BP-Lowest")[1], "117/80");
  assert.equal(row("Fasting BS")[1], "181");
  assert.equal(row("Tac")[1], "3mg BD");
  assert.equal(t.length, ROWS.length + 1);
});
