import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

type Row = { id: string; kind: "Deworming" | "Vaccine"; what: string; at: string; pet_id: string; pet: string; bill: string | null };

/**
 * Dewormings / vaccines recorded from a bill that the doctor hasn't confirmed yet. Each opens the pet,
 * where Confirm / Wrong product / Not given are. Reminders already run in the meantime.
 */
export async function ToConfirm() {
  const supabase = await createClient();
  const [{ data: dew }, { data: vac }] = await Promise.all([
    supabase.from("dewormings").select("id, product, given_at, pet_id, notes, pets(name)").eq("confirmed", false).is("voided_at", null).order("given_at").limit(100),
    supabase.from("vaccinations").select("id, vaccine_name, administered_at, pet_id, notes, pets(name)").eq("confirmed", false).is("voided_at", null).order("administered_at").limit(100),
  ]);
  const bill = (n: string | null) => n?.match(/bill (BD-[\w-]+)/)?.[1] ?? null;
  const rows: Row[] = [
    ...(dew ?? []).map((d) => ({ id: d.id, kind: "Deworming" as const, what: d.product, at: d.given_at, pet_id: d.pet_id,
      pet: (d.pets as unknown as { name: string } | null)?.name ?? "Pet", bill: bill(d.notes) })),
    ...(vac ?? []).map((v) => ({ id: v.id, kind: "Vaccine" as const, what: v.vaccine_name, at: v.administered_at, pet_id: v.pet_id,
      pet: (v.pets as unknown as { name: string } | null)?.name ?? "Pet", bill: bill(v.notes) })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (!rows.length) return null;
  return (
    <section id="confirm" className="mb-6 rounded-2xl bg-warning-soft p-4 ring-1 ring-warning/30">
      <p className="flex items-center gap-2 font-semibold text-warning"><CircleHelp className="size-5" /> Confirm what was given ({rows.length})</p>
      <p className="mt-1 text-xs text-warning">
        These were billed but not recorded on the visit. Open the pet and press Confirm, Wrong product or Not given. Reminders are already set meanwhile.
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-1.5">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-border">
            <Link href={`/pets/${r.pet_id}`} className="font-semibold hover:underline">{r.pet}</Link>
            <span>{r.kind}: <b>{r.what}</b></span>
            <span className="text-xs text-muted-foreground">{formatDate(r.at)}{r.bill ? ` · bill ${r.bill}` : ""}</span>
            <Link href={`/pets/${r.pet_id}`} className="ml-auto text-sm font-semibold text-brand hover:underline">Open to confirm →</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
