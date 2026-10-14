import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPKR, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveItem } from "../actions";
import { ItemForm } from "../item-form";
import { AddStockDialog, AdjustDialog, BatchDetailsDialog, SetCountDialog } from "../stock-widgets";
import { AvailabilityToggle, SizesPanel } from "../size-widgets";
import { DeleteItemButton } from "./delete-item";
import { bySize } from "@/lib/sizes";

export const metadata: Metadata = { title: "Item" };

const KIND: Record<string, string> = {
  receive: "Received", sale: "Sold (store)", dispense: "Billed (clinic)", surgery_use: "Used in surgery", return_in: "Returned by customer",
  return_to_supplier: "Returned to supplier", adjust: "Count corrected", wastage: "Damaged / wasted", expired: "Expired — removed",
  transfer_in: "Moved in", transfer_out: "Moved out", reversal: "Reversed (bill voided / record cancelled)",
  borrow_in: "Borrowed from a business", borrow_return: "Given back (borrowed)", lend_out: "Lent to a business", lend_return: "Returned to us (lent)",
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
  // Other sizes of the same product (with their stock), when this item is one size of several.
  const [{ data: family }, { data: sibs }] = item.family_id ? await Promise.all([
    supabase.from("product_families").select("id, name").eq("id", item.family_id).maybeSingle(),
    supabase.from("catalog_items").select("id, name, size_label, size_grams, sale_price, is_available, track_stock").eq("family_id", item.family_id).eq("is_active", true),
  ]) : [{ data: null }, { data: [] }];
  const sibTracked = (sibs ?? []).filter((x) => x.track_stock).map((x) => x.id);
  const { data: sibStock } = sibTracked.length ? await supabase.from("stock_levels").select("item_id, usable_qty").in("item_id", sibTracked) : { data: [] };
  const sibQty = new Map((sibStock ?? []).map((x) => [x.item_id, Number(x.usable_qty)]));
  const siblings = (sibs ?? []).map((x) => ({ ...x, sale_price: Number(x.sale_price), size_grams: x.size_grams == null ? null : Number(x.size_grams),
    stock: x.track_stock ? sibQty.get(x.id) ?? 0 : null })).sort(bySize);
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const today = todayPK();
  const onHand = (batches ?? []).reduce((s, b) => s + Number(b.qty_on_hand), 0);
  const canEdit = me.can("inventory.manage") || me.can("settings.manage");
  const cost = (costQ.data as { cost_price: number } | null)?.cost_price;
  // Delete only appears for items never used anywhere (checked by the database, which also enforces it).
  const { data: deletable } = canEdit ? await supabase.rpc("item_is_deletable", { p_item: item.id }) : { data: false };

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      <PageHeader back={{ href: "/inventory", label: "Inventory" }}
        actions={deletable ? <DeleteItemButton id={item.id} name={item.name} /> : undefined}
        title={<span className="flex flex-wrap items-center gap-3">{item.name}{!item.is_active && <StatusPill>Inactive</StatusPill>}
          {item.track_stock && <StatusPill tone="info">{onHand} {item.unit} in stock</StatusPill>}
          {item.kind === "product" && canEdit && <AvailabilityToggle id={item.id} available={item.is_available} />}
          {item.kind === "product" && !canEdit && !item.is_available && <StatusPill tone="warning">Not available</StatusPill>}</span>}
        description={[item.kind === "service" ? "Service" : "Product", item.category, formatPKR(item.sale_price),
          seeCost && cost != null ? `last cost ${formatPKR(cost)} · margin ${item.sale_price > 0 ? Math.round(((item.sale_price - cost) / item.sale_price) * 100) : 0}%` : null].filter(Boolean).join(" · ")} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          {canEdit ? <ItemForm action={saveItem.bind(null, id)} defaults={item} hasStock={onHand > 0} vaccines={vaccines ?? []} submitLabel="Save changes" />
            : <p className="text-muted-foreground">You can view this item. Ask the inventory manager to change it.</p>}
        </div>
        {item.kind === "product" && (
          <div className="grid min-w-0 content-start gap-6 lg:col-span-2">
            {canEdit && (
              <Card>
                <CardHeader><CardTitle>Sizes</CardTitle></CardHeader>
                <CardContent><SizesPanel item={{ id: item.id, name: item.name, size_label: item.size_label }} family={family ?? null} siblings={siblings} /></CardContent>
              </Card>
            )}
            <Card className="bg-brand-wash ring-brand-muted">
              <CardHeader><CardTitle>Stock</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-3xl font-bold tabular">{item.track_stock ? onHand : "—"} <span className="text-base font-normal text-muted-foreground">{item.unit} {item.track_stock ? "in stock" : "· not counted yet"}</span></p>
                {me.can("inventory.adjust") ? (
                  <div className="flex flex-wrap gap-2">
                    <AddStockDialog itemId={id} itemName={item.name} unit={item.unit} locations={locations ?? []} />
                    <SetCountDialog itemId={id} itemName={item.name} unit={item.unit} current={item.track_stock ? onHand : null} />
                  </div>
                ) : <p className="text-sm text-muted-foreground">Ask the inventory manager to add stock.</p>}
                <p className="text-xs text-muted-foreground"><b>Add stock</b> when new pieces arrive. <b>Set the count</b> when you count the shelf and the number is different.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Stock by expiry date</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-xs text-muted-foreground">
                  Each line is a <b>batch</b>: pieces with the same expiry date (and lot no. from the box). Sales and bills always use the one
                  expiring first; expired pieces are never sold. Wrong or missing date? Press <b>Expiry &amp; batch</b>.
                </p>
                {!batches?.some((b) => Number(b.qty_on_hand) > 0) ? <p className="text-sm text-muted-foreground">No stock on the shelf.</p> : (
                  <ul className="grid gap-2">
                    {(batches ?? []).filter((b) => Number(b.qty_on_hand) > 0).map((b) => {
                      const days = b.expiry_date ? Math.round((new Date(`${b.expiry_date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000) : null;
                      const tone = days == null ? "none" : days < 0 ? "expired" : days <= 60 ? "soon" : "ok";
                      return (
                        <li key={b.id} className={cn("grid gap-1 rounded-xl px-3 py-2 text-sm ring-1",
                          tone === "expired" ? "bg-danger-soft ring-danger/30" : tone === "soon" ? "bg-warning-soft ring-warning/30" : "bg-surface ring-border")}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold tabular">{Number(b.qty_on_hand)} {item.unit}</span>
                            <span className={cn("font-semibold", tone === "expired" && "text-danger", tone === "soon" && "text-warning", tone === "none" && "text-muted-foreground")}>
                              {b.expiry_date ? `${tone === "expired" ? "Expired" : "Expires"} ${formatDate(b.expiry_date)}` : "No expiry date recorded"}
                            </span>
                            {days != null && days >= 0 && days <= 60 && <StatusPill tone="warning">{days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}</StatusPill>}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                            <span>{b.batch_no ? `Batch ${b.batch_no}` : "No batch no."}</span>
                            <span>{(b.inventory_locations as unknown as { name: string }).name}</span>
                            {me.can("inventory.adjust") && (
                              <span className="ml-auto flex flex-wrap gap-1">
                                <BatchDetailsDialog itemId={id} unit={item.unit} batch={{ id: b.id, batch_no: b.batch_no, expiry_date: b.expiry_date, qty: Number(b.qty_on_hand) }} />
                                <AdjustDialog itemId={id} batch={{ id: b.id, batch_no: b.batch_no, qty: Number(b.qty_on_hand), location_id: b.location_id }} locations={locations ?? []} />
                              </span>
                            )}
                          </div>
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
