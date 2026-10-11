import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Money a customer has paid that isn't allocated to any bill yet (deposits / advances). */
export async function customerCredit(customerId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("payments").select("amount, payment_allocations(amount)")
    .eq("customer_id", customerId).eq("kind", "payment");
  return Math.round((data ?? []).reduce((sum, p) => {
    const used = ((p.payment_allocations ?? []) as { amount: number }[]).reduce((s, a) => s + Number(a.amount), 0);
    return sum + Math.max(0, Number(p.amount) - used);
  }, 0) * 100) / 100;
}

export async function paymentMethods() {
  const supabase = await createClient();
  const { data } = await supabase.from("payment_methods").select("key, label, needs_reference").eq("is_active", true).order("sort_order");
  return data ?? [];
}
