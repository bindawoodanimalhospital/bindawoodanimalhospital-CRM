import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewRoleDialog, PermissionMatrix } from "./matrix";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const me = await requireStaff("staff.view");
  const supabase = await createClient();
  const [{ data: roles }, { data: permissions }, { data: grants }, { data: members }] = await Promise.all([
    supabase.from("roles").select("id, key, name, is_system").order("is_system", { ascending: false }).order("created_at"),
    supabase.from("permissions").select("key, module, label, is_sensitive").order("sort_order"),
    supabase.from("role_permissions").select("role_id, permission_key"),
    supabase.from("staff_roles").select("role_id"),
  ]);

  const count = new Map<string, number>();
  for (const m of members ?? []) count.set(m.role_id, (count.get(m.role_id) ?? 0) + 1);
  const editable = me.can("staff.manage");

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Changes apply immediately and are enforced by the database, not just hidden in the menu. Padlocked rows are sensitive."
        actions={editable && <NewRoleDialog roles={(roles ?? []).map(({ id, name }) => ({ id, name }))} />}
      />
      <PermissionMatrix
        roles={(roles ?? []).map((r) => ({ ...r, members: count.get(r.id) ?? 0 }))}
        permissions={permissions ?? []}
        grants={(grants ?? []).map((g) => `${g.role_id}:${g.permission_key}`)}
        editable={editable}
      />
    </>
  );
}
