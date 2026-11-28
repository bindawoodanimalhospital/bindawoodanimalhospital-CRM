import Link from "next/link";
import { ArrowRight, ChevronDown, CircleCheck, CircleDashed, Rocket } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";

type Step = { done: boolean; title: string; detail: string; href: string; action: string };

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
    { done: !!phone, title: "Clinic phone & WhatsApp number",
      detail: phone ? "Printed on bills, receipts, prescriptions and discharge sheets." : "Not set yet — no printout shows a number to call.",
      href: "/settings#clinic-profile", action: "Add number" },
    { done: (unpriced.count ?? 0) === 0, title: "Prices on the price list",
      detail: unpriced.count ? `${unpriced.count} service${unpriced.count === 1 ? " or product has" : "s and products have"} no price — they can't be billed until they do.` : "Every item has a price.",
      href: "/inventory?tab=prices&unpriced=1", action: "Set prices" },
    { done: (schedules.count ?? 0) === 0, title: "Vaccine schedules approved",
      detail: schedules.count ? `${schedules.count} schedule${schedules.count === 1 ? " is" : "s are"} still a draft — next doses aren't suggested until a senior doctor approves them.` : "All schedules approved.",
      href: "/settings/vaccines", action: "Review schedules" },
    { done: consent?.status === "approved", title: "Surgery consent wording approved",
      detail: consent?.status === "approved" ? "Approved wording prints on the consent form." : "Still the draft wording — the consent form prints “Draft wording”.",
      href: "/settings#wording", action: "Review wording" },
    { done: (dewormers.count ?? 0) === 0, title: "Dewormers linked to the price list",
      detail: dewormers.count ? `${dewormers.count} dewormer${dewormers.count === 1 ? " isn't" : "s aren't"} linked — a deworming isn't suggested on the bill until it is.` : "All dewormers are linked.",
      href: "/settings/vaccines#dewormers", action: "Link dewormers" },
    { done: (retail.count ?? 0) > 0, title: "Pet-store products",
      detail: retail.count ? `${retail.count} product${retail.count === 1 ? "" : "s"} on sale in the pet store.` : "No products yet — add food, accessories and medicines you sell.",
      href: "/inventory/new?store=1", action: "Add a product" },
    { done: (staff.count ?? 0) > 1, title: "Staff accounts",
      detail: (staff.count ?? 0) > 1 ? `${staff.count} people can sign in.` : "Only your own account — add doctors and reception so each person signs in as themselves.",
      href: "/admin/staff", action: "Add staff" },
  ];
  const left = steps.filter((s) => !s.done);
  if (left.length === 0) return null;

  const done = steps.length - left.length;
  return (
    <details open={left.length >= 4} className="group rounded-3xl bg-card shadow-card ring-1 ring-brand-muted">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-5 md:p-6 [&::-webkit-details-marker]:hidden">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-gradient text-white"><Rocket className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-bold">Getting ready to start</h2>
          <p className="text-sm text-muted-foreground">{done} of {steps.length} done — finish the {left.length === 1 ? "last step" : `other ${left.length}`} so everything prints and bills correctly. This card goes away when they&apos;re all done.</p>
          <span className="mt-2 block h-1.5 max-w-sm overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-brand-gradient" style={{ width: `${(done / steps.length) * 100}%` }} />
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
          <span className="group-open:hidden">Show steps</span><span className="hidden group-open:inline">Hide</span>
          <ChevronDown className="size-4 transition group-open:rotate-180" />
        </span>
      </summary>
      <ul className="grid gap-2 px-5 pb-5 md:px-6 md:pb-6">
        {steps.map((s) => (
          <li key={s.title} className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-3.5 py-3 ring-1 ring-border">
            {s.done ? <CircleCheck className="size-5 shrink-0 text-success" /> : <CircleDashed className="size-5 shrink-0 text-warning" />}
            <div className="min-w-0 flex-1">
              <p className={s.done ? "font-semibold text-muted-foreground line-through decoration-1" : "font-semibold"}>{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.detail}</p>
            </div>
            {!s.done && (
              <Link href={s.href} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-gradient px-3.5 text-sm font-semibold text-white shadow-sm">
                {s.action} <ArrowRight className="size-4" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
