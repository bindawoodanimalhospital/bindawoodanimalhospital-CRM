import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { CampaignBuilder } from "./builder";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  await requireStaff("crm.campaigns");
  const supabase = await createClient();
  const [{ data: templates }, { data: past }] = await Promise.all([
    supabase.from("message_templates").select("key, label").eq("is_promotional", true).eq("language", "en").order("label"),
    supabase.from("campaigns").select("id, name, audience, message_count, created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader back={{ href: "/messages", label: "Messages" }} title="Campaigns"
        description="Friendly messages to groups of owners. They go into the same “Messages to send” list, in each owner's language." />
      <CampaignBuilder templates={templates ?? []} />
      <h2 className="mt-8 mb-3 text-lg font-semibold">Past campaigns</h2>
      <ul className="grid gap-2">
        {(past ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap gap-3 rounded-xl bg-card px-4 py-3 text-sm shadow-card ring-1 ring-border">
            <b>{c.name}</b><span className="text-muted-foreground">{c.audience.replaceAll("_", " ")}</span>
            <span className="ml-auto">{c.message_count} messages · {formatDateTime(c.created_at)}</span>
          </li>
        ))}
        {!past?.length && <li className="text-sm text-muted-foreground">None yet.</li>}
      </ul>
    </div>
  );
}
