import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPKR, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveItem } from "../actions";
import { ItemForm } from "../item-form";
import { AdjustDialog, StockCountDialog } from "../stock-widgets";

export const metadata: Metadata = { title: "Item" };

const KIND: Record<string, string> = {
  receive: "Received", sale: "Sold (store)", dispense: "Billed (clinic)", surgery_use: "Used in surgery", return_in: "Returned by customer",
  return_to_supplier: "Returned to supplier", adjust: "Count corrected", wastage: "Damaged / wasted", expired: "Expired — removed",
  transfer_in: "Moved in", transfer_out: "Moved out", reversal: "Bill voided — put back",
};

export default async function ItemPage({ params }: PageProps<"/inventory/[id]">) {
  const me = await requireStaff();
  if (!me.can("inventory.view") && !me.can("settings.manage")) redirect("/dashboard?denied=1");
  const { id } = await params;
  const supabase = await createClient();
  const seeCost = me.can("inventory.view_cost");
  const [{ data: item }, { data: batches }, { data: moves }, { data: locations }, { data: vaccines }, { data: staff }, costQ] = await Promise.all([
    supabase.from("catalog_items").select("*").eq("id", id).maybeSingle(),
    supabase.from("product_batches").select("id, batch_no, expiry_date, qty_on_hand, location_id, received_at, inventory_locations(name)").eq("item_id", id).order("expiry_date", { nullsFirst: false }),
    supabase.from("inventory_movements").select("id, qty, kind, reason, created_at, created_by, product_batches(batch_no)").eq("item_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("inventory_locations").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("vaccines").select("id, name").eq("is_active", true).order("name"),
    supabase.from("staff").select("id, full_name"),
    seeCost ? supabase.from("catalog_costs").select("cost_price").eq("item_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!item) notFound();
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const today = todayPK();
  const onHand = (batches ?? []).reduce((s, b) => s + Number(b.qty_on_hand), 0);
  const canEdit = me.can("inventory.manage") || me.can("settings.manage");
  const cost = (costQ.data as { cost_price: number } | null)?.cost_price;

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      <PageHeader back={{ href: "/inventory", label: "Inventory" }}
        title={<span className="flex flex-wrap items-center gap-3">{item.name}{!item.is_active && <StatusPill>Inactive</StatusPill>}
          {item.track_stock && <StatusPill tone="info">{onHand} {item.unit} in stock</StatusPill>}</span>}
        description={[item.kind === "service" ? "Service" : "Product", item.category, formatPKR(item.sale_price),
          seeCost && cost != null ? `last cost ${formatPKR(cost)} · margin ${item.sale_price > 0 ? Math.round(((item.sale_price - cost) / item.sale_price) * 100) : 0}%` : null].filter(Boolean).join(" · ")} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          {canEdit ? <ItemForm action={saveItem.bind(null, id)} defaults={item} hasStock={onHand > 0} vaccines={vaccines ?? []} submitLabel="Save changes" />
            : <p className="text-muted-foreground">You can view this item. Ask the inventory manager to change it.</p>}
        </div>
        {item.kind === "product" && (
          <div className="grid min-w-0 content-start gap-6 lg:col-span-2">
            <Card>
              <CardHeader><CardTitle>Batches</CardTitle>
                {me.can("inventory.adjust") && <CardAction><StockCountDialog itemId={id} locations={locations ?? []} unit={item.unit} /></CardAction>}</CardHeader>
              <CardContent>
                {!batches?.length ? <p className="text-sm text-muted-foreground">No stock recorded.</p> : (
                  <ul className="grid gap-2">
                    {batches.filter((b) => Number(b.qty_on_hand) > 0).map((b) => {
                      const expired = b.expiry_date && b.expiry_date < today;
                      return (
                        <li key={b.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1", expired ? "bg-danger-soft ring-danger/30" : "bg-surface ring-border")}>
                          <span className="font-semibold">{b.batch_no || "No batch"}</span>
                          <span className="text-muted-foreground">{(b.inventory_locations as unknown as { name: string }).name}</span>
                          <span className={cn(expired && "font-semibold text-danger")}>{b.expiry_date ? `exp ${formatDate(b.expiry_date)}` : "no expiry"}</span>
                          <span className="ml-auto font-bold tabular">{Number(b.qty_on_hand)}</span>
                          {me.can("inventory.adjust") && <AdjustDialog itemId={id} batch={{ id: b.id, batch_no: b.batch_no, qty: Number(b.qty_on_hand), location_id: b.location_id }} locations={locations ?? []} />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Stock history</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-1.5 text-sm">
                  {(moves ?? []).map((m) => (
                    <li key={m.id} className="flex flex-wrap gap-x-3">
                      <span className={cn("w-14 font-bold tabular", Number(m.qty) > 0 ? "text-success" : "text-foreground")}>{Number(m.qty) > 0 ? "+" : ""}{Number(m.qty)}</span>
                      <span className="font-medium">{KIND[m.kind] ?? m.kind}</span>
                      <span className="text-muted-foreground">{(m.product_batches as unknown as { batch_no: string } | null)?.batch_no}</span>
                      {m.reason && <span className="w-full pl-17 text-xs text-muted-foreground">{m.reason}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.created_at)}{m.created_by ? ` · ${names.get(m.created_by) ?? ""}` : ""}</span>
                    </li>
                  ))}
                  {!moves?.length && <li className="text-muted-foreground">Nothing yet.</li>}
                </ul>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
