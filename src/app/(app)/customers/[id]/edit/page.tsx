import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getReferralSources } from "@/lib/queries";
import { CONTACT, contactOf } from "@/lib/contacts";
import { updateCustomer } from "../../actions";
import { CustomerForm } from "../../customer-form";

export const metadata: Metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: PageProps<"/customers/[id]/edit">) {
  const me = await requireStaff("customers.edit");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: c }, referralSources] = await Promise.all([
    supabase.from("customers").select(`*, ${CONTACT}`).eq("id", id).maybeSingle(),
    getReferralSources(),
  ]);
  if (!c || c.status === "merged") notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${c.full_name}`} back={{ href: `/customers/${id}`, label: c.full_name }} />
      <CustomerForm action={updateCustomer.bind(null, id)} defaults={{ ...c, ...contactOf(c) }} referralSources={referralSources} canContact={me.can("customers.contact")}
        submitLabel="Save changes" />
    </div>
  );
}
