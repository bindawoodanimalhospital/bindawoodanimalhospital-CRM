import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RuleCard, TemplateEditor, type Rule } from "./widgets";

export const metadata: Metadata = { title: "Reminder settings" };

export default async function ReminderSettingsPage() {
  await requireStaff("settings.manage");
  const supabase = await createClient();
  const [{ data: rules }, { data: templates }, { data: roles }] = await Promise.all([
    supabase.from("reminder_rules").select("*").order("label"),
    supabase.from("message_templates").select("key, language, label, body, is_promotional").order("key").order("language"),
    supabase.from("roles").select("key, name").order("created_at"),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Reminders & messages"
        description="When owners get reminders, when staff are alerted, and who is told if nothing happens. Changes apply from the next check (every 30 minutes)." />
      <div className="grid gap-6">
        {(rules ?? []).map((r) => <RuleCard key={r.key} rule={r as Rule} roles={roles ?? []} />)}
      </div>
      <h2 className="mt-10 mb-4 text-xl font-bold">Message wording</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {(templates ?? []).map((t) => <TemplateEditor key={`${t.key}-${t.language}`} t={t} />)}
      </div>
    </>
  );
}
