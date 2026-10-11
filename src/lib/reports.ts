import { addDaysPK, todayPK } from "@/lib/format";

/** Quick date ranges offered above every report. */
export const PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "mtd", label: "This month" },
  { key: "lm", label: "Last month" },
  { key: "90d", label: "Last 3 months" },
  { key: "ytd", label: "This year" },
] as const;
export type PresetKey = (typeof PRESETS)[number]["key"];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function monthStart(ymd: string, offset = 0) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}
function dayBefore(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function presetRange(key: PresetKey): { from: string; to: string } {
  const today = todayPK();
  switch (key) {
    case "today": return { from: today, to: today };
    case "7d": return { from: addDaysPK(-6), to: today };
    case "30d": return { from: addDaysPK(-29), to: today };
    case "90d": return { from: addDaysPK(-89), to: today };
    case "mtd": return { from: monthStart(today), to: today };
    case "lm": return { from: monthStart(today, -1), to: dayBefore(monthStart(today)) };
    case "ytd": return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Reads ?range=… or ?from=…&to=… — falls back to "this month". Never trusts the input shape. */
export function parseRange(sp: { range?: string | string[]; from?: string | string[]; to?: string | string[] }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const from = one(sp.from), to = one(sp.to), range = one(sp.range);
  if (from && to && ISO.test(from) && ISO.test(to) && from <= to) return { from, to, preset: null as PresetKey | null };
  const preset = (PRESETS.find((p) => p.key === range)?.key ?? "mtd") as PresetKey;
  return { ...presetRange(preset), preset };
}

/** The same-length period just before a range — for "vs previous period". */
export function previousRange(from: string, to: string) {
  const f = Date.parse(from), t = Date.parse(to);
  const len = Math.round((t - f) / 86_400_000) + 1;
  const pf = new Date(f - len * 86_400_000).toISOString().slice(0, 10);
  return { from: pf, to: dayBefore(from) };
}

export type Grain = "day" | "week" | "month";

/** Axis/tooltip label for a series bucket. */
export function bucketLabel(bucket: string, grain: Grain, long = false) {
  const d = new Date(`${bucket}T00:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(d);
  if (grain === "month") return f({ month: "short", year: long ? "numeric" : "2-digit" });
  if (grain === "week") return long ? `Week of ${f({ day: "numeric", month: "short" })}` : f({ day: "numeric", month: "short" });
  return long ? f({ weekday: "short", day: "numeric", month: "short" }) : f({ day: "numeric", month: "short" });
}

type Range = { from: string; to: string; grain: Grain; days: number };
type Label = { label: string };

export type FinancialReport = {
  range: Range;
  billed: { gross: number; returns: number; net: number; discounts: number; bills: number; voided_bills: number;
    average_bill: number | null; average_per_visit: number | null; clinic: number; store: number };
  collected: { received: number; refunded: number; net: number; payments: number; written_off: number;
    by_method: { method: string; amount: number; count: number }[] };
  owed: { total: number; bills: number; customers: number; aging: (Label & { amount: number })[]; overdue_promises: number; credit_held: number };
  expenses: { total: number; by_category: (Label & { amount: number })[] };
  estimate: { stock_cost: number; wastage_cost: number; items_without_cost: number; gross_margin: number; profit: number } | null;
  series: { bucket: string; billed: number; collected: number; expenses: number }[];
  by_category: (Label & { kind: "service" | "product"; amount: number; lines: number })[];
  top_items: (Label & { kind: string; amount: number; qty: number })[];
  by_doctor: (Label & { amount: number; bills: number })[];
  by_species: (Label & { amount: number; bills: number })[];
  top_customers: (Label & { id: string; amount: number; bills: number })[];
  customer_value: { active_customers: number; average_yearly_spend: number | null; average_bills_per_year: number | null };
};

export type OperationsReport = {
  range: Range;
  visits: { total: number; completed: number; cancelled: number; urgent: number; pets: number; per_day: number;
    median_wait_min: number | null; median_visit_min: number | null };
  series: { bucket: string; visits: number }[];
  peak_hours: { dow: number; hour: number; visits: number }[];
  by_doctor: (Label & { visits: number; completed: number; median_visit_min: number | null })[];
  by_type: (Label & { visits: number })[];
  by_species: (Label & { pets: number })[];
  customers: { seen: number; new: number; returning: number; registered: number; lapsed: number; referrals: (Label & { customers: number })[] };
  appointments: { total: number; completed: number; no_show: number; cancelled: number; no_show_rate: number | null;
    cancel_rate: number | null; by_source: (Label & { appointments: number })[] };
  vaccinations: { doses: number; by_vaccine: (Label & { doses: number })[];
    due: { total: number; done: number; done_on_time: number; skipped: number; still_pending: number; completion_rate: number | null };
    overdue_now: number; overdue_pets: number };
  surgery: { total: number; completed: number; cancelled: number; emergency: number; by_procedure: (Label & { surgeries: number })[] };
  diagnostics: { total: number; resulted: number; by_category: (Label & { tests: number })[] };
  ward: { admissions: number; average_stay_days: number | null };
};

export type InventoryReport = {
  range: Range;
  top_used: { item_id: string; label: string; unit: string; used: number; cost: number | null; in_stock: number | null; days_left: number | null }[];
  losses: { wastage_qty: number; expired_qty: number; count_loss_qty: number; cost: number | null;
    items: { label: string; unit: string; qty: number; reason: string; cost: number | null }[] };
  stock_now: { tracked_items: number; out_of_stock: number; below_reorder: number; expired_on_shelf: number; expiring_60d: number;
    value: number | null; reorder: { item_id: string; label: string; unit: string; in_stock: number; reorder_level: number | null }[] };
  purchases: { total: number; count: number; by_supplier: (Label & { amount: number; purchases: number })[];
    price_changes: { label: string; unit: string; supplier: string; previous: number; latest: number; change_pct: number }[] } | null;
};

export type QualityCheck = { key: string; label: string; count: number; href: string; severity: "warning" | "info" };

/** Percent change, or null when there's no base to compare with. */
export function pctChange(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}
