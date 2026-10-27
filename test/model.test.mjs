// Behaviour test for the lamppost twin's model, against a recorded Open-Meteo answer.
// Run: node --test test/model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAT, LON, THRESH_ON, THRESH_OFF, solarPosition, clearSky, fitAndScore, ghiFor, externalGhi,
  scanStates, nextState, berlinDayStart, fmtTime,
} from "../entry.js";

const WX = JSON.parse(readFileSync(new URL("./berlin-open-meteo.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-27T16:05:00Z");

test("the sun is where NOAA says at Berlin noon", () => {
  const s = solarPosition(LAT, LON, Date.parse("2026-10-27T12:00:00Z"));
  assert.ok(s.elevation > 20 && s.elevation < 26, `elevation ${s.elevation}`);
  assert.ok(s.azimuth > 185 && s.azimuth < 210, `azimuth ${s.azimuth}`);
});

test("clear-sky noon is a plausible October value, and zero at night", () => {
  const noon = clearSky(LAT, LON, Date.parse("2026-10-27T12:00:00Z"));
  assert.ok(noon > 150 && noon < 400, `clear noon ${noon}`);
  assert.equal(clearSky(LAT, LON, Date.parse("2026-10-27T22:00:00Z")), 0);
});

test("sunset computed from the solar curve matches Open-Meteo's 15:46 UTC", () => {
  // find the -0.833 deg crossing on 2026-10-27 by one-minute scan
  let prev = solarPosition(LAT, LON, Date.parse("2026-10-27T15:00:00Z")).elevation + 0.833;
  let hit = null;
  for (let t = Date.parse("2026-10-27T15:00:00Z"); t < Date.parse("2026-10-27T17:00:00Z"); t += 60000) {
    const v = solarPosition(LAT, LON, t).elevation + 0.833;
    if (prev > 0 && v <= 0) { hit = t; break; }
    prev = v;
  }
  const mins = Math.abs((hit - Date.parse("2026-10-27T15:46:00Z")) / 60000);
  assert.ok(mins <= 3, `sunset ${fmtTime(hit)} vs 15:46 UTC (${mins} min)`);
});

test("the fit and the holdout are real, and the winner is a finite model", () => {
  const fit = fitAndScore(WX.hourly, LAT, LON, NOW);
  assert.ok(fit.train.length >= 6, `train ${fit.train.length}`);
  assert.ok(fit.hold.length >= 3, `hold ${fit.hold.length}`);
  assert.ok(fit.chosen && fit.chosen.mae != null, "no chosen model");
  assert.ok(fit.chosen.mae < 120, `MAE ${fit.chosen.mae}`);
  for (const m of fit.models) if (m.mae != null) assert.ok(m.mae >= 0);
});

test("the lamp is on at 16:05 UTC from Open-Meteo's irradiance, shortly before sunset", () => {
  const g = (ms) => externalGhi(WX.hourly, ms);
  const start = NOW - 36 * 3600000;
  const past = scanStates(g, start, NOW, 5 * 60000, g(start) < THRESH_ON ? "on" : "off");
  assert.equal(past.state, "on", `state at now: ${past.state}`);
  const last = past.transitions[past.transitions.length - 1];
  assert.ok(last && last.to === "on");
  const minutesBeforeSunset = (Date.parse("2026-10-27T15:46:00Z") - last.t) / 60000;
  assert.ok(minutesBeforeSunset > -30 && minutesBeforeSunset < 60, `on ${minutesBeforeSunset} min before sunset`);
});

test("the simple cloud model is a cross-check, not the headline", () => {
  const fit = fitAndScore(WX.hourly, LAT, LON, NOW);
  const ext = externalGhi(WX.hourly, NOW);
  const twin = ghiFor(fit.chosen, WX.hourly, LAT, LON, NOW);
  assert.ok(Number.isFinite(ext) && Number.isFinite(twin));
  // at 16:05 UTC the sun is down, so both are near zero; the interesting difference is at the crossing
  const crossing = Date.parse("2026-10-27T15:29:00Z");
  const e = externalGhi(WX.hourly, crossing), t = ghiFor(fit.chosen, WX.hourly, LAT, LON, crossing);
  assert.ok(e > 20 && e < 70, `external at crossing ${e}`);
  assert.ok(t >= 0 && t < 200, `twin at crossing ${t}`);
});

test("hysteresis: 50 W/m2 keeps whatever state it had", () => {
  assert.equal(nextState(50, "on"), "on");
  assert.equal(nextState(50, "off"), "off");
  assert.equal(nextState(39, "off"), "on");
  assert.equal(nextState(61, "on"), "off");
});

test("Berlin midnight is a real instant, not UTC midnight", () => {
  const d0 = berlinDayStart(NOW);
  assert.equal(fmtTime(d0), "00:00");
  assert.equal(d0, Date.parse("2026-10-26T23:00:00Z")); // CET, UTC+1
});
