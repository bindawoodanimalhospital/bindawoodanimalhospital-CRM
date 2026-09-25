import Link from "next/link";
import { cn } from "@/lib/utils";

export type BarItem = { label: string; value: number; sub?: string; href?: string };

const full = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/**
 * Ranked horizontal bars: one series, one colour, value printed at the tip (so nothing relies on
 * colour or hover). Anything past `limit` folds into "Other" rather than getting a new colour.
 */
export function BarList({ items, money = false, limit = 8, empty = "Nothing in this period", unit, className }: {
  items: BarItem[]; money?: boolean; limit?: number; empty?: string; unit?: string; className?: string;
}) {
  const rows = items.filter((i) => i.value !== 0);
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit);
  if (rest.length) shown.push({ label: `Other (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0) });
  const max = Math.max(...shown.map((r) => Math.abs(r.value)));
  const fmt = (n: number) => (money ? `Rs. ${full.format(n)}` : `${full.format(n)}${unit ? ` ${unit}` : ""}`);
  return (
    <ul className={cn("grid gap-2.5", className)}>
      {shown.map((r) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.label}{r.sub && <span className="ml-1.5 text-xs text-muted-foreground">{r.sub}</span>}</span>
              <span className="shrink-0 font-semibold tabular">{fmt(r.value)}</span>
            </div>
            <div className="mt-1 h-2.5 w-full" aria-hidden>
              <div className="h-full rounded-r-[4px] bg-[var(--viz-1)] transition-[filter] group-hover:brightness-110"
                style={{ width: `${Math.max(1.5, (Math.abs(r.value) / max) * 100)}%` }} />
            </div>
          </>
        );
        return (
          <li key={r.label} title={`${r.label}: ${fmt(r.value)}`}>
            {r.href
              ? <Link href={r.href} className="group -mx-2 block rounded-lg px-2 py-1 hover:bg-muted/60">{body}</Link>
              : <div className="group -mx-2 rounded-lg px-2 py-1 hover:bg-muted/60">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** Share-of-whole meter (e.g. vaccination completion). The track is a light step of the same hue. */
export function Meter({ value, label, className }: { value: number | null; label: string; className?: string }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-lg font-bold tabular">{v == null ? "—" : `${v}%`}</span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-[var(--heat-1)]" role="meter" aria-valuenow={v ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${v ?? 0}%` }} />
      </div>
    </div>
  );
}
