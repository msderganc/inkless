/**
 * Turn common plain-English requests into label text without AI: "every 1/4 inch from 1/4 to
 * 2", "bins A1 to D5", "box 1 of 12 to 12 of 12", "best by 6 months from today",
 * "red, green and blue". Returns null when unsure, so the caller can ask the AI instead.
 */

const AMT = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
const UNIT = String.raw`(inches|inch|in\.?|"|millimet(?:er|re)s?|mm|centimet(?:er|re)s?|cm|feet|foot|ft|'|kg|g|lbs?|oz|ml|l)?`;

const UNIT_OUT: Record<string, string> = {
  inches: '"',
  inch: '"',
  in: '"',
  "in.": '"',
  '"': '"',
  feet: "'",
  foot: "'",
  ft: "'",
  "'": "'",
};

function unitSuffix(u: string | undefined): string {
  if (!u) return "";
  const k = u.toLowerCase();
  if (UNIT_OUT[k]) return UNIT_OUT[k];
  if (k.startsWith("millimet")) return " mm";
  if (k.startsWith("centimet")) return " cm";
  return ` ${k}`;
}

/** "quarter" → 1/4, "thru" → to, en dashes → "-", tidy spaces. */
function normalise(s: string): string {
  return s
    .replace(/[–—]/g, "-")
    .replace(/\b(?:a\s+)?quarter(?:\s+inch)?\b/gi, (m) =>
      /inch/i.test(m) ? "1/4 inch" : "1/4",
    )
    .replace(/\b(?:a\s+)?half(?:\s+inch)?\b/gi, (m) =>
      /inch/i.test(m) ? "1/2 inch" : "1/2",
    )
    .replace(/\beighth\b/gi, "1/8")
    .replace(/\bsixteenth\b/gi, "1/16")
    .replace(/\b(?:thru|through|until|up to|till)\b/gi, "to")
    .replace(/\s+/g, " ")
    .trim();
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "bins" → "Bin", "boxes" → "Box": a label word before the range. */
function labelWord(pre: string): string {
  const w = pre
    .replace(
      /\b(?:labels?|for|make|print|me|please|numbered|from|every|each)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!w) return "";
  const single = w
    .replace(/ves$/i, "f") // shelves → shelf
    .replace(/ies$/i, "y") // batteries → battery
    .replace(/(x|ch|sh|ss)es$/i, "$1") // boxes → box
    .replace(/([^s])s$/i, "$1");
  return `${cap(single)} `;
}

const amount = (s: string) => s.trim().replace(/\s+/, " ");

type Result = { text: string; note: string };

const rangeRules: ((s: string) => Result | null)[] = [
  // every STEP [unit] from A [unit] to B [unit]
  (s) => {
    const m = new RegExp(
      String.raw`^(.*?)\b(?:every|each|by|in steps of|steps? of)\s+${AMT}\s*${UNIT}\s*(?:,\s*)?(?:from\s+)?${AMT}\s*${UNIT}\s*(?:to|-)\s*${AMT}\s*${UNIT}(.*)$`,
      "i",
    ).exec(s);
    if (!m) return null;
    const unit = unitSuffix(m[7] ?? m[5] ?? m[3]);
    return {
      text: `${labelWord(m[1]!)}{${amount(m[4]!)}-${amount(m[6]!)}:${amount(m[2]!)}}${unit}`,
      note: `From ${amount(m[4]!)} to ${amount(m[6]!)} in steps of ${amount(m[2]!)}.`,
    };
  },
  // from A to B every/by STEP [unit]
  (s) => {
    const m = new RegExp(
      String.raw`^(.*?)\b(?:from\s+)?${AMT}\s*${UNIT}\s*(?:to|-)\s*${AMT}\s*${UNIT}\s*,?\s*(?:every|each|by|in steps of|steps? of|step)\s+${AMT}\s*${UNIT}(.*)$`,
      "i",
    ).exec(s);
    if (!m) return null;
    const unit = unitSuffix(m[5] ?? m[7] ?? m[3]);
    return {
      text: `${labelWord(m[1]!)}{${amount(m[2]!)}-${amount(m[4]!)}:${amount(m[6]!)}}${unit}`,
      note: `From ${amount(m[2]!)} to ${amount(m[4]!)} in steps of ${amount(m[6]!)}.`,
    };
  },
  // box 1 of 12 to 12 of 12
  (s) => {
    const m =
      /^(.*?)\b(\d+)\s+of\s+(\d+)\s*(?:to|-)\s*(\d+)\s+of\s+(\d+)\s*$/i.exec(s);
    if (!m || m[3] !== m[5]) return null;
    return {
      text: `${labelWord(m[1]!)}{${m[2]}-${m[4]}} of ${m[5]}`,
      note: `${m[2]} of ${m[5]} through ${m[4]} of ${m[5]}.`,
    };
  },
  // bins A1 to D5
  (s) => {
    const m =
      /^(.*?)\b([A-Z]{1,2})(\d+)\s*(?:to|-)\s*([A-Z]{1,2})(\d+)\s*$/i.exec(s);
    // Same letters ("M3 to M10") is a sized series, not a grid: leave it to the AI.
    if (!m || m[2]!.toUpperCase() === m[4]!.toUpperCase()) return null;
    return {
      text: `${labelWord(m[1]!)}{${m[2]}-${m[4]}}{${m[3]}-${m[5]}}`,
      note: `Every combination from ${m[2]}${m[3]} to ${m[4]}${m[5]}.`,
    };
  },
  // roman numerals 1 to 12
  (s) => {
    const m =
      /^(.*?)\b(lower(?:case)?\s+)?roman(?:\s+numerals?)?\s+(?:from\s+)?(\d+)\s*(?:to|-)\s*(\d+)\s*$/i.exec(
        s,
      );
    if (!m) return null;
    return {
      text: `${labelWord(m[1]!)}{${m[3]}-${m[4]}:${m[2] ? "roman" : "ROMAN"}}`,
      note: "Roman numerals.",
    };
  },
  // letters A to Z
  (s) => {
    const m =
      /^(.*?)\b(?:letters?\s+)?(?:from\s+)?\b([A-Z]{1,2})\s*(?:to|-)\s*([A-Z]{1,2})\b\s*$/i.exec(
        s,
      );
    if (!m || !/[A-Z]/i.test(m[2]!) || /^\d/.test(m[2]!)) return null;
    return {
      text: `${labelWord(m[1]!)}{${m[2]}-${m[3]}}`,
      note: `Letters ${m[2]} to ${m[3]}.`,
    };
  },
  // [word] A to B [unit] (whole numbers, fractions, decimals; counts down if B < A)
  (s) => {
    const m = new RegExp(
      String.raw`^(.*?)\b(?:from\s+)?${AMT}\s*${UNIT}\s*(?:to|-|down to)\s*${AMT}\s*${UNIT}\s*$`,
      "i",
    ).exec(s);
    if (!m) return null;
    return {
      text: `${labelWord(m[1]!)}{${amount(m[2]!)}-${amount(m[4]!)}}${unitSuffix(m[5] ?? m[3])}`,
      note: `From ${amount(m[2]!)} to ${amount(m[4]!)}.`,
    };
  },
];

/** A date format the request names or shows by example ("mm/dd/yy", "like Mar 2027"). */
function dateFormat(s: string, unit?: string): string {
  const explicit =
    /\b(m{1,2}\/d{1,2}\/y{2,4}|d{1,2}\/m{1,2}\/y{2,4}|y{4}-m{2}-d{2}|m{1,4} d{1,2},? y{2,4}|m{1,4} y{2,4}|m{2}\/y{2})\b/i.exec(
      s,
    );
  if (explicit) return explicit[1]!.toLowerCase();
  if (/\biso\b/i.test(s)) return "yyyy-mm-dd";
  if (/\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b/.test(s)) return "mmm d, yyyy";
  if (/\b[A-Z][a-z]{3,} \d{4}\b/.test(s)) return "mmmm yyyy";
  if (/\b[A-Z][a-z]{2} \d{4}\b/.test(s)) return "mmm yyyy";
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(s)) return "yyyy-mm-dd";
  if (/\b\d{2}\/\d{2}\/\d{4}\b/.test(s)) return "mm/dd/yyyy";
  if (/\b\d{1,2}\/\d{1,2}\/\d{2}\b/.test(s)) return "m/d/yy";
  if (/\bmonth and year\b/i.test(s)) return "mmm yyyy";
  return unit && /^(m|y)$/.test(unit) ? "mmm yyyy" : "m/d/yy";
}

const DATE_UNITS: Record<string, string> = {
  day: "",
  days: "",
  week: "w",
  weeks: "w",
  month: "m",
  months: "m",
  year: "y",
  years: "y",
};

function dateRule(s: string): Result | null {
  const lead =
    /^(.*?)\b(best by|best before|use by|sell by|expires?|exp\.?|due|packed|made|opened|received|printed|date)?\s*(?:on\s+)?/i;
  const rel =
    /(\d+)\s*(days?|weeks?|months?|years?)\s*(?:from|after)\s*(?:today|now)/i.exec(
      s,
    );
  const word =
    /\b(today|tomorrow|yesterday|next week|next month|next year)\b/i.exec(s);
  if (!rel && !word) return null;
  const label = lead.exec(s)?.[2];
  let offset = "";
  let unit: string | undefined;
  if (rel) {
    unit = DATE_UNITS[rel[2]!.toLowerCase()];
    offset = `+${rel[1]}${unit ?? ""}`;
  } else {
    const w = word![1]!.toLowerCase();
    offset =
      w === "tomorrow"
        ? "+1"
        : w === "yesterday"
          ? "-1"
          : w === "next week"
            ? "+1w"
            : w === "next month"
              ? "+1m"
              : w === "next year"
                ? "+1y"
                : "";
    unit = offset.slice(-1);
  }
  const fmt = dateFormat(s, unit);
  const prefix = label ? `${cap(label.toLowerCase())} ` : "";
  return {
    text: `${prefix}{today${offset}:${fmt}}`,
    note: `${offset ? `Today ${offset}` : "Today's date"}, shown as ${fmt}. It updates every time you print.`,
  };
}

/** "red, green and blue" / "small or large" → {Red|Green|Blue}. */
function listRule(s: string): Result | null {
  const parts = s
    .split(/\s*,\s*|\s+(?:and|or|&)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (
    parts.length < 2 ||
    parts.some(
      (p) => p.length > 30 || p.split(" ").length > 3 || /[{}|]/.test(p),
    )
  )
    return null;
  if (!/,|\b(and|or)\b|&/i.test(s)) return null;
  return {
    text: `{${parts.map(cap).join("|")}}`,
    note: `One label for each: ${parts.map(cap).join(", ")}.`,
  };
}

/**
 * Best local interpretation, or null. `check` validates the result with the app's parser so
 * nothing unusable is offered.
 */
export function describeLocally(
  description: string,
  check: (text: string) => string | undefined,
): Result | null {
  const s = normalise(description);
  if (!s) return null;
  const isDate =
    /\b(today|tomorrow|yesterday|next (week|month|year)|from (today|now)|after (today|now))\b/i.test(
      s,
    );
  const rules = isDate ? [dateRule] : [...rangeRules, listRule];
  for (const rule of rules) {
    const r = rule(s);
    if (r && !check(r.text)) return r;
  }
  return null;
}
