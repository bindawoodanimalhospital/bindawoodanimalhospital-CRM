import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveItem } from "../actions";
import { ItemForm } from "../item-form";

export const metadata: Metadata = { title: "New item" };

export default async function NewItemPage() {
  const me = await requireStaff();
  if (!me.can("inventory.manage") && !me.can("settings.manage")) redirect("/inventory?denied=1");
  const supabase = await createClient();
  const { data: vaccines } = await supabase.from("vaccines").select("id, name").eq("is_active", true).order("name");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New price-list item" back={{ href: "/inventory", label: "Inventory" }} />
      <ItemForm action={saveItem.bind(null, null)} hasStock={false} vaccines={vaccines ?? []} submitLabel="Save item" />
    </div>
  );
}
