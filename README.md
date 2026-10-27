# Lamppost 31, Unter den Linden — a one-lamp digital twin

**Live on the globe:** <https://maps.ce-net.com/?app=https%3A%2F%2Fleif-rydenfalk.github.io%2Flamppost-twin%2Fapp.json>

One real street lamp, one live model, one falsifiable claim: **when does this lamp switch on and off?**

## The real asset

| | |
|---|---|
| Asset | `43378-2110031-00` (WFS feature `beleuchtung.153492`) |
| Type | `Lichtmast mit Auslegerleuchte` — mast with a bracket luminaire |
| Street | Unter den Linden, Mitte, Berlin |
| Position | 52.51767572 N, 13.39770114 E |
| Arm | 174.09° (south, over the carriageway) |
| Register status | `In Betrieb` |

Source: Berlin's public street-lighting register, GDI Berlin WFS `beleuchtung`
(<https://gdi.berlin.de/services/wfs/beleuchtung>), data licence dl-de/by-2-0. The register is fetched live
by the app (CORS is open); if it is unreachable the last known row is shown and marked `last known`.

**The register records the asset. It does not record whether the lamp is lit.** That is the twin's job.

## The twin

A photocell controller model:

- **on** when global horizontal irradiance falls below **40 W/m²**
- **off** when it rises above **60 W/m²** (hysteresis, so dusk does not chatter)
- the thresholds are a model assumption, not a published Berlin setting

Two irradiance estimates are shown:

1. **Headline — Open-Meteo** (`shortwave_radiation` for this exact point, interpolated from the hourly
   forecast). It is the best available evidence, but it is a weather model, not a sensor on the mast.
2. **Cross-check — the twin's simple model**: Haurwitz clear-sky × Kasten–Czeplak cloud attenuation, or a
   local cloud coefficient fitted on the previous 36 h. All four candidates (local fit, Kasten–Czeplak,
   clear-sky, persistence) are scored on the **last 12 daylight hours** against Open-Meteo. The winner is
   used, and its switch time is shown next to the headline. If the cloud model does not beat clear sky, the
   panel says so.

The 24 bars are 12 hours either side of now; the bright markers are the headline switch-on/off, the
violet markers are the simple model's. The light pool and the luminaire follow the inferred state.

**Uncertainty:** the headline time carries ±10 min from hourly linear interpolation. The simple model's
spread against the headline is shown separately. There is no claim of a measured error for Open-Meteo's own
irradiance — it does not publish one here.

## What is not claimed

- Open-Meteo is a model, not an observation at this mast.
- 40/60 W/m² and the 8.0 m mast height are assumptions; the register has no height.
- `In Betrieb` means "not reported broken", not "lit".
- The scene is a schematic of the promenade, kerb, carriageway and lindens, not a survey.

## The cell

The view is `globe.lamppost@1` (declared in `app.json` as `cell`, and in `meta.cells`). It is a view cell,
not a Rust process: it speaks the Twinton app contract (`start(ctx)`, declared `needs`, only the two data URLs
in the manifest). If it is promoted to a first-class view on maps.ce-net.com, it becomes
`site/apps/lamppost.js` with `cells: ["globe.lamppost@1"]` and the same model.

## Files

| file | what |
|---|---|
| `app.json` | manifest: id, title, what, needs, the two data URLs, entry |
| `entry.js` | the app: scene, solar model, cloud candidates, panel, 4-step tour |
| `index.html` | the standalone page with the live link and sources |
| `test/model.test.mjs` | recorded-answer tests: sun, sunset, fit, state, hysteresis, Berlin midnight |
| `test/app.smoke.mjs` | host-shaped smoke test: only declared ops, 24 bars, panel, tour, offline path |
| `test/berlin-open-meteo.json` | recorded Open-Meteo answer (2026-10-27) |
| `test/berlin-wfs.json` | recorded register answer (feature 153492) |

```bash
node --test test/
```

## Data and licences

- Berlin GDI, WFS `beleuchtung`: dl-de/by-2-0.
- Open-Meteo: CC BY 4.0 (<https://open-meteo.com>).
- Sun position: NOAA solar-position equations; clear-sky: Haurwitz (1945); cloud attenuation:
  Kasten & Czeplak (1980).
- Scene: schematic, no imagery.
