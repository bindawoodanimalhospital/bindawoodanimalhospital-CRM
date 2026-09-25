import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { paymentMethods } from "@/lib/billing";
import { formatDate, formatPKR } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { PaySupplierDialog, StartPurchaseButton, SupplierDialog } from "../widgets";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const me = await requireStaff("suppliers.manage");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: s }, { data: purchases }, { data: pays }, methods] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", id).maybeSingle(),
    supabase.from("purchases").select("id, code, supplier_invoice_no, invoice_date, status, total, received_at, created_at").eq("supplier_id", id).order("created_at", { ascending: false }),
    supabase.from("supplier_payments").select("id, amount, method, paid_on, reference").eq("supplier_id", id).order("paid_on", { ascending: false }),
    paymentMethods(),
  ]);
  if (!s) notFound();
  const bought = (purchases ?? []).filter((p) => p.status === "received").reduce((x, p) => x + Number(p.total), 0);
  const paid = (pays ?? []).reduce((x, p) => x + Number(p.amount), 0);
  const seeMoney = me.can("finance.view");

  return (
    <>
      <PageHeader back={{ href: "/suppliers", label: "Suppliers" }} title={s.name}
        description={[s.contact_name, formatPhone(s.phone), s.address].filter(Boolean).join(" · ")}
        actions={<>
          <SupplierDialog supplier={s} trigger={<Button variant="outline"><Pencil /> Edit</Button>} />
          {seeMoney && <PaySupplierDialog supplierId={id} owed={bought - paid} methods={methods.filter((m) => m.key !== "write_off")} />}
          <StartPurchaseButton supplierId={id} />
        </>} />
      {seeMoney && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[["Bought (received)", bought], ["Paid", paid], ["You owe", bought - paid]].map(([l, v]) => (
            <div key={l as string} className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border"><p className="text-sm text-muted-foreground">{l}</p><p className="text-2xl font-bold tabular">{formatPKR(v as number)}</p></div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Deliveries</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {(purchases ?? []).map((p) => (
                <li key={p.id}>
                  <Link href={`/suppliers/receive/${p.id}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border hover:ring-brand-muted">
                    <span className="font-mono text-xs">{p.code}</span>
                    <span>{p.supplier_invoice_no ? `Bill ${p.supplier_invoice_no}` : "No bill no."}</span>
                    <span className="text-muted-foreground">{formatDate(p.received_at ?? p.created_at)}</span>
                    <StatusPill tone={p.status === "received" ? "success" : p.status === "draft" ? "warning" : "neutral"}>{p.status === "draft" ? "Not received yet" : p.status}</StatusPill>
                    {seeMoney && <span className="ml-auto font-semibold tabular">{formatPKR(p.total)}</span>}
                  </Link>
                </li>
              ))}
              {!purchases?.length && <li className="text-sm text-muted-foreground">No deliveries yet.</li>}
            </ul>
          </CardContent>
        </Card>
        {seeMoney && (
          <Card>
            <CardHeader><CardTitle>Payments made</CardTitle></CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {(pays ?? []).map((p) => (
                  <li key={p.id} className="flex gap-3 rounded-xl bg-surface px-3 py-2 ring-1 ring-border">
                    <span>{formatDate(p.paid_on)}</span><span className="text-muted-foreground">{methods.find((m) => m.key === p.method)?.label ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                    <span className="ml-auto font-semibold tabular">{formatPKR(p.amount)}</span>
                  </li>
                ))}
                {!pays?.length && <li className="text-muted-foreground">No payments recorded.</li>}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
