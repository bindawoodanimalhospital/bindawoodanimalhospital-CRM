/*
 * Product sizes: the same product in several weights (Petline Kitten 400 g / 1.5 kg).
 * Each size is its own price-list item; product_families links them (migration 037).
 */

const UNIT: Record<string, [label: string, factor: number]> = {
  kg: ["kg", 1000], kgs: ["kg", 1000], g: ["g", 1], gm: ["g", 1], gms: ["g", 1], gram: ["g", 1], grams: ["g", 1],
  ml: ["ml", 1], l: ["L", 1000], ltr: ["L", 1000], litre: ["L", 1000], liter: ["L", 1000], lb: ["lb", 453.6], lbs: ["lb", 453.6],
};
// "25-40kg" (a dog-weight band on spot-ons) or a single size like "1.5 kg", "330g", "10L"
const SIZE = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(kgs?|g|gms?|grams?|ml|l|ltr|litre|liter|lbs?)(?![a-z])/i;

export type ParsedSize = { label: string; grams: number; base: string };

/** "Petline Kitten Junior 1.5kg" → { label: "1.5 kg", grams: 1500, base: "Petline Kitten Junior" } */
export function parseSize(name: string): ParsedSize | null {
  const m = SIZE.exec(name);
  if (!m) return null;
  const [label, factor] = UNIT[m[3].toLowerCase()] ?? [m[3], 1];
  const low = Number(m[1]);
  const high = m[2] ? Number(m[2]) : null;
  const base = (name.slice(0, m.index) + " " + name.slice(m.index + m[0].length))
    .replace(/[()[\]]/g, " ").replace(/\s*[/,&-]\s*$/, "").replace(/\s+/g, " ").trim();
  return { label: high != null ? `${low}–${high} ${label}` : `${low} ${label}`, grams: (high ?? low) * factor, base };
}

/** Key used to spot items that are probably sizes of the same product. */
function baseKey(base: string) {
  return base.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export type SizeCandidate = { id: string; name: string; sale_price: number; family_id: string | null };
export type SizeSuggestion = { name: string; items: (SizeCandidate & { size_label: string; grams: number })[] };

/**
 * Products whose names differ only by size ("… 400g" / "… 1.5kg") and aren't grouped yet.
 * Exact duplicates (same name and size) are left out — those are a typo to fix, not a size.
 */
export function suggestSizeGroups(items: SizeCandidate[]): SizeSuggestion[] {
  const groups = new Map<string, SizeSuggestion>();
  for (const it of items) {
    if (it.family_id) continue;
    const p = parseSize(it.name);
    if (!p || p.base.length < 3) continue;
    const key = baseKey(p.base);
    const g = groups.get(key) ?? { name: p.base, items: [] };
    if (!g.items.some((x) => x.size_label === p.label)) g.items.push({ ...it, size_label: p.label, grams: p.grams });
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.items.length > 1)
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.grams - b.grams) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Sort helper: smallest size first, items without a size last. */
export function bySize<T extends { size_grams?: number | null; name: string }>(a: T, b: T) {
  return (a.size_grams ?? Infinity) - (b.size_grams ?? Infinity) || a.name.localeCompare(b.name);
}
