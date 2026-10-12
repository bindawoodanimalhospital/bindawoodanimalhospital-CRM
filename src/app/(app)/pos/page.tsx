import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { paymentMethods } from "@/lib/billing";
import { popularRetail, searchRetail } from "./actions";
import { Register } from "./register";

export const metadata: Metadata = { title: "Pet store" };

export default async function PosPage() {
  const me = await requireStaff("pos.use");
  const supabase = await createClient();
  const [initial, popular, methods, { data: deliveryItem }, { count: openDeliveries }] = await Promise.all([
    searchRetail(""), popularRetail(), paymentMethods(),
    supabase.from("catalog_items").select("sale_price").eq("system_role", "delivery_charge").maybeSingle(),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("fulfilment", "home_delivery").eq("status", "issued").in("delivery_status", ["pending", "dispatched"]),
  ]);
  return (
    <>
      <PageHeader title="Pet store" description="Scan or tap products, take payment, print the receipt. Stock updates automatically."
        actions={<Button asChild variant="outline"><Link href="/pos/deliveries"><Truck /> Home deliveries{openDeliveries ? ` (${openDeliveries})` : ""}</Link></Button>} />
      <Register initial={initial} popular={popular} methods={methods.filter((m) => m.key !== "write_off")} canDiscount={me.can("billing.discount")}
        defaultDeliveryCharge={Number(deliveryItem?.sale_price ?? 50)} />
    </>
  );
}
