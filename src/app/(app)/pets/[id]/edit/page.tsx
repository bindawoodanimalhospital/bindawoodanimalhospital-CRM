import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSpeciesOptions } from "@/lib/queries";
import { updatePet } from "../../actions";
import { PetForm } from "../../pet-form";

export const metadata: Metadata = { title: "Edit pet" };

export default async function EditPetPage({ params }: PageProps<"/pets/[id]/edit">) {
  await requireStaff("pets.edit");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: p }, species] = await Promise.all([
    supabase.from("pets").select("*").eq("id", id).maybeSingle(),
    getSpeciesOptions(),
  ]);
  if (!p) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${p.name}`} back={{ href: `/pets/${id}`, label: p.name }} />
      <PetForm action={updatePet.bind(null, id)} species={species} defaults={p} status={p.status} submitLabel="Save changes" />
    </div>
  );
}
