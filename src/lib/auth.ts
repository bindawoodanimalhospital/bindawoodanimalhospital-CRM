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

/*
 * Profile, roles and permissions are remembered per staff member for a few seconds, so moving between pages doesn't
 * wait on a database round trip first. This only shapes the screens (menus, buttons, page access): the database
 * checks the staff member is active and holds the permission on every query, so a stale entry can never grant
 * access. Saving staff or role changes clears it at once (forgetStaffCache).
 */
const STAFF_TTL_MS = 30_000;
const staffCache = new Map<string, { at: number; staff: CurrentStaff }>();

export function forgetStaffCache() {
  staffCache.clear();
}

/** The signed-in staff member, their roles and effective permissions. Memoised per request and briefly across requests. */
export const getCurrentStaff = cache(async (): Promise<CurrentStaff | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const hit = staffCache.get(userId);
  if (hit && Date.now() - hit.at < STAFF_TTL_MS) return hit.staff;

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
  const me: CurrentStaff = {
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
  // Only remember a complete answer; a failed lookup is retried on the next page.
  if (staff) staffCache.set(userId, { at: now, staff: me });
  return me;
});

/** For pages: signed in, active, and (optionally) holding a permission — otherwise redirect. */
export async function requireStaff(permission?: Permission): Promise<CurrentStaff> {
  const me = await getCurrentStaff();
  if (!me) redirect("/login");
  if (!me.isActive || me.permissions.size === 0) redirect("/no-access");
  if (permission && !me.can(permission)) redirect(`/dashboard?denied=${encodeURIComponent(permission)}`);
  return me;
}

/** For server actions: throws instead of redirecting. RLS remains the real enforcement. */
export async function assertCan(permission: Permission): Promise<CurrentStaff> {
  const me = await getCurrentStaff();
  if (!me?.isActive || !me.can(permission)) throw new Error(`You don't have permission (${permission}).`);
  return me;
}
