import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPKR } from "@/lib/format";
import { savePurchaseHeader } from "../../actions";
import { GrnEditor, HeaderFields, type GrnLine } from "../../widgets";

export const metadata: Metadata = { title: "Receive delivery" };

export default async function ReceivePage({ params }: PageProps<"/suppliers/receive/[id]">) {
  await requireStaff("suppliers.manage");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: p }, { data: locations }] = await Promise.all([
    supabase.from("purchases").select(`*, suppliers(id, name), purchase_lines(id, batch_no, expiry_date, qty, unit_cost, line_total, catalog_items(name), inventory_locations(name))`).eq("id", id).maybeSingle(),
    supabase.from("inventory_locations").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  if (!p) notFound();
  const supplier = p.suppliers as unknown as { id: string; name: string };
  const lines: GrnLine[] = ((p.purchase_lines ?? []) as unknown as { id: string; batch_no: string; expiry_date: string | null; qty: number; unit_cost: number; line_total: number;
    catalog_items: { name: string }; inventory_locations: { name: string } }[])
    .map((l) => ({ id: l.id, item_name: l.catalog_items.name, location: l.inventory_locations.name, batch_no: l.batch_no, expiry_date: l.expiry_date,
      qty: Number(l.qty), unit_cost: Number(l.unit_cost), line_total: Number(l.line_total) }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back={{ href: `/suppliers/${supplier.id}`, label: supplier.name }}
        title={<span className="flex items-center gap-3">Delivery {p.code}
          <StatusPill tone={p.status === "received" ? "success" : p.status === "draft" ? "warning" : "neutral"}>{p.status === "draft" ? "Being entered" : p.status}</StatusPill></span>}
        description={p.status === "received" ? `Received ${formatDateTime(p.received_at)} · ${formatPKR(p.total)}` : "Enter every item from the supplier's bill, then receive it into stock."} />
      <div className="grid gap-6 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
        {p.status === "draft" ? (
          <>
            <HeaderFields purchaseId={id} invoiceNo={p.supplier_invoice_no ?? ""} invoiceDate={p.invoice_date ?? ""} onSave={savePurchaseHeader} />
            <GrnEditor purchaseId={id} lines={lines} locations={locations ?? []} total={Number(p.total)} />
          </>
        ) : (
          <ul className="grid gap-2">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-3 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border">
                <b>{l.item_name}</b><span className="text-muted-foreground">{l.location} · batch {l.batch_no || "—"} · exp {l.expiry_date ?? "—"}</span>
                <span className="ml-auto tabular">{l.qty} × {formatPKR(l.unit_cost)} = <b>{formatPKR(l.line_total)}</b></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
