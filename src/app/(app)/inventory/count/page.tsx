import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ShelfCount, type CountRow } from "./shelf-count";

export const metadata: Metadata = { title: "Shelf count" };

/** Count the shelf: one list of every product with a box for "how many are there now". */
export default async function ShelfCountPage({ searchParams }: PageProps<"/inventory/count">) {
  const me = await requireStaff();
  if (!me.can("inventory.adjust")) redirect("/dashboard?denied=inventory.adjust");
  const onlyUncounted = (await searchParams).show === "uncounted";
  const supabase = await createClient();
  const [{ data: items }, { data: levels }, { data: batches }] = await Promise.all([
    supabase.from("catalog_items").select("id, name, category, unit, track_stock").eq("kind", "product").eq("is_active", true).order("category").order("name"),
    supabase.from("stock_levels").select("item_id, usable_qty"),
    supabase.from("product_batches").select("item_id, qty_on_hand, inventory_locations(name)").gt("qty_on_hand", 0),
  ]);
  // Products kept in more than one place: show where, so both shelves are counted.
  const byPlace = new Map<string, Map<string, number>>();
  for (const b of batches ?? []) {
    const place = (b.inventory_locations as unknown as { name: string } | null)?.name ?? "?";
    const m = byPlace.get(b.item_id) ?? new Map<string, number>();
    m.set(place, (m.get(place) ?? 0) + Number(b.qty_on_hand));
    byPlace.set(b.item_id, m);
  }
  const places = (id: string) => {
    const m = byPlace.get(id);
    return m && m.size > 1 ? [...m].map(([p, n]) => `${p} ${n}`).join(" · ") : null;
  };
  const qty = new Map((levels ?? []).map((l) => [l.item_id, Number(l.usable_qty)]));
  const rows: CountRow[] = (items ?? [])
    .filter((i) => !onlyUncounted || !i.track_stock)
    .map((i) => ({ id: i.id, name: i.name, category: i.category, unit: i.unit, current: i.track_stock ? qty.get(i.id) ?? 0 : null, places: places(i.id) }));
  const uncounted = (items ?? []).filter((i) => !i.track_stock).length;
  const tab = (on: boolean) => cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ring-1", on ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted");

  return (
    <>
      <PageHeader back={{ href: "/inventory", label: "Inventory" }} title="Shelf count"
        description="Walk along the shelf and type how many of each product you see — the total, counting every place it is kept. Press Save: the system now knows your stock, and every sale or bill counts down from it. Do it again any time the numbers don't match." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/inventory/count" className={tab(!onlyUncounted)}>All products ({items?.length ?? 0})</Link>
        <Link href="/inventory/count?show=uncounted" className={tab(onlyUncounted)}>Not counted yet ({uncounted})</Link>
      </div>
      <ShelfCount rows={rows} onlyUncounted={onlyUncounted} />
    </>
  );
}
