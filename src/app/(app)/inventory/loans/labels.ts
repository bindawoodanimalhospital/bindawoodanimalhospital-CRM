import type { Tone } from "@/lib/clinic";

export const LOAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_return: { label: "Pending return", tone: "warning" },
  partially_returned: { label: "Partly returned", tone: "info" },
  fully_returned: { label: "Fully returned", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** 4 → "4", 2.5 → "2.5" (quantities are numeric(12,2)). */
export function qtyText(n: number | string): string {
  return String(Math.round(Number(n) * 100) / 100);
}
