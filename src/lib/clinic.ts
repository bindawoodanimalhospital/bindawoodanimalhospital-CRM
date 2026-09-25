/** Shared labels & helpers for clinic workflows (queue, appointments, records). Plain words on purpose. */

export type VisitStatus = "waiting" | "with_doctor" | "in_treatment" | "ready_for_billing" | "completed" | "cancelled";
export type VisitPriority = "normal" | "urgent" | "emergency";
export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const VISIT_STAGES: { status: VisitStatus; label: string; hint: string; tone: Tone }[] = [
  { status: "waiting", label: "Waiting", hint: "Checked in, waiting to be seen", tone: "warning" },
  { status: "with_doctor", label: "With doctor", hint: "In the consultation room", tone: "brand" },
  { status: "in_treatment", label: "Treatment / tests", hint: "Injection, dressing, ultrasound, lab…", tone: "info" },
  { status: "ready_for_billing", label: "Ready to pay", hint: "Done with the doctor — collect payment", tone: "success" },
];

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  waiting: "Waiting", with_doctor: "With doctor", in_treatment: "Treatment / tests",
  ready_for_billing: "Ready to pay", completed: "Done", cancelled: "Cancelled",
};

/** The obvious next step for each stage (shown as the card's main button). */
export const NEXT_STEP: Partial<Record<VisitStatus, { to: VisitStatus; label: string }>> = {
  waiting: { to: "with_doctor", label: "Call in" },
  with_doctor: { to: "ready_for_billing", label: "Done with doctor" },
  in_treatment: { to: "ready_for_billing", label: "Treatment done" },
  ready_for_billing: { to: "completed", label: "Paid — finish" },
};

export const PRIORITY: Record<VisitPriority, { label: string; tone: Tone; rank: number }> = {
  emergency: { label: "Emergency", tone: "danger", rank: 0 },
  urgent: { label: "Urgent", tone: "warning", rank: 1 },
  normal: { label: "Normal", tone: "neutral", rank: 2 },
};

export const APPOINTMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  booked: { label: "Booked", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "info" },
  arrived: { label: "Arrived", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
  no_show: { label: "No-show", tone: "warning" },
};

/** "Just now", "12 min", "1 h 5 min" */
export function waitedFor(since: string | Date, now = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function minutesSince(since: string | Date, now = new Date()): number {
  return Math.floor((now.getTime() - new Date(since).getTime()) / 60000);
}

// ---------------------------------------------------------------- surgery & ward

export type SurgeryStatus = "planned" | "scheduled" | "admitted" | "pre_op" | "in_surgery" | "recovery" | "discharged" | "cancelled";

export const SURGERY_STAGES: { status: SurgeryStatus; label: string; tone: Tone }[] = [
  { status: "planned", label: "Planned", tone: "neutral" },
  { status: "scheduled", label: "Scheduled", tone: "info" },
  { status: "admitted", label: "Admitted", tone: "info" },
  { status: "pre_op", label: "Pre-op", tone: "warning" },
  { status: "in_surgery", label: "In surgery", tone: "danger" },
  { status: "recovery", label: "Recovery", tone: "brand" },
  { status: "discharged", label: "Discharged", tone: "success" },
];

export const SURGERY_LABEL: Record<SurgeryStatus, string> = {
  planned: "Planned", scheduled: "Scheduled", admitted: "Admitted", pre_op: "Pre-op", in_surgery: "In surgery",
  recovery: "Recovery", discharged: "Discharged", cancelled: "Cancelled",
};

export const SURGERY_TONE: Record<SurgeryStatus, Tone> = {
  planned: "neutral", scheduled: "info", admitted: "info", pre_op: "warning", in_surgery: "danger",
  recovery: "brand", discharged: "success", cancelled: "neutral",
};

export const URGENCY: Record<string, { label: string; tone: Tone }> = {
  elective: { label: "Planned (elective)", tone: "neutral" },
  urgent: { label: "Urgent", tone: "warning" },
  emergency: { label: "Emergency", tone: "danger" },
};

export const ADMISSION_OUTCOMES: { value: string; label: string }[] = [
  { value: "discharged_home", label: "Went home" },
  { value: "transferred", label: "Transferred to another clinic" },
  { value: "left_against_advice", label: "Owner took pet against advice" },
  { value: "deceased", label: "Passed away" },
];

export type TreatmentSlot = { due_at: string; state: "given" | "skipped" | "refused" | "overdue" | "due" | "upcoming" };

/**
 * Dose times for a repeating order within [from, to], aligned to starts_at + k × every_hours.
 * `done` maps an ISO due_at to its recorded result. Pure — used on server and client.
 */
export function treatmentSlots(order: { starts_at: string; ends_at: string | null; every_hours: number | null },
  done: Map<string, "given" | "skipped" | "refused">, from: Date, to: Date, now = new Date()): TreatmentSlot[] {
  if (!order.every_hours) return [];
  const start = new Date(order.starts_at).getTime();
  const step = order.every_hours * 3600_000;
  const end = Math.min(to.getTime(), order.ends_at ? new Date(order.ends_at).getTime() : Infinity);
  let k = Math.max(0, Math.ceil((from.getTime() - start) / step));
  const out: TreatmentSlot[] = [];
  for (let t = start + k * step; t <= end && out.length < 200; k++, t = start + k * step) {
    const iso = new Date(t).toISOString();
    const result = done.get(iso);
    const mins = (t - now.getTime()) / 60000;
    out.push({ due_at: iso, state: result ?? (mins < -30 ? "overdue" : mins <= 30 ? "due" : "upcoming") });
  }
  return out;
}
