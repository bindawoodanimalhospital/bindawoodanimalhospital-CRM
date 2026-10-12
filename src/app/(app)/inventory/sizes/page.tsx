import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Layers } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/format";
import { bySize, suggestSizeGroups } from "@/lib/sizes";
import { AddSizeDialog, AvailabilityToggle, SuggestionCard } from "../size-widgets";

export const metadata: Metadata = { title: "Product sizes" };

/** Products that come in several sizes: suggested groups to combine, and the groups already made. */
export default async function SizesPage() {
  const me = await requireStaff();
  if (!me.can("inventory.manage") && !me.can("settings.manage")) redirect("/dashboard?denied=1");
  const supabase = await createClient();
  const [{ data: items }, { data: families }] = await Promise.all([
    supabase.from("catalog_items").select("id, name, sale_price, family_id").eq("kind", "product").eq("is_active", true).order("name"),
    supabase.from("product_families").select("id, name, catalog_items(id, name, size_label, size_grams, sale_price, is_available, is_active)").order("name"),
  ]);
  const suggestions = suggestSizeGroups((items ?? []).map((i) => ({ ...i, sale_price: Number(i.sale_price) })));
  type Size = { id: string; name: string; size_label: string | null; size_grams: number | null; sale_price: number; is_available: boolean; is_active: boolean };

  return (
    <>
      <PageHeader back={{ href: "/inventory?tab=prices", label: "Price list" }} title="Product sizes"
        description="When one product comes in several weights (400 g, 1.5 kg…), group the sizes. The pet store then shows one product with a button per size, and sizes that aren't available are greyed out." />

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold">Suggested groups</h2>
        <p className="mb-3 text-sm text-muted-foreground">Products whose names differ only by size. Check the name and sizes, untick anything that doesn&apos;t belong, then combine.</p>
        {suggestions.length ? (
          <div className="grid gap-3 lg:grid-cols-2">{suggestions.map((s) => <SuggestionCard key={s.name + s.items[0].id} suggestion={s} />)}</div>
        ) : <p className="rounded-2xl bg-surface p-5 text-sm text-muted-foreground ring-1 ring-border">No more suggestions — every product that looks like a size is grouped.</p>}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Products with sizes ({families?.length ?? 0})</h2>
        {!families?.length ? <EmptyState icon={Layers} title="No size groups yet" description="Combine a suggestion above, or add a new product with sizes from Inventory → New item." /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {families.map((f) => {
              const sizes = ((f.catalog_items ?? []) as Size[]).filter((s) => s.is_active).sort(bySize);
              return (
                <div key={f.id} className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
                  <div className="mb-2 flex items-center gap-2"><Layers className="size-4 text-brand" /><b>{f.name}</b>
                    <span className="ml-auto"><AddSizeDialog familyId={f.id} familyName={f.name} /></span></div>
                  <ul className="grid gap-1.5">
                    {sizes.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-1.5 text-sm ring-1 ring-border">
                        <Link href={`/inventory/${s.id}`} className="w-20 font-semibold hover:underline">{s.size_label ?? "—"}</Link>
                        <span className="tabular text-muted-foreground">{formatPKR(s.sale_price)}</span>
                        <span className="ml-auto"><AvailabilityToggle id={s.id} available={s.is_available} /></span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
