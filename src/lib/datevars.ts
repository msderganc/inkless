/**
 * Date and time placeholders: {today}, {today+30}, {today+2w:mmm d}, {now:m/d/yy h:mm AM/PM},
 * {time}, {year}, {julian}… Formats use Excel-style tokens (see formatDate).
 */

type Unit = "d" | "w" | "m" | "y" | "h" | "min";

export interface DateVar {
  kind: "date" | "datetime" | "time";
  sign: 1 | -1;
  amount: number;
  unit: Unit;
  /** Explicit format, or undefined for the variable's default. */
  format?: string;
}

/** Names that always mean the current date/time, and the format a bare name implies. */
const NAMES: Record<string, { kind: DateVar["kind"]; format?: string }> = {
  today: { kind: "date" },
  date: { kind: "date" },
  now: { kind: "datetime" },
  time: { kind: "time" },
  year: { kind: "date", format: "yyyy" },
  month: { kind: "date", format: "mmmm" },
  day: { kind: "date", format: "d" },
  weekday: { kind: "date", format: "dddd" },
  week: { kind: "date", format: "ww" },
  julian: { kind: "date", format: "jjj" },
};

const VAR_RE =
  /^([a-z]+)\s*(?:([+-])\s*(\d{1,4})\s*(min|d|w|m|y|h)?)?\s*(?::(.{1,50}))?$/i;

/**
 * Parse the inside of a {placeholder} as a date variable, or null if it isn't one.
 * Offsets default to days (hours for {time}); "m" is months, "min" minutes.
 */
export function parseDateVar(key: string): DateVar | null {
  const m = VAR_RE.exec(key.trim());
  if (!m) return null;
  // Own keys only: {constructor} must not match Object.prototype.
  const word = m[1]!.toLowerCase();
  const name = Object.hasOwn(NAMES, word) ? NAMES[word] : undefined;
  if (!name) return null;
  const unit = (m[4]?.toLowerCase() ??
    (name.kind === "time" ? "h" : "d")) as Unit;
  return {
    kind: name.kind,
    sign: m[2] === "-" ? -1 : 1,
    amount: m[3] ? Number(m[3]) : 0,
    unit,
    // A blank format ("{today:}") falls back to the default.
    format: m[5]?.trim() ? m[5].trim() : name.format,
  };
}

/** Add an offset; months/years clamp to the month's last day (Jan 31 + 1m = Feb 28). */
export function shiftDate(
  from: Date,
  sign: 1 | -1,
  amount: number,
  unit: Unit,
): Date {
  const d = new Date(from);
  const n = sign * amount;
  switch (unit) {
    case "d":
      d.setDate(d.getDate() + n);
      break;
    case "w":
      d.setDate(d.getDate() + 7 * n);
      break;
    case "h":
      d.setHours(d.getHours() + n);
      break;
    case "min":
      d.setMinutes(d.getMinutes() + n);
      break;
    case "m":
    case "y": {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + (unit === "y" ? 12 * n : n));
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      break;
    }
  }
  return d;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** ISO 8601 week number (weeks start Monday; week 1 contains the first Thursday). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** Day of the year, 1–366. */
export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getFullYear(), 0, 1);
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((today - start) / 86_400_000) + 1;
}

// Longest first so "mmmm" wins over "mm". Letters not listed are kept as typed.
const TOKENS = [
  "yyyy",
  "yy",
  "mmmm",
  "mmm",
  "mm",
  "m",
  "dddd",
  "ddd",
  "dd",
  "do",
  "d",
  "jjj",
  "j",
  "ww",
  "q",
  "HH",
  "H",
  "hh",
  "h",
  "ss",
  "s",
  "AM/PM",
  "am/pm",
  "A/P",
  "a/p",
];

type Part = { token: string } | { text: string };

function tokenize(fmt: string): Part[] {
  const parts: Part[] = [];
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i]!;
    if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      const stop = end < 0 ? fmt.length : end;
      parts.push({ text: fmt.slice(i + 1, stop) });
      i = stop + 1;
      continue;
    }
    if (ch === "\\" && i + 1 < fmt.length) {
      parts.push({ text: fmt[i + 1]! });
      i += 2;
      continue;
    }
    const token = TOKENS.find((t) => {
      const s = fmt.slice(i, i + t.length);
      // h/H (24- vs 12-hour) and AM/PM styles are case-sensitive; the rest are not.
      return /^[hH]|\//.test(t) ? s === t : s.toLowerCase() === t.toLowerCase();
    });
    if (token) {
      parts.push({
        token: /^[hH]|\//.test(token) ? token : token.toLowerCase(),
      });
      i += token.length;
    } else {
      parts.push({ text: ch });
      i++;
    }
  }
  return parts;
}

/**
 * Format with Excel-style tokens:
 * d dd ddd dddd do (1st) · m mm mmm mmmm · yy yyyy · jjj (day of year) · ww (ISO week) · q
 * h hh (12-hour with AM/PM, else 24-hour) · H HH (24-hour) · mm after h or before s = minutes
 * · ss · AM/PM am/pm A/P a/p · "literal text" or \x.
 */
export function formatDate(d: Date, fmt: string, locale?: string): string {
  const parts = tokenize(fmt);
  const twelve = parts.some((p) => "token" in p && p.token.includes("/"));
  const tokens = parts.flatMap((p, i) => ("token" in p ? [{ p, i }] : []));
  // m/mm means minutes right after an hour token or right before a seconds token (Excel).
  const minuteAt = new Set<number>();
  tokens.forEach(({ p, i }, k) => {
    if (!("token" in p) || (p.token !== "m" && p.token !== "mm")) return;
    const prev = tokens[k - 1]?.p;
    const next = tokens[k + 1]?.p;
    if (
      (prev && "token" in prev && /^[hH]{1,2}$/.test(prev.token)) ||
      (next && "token" in next && /^s{1,2}$/.test(next.token))
    )
      minuteAt.add(i);
  });
  const hours12 = d.getHours() % 12 || 12;
  const pm = d.getHours() >= 12;
  return parts
    .map((p, i) => {
      if ("text" in p) return p.text;
      switch (p.token) {
        case "yyyy":
          return String(d.getFullYear());
        case "yy":
          return pad(d.getFullYear() % 100);
        case "mmmm":
          return d.toLocaleString(locale, { month: "long" });
        case "mmm":
          return d.toLocaleString(locale, { month: "short" });
        case "mm":
          return minuteAt.has(i) ? pad(d.getMinutes()) : pad(d.getMonth() + 1);
        case "m":
          return minuteAt.has(i)
            ? String(d.getMinutes())
            : String(d.getMonth() + 1);
        case "dddd":
          return d.toLocaleString(locale, { weekday: "long" });
        case "ddd":
          return d.toLocaleString(locale, { weekday: "short" });
        case "dd":
          return pad(d.getDate());
        case "do":
          return ordinal(d.getDate());
        case "d":
          return String(d.getDate());
        case "jjj":
          return pad(dayOfYear(d), 3);
        case "j":
          return String(dayOfYear(d));
        case "ww":
          return pad(isoWeek(d));
        case "q":
          return String(Math.floor(d.getMonth() / 3) + 1);
        case "HH":
          return pad(d.getHours());
        case "H":
          return String(d.getHours());
        case "hh":
          return pad(twelve ? hours12 : d.getHours());
        case "h":
          return String(twelve ? hours12 : d.getHours());
        case "ss":
          return pad(d.getSeconds());
        case "s":
          return String(d.getSeconds());
        case "AM/PM":
          return pm ? "PM" : "AM";
        case "am/pm":
          return pm ? "pm" : "am";
        case "A/P":
          return pm ? "P" : "A";
        case "a/p":
          return pm ? "p" : "a";
        default:
          return "";
      }
    })
    .join("");
}

/** Short local date, e.g. 12/10/2026 in Australia. */
export const defaultDate = (d: Date) =>
  d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
const defaultTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The text for a parsed date variable at `now`. */
export function renderDateVar(
  v: DateVar,
  now: Date,
  defaultDateFormat: (d: Date) => string = defaultDate,
): string {
  const d = shiftDate(now, v.sign, v.amount, v.unit);
  if (v.format) return formatDate(d, v.format);
  if (v.kind === "time") return defaultTime(d);
  if (v.kind === "datetime") return `${defaultDateFormat(d)} ${defaultTime(d)}`;
  return defaultDateFormat(d);
}

/** Ready-made variables for the "Insert variable" menu. */
export const VARIABLE_PRESETS: {
  group: string;
  items: { value: string; label: string }[];
}[] = [
  {
    group: "Today's date",
    items: [
      { value: "{today}", label: "Local short date" },
      { value: "{today:m/d/yy}", label: "m/d/yy" },
      { value: "{today:mm/dd/yy}", label: "mm/dd/yy" },
      { value: "{today:m/d/yyyy}", label: "m/d/yyyy" },
      { value: "{today:mm/dd/yyyy}", label: "mm/dd/yyyy" },
      { value: "{today:d/m/yy}", label: "d/m/yy" },
      { value: "{today:dd/mm/yyyy}", label: "dd/mm/yyyy" },
      { value: "{today:yyyy-mm-dd}", label: "yyyy-mm-dd (ISO)" },
      { value: "{today:mm.dd.yy}", label: "mm.dd.yy" },
      { value: "{today:yyyymmdd}", label: "yyyymmdd" },
      { value: "{today:mmm d, yyyy}", label: "mmm d, yyyy" },
      { value: "{today:mmmm d, yyyy}", label: "mmmm d, yyyy" },
      { value: "{today:d mmm yyyy}", label: "d mmm yyyy" },
      { value: "{today:ddd, mmm d}", label: "ddd, mmm d" },
      { value: "{today:dddd, mmmm do}", label: "dddd, mmmm do" },
      { value: "{today:mmm do}", label: "mmm do" },
      { value: "{today:mm/yy}", label: "mm/yy (month/year)" },
      { value: "{today:mmm yyyy}", label: "mmm yyyy" },
    ],
  },
  {
    group: "Dates from today",
    items: [
      { value: "{today+1:m/d/yy}", label: "Tomorrow" },
      { value: "{today+3:m/d/yy}", label: "In 3 days" },
      { value: "{today+7:m/d/yy}", label: "In 1 week" },
      { value: "{today+2w:m/d/yy}", label: "In 2 weeks" },
      { value: "{today+30:m/d/yy}", label: "In 30 days" },
      { value: "{today+1m:m/d/yy}", label: "In 1 month" },
      { value: "{today+3m:mm/yy}", label: "In 3 months (mm/yy)" },
      { value: "{today+6m:mmm yyyy}", label: "In 6 months" },
      { value: "{today+1y:m/d/yy}", label: "In 1 year" },
      { value: "{today-1:m/d/yy}", label: "Yesterday" },
    ],
  },
  {
    group: "Time",
    items: [
      { value: "{time}", label: "Local time" },
      { value: "{time:h:mm AM/PM}", label: "h:mm AM/PM" },
      { value: "{time:HH:mm}", label: "HH:mm (24-hour)" },
      { value: "{time:h:mm:ss AM/PM}", label: "h:mm:ss AM/PM" },
      { value: "{now:m/d/yy h:mm AM/PM}", label: "Date and time" },
      { value: "{time+2h:h:mm AM/PM}", label: "In 2 hours" },
    ],
  },
  {
    group: "Parts and codes",
    items: [
      { value: "{weekday}", label: "Weekday" },
      { value: "{month}", label: "Month name" },
      { value: "{day}", label: "Day of month" },
      { value: "{year}", label: "Year" },
      { value: '{today:"Q"q yyyy}', label: "Quarter" },
      { value: '{today:"Week "ww}', label: "ISO week number" },
      { value: "{julian}", label: "Day of year (jjj)" },
      { value: "{today:yyjjj}", label: "Julian date code (yyjjj)" },
    ],
  },
];
