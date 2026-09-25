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
