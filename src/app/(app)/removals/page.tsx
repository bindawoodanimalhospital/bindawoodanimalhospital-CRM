import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, PawPrint, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { DeclineButton } from "@/components/app/removal-panel";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Removal requests" };

type Row = {
  id: string; kind: "customer" | "pet"; label: string; link: string; reason: string | null; created_at: string; reminders: number;
  status: "open" | "deleted" | "declined"; resolved_at: string | null; note: string | null;
  requester: { full_name: string | null } | null; resolver: { full_name: string | null } | null;
};

export default async function RemovalsPage() {
  const me = await requireStaff();
  const isOwner = me.can("customers.delete") || me.can("pets.delete");
  const supabase = await createClient();
  const { data } = await supabase.from("removal_requests")
    .select("id, kind, label, link, reason, created_at, reminders, status, resolved_at, note, requester:requested_by(full_name), resolver:resolved_by(full_name)")
    .order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as unknown as Row[];
  const open = rows.filter((r) => r.status === "open");
  const done = rows.filter((r) => r.status !== "open").slice(0, 30);

  return (
    <>
      <PageHeader title="Removal requests"
        description={isOwner
          ? "Pet owners and pets staff asked you to remove. Open each one: Delete it (only possible if it was never used) or keep it with Decline. You are reminded several times a day until each is handled."
          : "Pet owners and pets waiting for Mr. Musab Bin Dawood to remove. Ask for a removal from the bottom of the pet owner's or pet's page."} />
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="size-4 text-warning" /> Waiting ({open.length})</CardTitle></CardHeader>
        <CardContent>
          {!open.length ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : (
            <ul className="grid gap-2">
              {open.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-border">
                  {r.kind === "customer" ? <User className="size-4 text-brand" /> : <PawPrint className="size-4 text-brand" />}
                  <span className="min-w-0 flex-1 text-sm">
                    <Link href={r.link} className="font-semibold underline-offset-2 hover:underline">{r.label}</Link>
                    <span className="block text-xs text-muted-foreground">
                      Asked by {r.requester?.full_name ?? "staff"} · {formatDateTime(r.created_at)}{r.reason ? ` · “${r.reason}”` : ""}{r.reminders > 1 ? ` · reminded ${r.reminders}×` : ""}
                    </span>
                  </span>
                  <Link href={r.link} className="text-sm font-semibold text-brand hover:underline">{isOwner ? "Open to delete" : "Open"}</Link>
                  {isOwner && <DeclineButton requestId={r.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {done.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Handled</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {done.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusPill tone={r.status === "deleted" ? "success" : "neutral"}>{r.status === "deleted" ? "Deleted" : "Kept"}</StatusPill>
                  <span className="font-medium">{r.label}</span>
                  <span className="text-xs text-muted-foreground">
                    asked by {r.requester?.full_name ?? "staff"} · {r.status === "deleted" ? "deleted" : "kept"} by {r.resolver?.full_name ?? "the owner"} {formatDateTime(r.resolved_at)}{r.note ? ` · “${r.note}”` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
