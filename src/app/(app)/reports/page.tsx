import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { parseRange, previousRange, type FinancialReport, type InventoryReport, type OperationsReport, type QualityCheck } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { ClinicReport } from "./clinic";
import { MoneyReport } from "./money";
import { ExportMenu, RangeBar, type ExportOption } from "./parts";
import { QualityReport, StockReport } from "./stock";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const me = await requireStaff();
  const sp = await searchParams;
  const money = me.can("reports.financial");
  const clinic = money || me.can("reports.view");
  const stock = money || me.can("inventory.view");
  if (!clinic && !stock) redirect("/dashboard?denied=1");

  const tabs = [
    money && { key: "money", label: "Money" },
    clinic && { key: "clinic", label: "Clinic activity" },
    stock && { key: "stock", label: "Medicines & stock" },
    clinic && { key: "checks", label: "Data checks" },
  ].filter(Boolean) as { key: string; label: string }[];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key;
  const { from, to, preset } = parseRange(sp);
  const prev = previousRange(from, to);
  const supabase = await createClient();

  let body: React.ReactNode = null;
  let error: string | null = null;
  if (tab === "money") {
    const [cur, before] = await Promise.all([
      supabase.rpc("report_financial", { p_from: from, p_to: to }),
      supabase.rpc("report_financial", { p_from: prev.from, p_to: prev.to }),
    ]);
    if (cur.error) error = cur.error.message;
    else body = <MoneyReport r={cur.data as FinancialReport} prev={(before.data as FinancialReport | null) ?? null} />;
  } else if (tab === "clinic") {
    const [cur, before] = await Promise.all([
      supabase.rpc("report_operations", { p_from: from, p_to: to }),
      supabase.rpc("report_operations", { p_from: prev.from, p_to: prev.to }),
    ]);
    if (cur.error) error = cur.error.message;
    else body = <ClinicReport r={cur.data as OperationsReport} prev={(before.data as OperationsReport | null) ?? null} />;
  } else if (tab === "stock") {
    const { data, error: e } = await supabase.rpc("report_inventory", { p_from: from, p_to: to });
    if (e) error = e.message;
    else body = <StockReport r={data as InventoryReport} />;
  } else {
    const { data, error: e } = await supabase.rpc("report_data_quality");
    if (e) error = e.message;
    else body = <QualityReport checks={data as QualityCheck[]} />;
  }

  const exports: ExportOption[] = me.can("data.export") ? ([
    money && { dataset: "summary", label: "Daily money summary" },
    me.can("billing.view") && { dataset: "invoices", label: "Bills" },
    me.can("billing.view") && { dataset: "payments", label: "Payments received" },
    me.can("billing.view") && { dataset: "dues", label: "Unpaid bills (today)" },
    me.can("expenses.view") && { dataset: "expenses", label: "Expenses" },
    me.can("queue.manage") || me.can("clinical.view") ? { dataset: "visits", label: "Visits" } : null,
    me.can("customers.view") && { dataset: "customers", label: "Pet owners (contact list)" },
    me.can("inventory.view") && { dataset: "stock", label: "Stock levels (today)" },
  ].filter(Boolean) as ExportOption[]) : [];

  return (
    <>
      <PageHeader title="Reports" description={tab === "checks" ? "Records to tidy up" : `${formatDate(from)} – ${formatDate(to)}`}
        actions={<ExportMenu options={exports} from={from} to={to} />} />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t.key} href={`?tab=${t.key}${preset ? `&range=${preset}` : `&from=${from}&to=${to}`}`}
            className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ring-1",
              tab === t.key ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>{t.label}</Link>
        ))}
      </div>
      {tab !== "checks" && <RangeBar tab={tab} preset={preset} from={from} to={to} />}
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : body}
    </>
  );
}
