import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSpeciesOptions } from "@/lib/queries";
import { formatPhone } from "@/lib/phone";
import { createPet } from "../actions";
import { PetForm } from "../pet-form";

export const metadata: Metadata = { title: "Register pet" };

export default async function NewPetPage({ searchParams }: PageProps<"/pets/new">) {
  await requireStaff("pets.create");
  const { customer: customerId } = await searchParams;

  // Every pet belongs to an owner: without ?customer, send reception to pick/create one first.
  if (typeof customerId !== "string") {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Register pet" back={{ href: "/pets", label: "Pets" }} />
        <EmptyState icon={Users} title="Choose the owner first"
          description="Open the owner's profile (Ctrl K to search by phone) and use “Add pet”, or register a new customer with their first pet."
          action={<Button asChild><Link href="/customers/new">New customer + pet</Link></Button>} />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: owner }, species] = await Promise.all([
    supabase.from("customers").select("id, full_name, phone").eq("id", customerId).maybeSingle(),
    getSpeciesOptions(),
  ]);
  if (!owner) return <EmptyState icon={Users} title="Owner not found" />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Register pet" back={{ href: `/customers/${owner.id}`, label: owner.full_name }}
        description={<>Owner: <b>{owner.full_name}</b> · {formatPhone(owner.phone)}</>} />
      <PetForm action={createPet.bind(null, owner.id)} species={species} submitLabel="Register pet" showWeight />
    </div>
  );
}
