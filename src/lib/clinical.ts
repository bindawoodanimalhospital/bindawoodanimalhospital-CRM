/** Pure helpers for clinical display: units, lab ranges and flags, prescription frequencies. Used on server and client. */

/** °C → °F, one decimal. */
export function cToF(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}

/** °F → °C, one decimal. */
export function fToC(f: number): number {
  return Math.round(((f - 32) * 5 / 9) * 10) / 10;
}

/** "38.9 °C (102.0 °F)" */
export function formatTemp(c: number | string | null | undefined): string {
  if (c == null || c === "") return "";
  const n = Number(c);
  return `${n.toFixed(1)} °C (${cToF(n).toFixed(1)} °F)`;
}

/** "4.1 kg (9.04 lb)" */
export function formatWeight(kg: number | string | null | undefined): string {
  if (kg == null || kg === "") return "";
  const n = Number(kg);
  return `${n} kg (${(Math.round(n * 2.20462 * 100) / 100).toFixed(2)} lb)`;
}

export type Range = { lo: number | null; hi: number | null };

/**
 * Reads a reference range as labs print it: "5.5-19.5", "5.5 – 19.5", "< 0.4", "≤ 0.1", "> 2", "up to 7".
 * Returns null when there is nothing to compare against (blank, "NIL", text).
 */
export function parseRange(text: string | null | undefined): Range | null {
  const t = (text ?? "").trim().replace(/,/g, "");
  if (!t) return null;
  const num = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
  let m = t.match(new RegExp(String.raw`^${num}\s*(?:-|–|—|to)\s*${num}$`, "i"));
  if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  m = t.match(new RegExp(String.raw`^(?:<|≤|<=|up to|upto|max\.?)\s*${num}$`, "i"));
  if (m) return { lo: null, hi: Number(m[1]) };
  m = t.match(new RegExp(String.raw`^(?:>|≥|>=|min\.?)\s*${num}$`, "i"));
  if (m) return { lo: Number(m[1]), hi: null };
  return null;
}

/** "H" above the range, "L" below it, null inside it or when either side can't be read as a number. */
export function flagResult(value: string | null | undefined, range: string | null | undefined): "H" | "L" | null {
  const r = parseRange(range);
  const v = (value ?? "").trim().replace(/,/g, "");
  if (!r || !/^-?(\d+(\.\d+)?|\.\d+)$/.test(v)) return null;
  const n = Number(v);
  if (r.hi != null && n > r.hi) return "H";
  if (r.lo != null && n < r.lo) return "L";
  return null;
}

/** The range to suggest for a test value: the one for this species, if the test type has one. */
export function defaultRange(field: { ranges?: Record<string, string> }, species: string | null | undefined): string {
  if (!field.ranges || !species) return "";
  const hit = Object.entries(field.ranges).find(([k]) => k.toLowerCase() === species.toLowerCase());
  return hit?.[1] ?? "";
}

const FREQUENCY_WORDS: Record<string, string> = {
  od: "once a day", sid: "once a day", qd: "once a day",
  bd: "twice a day", bid: "twice a day",
  tds: "three times a day", tid: "three times a day",
  qds: "four times a day", qid: "four times a day",
  eod: "every other day", qod: "every other day",
  hs: "at bedtime", stat: "immediately, once",
  sos: "when needed", prn: "when needed",
  q4h: "every 4 hours", q6h: "every 6 hours", q8h: "every 8 hours", q12h: "every 12 hours", q24h: "every 24 hours",
};

/** "BD" → "BD (twice a day)". Anything already in words is left as written. */
export function spellFrequency(freq: string | null | undefined): string {
  const t = (freq ?? "").trim();
  const words = FREQUENCY_WORDS[t.toLowerCase().replace(/[\s.]/g, "")];
  return words ? `${t} (${words})` : t;
}
