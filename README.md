# B21S Labels

An offline label designer and printer for the NIIMBOT B21S over USB. It replaces the always-running NIIMBOT helper service (`jcPrinterService`). Nothing runs in the background: the app holds the printer only while its window is open.

- Spec and evidence: `G:/niimbot-investigation-20261011/NIIMBOT-B21S-replacement-plan.md`
- Implementation plan: [docs/implementation-plan.md](docs/implementation-plan.md)

Built with the T3 stack (Next.js static export, TypeScript, Tailwind). tRPC, a database and auth are omitted because there is no server. Printer protocol: [NiimBlueLib](https://github.com/MultiMote/niimbluelib) 0.47.0 (MIT), with an app-owned Web Serial client that fixes its connection-lifecycle gaps.

## Features

- Every NIIMBOT B21-family shape: rectangles, round, wave round, jewelry tags (two panels, the lower one printed upside down so it reads when folded) and cable labels (optionally repeating the flag text along the wrap). Custom rectangles are also supported.
- Text with font, size, bold, alignment, rotation and shrink-to-fit. Images with threshold, dither and invert.
- Batches of up to 500 labels: numbered sequences (prefix, padding, step) or a pasted list, via `{n}` in any text.
- Exact 1-bit preview, in both the design view and the as-printed view.
- Copies, darkness 1–5, and cancel (stops after the label currently printing).
- Templates saved in the browser, with JSON backup export and import.
- Remembers which label is loaded for each RFID roll barcode.
- Diagnostics page: printer and roll info, a test pattern, horizontal calibration, measured-geometry overrides, and an opt-in packet log (last 500 packets).
- Curved text along the top or bottom of round labels. Shapes: rectangle, ellipse, line, and a border that follows the label outline (single or double).
- Offline icon library of about 1,900 Lucide icons, with adjustable line weight, category and A-Z filters, and search by name or tag ("kitten" finds cat). Category and tag data live in `src/lib/icon-meta.json`; refresh it after upgrading `lucide` with `node scripts/fetch-icon-meta.mjs`.
- My icons: save AI icons (bookmark button under each result, or Save to My icons on a selected AI icon) and reuse them from the icon library. Saved icons are included in backups.
- AI icon generator using Anthropic Claude or OpenAI with your own API key. Icons are generated as bold black-and-white SVG suited to 203 DPI and previewed exactly as they will print. Keys stay in the browser and are never included in backups.
- Sign in with ChatGPT (OpenAI, Pay with "My ChatGPT plan") bills icon generation to your ChatGPT plan instead of an API key. Sign-in needs the local server running (`npm run serve`); it listens on 127.0.0.1:1455 only to forward OpenAI's sign-in redirect to the app. Image models need an API key.
- AI usage and cost: the chart button in the AI icon generator shows estimated Anthropic spend (this month and all time) from each response's token counts and Anthropic list prices, plus recent generations. The Anthropic Console is the authoritative bill. The log stays in the browser and isn't backed up.
- Layout: label size, Add tools and saved labels on the left; above the canvas the label name with Save (Ctrl+S), Save as new and New, plus undo, Design / As printed and zoom (fits the window by default); on the right, Design (layers and the selected item) and Print settings tabs, with the Print button always at the bottom.
- New clears the design and batch but keeps the label size; Undo brings the old design back.
- Layers: every item on the label, topmost first. Click to select (Shift adds), double-click to rename, move up/down, hide (hidden items don't print) and lock (locked items can't be dragged on the canvas).
- New items are placed in free space instead of on top of existing ones.
- Batches: Numbers (start/step accept fractions like `1/4` or decimals like `0.5`, shown as whole numbers, decimals or mixed fractions such as `1 1/4`), List (with presets: fractional inches, drill bits, metric bolts, machine and wood screws, sockets, wire gauges, sizes, months, weekdays), and Spreadsheet (CSV columns become `{placeholders}`). Every batch also offers `{i}` (label number) and `{total}`.
- Ranges typed straight into label text make one label per value: `Bin {A-D}{1-5}` prints 20 labels (A1…D5). Ranges: `{01-24}` (zero-padded), `{0-100:5}` (step), `{10-1}` (down), `{1/4-2:1/4}"`, `{0.5-5:0.5} mm`, `{A-Z}`, `{AA-AF}`, `{1-12:ROMAN}`, `{Red|Green|Blue}`, `{-5..5}`. Several ranges multiply (the last changes fastest); the same range in two text boxes is one shared counter; ranges also multiply with a List/Numbers/Spreadsheet batch. Insert variable lists examples.
- Describe it: in a text item, describe what you want and it writes the label text with ranges and date variables. Common requests ("every 1/4 inch from 1/4 to 2", "1 to 100", "001 to 250", "bins A1 to D5", "box 1 of 12 to 12 of 12", "Roman numerals 1 to 12", "best by 6 months from today", "packed today mm/dd/yy", "red, green and blue") are worked out instantly on this computer, with no AI. Anything else goes to the AI: your ChatGPT plan when you are signed in (no API cost), otherwise your configured key. Results are checked before you use them and show how many labels they make.
- Dates and times (Insert variable on a text item): `{today}`, `{today:m/d/yy}`, `{today+30:mmm d, yyyy}`, `{today+2w}`, `{today+3m:mm/yy}`, `{today+1y}`, `{time:h:mm AM/PM}`, `{now:m/d/yy h:mm AM/PM}`, `{weekday}`, `{month}`, `{year}`, `{julian}`, `{today:yyjjj}` and more. Formats use Excel-style tokens (d dd ddd dddd do, m mm mmm mmmm, yy yyyy, jjj, ww, q, h hh H HH, mm as minutes after h, ss, AM/PM, "quoted text").
- Undo and redo (Ctrl+Z, Ctrl+Y), multi-select (Shift+click, Ctrl+A), group alignment, duplicate (Ctrl+D), and snapping to the centre, edges and other items (hold Alt to turn it off).

## Requirements

- Windows with Microsoft Edge or Google Chrome. Web Serial is not available in Firefox.
- Node.js 24 LTS, to build. It is installed at `%USERPROFILE%\tools\node-v24.21.0-win-x64` and on the user `PATH`.
- The B21S connected by USB, using the existing NIIMBOT driver. It appears as `Niimbot Serial Port (COMx)`.

## Build and install

```bash
npm install
```

```bash
npm run build
```

```bash
npm run serve
```

1. Open `http://localhost:5179/` in Edge or Chrome. Always use this exact address, because saved templates belong to it.
2. Install the app from the address bar (**App available → Install**). This adds a Start Menu entry.
3. Stop the server (Ctrl+C). The installed app keeps working offline with no server running.

To update, rebuild and run `npm run serve` again, open the app, and click **Update** when prompted.

## Using the printer

1. Close the NIIMBOT app. The serial port can only be used by one program at a time, so stop the vendor helper too (see Cutover).
2. Click **Connect printer** and choose the NIIMBOT port. The app checks that the printer reports itself as a B21S (model 777).
3. Pick the label, design it, then click **Print**.

The app releases the printer when you disconnect, close the window or unplug the cable. Only one tab or window can hold the printer at a time.

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

- `npm run dev` starts the dev server on port 5179 (no service worker).
- `npm test` runs the unit tests, the recorded-B21S session and the simulated print jobs.
- `npm run check` runs lint and typecheck.

Code layout:

| Path | Purpose |
|---|---|
| `src/lib/catalogue.ts`, `shapes.ts`, `geometry.ts` | Label shapes, safe areas, mm ↔ dots, printhead window |
| `src/lib/render/` | Design → 1-bit raster → printer encoding; test pattern |
| `src/lib/printer/serial-client.ts` | Web Serial transport with the lifecycle fixes (validation V3) |
| `src/lib/printer/session.ts` | Connection state, heartbeat cadence, cross-tab lock, print jobs and cancel |
| `src/lib/store/` | IndexedDB templates, roll map, overrides, settings, backup |
| `src/components/`, `src/app/` | UI |
| `src/test/` | Recorded B21S dump, fake serial port, simulated printer |

## First hardware test (spec Phase 2 and "First implementation milestone")

Not done yet: this needs the physical printer.

1. Back up the vendor service and driver (from an elevated prompt):
   - `sc.exe qc jcPrinterService`
   - `pnputil /export-driver oem10.inf G:\niimbot-investigation-20261011\driver-backup`
2. Close the NIIMBOT editor. Stop the helper with `sc.exe stop jcPrinterService`. Check in Task Manager that both `jcprinter` and `jcprinterdaemon` have exited.
3. Open the app and click **Connect printer**. Open **Diagnostics** and record the model, firmware, roll RFID barcode, and whether **Read paper info** answers.
4. Load 50 mm wide stock and click **Print test pattern**. Check that the border and ruler are not clipped and the pattern is centred. Adjust **Offset** if needed (8 dots ≈ 1 mm).
5. Click **Disconnect**, then **Connect** again, then print once more.
6. For each roll shape, print a sample. If the outline or zones are off, measure them and save a correction under **Measured label geometry**.

If connecting fails with "port in use", something else still holds COM3: the NIIMBOT app, its helper, or another tab.

## Cutover and rollback (spec Phase 7)

**Cutover**, after the app has worked reliably:

```bash
sc.exe config jcPrinterService start= demand
```

Reboot, then confirm `jcprinter` and `jcprinterdaemon` are not running. Keep the NIIMBOT app and the driver backup for now. Opening the NIIMBOT editor may start the helper again.

**Rollback:**

```bash
sc.exe config jcPrinterService start= auto
```

```bash
sc.exe start jcPrinterService
```

Then use the NIIMBOT app as before.

## Known limits

- All catalogue shapes are marked unverified until they are measured on real rolls. Jewelry-tag panels and cable flag/wrap zones are estimates.
- The roll RFID tag gives a barcode and label counts, not the size or shape. The label is chosen once per roll type and remembered.
- Cancel takes effect between labels. A label that has started printing finishes.
- NiimBlueLib ships CommonJS only, so its Bluetooth/Capacitor client code cannot be tree-shaken and is included in the bundle (V6). The app never constructs those clients.
