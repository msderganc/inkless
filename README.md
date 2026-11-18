# Inkless

**An offline label designer and printer for the NIIMBOT B21S, over USB, in your browser.**

Thermal printers print with heat, so there's no ink, hence the name.

Inkless replaces NIIMBOT's always-running Windows helper service (`jcPrinterService`) and its editor. It's a Progressive Web App: install it once from Edge or Chrome and it works fully offline, with no server and no account. Nothing runs in the background. The app holds the printer only while its window is open and releases it when you disconnect, close the window or unplug the cable.

---

## Contents

- [Highlights](#highlights)
- [Requirements](#requirements)
- [Install](#install)
- [Printing](#printing)
- [Designing labels](#designing-labels)
- [Batches, ranges and variables](#batches-ranges-and-variables)
- [AI features (optional)](#ai-features-optional)
- [Templates, backups and privacy](#templates-backups-and-privacy)
- [Diagnostics and calibration](#diagnostics-and-calibration)
- [Replacing the NIIMBOT helper service](#replacing-the-niimbot-helper-service)
- [Development](#development)
- [Architecture](#architecture)
- [Known limits](#known-limits)
- [Credits](#credits)

---

## Highlights

- **Every B21-family label shape:** rectangles, round, wave round, jewelry tags and cable labels, plus custom rectangles.
- **Exact 1-bit preview.** What you see in *As printed* is the raster the printer receives, at 203 DPI.
- **Batches of up to 500 labels** from numbered sequences, lists, spreadsheets, or ranges typed straight into the text (`Bin {A-D}{1-5}` prints 20 labels).
- **Dates and times** with Excel-style formats (`{today+30:mmm d, yyyy}`).
- **About 1,900 offline icons** (Lucide), searchable by name or tag.
- **Optional AI:** generate print-ready icons, or describe label text in plain words. Bring your own Anthropic or OpenAI key, or sign in with your ChatGPT plan.
- **Offline-first.** Templates, roll mappings and settings live in the browser (IndexedDB), with JSON backup and restore.

---

## Requirements

| | |
|---|---|
| **OS** | Windows (other platforms with Web Serial may work but are untested) |
| **Browser** | Microsoft Edge or Google Chrome. Firefox and Safari don't support Web Serial. |
| **Printer** | NIIMBOT B21S connected by USB, using the standard NIIMBOT driver. It appears as `Niimbot Serial Port (COMx)`. |
| **To build** | Node.js 24 LTS and npm |

---

## Install

```bash
git clone https://github.com/msderganc/inkless.git
```

```bash
cd inkless
```

```bash
npm install
```

```bash
npm run build
```

```bash
npm run serve
```

1. Open **`http://localhost:5179/`** in Edge or Chrome. Always use this exact address: saved templates belong to the origin, so `127.0.0.1:5179` would be a different, empty app.
2. Install it from the address bar (**App available → Install**). This adds a Start Menu entry.
3. Stop the server (Ctrl+C). The installed app keeps working offline.

**Updating:** pull, rebuild, run `npm run serve` again, open the app and click **Update** when prompted.

> The local server is only needed to install or update, and for *Sign in with ChatGPT* (see [AI features](#ai-features-optional)).

---

## Printing

1. **Close the NIIMBOT app.** A serial port can be used by only one program at a time, so the vendor helper must be stopped too (see [Replacing the NIIMBOT helper service](#replacing-the-niimbot-helper-service)).
2. Click **Connect printer** and choose the NIIMBOT port. Inkless checks that the printer reports itself as a B21S (model 777).
3. Pick the label, design it, then click **Print**.

Print settings:

- **Copies** and **darkness** (1–5).
- **Cancel** stops after the label currently printing.
- Only one tab or window can hold the printer at a time (a cross-tab lock enforces this).
- Inkless remembers which label size is loaded for each roll's RFID barcode, so next time you load that roll it picks the right label.

If connecting fails with "port in use", something else still holds the port: the NIIMBOT app, its helper service, or another Inkless tab.

---

## Designing labels

### Layout

- **Left:** label size, *Add* tools and saved labels.
- **Above the canvas:** the label name with **Save** (Ctrl+S), **Save as new** and **New**; undo; **Design / As printed** toggle; zoom (fits the window by default).
- **Right:** **Design** tab (layers and the selected item) and **Print settings** tab. The **Print** button is always at the bottom.

### Label shapes

| Shape | Notes |
|---|---|
| Rectangle | Standard sizes plus custom dimensions |
| Round, wave round | Supports curved text along the top or bottom edge |
| Jewelry tag | Two panels. The lower one prints upside down so it reads correctly when folded. |
| Cable label | Flag plus wrap zone, optionally repeating the flag text along the wrap |

### Items

- **Text:** font (including installed system fonts), size, bold, alignment, rotation and shrink-to-fit. Curved text on round labels.
- **Images:** threshold, dither and invert, previewed exactly as they'll print.
- **Shapes:** rectangle, ellipse, line, and a border that follows the label outline (single or double).
- **Icons:** an offline library of about 1,900 [Lucide](https://lucide.dev) icons with adjustable line weight, category and A–Z filters, and tag search ("kitten" finds *cat*). Saved AI icons appear under **My icons**.

### Editing

- **Layers:** every item, topmost first. Click to select (Shift adds), double-click to rename, move up and down, hide (hidden items don't print) and lock (locked items can't be dragged).
- **Undo/redo** (Ctrl+Z, Ctrl+Y), **multi-select** (Shift+click, Ctrl+A), **group alignment**, **duplicate** (Ctrl+D).
- **Snapping** to the centre, edges and other items. Hold **Alt** to turn it off.
- New items are placed in free space rather than on top of existing ones.
- **New** clears the design and batch but keeps the label size. Undo brings the old design back.

---

## Batches, ranges and variables

### Batch sources

Set up a batch on the **Print settings** tab. Use `{n}` (or the column names) in any text item.

| Source | What it does |
|---|---|
| **Numbers** | Prefix, padding, start and step. Start and step accept fractions (`1/4`) and decimals (`0.5`), shown as whole numbers, decimals or mixed fractions such as `1 1/4`. |
| **List** | Paste one value per line, or use a preset: fractional inches, drill bits, metric bolts, machine and wood screws, sockets, wire gauges, sizes, months, weekdays. |
| **Spreadsheet** | Paste CSV. Each column becomes a `{placeholder}`. |

Every batch also offers `{i}` (label number) and `{total}`. Batches are capped at 500 labels.

### Inline ranges

Type a range straight into label text and Inkless makes one label per value:

| You type | You get |
|---|---|
| `{1-10}` | 1, 2, … 10 |
| `{01-24}` | 01, 02, … 24 (zero-padded) |
| `{0-100:5}` | 0, 5, 10, … 100 (step) |
| `{10-1}` | 10, 9, … 1 (counts down) |
| `{-5..5}` | −5 … 5 |
| `{1/4-2:1/4}"` | 1/4", 1/2", 3/4", … 2" |
| `{0.5-5:0.5} mm` | 0.5 mm, 1 mm, … 5 mm |
| `{A-Z}`, `{AA-AF}` | Letters |
| `{1-12:ROMAN}` | I, II, … XII |
| `{Red\|Green\|Blue}` | A list of choices |

- Several ranges multiply, and the last one changes fastest: `Bin {A-D}{1-5}` prints 20 labels, A1 … D5.
- The same range in two text boxes is one shared counter.
- Ranges also multiply with a List, Numbers or Spreadsheet batch.
- **Insert variable** on a text item lists examples.

### Dates and times

| Variable | Example output |
|---|---|
| `{today}` | Today's date |
| `{today:m/d/yy}` | 11/17/26 |
| `{today+30:mmm d, yyyy}` | Dec 17, 2026 |
| `{today+2w}`, `{today+3m:mm/yy}`, `{today+1y}` | Offsets in days, weeks, months, years |
| `{time:h:mm AM/PM}` | 3:45 PM |
| `{now:m/d/yy h:mm AM/PM}` | Date and time |
| `{weekday}`, `{month}`, `{year}` | Names and numbers |
| `{julian}`, `{today:yyjjj}` | Julian day / date codes |

Formats use Excel-style tokens: `d dd ddd dddd do`, `m mm mmm mmmm`, `yy yyyy`, `jjj`, `ww`, `q`, `h hh H HH`, `mm` (minutes when after `h`), `ss`, `AM/PM`, and `"quoted text"`.

---

## AI features (optional)

Inkless works without any AI. These features are opt-in and need your own provider access.

### Describe it

In a text item, describe what you want and Inkless writes the label text with ranges and date variables. Common requests are worked out instantly **on your computer, with no AI**:

> "every 1/4 inch from 1/4 to 2" · "1 to 100" · "001 to 250" · "bins A1 to D5" · "box 1 of 12 to 12 of 12" · "Roman numerals 1 to 12" · "best by 6 months from today" · "packed today mm/dd/yy" · "red, green and blue"

Anything else goes to the AI: your ChatGPT plan if you're signed in (no API cost), otherwise your configured API key. Results are validated before you can use them, and show how many labels they'll make.

### AI icon generator

Generates bold black-and-white SVG icons suited to 203 DPI, previewed exactly as they'll print. Save results to **My icons** (bookmark button under each result, or **Save to My icons** on a selected AI icon) to reuse them from the icon library.

Providers:

- **Anthropic Claude** or **OpenAI** with your own API key. Keys stay in the browser and are never included in backups.
- **Sign in with ChatGPT** (OpenAI, *Pay with: My ChatGPT plan*) bills generation to your ChatGPT plan instead of an API key. Sign-in needs the local server running (`npm run serve`); it listens on `127.0.0.1:1455` only to forward OpenAI's sign-in redirect to the app. Image models still need an API key.

### Usage and cost

The chart button in the AI icon generator shows estimated Anthropic spend (this month and all time), calculated from each response's token counts and Anthropic list prices, plus recent generations. The Anthropic Console is the authoritative bill. The log stays in the browser and isn't backed up.

---

## Templates, backups and privacy

- Templates, saved icons, roll mappings, geometry overrides and settings are stored in the browser's IndexedDB, tied to `http://localhost:5179`.
- **Export backup** (under saved labels) writes saved labels, settings and My icons to one JSON file. **Import backup** restores it, adding to what's already there. API keys and the AI usage log are deliberately excluded.
- Nothing is sent anywhere unless you use an AI feature, and then only to the provider you chose.

---

## Diagnostics and calibration

The **Diagnostics** page provides:

- Printer and roll info (model, firmware, RFID barcode, label counts).
- A **test pattern** (border and ruler) to check centring and clipping.
- **Horizontal calibration** offset (8 dots ≈ 1 mm).
- **Measured label geometry** overrides, to correct a shape's outline or zones after measuring a real roll.
- An opt-in **packet log** (last 500 packets) for protocol debugging.

### First hardware check

1. Stop the NIIMBOT editor and helper (below). In Task Manager, confirm `jcprinter` and `jcprinterdaemon` have exited.
2. **Connect printer**, open **Diagnostics**, and note the model, firmware, roll barcode, and whether **Read paper info** answers.
3. Load 50 mm stock and **Print test pattern**. Check the border and ruler aren't clipped and the pattern is centred. Adjust **Offset** if needed.
4. **Disconnect**, **Connect** again, and print once more to confirm the connection lifecycle.
5. Print a sample of each roll shape you own. If the outline or zones are off, measure them and save a correction under **Measured label geometry**.

---

## Replacing the NIIMBOT helper service

NIIMBOT installs `jcPrinterService`, which starts with Windows and holds the printer's serial port. Inkless can't connect while it's running.

**Back up first** (elevated prompt):

```bash
sc.exe qc jcPrinterService
```

```bash
pnputil /export-driver <oemNN.inf> <backup-folder>
```

Find the right `oemNN.inf` with `pnputil /enum-drivers` (look for NIIMBOT). Keep the driver: Inkless uses it.

**Stop it for one session:**

```bash
sc.exe stop jcPrinterService
```

**Cutover** (after Inkless has worked reliably), so it no longer starts with Windows:

```bash
sc.exe config jcPrinterService start= demand
```

Reboot and confirm `jcprinter` and `jcprinterdaemon` aren't running. Opening the NIIMBOT editor may start the helper again.

**Rollback:**

```bash
sc.exe config jcPrinterService start= auto
```

```bash
sc.exe start jcPrinterService
```

---

## Development

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run check
```

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server on port 5179 (no service worker) |
| `npm run build` | Static export to `out/`, then the service worker step (`scripts/postbuild.mjs`) |
| `npm run serve` | Serves `out/` on 5179 and the ChatGPT sign-in redirect on 1455 |
| `npm test` | Unit tests, a recorded B21S session and simulated print jobs (Vitest) |
| `npm run check` | Lint and typecheck |
| `npm run format:write` | Prettier |

After upgrading `lucide`, refresh icon categories and tags (`src/lib/icon-meta.json`):

```bash
node scripts/fetch-icon-meta.mjs
```

### Stack

Built with the [T3 stack](https://create.t3.gg) subset that fits an app with no server: **Next.js 15** (static export), **React 19**, **TypeScript**, **Tailwind CSS 4** and **Zod**. tRPC, a database and auth are omitted. Storage is IndexedDB via `idb`. Tests use Vitest, jsdom, `fake-indexeddb` and `@napi-rs/canvas`.

---

## Architecture

```
Design (items, label shape)
   │  src/lib/render/
   ▼
1-bit raster at 203 DPI  ──►  printer encoding (NiimBlueLib)
   │                               │
   ▼                               ▼
"As printed" preview       src/lib/printer/session.ts
                           (state, heartbeat, cross-tab lock, jobs, cancel)
                                   │
                                   ▼
                           src/lib/printer/serial-client.ts
                           (Web Serial transport) ──► USB ──► B21S
```

| Path | Purpose |
|---|---|
| `src/lib/catalogue.ts`, `shapes.ts`, `geometry.ts` | Label shapes, safe areas, mm ↔ dots, printhead window |
| `src/lib/render/` | Design → 1-bit raster → printer encoding; test pattern |
| `src/lib/printer/serial-client.ts` | Web Serial transport with connection-lifecycle fixes |
| `src/lib/printer/session.ts` | Connection state, heartbeat cadence, cross-tab lock, print jobs and cancel |
| `src/lib/store/` | IndexedDB templates, roll map, overrides, settings, backup |
| `src/components/`, `src/app/` | UI |
| `src/test/` | Recorded B21S dump, fake serial port, simulated printer |
| `scripts/` | Local server, service-worker post-build, icon generation, icon metadata fetch |
| `docs/implementation-plan.md` | The original implementation plan |

The printer protocol comes from [NiimBlueLib](https://github.com/MultiMote/niimbluelib). Inkless uses its own Web Serial client in place of the library's, to close gaps in connect, disconnect and unplug handling.

---

## Known limits

- **Shapes are unverified** until they're measured on real rolls. Jewelry-tag panels and cable flag/wrap zones are estimates. Use **Measured label geometry** to correct them.
- **The roll's RFID tag** gives a barcode and label counts, not the size or shape, so you choose the label once per roll type and Inkless remembers it.
- **Cancel** takes effect between labels. A label that has started printing finishes.
- **Bundle size:** NiimBlueLib ships CommonJS only, so its Bluetooth and Capacitor client code can't be tree-shaken and ends up in the bundle. Inkless never constructs those clients.
- **B21S only.** Other NIIMBOT models are rejected at connect time.

---

## Credits

- [NiimBlueLib](https://github.com/MultiMote/niimbluelib) by MultiMote (MIT), the NIIMBOT protocol implementation.
- [Lucide](https://lucide.dev) icons (ISC).

Inkless is an independent project, not affiliated with or endorsed by NIIMBOT.
