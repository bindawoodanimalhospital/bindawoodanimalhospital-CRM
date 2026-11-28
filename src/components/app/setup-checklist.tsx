import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, CircleCheck, CircleDashed, Rocket } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";

type Step = { done: boolean; title: string; detail: string; short: string; href: string; action: string };

/**
 * "Getting ready" — shown on Home to whoever manages settings (the owner) until the clinic's own details are in:
 * phone numbers, prices, approved vaccine schedules and consent wording, dewormers on the price list, pet-store
 * products and staff accounts. Each step links to the screen where it is done; the card disappears when all are done.
 */
export async function SetupChecklist() {
  const supabase = await createClient();
  const [profile, consent, unpriced, schedules, dewormers, retail, staff] = await Promise.all([
    getSetting<Record<string, string>>("clinic.profile"),
    getSetting<{ status?: string }>("surgery.consent_text"),
    supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("is_active", true).eq("price_is_editable", false).eq("sale_price", 0),
    supabase.from("vaccination_protocols").select("id", { count: "exact", head: true }).eq("is_active", true).eq("is_approved", false),
    supabase.from("dewormers").select("id", { count: "exact", head: true }).eq("is_active", true).is("catalog_item_id", null)
      .not("name", "ilike", "%other%"),
    supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("is_active", true).eq("is_retail", true),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  const phone = profile?.phone || profile?.whatsapp;
  const steps: Step[] = [
    { done: !!phone, title: "Clinic phone number",
      detail: phone ? "Printed on bills, receipts, prescriptions and discharge sheets." : "Not set yet — no printout shows a number to call.",
      short: "Not set yet", href: "/settings#clinic-profile", action: "Add number" },
    { done: (unpriced.count ?? 0) === 0, title: "Prices on the price list",
      detail: unpriced.count ? `${unpriced.count} service${unpriced.count === 1 ? " or product has" : "s and products have"} no price — they can't be billed until they do.` : "Every item has a price.",
      short: `${unpriced.count ?? 0} without a price`, href: "/inventory?tab=prices&unpriced=1", action: "Set prices" },
    { done: (schedules.count ?? 0) === 0, title: "Approve vaccine schedules",
      detail: schedules.count ? `${schedules.count} schedule${schedules.count === 1 ? " is" : "s are"} still a draft — next doses aren't suggested until a senior doctor approves them.` : "All schedules approved.",
      short: `${schedules.count ?? 0} still ${schedules.count === 1 ? "a draft" : "drafts"}`, href: "/settings/vaccines", action: "Review schedules" },
    { done: consent?.status === "approved", title: "Approve consent wording",
      detail: consent?.status === "approved" ? "Approved wording prints on the consent form." : "Still the draft wording — the consent form prints “Draft wording”.",
      short: "Prints “Draft wording” until approved", href: "/settings#wording", action: "Review wording" },
    { done: (dewormers.count ?? 0) === 0, title: "Link dewormers to prices",
      detail: dewormers.count ? `${dewormers.count} dewormer${dewormers.count === 1 ? " isn't" : "s aren't"} linked — a deworming isn't suggested on the bill until it is.` : "All dewormers are linked.",
      short: `${dewormers.count ?? 0} not linked yet`, href: "/settings/vaccines#dewormers", action: "Link dewormers" },
    { done: (retail.count ?? 0) > 0, title: "Pet-store products",
      detail: retail.count ? `${retail.count} product${retail.count === 1 ? "" : "s"} on sale in the pet store.` : "No products yet — add food, accessories and medicines you sell.",
      short: "None yet — food, accessories, medicines", href: "/inventory/new?store=1", action: "Add a product" },
    { done: (staff.count ?? 0) > 1, title: "Staff accounts",
      detail: (staff.count ?? 0) > 1 ? `${staff.count} people can sign in.` : "Only your own account — add doctors and reception so each person signs in as themselves.",
      short: "Only your own account", href: "/admin/staff", action: "Add staff" },
  ];
  const left = steps.filter((s) => !s.done);
  if (left.length === 0) return null;

  const done = steps.length - left.length;
  const finished = steps.filter((s) => s.done);
  return (
    <details open={left.length >= 4} className="group rounded-3xl bg-card shadow-card ring-1 ring-brand-muted">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 sm:p-5 md:p-6 [&::-webkit-details-marker]:hidden">
        <span className="hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white sm:flex"><Rocket className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base font-bold sm:text-lg">Getting ready to start</h2>
          <p className="text-sm text-muted-foreground">
            {done} of {steps.length} done
            <span className="hidden sm:inline"> — finish the {left.length === 1 ? "last step" : `other ${left.length}`} so everything prints and bills correctly. This card goes away when they&apos;re all done.</span>
          </p>
          <span className="mt-2 block h-1.5 max-w-sm overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-brand-gradient" style={{ width: `${Math.max(4, (done / steps.length) * 100)}%` }} />
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand">
          <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span>
          <ChevronDown className="size-4 transition group-open:rotate-180" />
        </span>
      </summary>
      <div className="grid gap-1.5 px-3 pb-3 sm:gap-2 sm:px-5 sm:pb-5 md:px-6 md:pb-6">
        {left.map((s) => (
          <Link key={s.title} href={s.href}
            className="group/step flex items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 ring-1 ring-border transition hover:ring-brand-muted sm:px-3.5 sm:py-3">
            <CircleDashed className="size-5 shrink-0 text-warning" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm leading-snug font-semibold sm:text-base">{s.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground sm:hidden">{s.short}</span>
              <span className="mt-0.5 hidden text-xs leading-snug text-muted-foreground sm:block">{s.detail}</span>
            </span>
            <span className="hidden h-9 shrink-0 items-center gap-1.5 rounded-xl bg-brand-gradient px-3.5 text-sm font-semibold text-white shadow-sm sm:inline-flex">
              {s.action} <ArrowRight className="size-4" />
            </span>
            <ChevronRight className="size-5 shrink-0 text-brand sm:hidden" aria-hidden />
          </Link>
        ))}
        {finished.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-xs text-muted-foreground">
            {finished.map((s) => (
              <span key={s.title} className="inline-flex items-center gap-1"><CircleCheck className="size-3.5 text-success" /> {s.title}</span>
            ))}
          </p>
        )}
      </div>
    </details>
  );
}
