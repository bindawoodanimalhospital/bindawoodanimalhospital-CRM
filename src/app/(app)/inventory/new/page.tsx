import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Layers, Package } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { saveItem } from "../actions";
import { ItemForm } from "../item-form";
import { SizedProductForm } from "../size-widgets";

export const metadata: Metadata = { title: "New item" };

export default async function NewItemPage({ searchParams }: PageProps<"/inventory/new">) {
  const me = await requireStaff();
  if (!me.can("inventory.manage") && !me.can("settings.manage")) redirect("/inventory?denied=1");
  const sized = (await searchParams).sizes === "1";
  const supabase = await createClient();
  const { data: vaccines } = await supabase.from("vaccines").select("id, name").eq("is_active", true).order("name");
  const tab = (on: boolean) => cn("flex items-start gap-3 rounded-2xl p-4 text-left ring-1 transition",
    on ? "bg-brand-wash ring-brand-muted" : "bg-card ring-border hover:ring-brand-muted");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New price-list item" back={{ href: "/inventory", label: "Inventory" }} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Link href="/inventory/new" className={tab(!sized)}>
          <Package className="mt-0.5 size-5 text-brand" />
          <span><b className="block">One item</b><span className="text-sm text-muted-foreground">A service, a medicine, or a product sold in one size</span></span>
        </Link>
        <Link href="/inventory/new?sizes=1" className={tab(sized)}>
          <Layers className="mt-0.5 size-5 text-brand" />
          <span><b className="block">Product with sizes</b><span className="text-sm text-muted-foreground">e.g. a cat food in 400 g, 1.5 kg and 7 kg — each with its own price</span></span>
        </Link>
      </div>
      {sized ? <SizedProductForm /> : <ItemForm action={saveItem.bind(null, null)} hasStock={false} vaccines={vaccines ?? []} submitLabel="Save item" />}
    </div>
  );
}
