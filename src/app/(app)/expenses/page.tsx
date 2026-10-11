import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { paymentMethods } from "@/lib/billing";
import { formatDate, formatPKR, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddExpenseDialog, ReceiptLink, ReverseButton } from "./widgets";

export const metadata: Metadata = { title: "Expenses" };

const shiftMonth = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const me = await requireStaff("expenses.view");
  const { month: mq } = await searchParams;
  const month = typeof mq === "string" && /^\d{4}-\d{2}$/.test(mq) ? mq : todayPK().slice(0, 7);
  const supabase = await createClient();
  const [{ data: rows }, { data: cats }, methods, { data: staff }] = await Promise.all([
    supabase.from("expenses").select("id, spent_on, amount, method, payee, description, reference, reverses_id, created_by, expense_categories(name), documents(path)")
      .gte("spent_on", `${month}-01`).lt("spent_on", `${shiftMonth(month, 1)}-01`).order("spent_on", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("expense_categories").select("id, name").eq("is_active", true).order("sort_order"),
    paymentMethods(),
    supabase.from("staff").select("id, full_name"),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const reversed = new Set((rows ?? []).filter((r) => r.reverses_id).map((r) => r.reverses_id));
  const total = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const byCat = new Map<string, number>();
  for (const r of rows ?? []) { const c = (r.expense_categories as unknown as { name: string }).name; byCat.set(c, (byCat.get(c) ?? 0) + Number(r.amount)); }
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));

  return (
    <>
      <PageHeader title="Expenses" description="Running costs of the hospital. Visible only to finance staff."
        actions={me.can("expenses.manage") && <AddExpenseDialog categories={cats ?? []} methods={methods.filter((m) => m.key !== "write_off")} />} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="icon"><Link href={`?month=${shiftMonth(month, -1)}`} aria-label="Previous month"><ChevronLeft /></Link></Button>
        <span className="min-w-40 text-center text-lg font-semibold">{label}</span>
        <Button asChild variant="outline" size="icon"><Link href={`?month=${shiftMonth(month, 1)}`} aria-label="Next month"><ChevronRight /></Link></Button>
        <span className="ml-auto text-lg">Total <b className="tabular">{formatPKR(total)}</b></span>
      </div>
      {byCat.size > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {[...byCat].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
            <span key={c} className="rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-border">{c} <b className="tabular">{formatPKR(v)}</b></span>
          ))}
        </div>
      )}
      {!rows?.length ? <EmptyState icon={Wallet} title="No expenses this month" /> : (
        <ul className="grid gap-2">
          {rows.map((r) => {
            const doc = (r.documents as unknown as { path: string } | null)?.path;
            return (
              <li key={r.id} className={cn("flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-card ring-1 ring-border", (reversed.has(r.id) || r.reverses_id) && "opacity-60")}>
                <span className="w-24 text-sm text-muted-foreground">{formatDate(r.spent_on)}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-medium", reversed.has(r.id) && "line-through")}>{r.description}</span>
                  <span className="block text-xs text-muted-foreground">{(r.expense_categories as unknown as { name: string }).name}{r.payee ? ` · ${r.payee}` : ""}{r.reference ? ` · ${r.reference}` : ""} · {methods.find((m) => m.key === r.method)?.label}{r.created_by ? ` · by ${names.get(r.created_by) ?? ""}` : ""}</span>
                </span>
                {doc && <ReceiptLink path={doc} />}
                <span className={cn("font-bold tabular", Number(r.amount) < 0 && "text-success")}>{formatPKR(r.amount)}</span>
                {me.can("expenses.manage") && Number(r.amount) > 0 && !reversed.has(r.id) && <ReverseButton id={r.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
