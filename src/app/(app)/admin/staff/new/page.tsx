import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createStaff } from "../actions";
import { NewStaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Add staff" };

export default async function NewStaffPage() {
  await requireStaff("staff.manage");
  const supabase = await createClient();
  const { data: roles } = await supabase.from("roles").select("id, name, description").order("created_at");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add staff member" back={{ href: "/admin/staff", label: "Staff" }} />
      <NewStaffForm action={createStaff} roles={roles ?? []} />
    </div>
  );
}
