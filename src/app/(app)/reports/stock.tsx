import Link from "next/link";
import { AlertTriangle, CircleCheck, Info } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { StatusPill } from "@/components/app/page-header";
import { formatPKR } from "@/lib/format";
import type { InventoryReport, QualityCheck } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { Panel, StatTile } from "./parts";

const qty = (n: number | null, unit?: string) => (n == null ? "—" : `${Number(n).toLocaleString("en-PK")}${unit ? ` ${unit}` : ""}`);

export function StockReport({ r }: { r: InventoryReport }) {
  const s = r.stock_now, seeCost = s.value != null;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile hero label="Stock value (at cost)" value={s.value} money
          explain={seeCost ? "Usable stock on the shelves, at purchase cost. Expired stock is not counted." : "Needs permission to see purchase costs."} />
        <StatTile label="Out of stock" value={s.out_of_stock} tone={s.out_of_stock ? "danger" : undefined} explain={`Of ${s.tracked_items} tracked items`} />
        <StatTile label="Running low" value={s.below_reorder} tone={s.below_reorder ? "warning" : undefined} explain="At or below the reorder level" />
        <StatTile label="Expiring in 60 days" value={s.expiring_60d} tone={s.expiring_60d ? "warning" : undefined}
          explain={`${s.expired_on_shelf} item(s) also have expired stock to remove`} />
      </div>

      <Panel title="Most used medicines & products" note="Sold, dispensed or used in surgery, in this period · days left = at this rate of use">
        {r.top_used.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing used in this period</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2 font-medium">Item</th><th className="py-2 text-right font-medium">Used</th>
                  {seeCost && <th className="py-2 text-right font-medium">Cost</th>}
                  <th className="py-2 text-right font-medium">In stock</th><th className="py-2 text-right font-medium">Days left</th></tr>
              </thead>
              <tbody>
                {r.top_used.map((i) => (
                  <tr key={i.item_id} className="border-t">
                    <td className="py-2 font-medium">{i.label}</td>
                    <td className="py-2 text-right tabular">{qty(i.used, i.unit)}</td>
                    {seeCost && <td className="py-2 text-right tabular">{i.cost == null ? "—" : formatPKR(i.cost)}</td>}
                    <td className="py-2 text-right tabular">{qty(i.in_stock)}</td>
                    <td className="py-2 text-right">
                      {i.days_left == null ? "—" : <StatusPill tone={i.days_left <= 7 ? "danger" : i.days_left <= 21 ? "warning" : "neutral"}>{i.days_left} days</StatusPill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Reorder list" note="Out of stock or at the reorder level" action={<Link href="/inventory" className="text-sm font-semibold text-brand hover:underline">Open inventory</Link>}>
          {s.reorder.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing to reorder</p> : (
            <ul className="divide-y text-sm">
              {s.reorder.map((i) => (
                <li key={i.item_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate font-medium">{i.label}</span>
                  <span className="shrink-0 text-muted-foreground tabular">
                    <b className={cn(i.in_stock <= 0 ? "text-danger" : "text-warning")}>{qty(i.in_stock, i.unit)}</b>
                    {i.reorder_level != null && ` / reorder at ${qty(i.reorder_level)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Wastage & losses" note={`Wasted ${qty(r.losses.wastage_qty)} · expired ${qty(r.losses.expired_qty)} · stock-count losses ${qty(r.losses.count_loss_qty)}${r.losses.cost != null ? ` · cost ${formatPKR(r.losses.cost)}` : ""}`}>
          <BarList items={r.losses.items.map((i) => ({ label: i.label, value: i.qty, sub: i.reason.replaceAll("_", " ") }))} empty="No wastage recorded — well done" />
        </Panel>
        {r.purchases && (
          <>
            <Panel title="Purchases by supplier" note={`${r.purchases.count} deliveries received · ${formatPKR(r.purchases.total)}`}>
              <BarList money items={r.purchases.by_supplier.map((p) => ({ label: p.label, value: p.amount, sub: `${p.purchases}×` }))} empty="No purchases received" />
            </Panel>
            <Panel title="Supplier price changes" note="Latest purchase price vs the one before, for deliveries in this period">
              {r.purchases.price_changes.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No price changes</p> : (
                <ul className="divide-y text-sm">
                  {r.purchases.price_changes.map((p) => (
                    <li key={p.label + p.supplier} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0"><span className="block truncate font-medium">{p.label}</span><span className="text-xs text-muted-foreground">{p.supplier}</span></span>
                      <span className="shrink-0 text-right tabular">
                        <span className="text-muted-foreground">{formatPKR(p.previous)} → </span><b>{formatPKR(p.latest)}</b>
                        <StatusPill tone={p.change_pct > 0 ? "danger" : "success"} className="ml-2">{p.change_pct > 0 ? "+" : ""}{p.change_pct}%</StatusPill>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

export function QualityReport({ checks }: { checks: QualityCheck[] }) {
  const open = checks.filter((c) => c.count > 0);
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">Reports are only as good as the records behind them. These are small things to tidy up — none of them block work.</p>
      {open.length === 0 && (
        <div className="flex items-center gap-3 rounded-2xl bg-success-soft p-5 text-success"><CircleCheck className="size-6" /> <b>Everything looks tidy.</b></div>
      )}
      <ul className="grid gap-2">
        {checks.map((c) => (
          <li key={c.key}>
            <Link href={c.href} className={cn("flex items-center gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border transition hover:ring-brand-muted", c.count === 0 && "opacity-60")}>
              {c.count === 0 ? <CircleCheck className="size-5 shrink-0 text-success" />
                : c.severity === "warning" ? <AlertTriangle className="size-5 shrink-0 text-warning" /> : <Info className="size-5 shrink-0 text-info" />}
              <span className="flex-1 text-sm">{c.label}</span>
              <span className={cn("text-xl font-bold tabular", c.count === 0 ? "text-muted-foreground" : c.severity === "warning" ? "text-warning" : "text-foreground")}>{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
