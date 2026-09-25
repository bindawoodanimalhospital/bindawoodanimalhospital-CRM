import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { getReferralSources, getSpeciesOptions } from "@/lib/queries";
import { createCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const me = await requireStaff("customers.create");
  const [species, referralSources] = await Promise.all([getSpeciesOptions(), getReferralSources()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New customer" back={{ href: "/customers", label: "Customers" }}
        description="Search first (Ctrl K) — the form also warns you if this owner already exists." />
      <CustomerForm action={createCustomer} species={me.can("pets.create") ? species : undefined}
        referralSources={referralSources} submitLabel="Save customer" />
    </div>
  );
}
