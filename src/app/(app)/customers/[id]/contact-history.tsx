import { MessageSquare } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { LogContactDialog } from "./log-contact";

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "info" | "brand" }> = {
  to_send: { label: "Waiting to send", tone: "brand" }, queued: { label: "Queued", tone: "brand" }, sent: { label: "Sent", tone: "success" },
  delivered: { label: "Delivered", tone: "success" }, not_reached: { label: "Not reached", tone: "warning" }, cancelled: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "warning" }, logged: { label: "Logged", tone: "info" },
};
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", call: "Call", email: "Email", in_person: "In person" };

/** Everything said to / heard from this owner: reminders, calls, replies (spec §6, §21). */
export async function ContactHistory({ customerId, canLog }: { customerId: string; canLog: boolean }) {
  const supabase = await createClient();
  const [{ data }, { data: staff }] = await Promise.all([
    supabase.from("messages").select("id, direction, channel, status, body, created_at, sent_at, sent_by, outcome_note").eq("customer_id", customerId)
      .order("created_at", { ascending: false }).limit(15),
    supabase.from("staff").select("id, full_name"),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquare className="size-4" /> Contact history</CardTitle>
        {canLog && <CardAction><LogContactDialog customerId={customerId} /></CardAction>}
      </CardHeader>
      <CardContent>
        {!data?.length ? <p className="text-sm text-muted-foreground">No messages or calls recorded yet.</p> : (
          <ul className="grid gap-2">
            {data.map((m) => {
              const s = STATUS[m.status] ?? { label: m.status, tone: "neutral" as const };
              return (
                <li key={m.id} className="rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{m.direction === "in" ? `Reply (${CHANNEL[m.channel]})` : CHANNEL[m.channel]}</b>
                    <StatusPill tone={s.tone}>{s.label}</StatusPill>
                    <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(m.sent_at ?? m.created_at)}{m.sent_by ? ` · ${names.get(m.sent_by) ?? ""}` : ""}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{m.body}</p>
                  {m.outcome_note && <p className="mt-1 text-xs text-warning">{m.outcome_note}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
