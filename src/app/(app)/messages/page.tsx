import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, todayPK } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { MessageQueue, type QueueMessage } from "./queue";
import { RunNowButton } from "./run-now";

export const metadata: Metadata = { title: "Messages" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" | "info" }> = {
  sent: { label: "Sent", tone: "success" }, delivered: { label: "Delivered", tone: "success" }, not_reached: { label: "Not reached", tone: "warning" },
  cancelled: { label: "Skipped", tone: "neutral" }, failed: { label: "Failed", tone: "danger" }, logged: { label: "Logged", tone: "info" },
};

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const me = await requireStaff();
  if (!me.can("crm.view")) redirect("/dashboard?denied=1");
  const { view: v } = await searchParams;
  const view = v === "history" ? "history" : "queue";
  const supabase = await createClient();
  const today = todayPK();

  const [{ data: templates }, { count: toSend }] = await Promise.all([
    supabase.from("message_templates").select("key, language, label"),
    supabase.from("messages").select("id", { count: "exact", head: true }).in("status", ["to_send", "queued"]),
  ]);
  const label = (k: string | null) => templates?.find((t) => t.key === k && t.language === "en")?.label ?? "Message";

  const tabs = (
    <div className="mb-4 flex flex-wrap gap-2">
      {[{ k: "queue", l: `To send (${toSend ?? 0})` }, { k: "history", l: "History" }].map((t) => (
        <Link key={t.k} href={`?view=${t.k}`} className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ring-1",
          view === t.k ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>{t.l}</Link>
      ))}
    </div>
  );
  const header = (
    <PageHeader title="Messages" description="Reminders prepared by the system. Open WhatsApp, send, then mark it — every message is kept in the customer's history."
      actions={<>
        {me.can("crm.campaigns") && <Button asChild variant="outline"><Link href="/messages/campaigns"><Megaphone /> Campaigns</Link></Button>}
        {(me.can("crm.manage") || me.can("settings.manage")) && <RunNowButton />}
      </>} />
  );

  if (view === "history") {
    const { data } = await supabase.from("messages").select("id, direction, channel, status, body, to_phone, template_key, sent_at, created_at, outcome_note, customers(id, full_name), sent_by")
      .not("status", "in", "(to_send,queued)").order("created_at", { ascending: false }).limit(100);
    const { data: staff } = await supabase.from("staff").select("id, full_name");
    const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
    return (
      <>{header}{tabs}
        <ul className="grid gap-2">
          {(data ?? []).map((m) => {
            const c = m.customers as unknown as { id: string; full_name: string } | null;
            const s = STATUS[m.status] ?? { label: m.status, tone: "neutral" as const };
            return (
              <li key={m.id} className="rounded-2xl bg-card px-4 py-3 shadow-card ring-1 ring-border">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {c && <Link href={`/customers/${c.id}`} className="font-semibold hover:underline">{c.full_name}</Link>}
                  <span className="text-muted-foreground">{formatPhone(m.to_phone)}</span>
                  <StatusPill tone={s.tone}>{m.direction === "in" ? "Reply received" : s.label}</StatusPill>
                  <span className="text-muted-foreground">{m.channel}{m.template_key ? ` · ${label(m.template_key)}` : ""}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.sent_at ?? m.created_at)}{m.sent_by ? ` · ${names.get(m.sent_by) ?? ""}` : ""}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm">{m.body}</p>
                {m.outcome_note && <p className="mt-1 text-xs text-warning">{m.outcome_note}</p>}
              </li>
            );
          })}
          {!data?.length && <EmptyState icon={MessageCircle} title="No messages yet" />}
        </ul>
      </>
    );
  }

  const { data } = await supabase.from("messages")
    .select("id, channel, body, to_phone, template_key, language, is_promotional, scheduled_for, track_id, customers(id, full_name), reminder_tracks:track_id(customer_msgs)")
    .in("status", ["to_send", "queued"]).lte("scheduled_for", today).order("is_promotional").order("created_at").limit(200);
  const items: QueueMessage[] = (data ?? []).map((m) => ({
    id: m.id, channel: m.channel, body: m.body ?? "", to_phone: m.to_phone, language: m.language, is_promotional: m.is_promotional,
    template_label: label(m.template_key), customer: m.customers as unknown as { id: string; full_name: string } | null,
    attempts: (m.reminder_tracks as unknown as { customer_msgs: number } | null)?.customer_msgs ?? 1,
  }));

  return (
    <>{header}{tabs}
      {items.length === 0
        ? <EmptyState icon={MessageCircle} title="All messages sent" description="New reminders appear here automatically (checked every 30 minutes)." />
        : <MessageQueue items={items} canSend={me.can("crm.manage")} />}
    </>
  );
}
