import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { formatDateTime, formatPKR } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Payment receipt" };

export default async function ReceiptPrint({ params }: PageProps<"/print/receipt/[id]">) {
  const me = await requireStaff();
  if (!me.can("billing.view") && !me.can("pos.use")) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: p }, clinic, { data: methods }] = await Promise.all([
    supabase.from("payments").select("code, kind, amount, method, reference, notes, received_at, customers(full_name, phone), payment_allocations(amount, invoices(number))").eq("id", id).maybeSingle(),
    getSetting<ClinicProfile>("clinic.profile"),
    supabase.from("payment_methods").select("key, label"),
  ]);
  if (!p) notFound();
  const customer = p.customers as unknown as { full_name: string; phone: string } | null;
  const allocs = (p.payment_allocations ?? []) as unknown as { amount: number; invoices: { number: string } }[];
  const used = allocs.reduce((s, a) => s + Math.abs(Number(a.amount)), 0);
  const label = methods?.find((m) => m.key === p.method)?.label ?? p.method;

  return (
    <PrintShell clinic={clinic ?? {}} title={p.kind === "refund" ? "Refund receipt" : "Payment receipt"}>
      <div className="flex justify-between text-xs text-muted-foreground"><span>No. {p.code}</span><span>{formatDateTime(p.received_at)}</span></div>
      <div className="mt-2"><InfoGrid rows={[["Received from", customer ? `${customer.full_name} · ${formatPhone(customer.phone)}` : "Walk-in"], ["Method", `${label}${p.reference ? ` · ${p.reference}` : ""}`]]} /></div>
      <p className="mt-6 text-center text-3xl font-bold">{formatPKR(p.amount)}</p>
      {allocs.length > 0 && (
        <div className="mt-6 text-sm">
          <p className="font-semibold text-muted-foreground uppercase">{p.kind === "refund" ? "Refunded on" : "Paid towards"}</p>
          {allocs.map((a, i) => <p key={i}>Bill {a.invoices.number}: {formatPKR(Math.abs(Number(a.amount)))}</p>)}
          {p.kind === "payment" && Number(p.amount) - used > 0 && <p>Kept as advance: {formatPKR(Number(p.amount) - used)}</p>}
        </div>
      )}
      {p.notes && <p className="mt-4 text-sm">{p.notes}</p>}
      <div className="mt-16 flex justify-end"><div className="w-56 border-t border-ink pt-1 text-center text-xs">Received by</div></div>
    </PrintShell>
  );
}
