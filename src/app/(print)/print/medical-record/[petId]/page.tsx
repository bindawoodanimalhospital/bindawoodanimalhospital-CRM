import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintShell } from "@/components/print/print-shell";
import { MedicalRecordView } from "@/components/app/medical-record";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { loadMedicalRecord } from "@/lib/medical-record";

export const metadata: Metadata = { title: "Medical record" };

/** The owner's medical record (whole history, or one problem with ?problem=), to print or save as PDF and send. */
export default async function MedicalRecordPrint({ params, searchParams }: PageProps<"/print/medical-record/[petId]">) {
  const me = await requireStaff();
  if (!me.can("clinical.view")) notFound();
  const { petId } = await params;
  const { problem } = await searchParams;
  const r = await loadMedicalRecord(await createClient(), petId, typeof problem === "string" ? problem : null);
  if (!r) notFound();
  return (
    <PrintShell clinic={r.clinic} title={r.scope ? `Medical record — ${r.scope.title}` : "Medical record"}
      meta={`Prepared ${formatDateTime(r.generatedAt)}`}
      footer={<>For the owner&apos;s information. Medicines must be given only as the doctor prescribed.</>}>
      <MedicalRecordView r={r} />
    </PrintShell>
  );
}
