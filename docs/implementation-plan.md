# B21S label printer: implementation plan

Date: October 11, 2026
Spec: `G:/niimbot-investigation-20261011/NIIMBOT-B21S-replacement-plan.md` (requirements, label catalogue, validation findings V1–V10)

## Goal

A small offline web app that designs and prints labels on Matthew's NIIMBOT B21S over USB (Web Serial, COM3) without the vendor helper. It runs no background process when closed.

## Fixed decisions

| Area | Decision | Reason |
|---|---|---|
| Platform | Browser app in Edge/Chrome, installed as an offline PWA | Web Serial is Chromium-only; the PWA needs no running server (V9). |
| Stack | T3 stack via `create-t3-app`: Next.js (App Router), TypeScript (strict), Tailwind CSS. Built with `output: "export"` (static export). | Matthew's standing choice. Static export keeps the "no background process" requirement (V9). |
| T3 parts omitted | tRPC, Prisma/Drizzle, NextAuth | The app has no server, database, or users. Everything runs in the browser and is stored in IndexedDB. Add them only if a server-side need appears. |
| Client-only code | All printer, canvas, and storage code lives in `"use client"` components, loaded with `next/dynamic` `ssr: false` where it touches `navigator.serial`, `window`, or IndexedDB | Static export still pre-renders pages at build time, where browser APIs do not exist. |
| Printer library | `@mmote/niimbluelib` pinned at the tested version (0.47.0 at review), MIT | B21S is mapped to the D110 print task. Import only serial client + protocol (V6). |
| Tests | Vitest for unit tests; library virtual client + B21S 40.28 dump for transport tests (V10) | Hardware-free regression coverage. |
| Storage | IndexedDB (templates, barcode→label map, settings), JSON export/import | Survives restarts; images are too big for localStorage (V8). |
| Dev/install port | Fixed `http://localhost:5179` | Storage is per origin (V8). |
| Transport | USB only | Matthew's answer. No Bluetooth code paths. |
| Licensing | Keep NiimBlueLib notices. Do not copy Thermalith (GPL-3.0) code. | Spec licence finding. |

## Prerequisites (Matthew)

1. Install Node.js LTS (V7). Check with `node --version`.
2. Have the B21S, a USB cable, and one roll of each shape family on hand for Wave 2 and Wave 5.
3. Optional: reinstall Python 3.14 if you want the Forge CLI working again.

## Architecture

```
src/
  app/         Next.js App Router pages: / (editor), /diagnostics, /templates; layout, manifest
  catalogue/   label shapes and sizes, outlines, safe areas, fold/wrap zones, feed orientation
  geometry/    mm ↔ dots (203 DPI), across-head cap (384), offsets
  render/      design → canvas → 1-bit (threshold / dither) → EncodedImage
  batch/       sequence and list value generators
  printer/     transport wrapper (lifecycle fixes, V3) and job controller (state machine)
  store/       IndexedDB repositories, export/import
  components/  React client components (Tailwind): workspace, shape picker, elements, preview, print panel, status
```

Dependencies only point downward: `app`/`components` → `printer`/`render`/`store` → `geometry`/`catalogue`. `render` never imports `printer`.

Job states: `disconnected → connecting → ready → printing → cancelling → ready`, with any state able to move to `error` and then back to `disconnected`.

## Waves

Each wave ends with tests passing and a short demo. Each task is written test-first where it has logic.

### Wave 0: Scaffold (after Node is installed)

- `git init`, `.gitignore`, MIT-compatible licence choice, `README.md`.
- `create-t3-app` with TypeScript, Tailwind, App Router, ESLint; no tRPC, no database, no auth. Set `output: "export"` and `images.unoptimized: true` in `next.config.js`.
- Add Vitest (+ jsdom, `fake-indexeddb`) for unit tests; Prettier from the T3 template.
- Add `@mmote/niimbluelib` at the exact version; commit the lockfile; record `npm ls` output.
- Fixed port 5179 for `next dev` and for serving the static `out/` folder.

**Done when:** `npm test` and `npm run build` pass on an empty app.

### Wave 1: Core logic (offline, no printer)

1. **Geometry:** mm → dots at 203 DPI, across-head width capped at 384 dots, centring offset. Tests for 50, 48, 40, 31, 25 mm widths.
2. **Catalogue:** typed entries for every size in the spec catalogue. Each entry has: id, display name, shape kind (`rect | round | wave | jewelry | cable`), W×H mm, feed orientation, outline path, safe-area path, fold line or wrap zone, gap, and stock colour. Mark jewelry/cable geometry and all feed orientations `unverified` until Wave 5 measurements. Tests check that safe areas lie inside outlines and within 384 dots.
3. **Renderer:** draws a design (text, image elements) to a canvas at device dots, masks to the safe area, converts to 1-bit (fixed threshold for text, optional Floyd–Steinberg for images), and encodes via `ImageEncoder.encode` with `printDirection: "top"`. Golden-image tests for each shape kind, including jewelry panel rotation.
4. **Batch generator:** sequences (prefix, start, step, zero-padding, suffix) and pasted lists. Tests for padding, negative step rejection, max count limit (default 500).
5. **Store:** IndexedDB repos for templates, barcode→catalogue map, and settings; export/import with a schema version and validation. Tests use `fake-indexeddb`.

**Done when:** unit tests cover all of the above. A dev page shows each catalogue shape's outline, safe area, and rendered 1-bit preview.

### Wave 2: Printer layer and first hardware print

1. **Transport wrapper** around `NiimbotSerialClient` (V3):
   - One connection; listeners tracked and removed on disconnect.
   - `reader.cancel()` before releasing the lock; cleanup awaited.
   - Heartbeat at 2 s while printing or within 30 s of activity, 10 s when idle, and off when the tab is hidden.
   - Disconnect on `pagehide`; reconnect with bounded backoff (max 3 tries) only while the app is open.
   - Web Lock `b21s-printer` so only one tab owns the port (V8).
2. **Job controller:**
   - Serial queue with a maximum length of 1 job.
   - Batches send one page per label; copies of the same label use `quantity` (V2).
   - Density defaults to the model metadata value of 3 (V4).
   - Cancel stops after the current page and always sends `printEnd`. No automatic resend.
   - Errors map to user messages: no paper, lid open, RFID error, timeout, port busy.
3. **Tests** with the virtual client and B21S dump: connect, identify, heartbeat, disconnect, and 100 connect/disconnect cycles with listener and timer counts checked. Also cover cancel mid-batch and timeout handling.
4. **Diagnostics page:** shows model ID, firmware, hardware version, RFID info, and `getPaperInfo` result. Prints a 384-dot test pattern (edges, rulers, density bar). An opt-in bounded log (last 500 packets) is available for troubleshooting.
5. **Hardware milestone (with Matthew)** = spec Phase 2 and the "First implementation milestone":
   - Stop the vendor helper and confirm COM3 is free.
   - Identify the printer as model 777 and record firmware.
   - Print the test pattern, then disconnect and reconnect.

**Done when:** the first direct print and reconnect succeed with `jcprinter` stopped. **If the hardware milestone fails, stop and go to spec Phase 4 (protocol investigation) before Wave 3.**

### Wave 3: Editor UI

- Label picker grouped by shape family, with a custom rectangle option. Selecting a roll whose RFID barcode is already mapped pre-selects its label (V1). An unknown barcode prompts the user to choose and remembers the answer.
- Canvas workspace drawn to scale with outline, safe area, and fold/wrap guides. Text elements have font, size, bold, alignment, and rotation; image elements have threshold or dither. Content is snapped and clipped to the safe area.
- Jewelry: two-panel editing with the second panel auto-rotated. Cable: flag area editing with an optional repeat of the text along the wrap.
- Preview shows the exact 1-bit output, with the pre-printed stock background toggled on or off.
- Print panel has copies, density 1–5, a batch field binding (`{n}` placeholder in text), and Print/Cancel. A status bar shows the connection state, paper, and lid.
- Templates: save, rename, delete, duplicate, export/import.

**Done when:** each shape family can be designed, previewed, and saved/restored; batch preview shows the first and last values.

### Wave 4: Packaging

- PWA: `app/manifest.ts` and a hand-written service worker that precaches the static `out/` build (Next.js has no built-in offline service worker; avoid unmaintained PWA plugins) (V9). Install from `http://localhost:5179` once. Verify the app launches from the Start Menu with no server and no network.
- Check that closing the app releases COM3 and leaves no process except the browser's normal behaviour.
- Record versions and hashes of the built bundle (spec Phase 7.1).
- Fallback if the PWA approach fails: a Start Menu shortcut that starts a static server, opens the app, and stops the server when the window closes.

**Done when:** the app works offline from the Start Menu after a reboot.

### Wave 5: Hardware and reliability validation (with Matthew)

- Spec Phase 3 test table on real stock: one roll per shape family; density 1–5; copies; batch run; cancel; paper-out; lid-open; unplug and replug; PC sleep and resume.
- Measure each roll's real outline, gap, and feed orientation. Update the catalogue and clear the `unverified` flags.
- Spec Phase 6 resource checks: browser process handle and memory trend over 100 connect cycles and a several-hour idle session.

**Done when:** the spec Phase 3 and Phase 6 exit criteria are met.

### Wave 6: Cutover (spec Phase 7)

- Disable automatic start of `jcPrinterService` after backing it up. Confirm both vendor processes stay gone after a reboot.
- Keep the vendor editor and driver backup until the app has been used successfully for a while.
- Write rollback steps in the README.

## Risks

| Risk | Mitigation |
|---|---|
| Web Serial cannot open COM3 with the vendor driver | Wave 2 milestone gates UI work. Fallbacks: spec Phase 2 step 6 and Phase 4. |
| Jewelry/cable geometry or feed orientation is wrong | Entries are flagged `unverified` until measured in Wave 5. |
| Library lifecycle bugs cause leaks | Wrapper plus cycle tests (Wave 2) and resource checks (Wave 5). |
| Upstream library changes | Exact version pin, lockfile, review before upgrading. |
| Service worker caches a broken build | Versioned cache with an update prompt; the previous build is kept. |
| Next.js pre-render touches browser APIs and breaks the build | Keep printer, canvas, and IndexedDB code behind `ssr: false` dynamic imports; `next build` runs in CI-style check every wave. |
| Next.js static export is heavier than a plain SPA | Acceptable for a local app; measure bundle size in Wave 4. |

## Out of scope

Bluetooth, third-party label stock, QR/barcode elements (can be added later), firmware updates, the vendor WebSocket API, and multi-printer support.
