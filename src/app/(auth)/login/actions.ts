"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoginState = { error?: string; email?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await logFailedSignIn(email);
    return { error: "Incorrect email or password.", email };
  }

  // Only allow internal redirects.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** A wrong password for a staff email goes in the activity log (unknown emails are ignored). */
async function logFailedSignIn(email: string) {
  try {
    const admin = createAdminClient();
    const { data: staff } = await admin.from("staff").select("id").eq("email", email.toLowerCase()).maybeSingle();
    if (!staff) return;
    await admin.from("audit_logs").insert({
      actor_id: staff.id, action: "auth.sign_in_failed", table_name: "sessions", context: { email },
    });
  } catch { /* logging must never block the sign-in form */ }
}
