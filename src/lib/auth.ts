import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/permissions";

export type CurrentStaff = {
  id: string;
  email: string | null;
  fullName: string;
  title: string | null;
  isActive: boolean;
  isDoctor: boolean;
  roles: { key: string; name: string }[];
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
};

/** The signed-in staff member, their roles and effective permissions. Memoised per request. */
export const getCurrentStaff = cache(async (): Promise<CurrentStaff | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const [{ data: staff }, { data: perms }, { data: roles }] = await Promise.all([
    supabase.from("staff").select("id, email, full_name, title, is_active, is_doctor").eq("id", userId).maybeSingle(),
    supabase.rpc("my_permissions"),
    supabase
      .from("staff_roles")
      .select("valid_from, valid_until, roles(key, name)")
      .eq("staff_id", userId),
  ]);

  const now = Date.now();
  const permissions = new Set<Permission>((perms ?? []) as Permission[]);
  return {
    id: userId,
    email: staff?.email ?? (claims.claims.email as string | undefined) ?? null,
    fullName: staff?.full_name || (claims.claims.email as string | undefined) || "Staff",
    title: staff?.title ?? null,
    isActive: Boolean(staff?.is_active),
    isDoctor: Boolean(staff?.is_doctor),
    roles: (roles ?? [])
      .filter((r) => new Date(r.valid_from).getTime() <= now && (!r.valid_until || new Date(r.valid_until).getTime() > now))
      .flatMap((r) => (r.roles ? [r.roles as unknown as { key: string; name: string }] : [])),
    permissions,
    can: (p) => permissions.has(p),
  };
});

/** For pages: signed in, active, and (optionally) holding a permission — otherwise redirect. */
export async function requireStaff(permission?: Permission): Promise<CurrentStaff> {
  const me = await getCurrentStaff();
  if (!me) redirect("/login");
  if (!me.isActive || me.permissions.size === 0) redirect("/no-access");
  if (permission && !me.can(permission)) redirect("/dashboard?denied=1");
  return me;
}

/** For server actions: throws instead of redirecting. RLS remains the real enforcement. */
export async function assertCan(permission: Permission): Promise<CurrentStaff> {
  const me = await getCurrentStaff();
  if (!me?.isActive || !me.can(permission)) throw new Error(`You don't have permission (${permission}).`);
  return me;
}
