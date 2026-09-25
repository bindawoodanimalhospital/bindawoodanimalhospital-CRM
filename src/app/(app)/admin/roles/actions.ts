"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

export async function setRolePermission(roleId: string, permission: string, granted: boolean): Promise<FormState> {
  await assertCan("staff.manage");
  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("key").eq("id", roleId).single();
  if (role?.key === "owner") return { message: "The Owner role always has every permission." };

  const { error } = granted
    ? await supabase.from("role_permissions").upsert({ role_id: roleId, permission_key: permission })
    : await supabase.from("role_permissions").delete().eq("role_id", roleId).eq("permission_key", permission);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/admin/roles");
  return { ok: true };
}

export async function createRole(name: string, description: string, copyFrom: string | null): Promise<FormState> {
  await assertCan("staff.manage");
  const clean = z.string().trim().min(2).max(60).safeParse(name);
  if (!clean.success) return { message: "Give the role a name." };
  const key = `custom_${clean.data.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

  const supabase = await createClient();
  const { data: role, error } = await supabase.from("roles")
    .insert({ key, name: clean.data, description: description.trim() || null }).select("id").single();
  if (error) return { message: error.code === "23505" ? "A role with this name already exists." : dbErrorMessage(error) };

  if (copyFrom) {
    const { data: perms } = await supabase.from("role_permissions").select("permission_key").eq("role_id", copyFrom);
    if (perms?.length) {
      await supabase.from("role_permissions").insert(perms.map((p) => ({ role_id: role.id, permission_key: p.permission_key })));
    }
  }
  revalidatePath("/admin/roles");
  return { ok: true, message: "Role created." };
}

export async function deleteRole(roleId: string): Promise<FormState> {
  await assertCan("staff.manage");
  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("is_system").eq("id", roleId).single();
  if (role?.is_system) return { message: "Built-in roles can't be deleted — remove their permissions instead." };
  const { count } = await supabase.from("staff_roles").select("staff_id", { count: "exact", head: true }).eq("role_id", roleId);
  if (count) return { message: `Remove this role from ${count} staff member(s) first.` };
  const { error } = await supabase.from("roles").delete().eq("id", roleId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/admin/roles");
  return { ok: true, message: "Role deleted." };
}
