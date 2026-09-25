import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { customerCredit, paymentMethods } from "@/lib/billing";
import { formatDate, formatDateTime, formatPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewBillButton } from "../../../billing/new-bill";
import { PayBalance } from "./pay-balance";

export const metadata: Metadata = { title: "Customer account" };

function withRunningBalance<T extends { debit: number; credit: number }>(entries: T[]) {
  const out: (T & { running: number })[] = [];
  let running = 0;
  for (const e of entries) {
    running = Math.round((running + Number(e.debit) - Number(e.credit)) * 100) / 100;
    out.push({ ...e, running });
  }
  return out;
}

const ENTRY: Record<string, string> = { invoice: "Bill", payment: "Payment", refund: "Refund", write_off: "Written off", return: "Return" };

export default async function AccountPage({ params }: PageProps<"/customers/[id]/account">) {
  const me = await requireStaff("billing.view");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: c }, { data: ledger }, { data: open }, credit, methods] = await Promise.all([
    supabase.from("customers").select("id, full_name, phone").eq("id", id).maybeSingle(),
    supabase.from("customer_ledger").select("*").eq("customer_id", id).order("at"),
    supabase.from("invoices").select("id, number, total, balance, issued_at, pets(name), dues(promised_date, status)").eq("customer_id", id).eq("status", "issued").gt("balance", 0).order("issued_at"),
    customerCredit(id),
    paymentMethods(),
  ]);
  if (!c) notFound();
  const rows = withRunningBalance(ledger ?? []);
  const balance = rows.at(-1)?.running ?? 0;

  return (
    <>
      <PageHeader back={{ href: `/customers/${id}`, label: c.full_name }} title={`${c.full_name} — account`}
        description={balance > 0 ? `Owes ${formatPKR(balance)}` : balance < 0 ? `Clinic holds ${formatPKR(-balance)} advance` : "Nothing owed"}
        actions={<>
          <Button asChild variant="outline"><Link href={`/print/statement/${id}`} target="_blank"><Printer /> Statement</Link></Button>
          {me.can("billing.create") && <NewBillButton customer={{ id }} label="New bill" />}
          {me.can("billing.create") && <PayBalance customerId={id} balance={Math.max(0, balance)} methods={methods.filter((m) => m.key !== "write_off")} />}
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className={cn("rounded-2xl p-4 ring-1", balance > 0 ? "bg-danger-soft ring-danger/30" : "bg-success-soft ring-success/30")}>
          <p className="text-sm text-muted-foreground">Balance</p><p className="text-2xl font-bold tabular">{formatPKR(Math.abs(balance))}</p>
          <p className="text-xs text-muted-foreground">{balance > 0 ? "to pay" : balance < 0 ? "advance held" : "all settled"}</p>
        </div>
        <div className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border"><p className="text-sm text-muted-foreground">Unpaid bills</p><p className="text-2xl font-bold tabular">{open?.length ?? 0}</p></div>
        <div className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border"><p className="text-sm text-muted-foreground">Unused advance</p><p className="text-2xl font-bold tabular">{formatPKR(credit)}</p></div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader><CardTitle>Account history</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Date</th><th>Entry</th><th className="text-right">Charged</th><th className="text-right">Paid / credit</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.entry}-${r.ref_id}`} className="border-t">
                    <td className="py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(r.at)}</td>
                    <td>{ENTRY[r.entry] ?? r.entry} {r.entry === "invoice" ? <Link href={`/billing/${r.ref_id}`} className="font-mono text-xs text-brand hover:underline">{r.ref}</Link> : <span className="font-mono text-xs text-muted-foreground">{r.ref}</span>}</td>
                    <td className="text-right tabular">{Number(r.debit) ? formatPKR(r.debit) : ""}</td>
                    <td className="text-right tabular text-success">{Number(r.credit) ? formatPKR(r.credit) : ""}</td>
                    <td className={cn("text-right font-semibold tabular", r.running > 0 && "text-danger")}>{formatPKR(r.running)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No bills or payments yet.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader><CardTitle>Unpaid bills</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {(open ?? []).map((i) => {
                const due = (Array.isArray(i.dues) ? i.dues[0] : i.dues) as { promised_date: string; status: string } | null;
                return (
                  <li key={i.id}><Link href={`/billing/${i.id}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border hover:ring-brand-muted">
                    <span className="font-mono text-xs">{i.number}</span>
                    <span className="text-muted-foreground">{formatDate(i.issued_at)}{(i.pets as unknown as { name: string } | null)?.name ? ` · ${(i.pets as unknown as { name: string }).name}` : ""}</span>
                    {due && <StatusPill tone="warning">promised {formatDate(due.promised_date)}</StatusPill>}
                    <span className="ml-auto font-bold text-danger tabular">{formatPKR(i.balance)}</span>
                  </Link></li>
                );
              })}
              {!open?.length && <li className="text-sm text-muted-foreground">Nothing unpaid.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
