"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toE164 } from "@/lib/phone";
import { dbErrorMessage, fieldErrors, type FormState } from "@/lib/validation";

const profileSchema = z.object({
  full_name: z.string().trim().min(2, "Name is required"),
  title: z.string().trim().optional().transform((v) => v || null),
  phone: z.string().trim().optional().transform((v) => (v ? toE164(v) : null)),
  pvmc_number: z.string().trim().optional().transform((v) => v || null),
  is_doctor: z.preprocess((v) => v === "on", z.boolean()),
});

const newStaffSchema = profileSchema.extend({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

function roleIds(fd: FormData) {
  return fd.getAll("role").map(String).filter(Boolean);
}

export async function createStaff(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await assertCan("staff.manage");
  const parsed = newStaffSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Please fix the highlighted fields." };
  const roles = roleIds(fd);
  if (!roles.length) return { errors: { role: "Pick at least one role" }, message: "Pick at least one role." };

  const { email, password, ...profile } = parsed.data;
  // Creating a login needs the service role; everything after runs as the admin so it's audited under their name.
  const admin = createAdminClient();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: profile.full_name },
  });
  if (authErr || !created.user) {
    return { message: authErr?.message.includes("already") ? "A login with this email already exists." : authErr?.message };
  }

  const supabase = await createClient();
  const userId = created.user.id;
  const { error: profileErr } = await supabase.from("staff").update({ ...profile, is_active: true }).eq("id", userId);
  if (profileErr) return { message: dbErrorMessage(profileErr) };
  const { error: roleErr } = await supabase.from("staff_roles")
    .insert(roles.map((role_id) => ({ staff_id: userId, role_id, granted_by: me.id })));
  if (roleErr) return { message: dbErrorMessage(roleErr) };

  revalidatePath("/admin/staff");
  redirect(`/admin/staff/${userId}?notice=created`);
}

export async function updateStaffProfile(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await assertCan("staff.manage");
  const parsed = profileSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("staff").update(parsed.data).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/staff/${id}`);
  return { ok: true, message: "Profile saved." };
}

export async function setStaffActive(id: string, active: boolean): Promise<FormState> {
  const me = await assertCan("staff.manage");
  if (id === me.id && !active) return { message: "You can't deactivate your own account." };
  const supabase = await createClient();
  const { error } = await supabase.from("staff").update({ is_active: active }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  // Kill existing sessions so a deactivated account is locked out immediately.
  if (!active) await createAdminClient().auth.admin.signOut(id, "global").catch(() => {});
  revalidatePath(`/admin/staff/${id}`);
  revalidatePath("/admin/staff");
  return { ok: true, message: active ? "Account activated." : "Account deactivated." };
}

export async function grantRole(staffId: string, roleId: string, validUntil: string | null): Promise<FormState> {
  const me = await assertCan("staff.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("staff_roles").upsert({
    staff_id: staffId, role_id: roleId, granted_by: me.id, valid_from: new Date().toISOString(),
    // "Until" is a date in Lahore; the role ends at the end of that day.
    valid_until: validUntil ? new Date(`${validUntil}T23:59:59+05:00`).toISOString() : null,
  });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/staff/${staffId}`);
  return { ok: true, message: "Role granted." };
}

export async function revokeRole(staffId: string, roleId: string): Promise<FormState> {
  const me = await assertCan("staff.manage");
  const supabase = await createClient();
  if (staffId === me.id) {
    const { data: owner } = await supabase.from("roles").select("id").eq("key", "owner").single();
    if (owner?.id === roleId) return { message: "You can't remove your own Owner role." };
  }
  const { error } = await supabase.from("staff_roles").delete().eq("staff_id", staffId).eq("role_id", roleId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/staff/${staffId}`);
  return { ok: true, message: "Role removed." };
}

export async function resetPassword(staffId: string, password: string): Promise<FormState> {
  await assertCan("staff.manage");
  if (password.length < 8) return { message: "Password must be at least 8 characters." };
  const { error } = await createAdminClient().auth.admin.updateUserById(staffId, { password });
  if (error) return { message: error.message };
  const supabase = await createClient();
  await supabase.rpc("log_event", { p_action: "staff.password_reset", p_table: "staff", p_record_id: staffId });
  return { ok: true, message: "Password updated. Share it with the staff member privately." };
}
