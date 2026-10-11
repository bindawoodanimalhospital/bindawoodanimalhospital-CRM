import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { Pagination } from "@/components/app/pagination";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPKR, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewBillButton } from "./new-bill";

export const metadata: Metadata = { title: "Billing" };
const PAGE = 30;
const VIEWS = [{ key: "today", label: "Today" }, { key: "unpaid", label: "Unpaid" }, { key: "drafts", label: "Drafts" }, { key: "all", label: "All" }] as const;

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const me = await requireStaff("billing.view");
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp.view) ? (sp.view as string) : "today";
  const page = Math.max(1, Number(sp.page) || 1);
  const today = todayPK();
  const supabase = await createClient();

  let q = supabase.from("invoices")
    .select("id, number, kind, status, total, amount_paid, balance, issued_at, created_at, customers(full_name), pets(name)", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (view === "today") q = q.gte("created_at", `${today}T00:00:00+05:00`);
  if (view === "unpaid") q = q.eq("status", "issued").gt("balance", 0);
  if (view === "drafts") q = q.eq("status", "draft");

  const [{ data, count }, { data: todayPays }] = await Promise.all([
    q,
    me.can("finance.view") || me.can("billing.create")
      ? supabase.from("payments").select("kind, amount, method").gte("received_at", `${today}T00:00:00+05:00`)
      : Promise.resolve({ data: [] as { kind: string; amount: number; method: string }[] }),
  ]);
  const collected = (todayPays ?? []).reduce((s, p) => s + (p.kind === "payment" ? Number(p.amount) : p.kind === "refund" ? -Number(p.amount) : 0), 0);
  const cash = (todayPays ?? []).reduce((s, p) => s + (p.method === "cash" ? (p.kind === "refund" ? -1 : p.kind === "payment" ? 1 : 0) * Number(p.amount) : 0), 0);

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      <PageHeader title="Billing" description="Clinic bills and pet store sales." actions={me.can("billing.create") && <NewBillButton />} />
      {(me.can("finance.view") || me.can("billing.create")) && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Collected today" value={formatPKR(collected)} />
          <Stat label="Cash in drawer (today)" value={formatPKR(cash)} hint="Cash received − cash refunds" />
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`?view=${v.key}`} className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ring-1",
            view === v.key ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>{v.label}</Link>
        ))}
      </div>
      {!data?.length ? <EmptyState icon={Receipt} title="No bills here" description="Bills are started from a visit (“Bill this visit”) or with New bill." /> : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
          <Table>
            <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Customer</TableHead><TableHead className="hidden md:table-cell">When</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map((i) => (
                <TableRow key={i.id} className="relative">
                  <TableCell>
                    <Link href={`/billing/${i.id}`} className="font-semibold after:absolute after:inset-0">{i.number ?? "Draft"}</Link>
                    {i.kind === "store" && <StatusPill tone="info" className="ml-2">Store</StatusPill>}
                    {i.status === "void" && <StatusPill className="ml-2">Void</StatusPill>}
                  </TableCell>
                  <TableCell>{(i.customers as unknown as { full_name: string } | null)?.full_name ?? "Walk-in"}
                    {(i.pets as unknown as { name: string } | null)?.name && <span className="text-muted-foreground"> · {(i.pets as unknown as { name: string }).name}</span>}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{formatDateTime(i.issued_at ?? i.created_at)}</TableCell>
                  <TableCell className="text-right tabular">{formatPKR(i.total)}</TableCell>
                  <TableCell className="text-right">
                    {i.status === "issued" ? (Number(i.balance) > 0 ? <StatusPill tone="danger">{formatPKR(i.balance)}</StatusPill> : <StatusPill tone="success">Paid</StatusPill>)
                      : i.status === "draft" ? <StatusPill tone="warning">Draft</StatusPill> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={{ view }} />
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
