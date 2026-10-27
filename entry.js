// Lamppost 43378-2110031-00, Unter den Linden, Berlin — one real street lamp with a modelled switch.
//
// REAL:   the asset. Berlin's public street-lighting register (GDI Berlin, WFS "beleuchtung") says this mast
//         exists, is a "Lichtmast mit Auslegerleuchte", is "In Betrieb", and stands at 52.51767572, 13.39770114,
//         with its arm at 174.09 deg. The register does not say whether the lamp is lit right now.
// LIVE:   Open-Meteo's current and hourly modelled irradiance and cloud cover at that exact point. It is a
//         forecast/reanalysis model, not a sensor on this mast — the panel says so.
// TWIN:   a photocell switch model: on below 40 W/m2 global horizontal irradiance, off above 60 (hysteresis).
//         The clear-sky curve is Haurwitz (1945); cloud attenuation is Kasten–Czeplak (1980) or a local
//         coefficient fitted on the previous 36 h and scored on the last 12 daylight hours, whichever wins.
//         The claim is the switch time, and its uncertainty comes from the measured holdout error divided by
//         the irradiance slope at the crossing.
//
// No network except the two URLs in app.json; no storage; no eval. Everything is ctx.

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
export const LAT = 52.51767572, LON = 13.39770114;
export const THRESH_ON = 40, THRESH_OFF = 60;      // W/m2, model assumption
const MAST_M = 8.0;                          // model assumption: the register has no height

const REG_URL = "https://gdi.berlin.de/services/wfs/beleuchtung?service=WFS&version=2.0.0&request=GetFeature&typeNames=beleuchtung:beleuchtung&featureID=beleuchtung.153492&outputFormat=application/json";
const WX_URL = "https://api.open-meteo.com/v1/forecast?latitude=52.51767572&longitude=13.39770114&current=is_day,shortwave_radiation,cloud_cover,temperature_2m,weather_code&hourly=shortwave_radiation,cloud_cover,temperature_2m,precipitation,weather_code&past_days=2&forecast_days=2&timezone=UTC";

// The register row this twin was built from, used when the WFS is unreachable. It is a fact, not a live state.
const ASSET0 = {
  id: 153492, leuchtstelle: "43378-2110031-00", kurznummer: 31, betriebsart: "Strom", status: "In Betrieb",
  bezirk: "Mitte (REG A)", ortsteil: "Mitte", strasse: "Unter den Linden", rotation: 174.09,
  leuchtentyp: "Lichtmast mit Auslegerleuchte", symbolnr: 1005,
  lat: LAT, lon: LON,
};

const C = {
  sky: "#070b12", asphalt: "#15191f", stone: "#3b4047", kerb: "#5b626b", line: "#c9c2ad",
  mast: "#2f3a34", collar: "#4c554e", metal: "#6d756f", headOff: "#666c66", headOn: "#ffd27a",
  bulbOff: "#2a2d30", bulbOn: "#ffe6a0", poolOff: "#24211b", poolMidOff: "#2a251c", poolInOff: "#312a1f",
  poolOn: "#6b4d18", poolMidOn: "#a06f1e", poolInOn: "#d99b2e",
  trunk: "#4a3a2a", leaf: "#2f5b3f", leaf2: "#386b49", bench: "#4b3b2b",
  chart: "#20242a", barDay: "#f2c76b", barDusk: "#9a8f7a", barNight: "#3d6bff",
  onMark: "#ffcf6b", offMark: "#7fd6ff", nowMark: "#ffffff",
};

// ---------------------------------------------------------------- pure model (exported for the test)

export function mod(v, m) { return ((v % m) + m) % m; }
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// NOAA solar position. Returns elevation and azimuth in degrees; azimuth is from north, clockwise.
export function solarPosition(lat, lon, ms) {
  const days = ms / 86400000 + 2440587.5;
  const T = (days - 2451545.0) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Cc = Math.sin(M * D2R) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * D2R) * 0.000289;
  const trueLong = L0 + Cc;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const obliq0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliq = obliq0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(obliq * D2R) * Math.sin(lambda * D2R)) / D2R;
  const y = Math.tan(obliq * D2R / 2) ** 2;
  const eqTime = 4 * (y * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(M * D2R)
    + 4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R)
    - 0.5 * y * y * Math.sin(4 * L0 * D2R) - 1.25 * e * e * Math.sin(2 * M * D2R)) / D2R;
  const d = new Date(ms);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  const trueSolarTime = mod(utcMin + eqTime + 4 * lon, 1440);
  const hourAngle = trueSolarTime / 4 - 180;
  const cz = Math.sin(lat * D2R) * Math.sin(decl * D2R) + Math.cos(lat * D2R) * Math.cos(decl * D2R) * Math.cos(hourAngle * D2R);
  const zenith = Math.acos(clamp(cz, -1, 1)) / D2R;
  const elevation = 90 - zenith;
  const az = mod(Math.atan2(Math.sin(hourAngle * D2R), Math.cos(hourAngle * D2R) * Math.sin(lat * D2R) - Math.tan(decl * D2R) * Math.cos(lat * D2R)) / D2R + 180, 360);
  return { elevation, azimuth: az, decl, eqTime, zenith, cosZ: cz };
}

// Haurwitz clear-sky global horizontal irradiance, W/m2.
export function clearSky(lat, lon, ms) {
  const cz = solarPosition(lat, lon, ms).cosZ;
  if (cz <= 0.017) return 0;
  return 1098 * cz * Math.exp(-0.059 / cz);
}

// Kasten–Czeplak cloud attenuation: G = G_clear * (1 - 0.75 * cloud_fraction^3.4).
export function cloudAttenuation(cloudPct) {
  const c = clamp((cloudPct ?? 0) / 100, 0, 1);
  return 1 - 0.75 * c ** 3.4;
}

// hourly: {time:[iso], shortwave_radiation:[], cloud_cover:[]} from Open-Meteo, UTC.
export function hourlyIndex(hourly, ms) {
  const n = hourly?.time?.length || 0;
  if (!n) return null;
  const t0 = Date.parse(hourly.time[0] + "Z");
  const i = Math.floor((ms - t0) / 3600000);
  if (i < 0) return { i: 0, f: 0 };
  if (i >= n - 1) return { i: n - 1, f: 0 };
  return { i, f: (ms - t0 - i * 3600000) / 3600000 };
}

export function cloudAt(hourly, ms) {
  const x = hourlyIndex(hourly, ms);
  if (!x) return 0;
  const a = hourly.cloud_cover?.[x.i] ?? 0, b = hourly.cloud_cover?.[Math.min(x.i + 1, hourly.cloud_cover.length - 1)] ?? a;
  return a + (b - a) * x.f;
}

// Open-Meteo's own shortwave radiation, linearly interpolated. This is the external model the twin
// uses for the headline switch; it is a weather model, not a sensor.
export function externalGhi(hourly, ms) {
  const x = hourlyIndex(hourly, ms);
  if (!x) return 0;
  const r = hourly.shortwave_radiation || [];
  const a = r[x.i] ?? 0, b = r[Math.min(x.i + 1, r.length - 1)] ?? a;
  return Math.max(0, a + (b - a) * x.f);
}

// a model: {kind:"clear"|"cloud"|"persist", a?, ratio?}
export function ghiFor(model, hourly, lat, lon, ms) {
  const clear = clearSky(lat, lon, ms);
  if (clear <= 0) return 0;
  if (!model || model.kind === "clear") return clear;
  if (model.kind === "persist") return clamp(clear * model.ratio, 0, clear);
  const att = model.kind === "kasten" ? 0.75 : model.a;
  return clear * (1 - att * (clamp(cloudAt(hourly, ms) / 100, 0, 1) ** 3.4));
}

// Fit the local cloud coefficient on [now-48h, now-12h], score every candidate on [now-12h, now].
export function fitAndScore(hourly, lat, lon, nowMs) {
  const trainFrom = nowMs - 48 * 3600000, trainTo = nowMs - 12 * 3600000;
  const holdFrom = nowMs - 12 * 3600000, holdTo = nowMs;
  const points = (from, to) => {
    const out = [];
    if (!hourly?.time) return out;
    for (let i = 0; i < hourly.time.length; i++) {
      const t = Date.parse(hourly.time[i] + "Z");
      if (t < from || t >= to) continue;
      const clear = clearSky(lat, lon, t);
      if (clear < 20) continue;                       // daylight only; night is 0/0 and says nothing
      const obs = hourly.shortwave_radiation?.[i];
      if (!Number.isFinite(obs)) continue;
      out.push({ t, clear, obs, cloud: clamp(hourly.cloud_cover?.[i] ?? 0, 0, 100) });
    }
    return out;
  };
  const train = points(trainFrom, trainTo);
  const hold = points(holdFrom, holdTo);

  let a = 0.75, ratio = 0.75;
  if (train.length >= 4) {
    let num = 0, den = 0;
    for (const p of train) {
      const x = p.clear * (p.cloud / 100) ** 3.4;
      num += (p.clear - p.obs) * x;
      den += x * x;
    }
    if (den > 1e-6) a = clamp(num / den, 0, 0.95);
    const last = train[train.length - 1];
    if (last.clear > 20) ratio = clamp(last.obs / last.clear, 0, 1.15);
  }

  const models = [
    { id: "fit", label: "local cloud fit", kind: "cloud", a },
    { id: "kasten", label: "Kasten–Czeplak", kind: "kasten" },
    { id: "clear", label: "clear-sky", kind: "clear" },
    { id: "persist", label: "persistence", kind: "persist", ratio },
  ];
  for (const m of models) {
    let sum = 0, n = 0;
    for (const p of hold) { sum += Math.abs(ghiFor(m, hourly, lat, lon, p.t) - p.obs); n++; }
    m.mae = n ? sum / n : null;
    m.n = n;
  }
  const scored = models.filter((m) => m.mae != null).sort((x, y) => x.mae - y.mae);
  let chosen = scored[0] || models[1];
  // if the cloud model does not beat clear sky by a clear margin, say so and use clear sky
  const clear = models.find((m) => m.id === "clear");
  if (chosen.mae != null && clear.mae != null && chosen.id !== "clear" && chosen.mae > clear.mae - 1.5) {
    chosen = { ...clear, note: "cloud did not earn it" };
  }
  return { train, hold, a, ratio, models, chosen, scored: !!hold.length };
}

// state machine with hysteresis; prev is "on" or "off"
export function nextState(g, prev) {
  if (prev === "on") return g > THRESH_OFF ? "off" : "on";
  return g < THRESH_ON ? "on" : "off";
}

// Scan a window at `stepMs`, refine each change to the threshold, return {transitions, stateAtEnd}.
export function scanStates(ghi, t0, t1, stepMs, prev) {
  const transitions = [];
  let state = prev, t = t0;
  while (t < t1) {
    const tNext = Math.min(t + stepMs, t1);
    const g = ghi(tNext);
    const s = nextState(g, state);
    if (s !== state) {
      const threshold = state === "on" ? THRESH_OFF : THRESH_ON;
      let lo = t, hi = tNext;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        const onSide = state === "on" ? ghi(mid) > threshold : ghi(mid) < threshold;
        if (onSide) lo = mid; else hi = mid;
      }
      const at = (lo + hi) / 2;
      transitions.push({ t: at, from: state, to: s, threshold });
      state = s;
    }
    t = tNext;
  }
  return { transitions, state };
}

export function crossingMinutes(t, ghi, mae) {
  const dt = 10 * 60000;
  const slope = Math.abs(ghi(t + dt) - ghi(t - dt)) / (2 * dt / 60000);   // W/m2 per minute
  const err = mae == null ? 15 : mae / Math.max(slope, 0.02) + 5;
  return Math.round(clamp(err, 4, 120));
}

// Berlin local time helpers (the browser's Intl has the tz database; no offset table to rot).
export function berlinParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute };
}
export function berlinOffsetMin(ms) {
  const p = berlinParts(ms);
  const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  return Math.round((asUTC - Math.floor(ms / 60000) * 60000) / 60000);
}
export function berlinDayStart(ms) {
  const p = berlinParts(ms);
  let t = Date.UTC(p.y, p.m - 1, p.d, 0, 0);
  // two passes settle the CET/CEST change
  for (let k = 0; k < 2; k++) t = Date.UTC(p.y, p.m - 1, p.d, 0, 0) - berlinOffsetMin(t) * 60000;
  return t;
}
export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
}
export function fmtWhen(ms, now) {
  const day = (x) => new Date(x).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
  const d = day(ms), today = day(now), tomorrow = day(now + 86400000);
  return d === today ? fmtTime(ms) : d === tomorrow ? "tomorrow " + fmtTime(ms) : d.slice(5) + " " + fmtTime(ms);
}

// ---------------------------------------------------------------- the app

export async function start(ctx) {
  const f = await ctx.local(LAT, LON);
  ctx.base("density", false); ctx.base("twins", false); ctx.base("lanes", false); ctx.base("links", false);

  const S = {
    asset: { ...ASSET0 }, wx: null, fit: null, model: null, forceClear: false,
    state: "off", transitions: [], nowG: 0, lastChange: null, nextOn: null, nextOff: null,
    burn: 0, mae: null, loaded: Date.now(), error: null, regLive: true, chart: [], bars: [], markers: [], lamp: null,
  };

  const local = (size, at, color, opts = {}) => ctx.box({ frame: f, size, at, color, emissive: opts.emissive || "#000000", heading: opts.heading || 0 });
  // static geometry needs no handle; a rejected box must not become an unhandled rejection
  const place = (...a) => { local(...a).catch(() => {}); };

  // ---- the street: a promenade, a kerb, a carriageway, lindens. The lamp is on the promenade edge.
  place([52, 0.10, 34], [0, -0.10, 0], C.asphalt);
  place([52, 0.18, 13], [0, 0, -6.4], C.stone);              // promenade north of the kerb
  place([52, 0.22, 0.42], [0, 0, 0.22], C.kerb);              // kerb
  place([52, 0.02, 15], [0, 0.02, 8.2], C.asphalt);           // carriageway south
  for (let x = -22; x <= 22; x += 4.5) local([2.2, 0.015, 0.12], [x, 0.04, 9.5], C.line);

  // lindens on the promenade
  for (const [x, z] of [[-18, -7.6], [-10, -8.2], [10, -7.9], [18, -7.4]]) {
    place([0.42, 3.6, 0.42], [x, 0.1, z], C.trunk);
    place([3.6, 1.5, 3.4], [x, 3.6, z], C.leaf);
    place([2.8, 1.3, 2.8], [x, 4.7, z], C.leaf2);
    place([1.7, 1.1, 1.7], [x, 5.8, z], C.leaf);
  }
  // two benches, turned to face the road
  for (const x of [7.5, 11.5]) {
    place([2.2, 0.10, 0.55], [x, 0.55, -3.2], C.bench);
    place([2.2, 0.55, 0.10], [x, 0.9, -3.45], C.bench);
    for (const dx of [-0.85, 0.85]) local([0.10, 0.55, 0.10], [x + dx, 0.1, -3.2], C.metal);
  }
  // bollards along the kerb, leaving the lamp clear
  for (const x of [-9, -6, -3, 3, 6, 9]) {
    place([0.16, 0.95, 0.16], [x, 0.1, -0.1], C.metal);
    place([0.19, 0.05, 0.19], [x, 1.05, -0.1], C.collar);
  }

  // ---- the lamp: plinth, mast, collar, arm turned to the register's 174.09 deg, luminaire, photocell
  const armHeading = 180 - (S.asset.rotation ?? 174.09);
  const arm = { x: Math.sin(armHeading * D2R), z: Math.cos(armHeading * D2R) };
  const L = {
    plinth: await local([0.62, 0.34, 0.62], [0, 0.18, 0], C.collar),
    mast: await local([0.19, MAST_M, 0.19], [0, 0.5, 0], C.mast),
    collar: await local([0.27, 0.22, 0.27], [0, MAST_M - 0.35, 0], C.collar),
    arm: await local([0.13, 0.13, 1.55], [arm.x * 0.78, MAST_M - 0.05, arm.z * 0.78], C.mast, { heading: armHeading }),
    head: await local([0.72, 0.17, 0.34], [arm.x * 1.56, MAST_M - 0.18, arm.z * 1.56], C.headOff, { heading: armHeading }),
    bulb: await local([0.46, 0.06, 0.22], [arm.x * 1.56, MAST_M - 0.24, arm.z * 1.56], C.bulbOff, { heading: armHeading }),
    cell: await local([0.18, 0.08, 0.18], [arm.x * 1.56, MAST_M - 0.01, arm.z * 1.56], "#20242a", { heading: armHeading }),
    poolOut: await local([6.6, 0.02, 5.6], [arm.x * 1.56, 0.19, arm.z * 1.56], C.poolOff),
    poolMid: await local([3.5, 0.03, 3.0], [arm.x * 1.56, 0.20, arm.z * 1.56], C.poolMidOff),
    poolIn: await local([1.6, 0.04, 1.4], [arm.x * 1.56, 0.21, arm.z * 1.56], C.poolInOff),
  };
  place([0.31, 0.08, 0.31], [0, MAST_M + 0.42, 0], C.collar);
  S.lamp = L;

  // ---- the next-24 h irradiance chart, built from boxes: one bar per hour, a threshold line, two markers.
  const CHART_Z = -11.4, CHART_BASE = 0.34, BAR_W = 0.42, BAR_GAP = 0.56, MAX_W = 700;
  place([14.6, 0.14, 1.5], [0, 0.2, CHART_Z], C.chart);
  place([14.2, 0.02, 0.03], [0, 0.28, CHART_Z], C.line);
  S.chart = { z: CHART_Z, base: CHART_BASE, barW: BAR_W, gap: BAR_GAP, maxW: MAX_W, n: 24 };
  S.bars = new Array(24).fill(null);
  // thresholds at 40 and 60 W/m2, on the same scale as the bars
  const hScale = 5.6 / MAX_W;   // metres per W/m2
  place([14.0, 0.035, 0.06], [0, CHART_BASE + THRESH_ON * hScale, CHART_Z], C.barNight, { emissive: "#10205a" });
  place([14.0, 0.025, 0.06], [0, CHART_BASE + THRESH_OFF * hScale, CHART_Z - 0.18], C.barDay, { emissive: "#3a2a08" });

  async function rebuildChart() {
    for (const b of S.bars) if (b) { try { ctx.remove(b); } catch (e) {} }
    for (const m of S.markers) if (m) { try { ctx.remove(m); } catch (e) {} }
    S.bars = new Array(24).fill(null); S.markers = [];
    if (!S.wx) return;
    const now = Date.now(), start = Math.floor(now / 3600000) * 3600000;
    for (let i = 0; i < 24; i++) {
      const t = start + i * 3600000;
      const g = ghiAt(t);
      const h = Math.max(0.04, Math.min(5.6, g * hScale));
      const x = (i - 11.5) * BAR_GAP;
      const color = g >= THRESH_OFF ? C.barDay : g < THRESH_ON ? C.barNight : C.barDusk;
      const show = await local([BAR_W, h, 0.5], [x, CHART_BASE, CHART_Z], color, { emissive: g < THRESH_ON ? "#0a1430" : "#1a1406" });
      S.bars[i] = show;
    }
    // marker on the first upcoming on/off transition inside the next 24 h: headline (bright) and twin (violet)
    for (const [tr, color, w, dz] of [[S.nextOn, C.onMark, 0.08, 0.32], [S.nextOff, C.offMark, 0.08, 0.32], [S.twinNextOn, "#c69bff", 0.045, 0.52], [S.twinNextOff, "#7c9cff", 0.045, 0.52]]) {
      if (!tr || tr < now || tr > now + 24 * 3600000) continue;
      const i = (tr - start) / 3600000;
      const x = (i - 11.5) * BAR_GAP;
      S.markers.push(await local([w, 6.1, w], [x, CHART_BASE, CHART_Z + dz], color, { emissive: color }));
    }
  }

  function ghiAt(ms) {
    if (!S.wx) return 0;
    return externalGhi(S.wx.hourly, ms);
  }
  function twinGhiAt(ms) {
    if (!S.wx) return 0;
    return ghiFor(activeModel(), S.wx.hourly, LAT, LON, ms);
  }
  function activeModel() {
    if (S.forceClear) return { kind: "clear", id: "clear", label: "clear-sky" };
    return S.fit?.chosen || { kind: "clear", id: "clear", label: "clear-sky" };
  }

  function recompute(now = Date.now()) {
    if (!S.wx) return;
    const start = now - 36 * 3600000, end = now + 36 * 3600000;
    const g = (ms) => ghiAt(ms);
    const init = g(start) < THRESH_ON ? "on" : "off";
    const past = scanStates(g, start, now, 5 * 60000, init);
    S.transitions = past.transitions;
    S.state = past.state;
    S.lastChange = past.transitions.length ? past.transitions[past.transitions.length - 1] : null;
    const future = scanStates(g, now, end, 5 * 60000, S.state);
    S.nextOn = future.transitions.find((x) => x.to === "on") || null;
    S.nextOff = future.transitions.find((x) => x.to === "off") || null;
    S.nowG = g(now);
    S.nowTwin = twinGhiAt(now);
    S.mae = activeModel()?.mae ?? null;
    // the twin model's own switch, for the cross-check. Its spread against the headline is the useful number.
    const tstart = now - 36 * 3600000;
    const twinPast = scanStates((x) => twinGhiAt(x), tstart, now, 5 * 60000, twinGhiAt(tstart) < THRESH_ON ? "on" : "off");
    const twinFuture = scanStates((x) => twinGhiAt(x), now, end, 5 * 60000, twinPast.state);
    S.twinState = twinPast.state;
    S.twinLastOn = [...twinPast.transitions].reverse().find((x) => x.to === "on") || null;
    S.twinNextOn = twinFuture.transitions.find((x) => x.to === "on") || null;
    S.twinNextOff = twinFuture.transitions.find((x) => x.to === "off") || null;
    const headlineOn = S.state === "on" && S.lastChange ? S.lastChange : S.nextOn;
    const twinOn = S.twinState === "on" && S.twinLastOn ? S.twinLastOn : S.twinNextOn;
    S.spread = headlineOn && twinOn ? (headlineOn.t - twinOn.t) / 60000 : null;
    S.uncOn = 10; S.uncOff = 10; S.uncLast = 10;   // hourly linear interpolation, not a model-error claim
    // modelled burn from Berlin midnight to Berlin midnight
    const d0 = berlinDayStart(now);
    let on = 0, total = 0;
    for (let t = d0; t < d0 + 24 * 3600000; t += 5 * 60000) { total++; if (g(t) < THRESH_ON) on++; }
    S.burn = (on / total) * 24;
    // the sunset nearest the most recent or next on-transition
    const anchor = S.state === "on" && S.lastChange ? S.lastChange.t : (S.nextOn?.t ?? now);
    S.sunset = sunEvent(anchor, -0.833, "down");
    S.sunrise = sunEvent(anchor, -0.833, "up");
    S.vsSunset = S.sunset ? (anchor - S.sunset) / 60000 : null;
  }

  function sunEvent(around, target, dir) {
    const min = 60000;
    let prev = solarPosition(LAT, LON, around - 6 * 3600000).elevation - target;
    for (let t = around - 6 * 3600000 + min; t <= around + 6 * 3600000; t += min) {
      const v = solarPosition(LAT, LON, t).elevation - target;
      if ((dir === "up" && prev < 0 && v >= 0) || (dir === "down" && prev > 0 && v <= 0)) {
        let lo = t - min, hi = t;
        for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; const s = solarPosition(LAT, LON, mid).elevation - target; if ((dir === "up") === (s < 0)) lo = mid; else hi = mid; }
        return (lo + hi) / 2;
      }
      prev = v;
    }
    return null;
  }

  function setLamp(on) {
    const L = S.lamp;
    ctx.set(L.head, { color: on ? C.headOn : C.headOff });
    ctx.set(L.bulb, { color: on ? C.bulbOn : C.bulbOff });
    ctx.set(L.poolOut, { color: on ? C.poolOn : C.poolOff });
    ctx.set(L.poolMid, { color: on ? C.poolMidOn : C.poolMidOff });
    ctx.set(L.poolIn, { color: on ? C.poolInOn : C.poolInOff });
  }

  function panel() {
    const a = S.asset, st = S.state, on = st === "on";
    const model = activeModel();
    const mae = model?.mae;
    const rows = [
      ["state", on ? "ON · modelled" : "OFF · modelled"],
      ["irradiance", S.wx ? `${S.nowG.toFixed(0)} ext · ${S.nowTwin.toFixed(0)} twin W/m²` : "no data"],
      ["switch", `${THRESH_ON} on / ${THRESH_OFF} off W/m²`],
      [on ? "on since" : "next on", lastOrNext(on ? S.lastChange : S.nextOn, S.uncLast ?? S.uncOn)],
      [on ? "next off" : "off since", lastOrNext(on ? S.nextOff : S.lastChange, S.uncOff ?? S.uncLast)],
      ["vs sunset", S.vsSunset == null ? "—" : `${S.vsSunset >= 0 ? "+" : "−"}${Math.abs(Math.round(S.vsSunset))} min`],
      ["twin says", twinLine()],
      ["burn today", `${S.burn.toFixed(1)} h · modelled`],
      ["model", modelLine()],
      ["register", `${a.status} · ${shortType(a.leuchtentyp)}${S.regLive ? "" : " · last known"}`],
      ["checked", S.error ? `last refresh failed: ${S.error}` : !S.wx ? "loading the two sources…" : `${fmtTime(S.loaded)} · Open-Meteo`],
    ];
    ctx.panel({
      title: "Lamppost 31, Unter den Linden",
      sub: `${a.leuchtstelle} · ${a.strasse}, ${a.bezirk}`,
      rows,
      actions: [
        { label: "Recentre", onClick: () => ctx.orbit(LAT, LON, 30, { heading: 128, tilt: 17, min: 6 }) },
        { label: S.forceClear ? "Twin: use cloud fit" : "Twin: force clear-sky", onClick: async () => { S.forceClear = !S.forceClear; recompute(); setLamp(S.state === "on"); await rebuildChart(); panel(); } },
      ],
      source: "Asset: Berlin GDI Straßenbeleuchtung, WFS beleuchtung, feature 153492 (dl-de/by-2-0). Irradiance and cloud: Open-Meteo (CC BY 4.0). Sun position: NOAA. The 40/60 W/m² thresholds and the 8.0 m mast are model assumptions, not Berlin's published settings. Irradiance is a model, not a sensor on this mast.",
    });
  }

  function lastOrNext(tr, unc) {
    if (!tr) return "—";
    const now = Date.now(), mins = (tr.t - now) / 60000;
    const label = tr.t > now && mins < 60 ? `in ${Math.round(mins)} min` : fmtWhen(tr.t, now);
    return `${label}${unc ? ` ± ${unc} min` : ""}`;
  }
  function twinLine() {
    if (!S.fit) return "—";
    const tr = S.twinState === "on" ? S.twinLastOn : S.twinNextOn;
    const label = tr ? (tr.t > Date.now() ? "in " + Math.round((tr.t - Date.now()) / 60000) + " min" : fmtWhen(tr.t, Date.now())) : "—";
    const spread = S.spread == null ? "" : ` · ${Math.abs(Math.round(S.spread))} min ${S.spread >= 0 ? "earlier" : "later"} than headline`;
    return `${S.forceClear ? "clear-sky" : S.fit.chosen.label} ${label}${spread}`;
  }
  function modelLine() {
    if (!S.fit?.models) return "—";
    const parts = S.fit.models.map((m) => `${m.label.split(" ")[0]} ${m.mae == null ? "—" : m.mae.toFixed(0)}`).join(" · ");
    return `${parts} W/m² MAE · last 12 daylight h`;
  }
  function shortType(t) {
    if (!t) return "—";
    return t.replace("Lichtmast mit Auslegerleuchte", "mast + arm").replace("Oberirdischer Schaltkasten", "switch box");
  }

  async function load() {
    const [reg, wx] = await Promise.allSettled([ctx.data(REG_URL), ctx.data(WX_URL)]);
    if (reg.status === "fulfilled") {
      const p = reg.value?.features?.[0]?.properties;
      if (p) { S.asset = { ...S.asset, ...p, lat: LAT, lon: LON }; S.regLive = true; }
    } else S.regLive = false;
    if (wx.status === "fulfilled" && wx.value?.hourly?.time?.length) {
      S.wx = wx.value;
      S.fit = fitAndScore(S.wx.hourly, LAT, LON, Date.now());
      S.error = null;
    } else {
      S.error = String(wx.reason?.message || "Open-Meteo unreachable").slice(0, 80);
    }
    S.loaded = Date.now();
    if (S.wx) recompute();
    setLamp(S.state === "on");
    await rebuildChart();
    panel();
  }

  // first paint: the place, a low 3/4 view, then the panel fills in when the sources answer
  ctx.orbit(LAT, LON, 34, { heading: 128, tilt: 18, min: 6 });
  panel();
  await load();

  let last = Date.now(), lastChart = 0;
  ctx.every((dt, nowMs) => {
    const t = Date.now();
    if (t - last < 900) return;
    last = t;
    if (S.wx) {
      const g = ghiAt(t);
      const s = nextState(g, S.state);
      S.nowG = g;
      if (s !== S.state) {
        S.state = s;
        recompute();
        setLamp(S.state === "on");
        rebuildChart().catch(() => {});
        panel();
      }
    }
    if (t - S.loaded > 10 * 60000) load();
  });

  ctx.steps([
    { title: "One real lamp", text: `This is asset ${ASSET0.leuchtstelle}: a ${ASSET0.leuchtentyp} on ${ASSET0.strasse}, ${ASSET0.bezirk}, at 52.51767572 N, 13.39770114 E. Berlin's street-lighting register says it is ${ASSET0.status.toLowerCase()}. The register records the asset; it does not record whether the lamp is lit.`, at: [LAT, LON, 20], view: { heading: 122, tilt: 12, min: 5 } },
    { title: "The switch is the twin", text: `The twin models the photocell: on below ${THRESH_ON} W/m² of global horizontal irradiance, off above ${THRESH_OFF} (hysteresis). The headline uses Open-Meteo's irradiance for this exact point; the violet markers are the simpler cloud model's switch, shown so you can see the disagreement. The bars are the next 24 hours.`, at: [LAT, LON, 36], view: { heading: 140, tilt: 22, min: 6 } },
    { title: "A model you can disagree with", text: `Clear sky is Haurwitz; cloud attenuation is Kasten–Czeplak or a local coefficient fitted on the previous 36 hours. All four candidates are scored on the last 12 daylight hours against Open-Meteo. The headline uses Open-Meteo; the winning simple model is the cross-check, and if it does not beat clear sky the panel says so.`, at: [LAT, LON, 52], view: { heading: 168, tilt: 30, min: 8 } },
    { title: "What is not claimed", text: `Open-Meteo is a model, not a sensor on this mast. The 40/60 W/m² thresholds and the 8.0 m mast are assumptions. "In Betrieb" means not reported broken, not lit. The headline time carries ±10 min from hourly interpolation; the simple model's spread is shown separately. The falsifiable claim is the switch time: stand at the kerb and watch.`, at: [LAT, LON, 26], view: { heading: 118, tilt: 15, min: 5 } },
  ]);
}
