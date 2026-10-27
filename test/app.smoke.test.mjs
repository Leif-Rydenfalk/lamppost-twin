// A host-shaped smoke test: run start(ctx) with the sandbox's async ctx, no Three.js, no network.
// It proves the app calls only declared ops, builds the chart, fills the panel and sets a tour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { start } from "../entry.js";

const WX = JSON.parse(readFileSync(new URL("./berlin-open-meteo.json", import.meta.url), "utf8"));
const REG = JSON.parse(readFileSync(new URL("./berlin-wfs.json", import.meta.url), "utf8"));

function mock() {
  let id = 0;
  const calls = [], boxes = [], sets = [], panels = [], stepCalls = [], removed = [];
  const ctx = {
    calls, boxes, sets, panels, stepCalls, removed,
    local: async () => ++id,
    box: async (o) => { if (!Number.isFinite(o.frame)) throw new Error("box without frame"); boxes.push(o); return ++id; },
    set: async (h, o) => { if (!Number.isFinite(h)) throw new Error("set without handle"); sets.push([h, o]); },
    remove: async (h) => { removed.push(h); },
    orbit: async (...a) => { calls.push(["orbit", ...a]); },
    panel: async (p) => { panels.push(p); },
    steps: async (s) => { stepCalls.push(s); },
    base: async (...a) => { calls.push(["base", ...a]); },
    data: async (u) => {
      if (u.includes("gdi.berlin.de")) return REG;
      if (u.includes("open-meteo.com")) return WX;
      throw new Error("url not allowed " + u);
    },
    every: (f) => { ctx.tick = f; },
    log: () => {},
  };
  return ctx;
}

test("start() builds a chart, a panel and a tour with the declared ops only", async () => {
  const ctx = mock();
  await start(ctx);
  assert.ok(ctx.boxes.length > 40, `boxes ${ctx.boxes.length}`);
  assert.ok(ctx.boxes.length < 5000, "object cap");
  assert.ok(ctx.panels.length >= 1, "no panel");
  assert.equal(ctx.stepCalls.length, 1);
  assert.equal(ctx.stepCalls[0].length, 4);
  assert.ok(ctx.sets.length >= 5, "lamp state was never set");
  const p = ctx.panels.at(-1);
  assert.ok(p.title.includes("Lamppost"));
  assert.equal(p.rows.length, 4, `rows ${p.rows.length}`);
  assert.ok(p.rows.some(([k]) => k === "state"));
  assert.ok(p.rows.some(([k]) => k === "switch"));
  assert.ok(p.rows.some(([k]) => k === "model"));
  const state = p.rows.find(([k]) => k === "state")[1];
  assert.match(state, /ON|OFF/);
  // the chart bars are boxes at the chart's z, 24 of them
  const bars = ctx.boxes.filter((b) => b.at[2] === -9.8 && b.size[0] === 0.42);
  assert.equal(bars.length, 24, `bars ${bars.length}`);
  // a tick must not throw
  ctx.tick(1, Date.now());
});

test("a failing weather source still leaves a panel and a scene", async () => {
  const ctx = mock();
  ctx.data = async (u) => {
    if (u.includes("gdi.berlin.de")) return REG;
    throw new Error("offline");
  };
  await start(ctx);
  const p = ctx.panels.at(-1);
  assert.ok(String(p.sub).includes("offline"), `sub ${p.sub}`);
  assert.ok(ctx.boxes.length > 40);
});
