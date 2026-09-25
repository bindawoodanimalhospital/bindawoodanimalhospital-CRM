import { BarList } from "@/components/charts/bar-list";
import { TrendChart } from "@/components/charts/trend-chart";
import { formatPKR } from "@/lib/format";
import { bucketLabel, pctChange, type FinancialReport } from "@/lib/reports";
import { Note, Panel, StatTile } from "./parts";

export function MoneyReport({ r, prev }: { r: FinancialReport; prev: FinancialReport | null }) {
  const g = r.range.grain;
  const e = r.estimate;
  const points = r.series.map((s) => ({ label: bucketLabel(s.bucket, g), longLabel: bucketLabel(s.bucket, g, true), values: [s.billed, s.collected] }));
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile hero label="Billed" value={r.billed.net} money delta={prev ? pctChange(r.billed.net, prev.billed.net) : null}
          explain={`Bills issued in this period (${r.billed.bills}), minus Rs. ${Math.round(r.billed.returns).toLocaleString("en-PK")} of returns. Not the same as cash received.`} />
        <StatTile label="Collected" value={r.collected.net} money delta={prev ? pctChange(r.collected.net, prev.collected.net) : null}
          explain={`Cash, card & wallet actually received (${r.collected.payments} payments), minus refunds. Includes old bills paid now.`} />
        <StatTile label="Owed to the clinic (today)" value={r.owed.total} money tone={r.owed.total > 0 ? "danger" : undefined} upIsGood={false}
          explain={`Still unpaid right now on ${r.owed.bills} bill(s) from ${r.owed.customers} owner(s) — all dates, not just this period.`} />
        <StatTile label="Estimated profit" value={e?.profit ?? null} money tone="brand"
          explain={e ? "Billed − medicine/stock cost − wastage − expenses. An estimate: only items with a known purchase cost are counted."
                     : "Needs permission to see purchase costs."} />
      </div>

      <Panel title="Billed vs collected" note={`${g === "day" ? "Per day" : g === "week" ? "Per week (Mon–Sun)" : "Per month"} · Pakistan time`}>
        <TrendChart money series={[{ name: "Billed", color: "var(--viz-1)" }, { name: "Collected", color: "var(--viz-2)" }]} points={points} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Where the money came from" note="Billed, by price-list category · before bill-level discounts">
          <BarList money items={r.by_category.map((c) => ({ label: c.label, value: c.amount, sub: c.kind === "service" ? "service" : "product" }))} />
          {r.billed.discounts > 0 && <p className="mt-3 text-xs text-muted-foreground">Discounts given in this period: <b className="text-foreground">{formatPKR(r.billed.discounts)}</b></p>}
        </Panel>
        <Panel title="Top items & services" note="Billed amount">
          <BarList money limit={10} items={r.top_items.map((c) => ({ label: c.label, value: c.amount, sub: `× ${Number(c.qty).toLocaleString("en-PK")}` }))} />
        </Panel>
        <Panel title="By doctor" note="Billed on visits, surgeries and ward stays each doctor handled">
          <BarList money items={r.by_doctor.map((c) => ({ label: c.label, value: c.amount, sub: `${c.bills} bills` }))} />
        </Panel>
        <Panel title="By species" note="Billed">
          <BarList money items={r.by_species.map((c) => ({ label: c.label, value: c.amount, sub: `${c.bills} bills` }))} />
        </Panel>
        <Panel title="How owners paid" note="Payments received, by method">
          <BarList money items={r.collected.by_method.map((m) => ({ label: m.method, value: m.amount, sub: `${m.count}×` }))} />
          {(r.collected.refunded > 0 || r.collected.written_off > 0) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Refunded: <b className="text-foreground">{formatPKR(r.collected.refunded)}</b> · Written off (not cash): <b className="text-foreground">{formatPKR(r.collected.written_off)}</b>
            </p>
          )}
        </Panel>
        <Panel title="Unpaid bills by age" note="Snapshot today — how long bills have been waiting">
          <BarList money items={r.owed.aging.map((a) => ({ label: a.label, value: a.amount }))} empty="Nothing owed — every bill is paid." />
          <p className="mt-3 text-xs text-muted-foreground">
            {r.owed.overdue_promises} owner(s) have missed their promised payment date.
            {r.owed.credit_held > 0 && <> Advance/credit held for owners: <b className="text-foreground">{formatPKR(r.owed.credit_held)}</b>.</>}
          </p>
        </Panel>
        <Panel title="Expenses" note={`Total ${formatPKR(r.expenses.total)} in this period`}>
          <BarList money items={r.expenses.by_category.map((c) => ({ label: c.label, value: c.amount }))} empty="No expenses recorded" />
        </Panel>
        {e && (
          <Panel title="Profit estimate, step by step" note="How the estimated profit is worked out">
            <dl className="grid gap-2 text-sm">
              {[
                ["Billed (after returns)", r.billed.net, false],
                ["− Medicines & stock used (at purchase cost)", e.stock_cost, true],
                ["= Gross margin", e.gross_margin, false],
                ["− Wastage, expired & count losses", e.wastage_cost, true],
                ["− Expenses", r.expenses.total, true],
              ].map(([l, v, minus]) => (
                <div key={l as string} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{l as string}</dt>
                  <dd className="font-semibold tabular">{minus ? "−" : ""}{formatPKR(v as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t pt-2 text-base">
                <dt className="font-semibold">= Estimated profit</dt><dd className="font-bold text-brand tabular">{formatPKR(e.profit)}</dd>
              </div>
            </dl>
            {e.items_without_cost > 0 && <div className="mt-3"><Note>{e.items_without_cost} item(s) used in this period have no purchase cost, so their cost is left out — the real profit is a little lower.</Note></div>}
          </Panel>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Top owners" note="Billed in this period">
          <BarList money limit={10} items={r.top_customers.map((c) => ({ label: c.label, value: c.amount, sub: `${c.bills} bills`, href: `/customers/${c.id}` }))} />
        </Panel>
        <Panel title="Averages" note="Useful for pricing and planning">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-muted-foreground">Average bill</dt><dd className="text-xl font-bold">{r.billed.average_bill == null ? "—" : formatPKR(r.billed.average_bill)}</dd></div>
            <div><dt className="text-muted-foreground">Average per visit</dt><dd className="text-xl font-bold">{r.billed.average_per_visit == null ? "—" : formatPKR(r.billed.average_per_visit)}</dd></div>
            <div><dt className="text-muted-foreground">Clinic / pet store</dt><dd className="font-semibold">{formatPKR(r.billed.clinic)} / {formatPKR(r.billed.store)}</dd></div>
            <div><dt className="text-muted-foreground">Cancelled bills</dt><dd className="font-semibold">{r.billed.voided_bills}</dd></div>
            <div className="col-span-2 rounded-xl bg-brand-wash p-3 ring-1 ring-brand-muted">
              <dt className="text-muted-foreground">Average yearly spend per owner (last 12 months, estimate)</dt>
              <dd className="text-xl font-bold">{r.customer_value.average_yearly_spend == null ? "—" : formatPKR(r.customer_value.average_yearly_spend)}</dd>
              <dd className="text-xs text-muted-foreground">{r.customer_value.active_customers} paying owners · about {r.customer_value.average_bills_per_year ?? 0} bills each a year</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
