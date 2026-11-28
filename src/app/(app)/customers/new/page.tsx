import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { getReferralSources, getSpeciesOptions } from "@/lib/queries";
import { createCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "New pet owner" };

export default async function NewCustomerPage() {
  const me = await requireStaff("customers.create");
  const [species, referralSources] = await Promise.all([getSpeciesOptions(), getReferralSources()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New pet owner" back={{ href: "/customers", label: "Pet owners" }}
        description="Search first (Ctrl K) — the form also warns you if this owner already exists." />
      <CustomerForm action={createCustomer} species={me.can("pets.create") ? species : undefined}
        referralSources={referralSources} submitLabel="Save pet owner" canContact={me.can("customers.contact")}
        canPreviousBalance={me.can("billing.create")} />
    </div>
  );
}
