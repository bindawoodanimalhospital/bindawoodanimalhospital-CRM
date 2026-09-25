import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { paymentMethods } from "@/lib/billing";
import { searchRetail } from "./actions";
import { Register } from "./register";

export const metadata: Metadata = { title: "Pet store" };

export default async function PosPage() {
  const me = await requireStaff("pos.use");
  const [initial, methods] = await Promise.all([searchRetail(""), paymentMethods()]);
  return (
    <>
      <PageHeader title="Pet store" description="Scan or tap products, take payment, print the receipt. Stock updates automatically." />
      <Register initial={initial} methods={methods.filter((m) => m.key !== "write_off")} canDiscount={me.can("billing.discount")} />
    </>
  );
}
