import { BellRing, CalendarCheck, CircleCheck, MessageCircle, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/** The days, relative to the due date, when the reminder engine acts (from Reminder settings). */
export type RulePlan = { customer: number[]; staff: number[] };

const dayName = (ymd: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
  .format(new Date(`${ymd}T00:00:00Z`));
const shift = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const when = (d: number) => (d === 0 ? "on the day" : d < 0 ? `${-d} day${d === -1 ? "" : "s"} before` : `${d} day${d === 1 ? "" : "s"} after`);

/**
 * "What happens next" for a next-dose date: the exact days a WhatsApp reminder is prepared for the
 * owner and reception is alerted — and that it all stops once the pet gets the dose.
 */
export function ReminderPlan({ due, plan, what, className }: { due: string; plan: RulePlan; what: string; className?: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const steps = [
    ...plan.customer.map((d) => ({ d, kind: "owner" as const })),
    ...plan.staff.filter((d) => d > 0).map((d) => ({ d, kind: "staff" as const })),
  ].sort((a, b) => a.d - b.d || (a.kind === "owner" ? -1 : 1));
  return (
    <div className={cn("rounded-xl bg-info-soft p-3 text-sm text-info", className)}>
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold"><BellRing className="size-4" /> What happens next</p>
      <ul className="grid gap-1">
        <li className="flex items-start gap-2"><CalendarCheck className="mt-0.5 size-3.5 shrink-0" />
          <span><b>{dayName(due)}</b> — {what} is due. It shows in <b>Due &amp; follow-ups</b> from today.</span></li>
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            {s.kind === "owner" ? <MessageCircle className="mt-0.5 size-3.5 shrink-0" /> : <UserRound className="mt-0.5 size-3.5 shrink-0" />}
            <span><b>{dayName(shift(due, s.d))}</b> ({when(s.d)}) — {s.kind === "owner"
              ? <>a WhatsApp reminder for the owner appears in <b>Messages to send</b>, ready to send in one tap</>
              : <>if the pet still hasn&apos;t come, reception is alerted to call</>}</span>
          </li>
        ))}
        <li className="flex items-start gap-2"><CircleCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>As soon as the next dose is recorded, the remaining reminders stop by themselves.</span></li>
      </ul>
    </div>
  );
}

/** Plain explanation of how next-dose reminders work, for the Due and Reminder settings pages. */
export function HowRemindersWork({ vaccine, deworming }: { vaccine: RulePlan; deworming: RulePlan }) {
  const list = (p: RulePlan) => p.customer.map(when).join(", ");
  return (
    <details className="group mb-6 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
        <BellRing className="size-5 text-brand" /> How next-dose reminders work (vaccines &amp; deworming)
        <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">Tap to read</span>
      </summary>
      <ol className="mt-3 grid gap-2 text-sm">
        <li><b>1. The doctor sets the next date.</b> When recording a vaccine or deworming on the visit, the doctor fills in “Next dose due” (a schedule or the pet&apos;s age suggests it). No date = no reminder.</li>
        <li><b>2. It appears here.</b> The pet is listed in Due &amp; follow-ups under Upcoming → Today → Overdue.</li>
        <li><b>3. WhatsApp messages are prepared automatically</b> (checked every 30 minutes) — vaccines: {list(vaccine)}; deworming: {list(deworming)} the due date — in the owner&apos;s language, in <b>Messages to send</b>. Reception opens each one in WhatsApp and presses Send. Phone numbers are private, so only the hospital owner can send them.</li>
        <li><b>4. If the pet doesn&apos;t come,</b> reception is alerted to call, and it is escalated to the owner if still overdue.</li>
        <li><b>5. It stops by itself</b> the moment the next dose is recorded. Marking a record “entered by mistake” brings the old reminder back.</li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">The days and the message wording can be changed in Settings → Reminder settings.</p>
    </details>
  );
}
