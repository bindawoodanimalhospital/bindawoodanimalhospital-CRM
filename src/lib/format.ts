import { differenceInDays, differenceInMonths, differenceInYears } from "date-fns";

export const TIMEZONE = "Asia/Karachi";

const pkr = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/** "Rs. 25,000" — PKR is shown without decimals, as local invoices do. */
export function formatPKR(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  return `Rs. ${pkr.format(Math.round(n))}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TIMEZONE })
    .format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: TIMEZONE,
  }).format(new Date(value));
}

/** "3 yrs 2 mo", "5 mo", "12 days" */
export function formatAge(dob: string | null | undefined, estimate = false): string {
  if (!dob) return "";
  const d = new Date(dob);
  const now = new Date();
  const years = differenceInYears(now, d);
  const months = differenceInMonths(now, d) - years * 12;
  let text: string;
  if (years >= 1) text = months ? `${years} yr${years > 1 ? "s" : ""} ${months} mo` : `${years} yr${years > 1 ? "s" : ""}`;
  else if (differenceInMonths(now, d) >= 1) text = `${differenceInMonths(now, d)} mo`;
  else text = `${differenceInDays(now, d)} days`;
  return estimate ? `~${text}` : text;
}

export function initials(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/** "active" → "Active" (first letter only; leaves the rest untouched). */
export function sentence(s: string | null | undefined): string {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/** "3:45 pm" in Lahore time. */
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TIMEZONE })
    .format(new Date(value)).replace(/\s?(am|pm)/i, (m) => m.toLowerCase());
}

/** Today's date in Lahore as YYYY-MM-DD. */
export function todayPK(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

/** Lahore date N days from today, as YYYY-MM-DD (safe around midnight, unlike toISOString). */
export function addDaysPK(days: number): string {
  const [y, m, d] = todayPK().split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
