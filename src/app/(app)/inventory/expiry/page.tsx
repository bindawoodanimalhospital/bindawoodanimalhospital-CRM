import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CalendarX2, CircleHelp, Hourglass } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdjustDialog, BatchDetailsDialog } from "../stock-widgets";

export const metadata: Metadata = { title: "Expiry check" };

type Row = {
  id: string; batch_no: string; expiry_date: string | null; qty_on_hand: number; location_id: string;
  catalog_items: { id: string; name: string; unit: string; is_active: boolean; kind: string } | null;
  inventory_locations: { name: string } | null;
};

const daysTo = (ymd: string, today: string) =>
  Math.round((new Date(`${ymd}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);

/**
 * Everything on the shelf by expiry: expired (take off the shelf), expiring soon (use first),
 * and stock with no expiry date recorded (read it from the box and add it).
 */
export default async function ExpiryPage() {
  const me = await requireStaff();
  if (!me.can("inventory.view")) redirect("/dashboard?denied=inventory.view");
  const canFix = me.can("inventory.adjust");
  const supabase = await createClient();
  const today = todayPK();
  const [{ data }, { data: locations }] = await Promise.all([
    supabase.from("product_batches").select("id, batch_no, expiry_date, qty_on_hand, location_id, catalog_items(id, name, unit, is_active, kind), inventory_locations(name)")
      .gt("qty_on_hand", 0).order("expiry_date", { nullsFirst: false }).limit(2000),
    supabase.from("inventory_locations").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.catalog_items?.kind === "product")
    .sort((a, b) => (a.catalog_items?.name ?? "").localeCompare(b.catalog_items?.name ?? ""));
  const expired = rows.filter((r) => r.expiry_date && r.expiry_date < today).sort((a, b) => a.expiry_date!.localeCompare(b.expiry_date!));
  const soon = rows.filter((r) => r.expiry_date && r.expiry_date >= today && daysTo(r.expiry_date, today) <= 90).sort((a, b) => a.expiry_date!.localeCompare(b.expiry_date!));
  const none = rows.filter((r) => !r.expiry_date);
  const later = rows.length - expired.length - soon.length - none.length;

  const section = (title: string, icon: React.ReactNode, hint: string, list: Row[], tone: "danger" | "warning" | "muted") => (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2">{icon} {title} <span className="text-muted-foreground">({list.length})</span></CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        <p className="text-xs text-muted-foreground">{hint}</p>
        {!list.length ? <p className="text-sm text-muted-foreground">Nothing here.</p> : (
          <ul className="grid gap-2">
            {list.map((r) => {
              const d = r.expiry_date ? daysTo(r.expiry_date, today) : null;
              return (
                <li key={r.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-sm ring-1",
                  tone === "danger" ? "bg-danger-soft ring-danger/30" : tone === "warning" ? "bg-warning-soft ring-warning/30" : "bg-surface ring-border")}>
                  <Link href={`/inventory/${r.catalog_items?.id}`} className="min-w-0 flex-1 font-semibold hover:underline">{r.catalog_items?.name}</Link>
                  <span className="font-bold tabular">{Number(r.qty_on_hand)} {r.catalog_items?.unit}</span>
                  <span className={cn(tone === "danger" && "font-semibold text-danger", tone === "warning" && "font-semibold text-warning", tone === "muted" && "text-muted-foreground")}>
                    {r.expiry_date ? `${d! < 0 ? "Expired" : "Expires"} ${formatDate(r.expiry_date)}${d! >= 0 ? ` · ${d === 0 ? "today" : `${d} days`}` : ""}` : "No date"}
                  </span>
                  <span className="text-xs text-muted-foreground">{r.batch_no ? `Batch ${r.batch_no}` : ""} {r.inventory_locations?.name}</span>
                  {canFix && (
                    <span className="flex gap-1">
                      <BatchDetailsDialog itemId={r.catalog_items!.id} unit={r.catalog_items!.unit}
                        batch={{ id: r.id, batch_no: r.batch_no, expiry_date: r.expiry_date, qty: Number(r.qty_on_hand) }} />
                      {tone === "danger" && <AdjustDialog itemId={r.catalog_items!.id} batch={{ id: r.id, batch_no: r.batch_no, qty: Number(r.qty_on_hand), location_id: r.location_id }} locations={locations ?? []} />}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader back={{ href: "/inventory", label: "Inventory" }} title="Expiry check"
        description={`Everything on the shelf by expiry date. Expired stock is never sold — take it off the shelf and remove it here. ${later} batch${later === 1 ? "" : "es"} expire after 3 months (nothing to do).`} />
      <div className="grid gap-6">
        {section("Expired — still on the shelf", <CalendarX2 className="size-5 text-danger" />,
          "Take these off the shelf. Press “Remove / correct” → “Expired — remove” to take them out of stock. If the date was typed wrong, fix it with “Expiry & batch”.", expired, "danger")}
        {section("Expiring in the next 3 months", <Hourglass className="size-5 text-warning" />,
          "Sell or use these first (the system already picks them first on bills and sales).", soon, "warning")}
        {section("No expiry date recorded", <CircleHelp className="size-5 text-muted-foreground" />,
          "Read the date on the box and press “Expiry & batch” to add it. If the pieces have different dates, split them there.", none, "muted")}
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-3.5" /> Today is {formatDate(today)} (Pakistan time).</p>
    </>
  );
}
