/**
 * Numbers that labels count in (whole, decimal, fractions like 1 1/4) and brace patterns that
 * expand to many labels: "Bin {A-D}{1-5}", "{01-12}", "{1/4-2:1/4}\"", "{Red|Green|Blue}",
 * "{1-10:roman}". Groups multiply left to right (the last one changes fastest).
 */

export type AmountStyle = "number" | "decimal" | "fraction";

export interface AmountFormat {
  style: AmountStyle;
  /** Decimal places ("decimal"). */
  decimals: number;
  /** Fractions round to this denominator, e.g. 16 for sixteenths ("fraction"). */
  denominator: number;
  /** Zero-pad whole numbers to this many digits. */
  pad: number;
}

const AMOUNT_RE =
  /^\s*(-)?\s*(?:(\d+)(?:\s+|-(?=\d+\/))?)?(?:(\d+)\/(\d+))?(?:\.(\d+))?\s*$/;

/**
 * "3", "-2", "0.25", "1/4", "1 1/4", "1-1/4" → number, plus what the text implies about how to
 * show it (fraction denominator or decimal places). Null if it isn't a number.
 */
export function parseAmount(
  text: string,
): { value: number; denominator?: number; decimals?: number } | null {
  const t = text.trim();
  if (!t) return null;
  if (/^-?\d*\.\d+$/.test(t) || /^-?\d+\.\d*$/.test(t)) {
    const value = Number(t);
    return Number.isFinite(value)
      ? { value, decimals: (t.split(".")[1] ?? "").length }
      : null;
  }
  const m = AMOUNT_RE.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  if (m[5] !== undefined) return null; // decimals handled above
  const whole = m[2] ? Number(m[2]) : 0;
  if (m[3] !== undefined) {
    const den = Number(m[4]);
    if (!den) return null;
    const v = whole + Number(m[3]) / den;
    return { value: m[1] ? -v : v, denominator: den };
  }
  return { value: m[1] ? -whole : whole };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** 1.25 → "1 1/4" (fraction), "1.25" (decimal), "1" (number, rounded). */
export function formatAmount(value: number, f: AmountFormat): string {
  if (f.style === "decimal") return value.toFixed(f.decimals);
  if (f.style === "fraction") {
    const den = Math.max(1, Math.round(f.denominator));
    const total = Math.round(Math.abs(value) * den);
    const whole = Math.floor(total / den);
    const rem = total % den;
    const sign = value < 0 && total > 0 ? "-" : "";
    if (rem === 0) return `${sign}${whole}`;
    const g = gcd(rem, den);
    const frac = `${rem / g}/${den / g}`;
    return whole ? `${sign}${whole} ${frac}` : `${sign}${frac}`;
  }
  const n = Math.round(value);
  const digits = String(Math.abs(n)).padStart(f.pad, "0");
  return n < 0 ? `-${digits}` : digits;
}

/** How to show a run of numbers given how its start/end/step were typed. */
export function inferFormat(
  parts: NonNullable<ReturnType<typeof parseAmount>>[],
  padFrom?: string,
): AmountFormat {
  const dens = parts.flatMap((p) => (p.denominator ? [p.denominator] : []));
  const decs = parts.flatMap((p) => (p.decimals ? [p.decimals] : []));
  const lcm = dens.reduce((a, b) => (a * b) / gcd(a, b), 1);
  // Leading zeros on the start ("01", "007") set the padding.
  const pad =
    padFrom && /^-?0\d/.test(padFrom.trim())
      ? padFrom.trim().replace("-", "").length
      : 0;
  return {
    style: dens.length ? "fraction" : decs.length ? "decimal" : "number",
    decimals: Math.max(0, ...decs),
    denominator: Math.min(lcm, 128),
    pad,
  };
}

// ---------- letters and Roman numerals ----------

/** "A" → 1, "Z" → 26, "AA" → 27 (spreadsheet columns). */
export function lettersToNumber(s: string): number {
  return [...s.toUpperCase()].reduce(
    (n, c) => n * 26 + c.charCodeAt(0) - 64,
    0,
  );
}

export function numberToLetters(n: number, lower = false): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return lower ? s.toLowerCase() : s;
}

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let s = "";
  for (const [v, r] of ROMAN)
    while (n >= v) {
      s += r;
      n -= v;
    }
  return s;
}

// ---------- patterns ----------

export class PatternError extends Error {}

type Segment = { text: string } | { values: string[] };

const MAX_GROUP = 2000;

/** Split "a-b" / "a..b" into start and end (a leading minus belongs to the start). */
function splitRange(body: string): [string, string] | null {
  if (body.includes("..")) {
    const [a, b] = body.split("..");
    return a !== undefined && b !== undefined ? [a, b] : null;
  }
  const i = body.indexOf("-", 1);
  if (i < 0) return null;
  // "1-1/4" is a mixed number, not a range.
  return [body.slice(0, i), body.slice(i + 1)];
}

function expandGroup(raw: string): string[] {
  const body = raw.trim();
  if (body.includes("|")) return body.split("|").map((s) => s.trim());

  const [rangePart, ...opts] = body.split(":").map((s) => s.trim());
  const range = splitRange(rangePart ?? "");
  if (!range) throw new PatternError(`"{${raw}}" isn't a range or a list.`);
  const [a, b] = [range[0].trim(), range[1].trim()];
  let step: ReturnType<typeof parseAmount> | undefined;
  let roman: "upper" | "lower" | undefined;
  let pad: number | undefined;
  for (const o of opts) {
    if (/^roman$/i.test(o)) roman = o === "roman" ? "lower" : "upper";
    else if (/^pad\d{1,2}$/i.test(o)) pad = Number(o.slice(3));
    else {
      const s = parseAmount(o);
      if (!s || s.value <= 0)
        throw new PatternError(`"${o}" isn't a valid step in "{${raw}}".`);
      step = s;
    }
  }

  // Letters: A-Z, AA-AZ, a-e (stepped by whole letters).
  if (/^[a-z]{1,3}$/i.test(a) && /^[a-z]{1,3}$/i.test(b)) {
    const from = lettersToNumber(a);
    const to = lettersToNumber(b);
    const by = Math.max(1, Math.round(step?.value ?? 1));
    const lower = a === a.toLowerCase();
    return run(from, to, by).map((n) => numberToLetters(n, lower));
  }

  const start = parseAmount(a);
  const end = parseAmount(b);
  if (!start || !end)
    throw new PatternError(
      `"{${raw}}": start and end must be numbers or letters.`,
    );
  const by = step?.value ?? 1;
  const fmt = inferFormat([start, end, ...(step ? [step] : [])], a);
  if (pad !== undefined) fmt.pad = pad;
  return run(start.value, end.value, by).map((v) =>
    roman
      ? roman === "upper"
        ? toRoman(Math.round(v))
        : toRoman(Math.round(v)).toLowerCase()
      : formatAmount(v, fmt),
  );
}

/** start → end in steps (counting down if end < start); tolerant of float error. */
function run(from: number, to: number, by: number): number[] {
  const dir = to >= from ? 1 : -1;
  const n = Math.floor(Math.abs(to - from) / by + 1e-9) + 1;
  if (n > MAX_GROUP)
    throw new PatternError(`A range can have at most ${MAX_GROUP} values.`);
  return Array.from(
    { length: n },
    (_, i) => Math.round((from + dir * i * by) * 1e9) / 1e9,
  );
}

/** Looks like a range or list ("1-10", "A..D", "a|b") rather than a {name}. */
export function looksLikeGroup(raw: string): boolean {
  const t = raw.trim();
  if (t.includes("|")) return true;
  const range = splitRange(t.split(":")[0] ?? "");
  if (!range) return false;
  const [a, b] = [range[0].trim(), range[1].trim()];
  const letters = /^[a-z]{1,3}$/i;
  return (
    (letters.test(a) && letters.test(b)) ||
    (parseAmount(a) !== null && parseAmount(b) !== null)
  );
}

/** The values of one {group} in label text; throws PatternError if it's malformed. */
export function groupValues(raw: string): string[] {
  return expandGroup(raw);
}

/** Parse a pattern into literal text and groups. Throws PatternError on a bad group. */
export function parsePattern(pattern: string): Segment[] {
  const segs: Segment[] = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  for (const m of pattern.matchAll(re)) {
    if (m.index > last) segs.push({ text: pattern.slice(last, m.index) });
    segs.push({ values: expandGroup(m[1]!) });
    last = m.index + m[0].length;
  }
  if (last < pattern.length) segs.push({ text: pattern.slice(last) });
  return segs;
}

/** How many labels a pattern makes (without building them). */
export function patternSize(segs: Segment[]): number {
  return segs.reduce((n, s) => ("values" in s ? n * s.values.length : n), 1);
}

/**
 * Every combination, last group fastest: each is the full text plus each group's value
 * (g1, g2, …) so a label can use the parts separately.
 */
export function expandPattern(
  segs: Segment[],
  limit: number,
): { text: string; groups: string[] }[] {
  const size = patternSize(segs);
  if (size > limit)
    throw new PatternError(
      `That pattern makes ${size} labels; a batch is limited to ${limit}.`,
    );
  const groups = segs.filter((s): s is { values: string[] } => "values" in s);
  const out: { text: string; groups: string[] }[] = [];
  for (let k = 0; k < size; k++) {
    let rest = k;
    const picks = new Array<string>(groups.length);
    for (let g = groups.length - 1; g >= 0; g--) {
      const vals = groups[g]!.values;
      picks[g] = vals[rest % vals.length]!;
      rest = Math.floor(rest / vals.length);
    }
    let gi = 0;
    const text = segs
      .map((s) => ("values" in s ? picks[gi++]! : s.text))
      .join("");
    out.push({ text, groups: picks });
  }
  return out;
}

/** Ready-made size lists for the List batch ("think screw sizes"). */
export const LIST_PRESETS: { name: string; items: string[] }[] = [
  {
    name: 'Fractional inches 1/16"–1" (by 1/16)',
    items: Array.from(
      { length: 16 },
      (_, i) =>
        `${formatAmount((i + 1) / 16, { style: "fraction", decimals: 0, denominator: 16, pad: 0 })}"`,
    ),
  },
  {
    name: 'Fractional inches 1/8"–2" (by 1/8)',
    items: Array.from(
      { length: 16 },
      (_, i) =>
        `${formatAmount((i + 1) / 8, { style: "fraction", decimals: 0, denominator: 8, pad: 0 })}"`,
    ),
  },
  {
    name: 'Drill bits 1/16"–1/2" (by 1/64)',
    items: Array.from(
      { length: 29 },
      (_, i) =>
        `${formatAmount((i + 4) / 64, { style: "fraction", decimals: 0, denominator: 64, pad: 0 })}"`,
    ),
  },
  {
    name: "Metric drill bits 1–13 mm (by 0.5)",
    items: Array.from(
      { length: 25 },
      (_, i) => `${(1 + i * 0.5).toFixed(1)} mm`,
    ),
  },
  {
    name: "Metric bolts M2–M24",
    items: [
      "M2",
      "M2.5",
      "M3",
      "M4",
      "M5",
      "M6",
      "M8",
      "M10",
      "M12",
      "M14",
      "M16",
      "M20",
      "M24",
    ],
  },
  {
    name: "Machine screws (UNC/UNF)",
    items: [
      "#2-56",
      "#4-40",
      "#6-32",
      "#8-32",
      "#10-24",
      "#10-32",
      '1/4"-20',
      '1/4"-28',
      '5/16"-18',
      '3/8"-16',
      '7/16"-14',
      '1/2"-13',
    ],
  },
  {
    name: "Wood screw gauges #2–#14",
    items: ["#2", "#4", "#6", "#8", "#10", "#12", "#14"],
  },
  {
    name: 'Sockets SAE 1/4"–1"',
    items: [
      '1/4"',
      '5/16"',
      '11/32"',
      '3/8"',
      '7/16"',
      '1/2"',
      '9/16"',
      '5/8"',
      '11/16"',
      '3/4"',
      '13/16"',
      '7/8"',
      '15/16"',
      '1"',
    ],
  },
  {
    name: "Sockets metric 6–24 mm",
    items: Array.from({ length: 19 }, (_, i) => `${i + 6} mm`),
  },
  {
    name: "Wire gauge AWG 24–4",
    items: [
      "24 AWG",
      "22 AWG",
      "20 AWG",
      "18 AWG",
      "16 AWG",
      "14 AWG",
      "12 AWG",
      "10 AWG",
      "8 AWG",
      "6 AWG",
      "4 AWG",
    ],
  },
  {
    name: "Clothing sizes XS–3XL",
    items: ["XS", "S", "M", "L", "XL", "XXL", "3XL"],
  },
  {
    name: "Months",
    items: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  },
  {
    name: "Weekdays",
    items: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
  },
];

/** Example patterns for the Pattern batch. */
export const PATTERN_EXAMPLES: { pattern: string; note: string }[] = [
  { pattern: "Bin {A-D}{1-5}", note: "A1…D5, 20 labels" },
  { pattern: "Shelf {01-24}", note: "zero-padded" },
  { pattern: '{1/4-2:1/4}"', note: "every 1/4 inch" },
  { pattern: "{0.5-5:0.5} mm", note: "every 0.5 mm" },
  { pattern: "M{3|4|5|6|8|10} x {10-50:10}", note: "bolt sizes × lengths" },
  { pattern: "Row {A-C} Seat {1-12}", note: "seating" },
  { pattern: "Part {100-500:25}", note: "step 25" },
  { pattern: "Chapter {1-12:ROMAN}", note: "I…XII" },
  { pattern: "{Mon|Tue|Wed|Thu|Fri} {AM|PM}", note: "lists" },
];

/** Ranges to insert into label text ("Insert variable"); each makes one label per value. */
export const RANGE_EXAMPLES: { pattern: string; note: string }[] = [
  { pattern: "{1-10}", note: "1 to 10" },
  { pattern: "{01-24}", note: "01 to 24, zero-padded" },
  { pattern: "{0-100:5}", note: "every 5" },
  { pattern: "{10-1}", note: "counting down" },
  { pattern: "{A-Z}", note: "letters" },
  { pattern: "{A-D}{1-5}", note: "A1 to D5 (20 labels)" },
  { pattern: '{1/4-2:1/4}"', note: "every 1/4 inch" },
  { pattern: '{1/16-1:1/16}"', note: "every 1/16 inch" },
  { pattern: "{0.5-5:0.5} mm", note: "every 0.5 mm" },
  { pattern: "{1-12:ROMAN}", note: "I to XII" },
  { pattern: "{Red|Green|Blue}", note: "a list" },
  { pattern: "M{3|4|5|6|8|10}", note: "metric bolt sizes" },
];
