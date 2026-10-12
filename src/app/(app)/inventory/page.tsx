import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, Boxes, ClipboardList, Layers, PackagePlus, Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDaysPK, formatDate, formatPKR, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PriceCell } from "./price-cell";
import { AvailabilityToggle } from "./size-widgets";
import { suggestSizeGroups } from "@/lib/sizes";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const me = await requireStaff();
  if (!me.can("inventory.view") && !me.can("settings.manage")) redirect("/dashboard?denied=1");
  const sp = await searchParams;
  const tab = sp.tab === "prices" ? "prices" : "stock";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const today = todayPK();
  const soon = addDaysPK(60);
  const supabase = await createClient();
  const canEdit = me.can("inventory.manage") || me.can("settings.manage");

  const tabs = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {[{ k: "stock", l: "Stock" }, { k: "prices", l: "Price list" }].map((t) => (
        <Link key={t.k} href={`?tab=${t.k}`} className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ring-1",
          tab === t.k ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>{t.l}</Link>
      ))}
      <form className="ml-auto"><input type="hidden" name="tab" value={tab} /><Input name="q" defaultValue={q} placeholder="Search…" className="w-56 bg-card" /></form>
    </div>
  );
  const header = (
    <PageHeader title="Inventory" description="Medicines, vaccines, supplies and pet store products — batches, expiry and prices."
      actions={
        <>
          {me.can("inventory.view") && <Button asChild variant="outline"><Link href="/inventory/loans"><ArrowLeftRight /> Borrowed & lent</Link></Button>}
          {me.can("inventory.adjust") && <Button asChild variant="outline"><Link href="/inventory/count"><ClipboardList /> Shelf count</Link></Button>}
          {me.can("suppliers.manage") && <Button asChild variant="outline"><Link href="/suppliers"><Truck /> Receive stock</Link></Button>}
          {canEdit && <Button asChild><Link href="/inventory/new"><Plus /> New item</Link></Button>}
        </>
      } />
  );

  if (tab === "prices") {
    let pq = supabase.from("catalog_items")
      .select("id, kind, name, category, sale_price, price_is_editable, unit, track_stock, is_retail, is_active, is_available, family_id, size_label, size_grams, product_families(name)")
      .order("category").order("name");
    if (q) pq = pq.ilike("name", `%${q.replace(/[%_,()]/g, "")}%`);
    const { data: items } = await pq;
    const zero = (items ?? []).filter((i) => i.is_active && Number(i.sale_price) === 0 && !i.price_is_editable).length;
    const suggestions = canEdit ? suggestSizeGroups((items ?? []).filter((i) => i.kind === "product" && i.is_active)
      .map((i) => ({ id: i.id, name: i.name, sale_price: Number(i.sale_price), family_id: i.family_id }))).length : 0;
    // Sizes of one product are listed together under the product's name, smallest first.
    type Row = NonNullable<typeof items>[number];
    const seen = new Set<string>();
    const rows: ({ kind: "item"; i: Row; sized?: boolean } | { kind: "family"; id: string; name: string; count: number })[] = [];
    for (const i of items ?? []) {
      if (!i.family_id) { rows.push({ kind: "item", i }); continue; }
      if (seen.has(i.family_id)) continue;
      seen.add(i.family_id);
      const sizes = (items ?? []).filter((x) => x.family_id === i.family_id)
        .sort((a, b) => (Number(a.size_grams ?? Infinity) - Number(b.size_grams ?? Infinity)) || a.name.localeCompare(b.name));
      rows.push({ kind: "family", id: i.family_id, name: (i.product_families as unknown as { name: string } | null)?.name ?? i.name, count: sizes.length });
      for (const x of sizes) rows.push({ kind: "item", i: x, sized: true });
    }
    return (
      <>
        <Suspense><NoticeToast /></Suspense>{header}{tabs}
        {zero > 0 && <p className="mb-4 flex items-center gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning"><AlertTriangle className="size-4" /> {zero} items still have no price — set them before billing.</p>}
        {suggestions > 0 && (
          <Link href="/inventory/sizes" className="mb-4 flex items-center gap-2 rounded-xl bg-info-soft px-4 py-3 text-sm text-info hover:underline">
            <Layers className="size-4" /> {suggestions} product{suggestions === 1 ? " seems" : "s seem"} to come in more than one size (e.g. 400 g and 1.5 kg) — review and group the sizes
          </Link>
        )}
        <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="hidden md:table-cell">Category</TableHead><TableHead>Type</TableHead>
              <TableHead className="hidden sm:table-cell">Available</TableHead><TableHead className="text-right">Price (Rs.)</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((row) => row.kind === "family" ? (
                <TableRow key={`f-${row.id}`} className="bg-surface hover:bg-surface">
                  <TableCell colSpan={5} className="py-2"><span className="inline-flex items-center gap-2 font-semibold"><Layers className="size-4 text-brand" />{row.name}
                    <span className="text-xs font-normal text-muted-foreground">{row.count} size{row.count === 1 ? "" : "s"}</span></span></TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.i.id} className={cn(!row.i.is_active && "opacity-50")}>
                  <TableCell className={cn(row.sized && "pl-9")}>
                    <Link href={`/inventory/${row.i.id}`} className="font-medium hover:underline">{row.sized && row.i.size_label ? row.i.size_label : row.i.name}</Link>
                    {row.sized && row.i.size_label && <span className="ml-2 text-xs text-muted-foreground">{row.i.name}</span>}
                    {row.i.is_retail && !row.sized && <StatusPill tone="info" className="ml-2">Store</StatusPill>}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{row.i.category}</TableCell>
                  <TableCell className="text-muted-foreground">{row.i.kind === "service" ? "Service" : `Product · ${row.i.unit}`}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {row.i.kind === "product" ? (canEdit ? <AvailabilityToggle id={row.i.id} available={row.i.is_available} label={false} />
                      : row.i.is_available ? "Yes" : <span className="text-warning">No</span>) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.i.price_is_editable ? <span className="text-sm text-muted-foreground">set at billing</span>
                      : canEdit ? <PriceCell id={row.i.id} price={Number(row.i.sale_price)} /> : formatPKR(row.i.sale_price)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  let sq = supabase.from("stock_levels").select("*").order("name");
  if (q) sq = sq.ilike("name", `%${q.replace(/[%_,()]/g, "")}%`);
  const [{ data: stock }, { count: untrackedCount }] = await Promise.all([
    sq,
    supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("kind", "product").eq("track_stock", false).eq("is_active", true),
  ]);
  const rows = stock ?? [];
  const low = rows.filter((r) => r.reorder_level != null && Number(r.usable_qty) <= Number(r.reorder_level));
  const expiring = rows.filter((r) => r.next_expiry && r.next_expiry <= soon);
  const expired = rows.filter((r) => Number(r.expired_qty) > 0);

  return (
    <>
      <Suspense><NoticeToast /></Suspense>{header}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Alert tone={low.length ? "warning" : "ok"} label="Low / reorder" value={low.length} />
        <Alert tone={expiring.length ? "warning" : "ok"} label="Expiring in 60 days" value={expiring.length} />
        <Alert tone={expired.length ? "danger" : "ok"} label="Expired on the shelf" value={expired.length} hint="Remove and write off" />
        <Link href="/inventory/count?show=uncounted" className="block rounded-2xl transition hover:ring-2 hover:ring-brand-muted">
          <Alert tone={untrackedCount ? "warning" : "ok"} label="Products not counted yet" value={untrackedCount ?? 0} hint={untrackedCount ? "Tap to count them now" : "Every product is counted"} />
        </Link>
      </div>
      {tabs}
      {rows.length === 0 ? (
        <EmptyState icon={Boxes} title="No stock counted yet" description="Do a shelf count: go along the shelf, type how many of each product you see, and save. From then on every sale counts down automatically."
          action={me.can("inventory.adjust") ? <Button asChild><Link href="/inventory/count"><ClipboardList /> Start a shelf count</Link></Button>
            : canEdit ? <Button asChild><Link href="/inventory/new"><PackagePlus /> Add a product</Link></Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">In stock</TableHead><TableHead className="hidden sm:table-cell">Next expiry</TableHead>
              <TableHead className="hidden md:table-cell text-right">Price</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isLow = r.reorder_level != null && Number(r.usable_qty) <= Number(r.reorder_level);
                const isSoon = r.next_expiry && r.next_expiry <= soon;
                return (
                  <TableRow key={r.item_id} className="relative">
                    <TableCell><Link href={`/inventory/${r.item_id}`} className="font-medium after:absolute after:inset-0">{r.name}</Link>
                      <span className="block text-xs text-muted-foreground">{r.category}</span></TableCell>
                    <TableCell className="text-right font-semibold tabular">{Number(r.usable_qty)} <span className="text-xs font-normal text-muted-foreground">{r.unit}</span></TableCell>
                    <TableCell className={cn("hidden sm:table-cell", isSoon && "font-semibold text-warning")}>{r.next_expiry ? formatDate(r.next_expiry) : "—"}</TableCell>
                    <TableCell className="hidden text-right tabular md:table-cell">{formatPKR(r.sale_price)}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        {Number(r.expired_qty) > 0 && <StatusPill tone="danger">{Number(r.expired_qty)} expired</StatusPill>}
                        {isLow && <StatusPill tone="warning">Reorder</StatusPill>}
                        {!isLow && !Number(r.expired_qty) && <StatusPill tone="success">OK</StatusPill>}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Expired stock is never sold — the system skips it automatically. Today is {formatDate(today)}.</p>
    </>
  );
}

function Alert({ tone, label, value, hint }: { tone: "ok" | "warning" | "danger"; label: string; value: number; hint?: string }) {
  return (
    <div className={cn("rounded-2xl p-4 ring-1", tone === "danger" ? "bg-danger-soft ring-danger/30" : tone === "warning" ? "bg-warning-soft ring-warning/30" : "bg-card ring-border")}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
