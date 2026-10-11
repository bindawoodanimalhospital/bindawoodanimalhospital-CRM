import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoGrid, PrintShell, type ClinicProfile } from "@/components/print/print-shell";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { formatDate, formatPKR, todayPK } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Statement" };
const ENTRY: Record<string, string> = { invoice: "Bill", payment: "Payment", refund: "Refund", write_off: "Written off", return: "Return" };

/** Customer statement (spec §46). ?from=YYYY-MM-DD&to=YYYY-MM-DD optional. */
export default async function StatementPrint({ params, searchParams }: PageProps<"/print/statement/[id]">) {
  await requireStaff("billing.view");
  const { id } = await params;
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : null;
  const to = typeof sp.to === "string" ? sp.to : todayPK();
  const supabase = await createClient();
  const [{ data: c }, { data: ledger }, clinic] = await Promise.all([
    supabase.from("customers").select("code, full_name, phone, address, area").eq("id", id).maybeSingle(),
    supabase.from("customer_ledger").select("*").eq("customer_id", id).order("at"),
    getSetting<ClinicProfile>("clinic.profile"),
  ]);
  if (!c) notFound();
  const end = new Date(`${to}T23:59:59+05:00`).getTime();
  const start = from ? new Date(`${from}T00:00:00+05:00`).getTime() : 0;
  let opening = 0; let running = 0;
  const rows: { at: string; entry: string; ref: string; debit: number; credit: number; running: number }[] = [];
  for (const r of ledger ?? []) {
    const t = new Date(r.at).getTime();
    const d = Number(r.debit) - Number(r.credit);
    if (t < start) { opening += d; running += d; continue; }
    if (t > end) continue;
    running += d;
    rows.push({ at: r.at, entry: r.entry, ref: r.ref, debit: Number(r.debit), credit: Number(r.credit), running });
  }

  return (
    <PrintShell clinic={clinic ?? {}} title="Account statement">
      <InfoGrid rows={[["Customer", `${c.full_name} (${c.code})`], ["Phone", formatPhone(c.phone)], ["Address", [c.address, c.area].filter(Boolean).join(", ") || null],
        ["Period", `${from ? formatDate(from) : "Start"} – ${formatDate(to)}`]]} />
      <table className="mt-5 w-full border-collapse text-[12px]">
        <thead><tr className="border-b-2 border-ink text-left uppercase"><th className="py-1.5">Date</th><th>Details</th><th className="text-right">Charged</th><th className="text-right">Paid</th><th className="text-right">Balance</th></tr></thead>
        <tbody>
          {from && <tr className="border-b"><td className="py-1.5" colSpan={4}>Opening balance</td><td className="text-right font-semibold">{formatPKR(opening)}</td></tr>}
          {rows.map((r, i) => (
            <tr key={i} className="border-b">
              <td className="py-1.5">{formatDate(r.at)}</td><td>{ENTRY[r.entry] ?? r.entry} {r.ref}</td>
              <td className="text-right">{r.debit ? formatPKR(r.debit) : ""}</td><td className="text-right">{r.credit ? formatPKR(r.credit) : ""}</td>
              <td className="text-right font-semibold">{formatPKR(r.running)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 text-right text-lg">{running > 0 ? "Amount due" : running < 0 ? "Advance held" : "Balance"}: <b>{formatPKR(Math.abs(running))}</b></p>
    </PrintShell>
  );
}
