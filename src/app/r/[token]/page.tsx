import type { Metadata } from "next";
import { LinkIcon } from "lucide-react";
import { PrintShell } from "@/components/print/print-shell";
import { MedicalRecordView } from "@/components/app/medical-record";
import { LogoMark } from "@/components/brand/logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMedicalRecord, type MedicalRecord } from "@/lib/medical-record";
import { hashShareToken, SHARE_TOKEN_PATTERN } from "@/lib/record-share";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "Medical record",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/*
 * A pet's medical record opened by its owner from a private link — no sign-in. The page itself is the gate: the
 * link's secret must match a stored hash, and the link must not be cancelled or expired. Then the service-role
 * client loads that one pet's record (the loader filters every query by pet and leaves out bills, private notes
 * and phone numbers).
 */
/** Checks a link and loads its record, or says why it can't be opened. Counts each successful opening. */
async function openShare(token: string): Promise<{ record: MedicalRecord; expiresAt: string } | { reason?: string }> {
  if (!SHARE_TOKEN_PATTERN.test(token)) return {};
  const db = createAdminClient();
  const { data: share } = await db.from("record_shares")
    .select("id, pet_id, problem_id, expires_at, revoked_at, views")
    .eq("token_hash", await hashShareToken(token)).maybeSingle();
  if (!share) return {};
  if (share.revoked_at) return { reason: "This link was cancelled by the clinic." };
  if (new Date(share.expires_at).getTime() < Date.now()) return { reason: `This link expired on ${formatDate(share.expires_at)}.` };
  const record = await loadMedicalRecord(db, share.pet_id, share.problem_id);
  if (!record) return {};
  await db.from("record_shares").update({ views: share.views + 1, last_viewed_at: new Date().toISOString() }).eq("id", share.id);
  return { record, expiresAt: share.expires_at };
}

export default async function SharedRecordPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const opened = await openShare(token);
  if (!("record" in opened)) return <Unavailable reason={opened.reason} />;
  const { record, expiresAt } = opened;
  return (
    <PrintShell clinic={record.clinic} title={record.scope ? `Medical record — ${record.scope.title}` : "Medical record"}
      meta={`Prepared ${formatDateTime(record.generatedAt)}`}
      footer={<>Shared privately with {record.pet.name}&apos;s owner · this link stops working on {formatDate(expiresAt)}.
        <span className="mt-1.5 block text-[11px] font-medium text-foreground/80">AI softwares by OBD · +92 337 8624781</span></>}>
      <MedicalRecordView r={record} />
    </PrintShell>
  );
}

function Unavailable({ reason = "This link isn't valid." }: { reason?: string }) {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <div className="grid max-w-sm justify-items-center gap-4 rounded-2xl bg-card p-8 text-center shadow-card ring-1 ring-border">
        <LogoMark tone="burgundy" className="w-12" />
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><LinkIcon className="size-5" /></span>
        <h1 className="text-xl font-semibold">Record not available</h1>
        <p className="text-muted-foreground">{reason} Please ask Bin Dawood Animal Hospital for a new link.</p>
      </div>
    </main>
  );
}
