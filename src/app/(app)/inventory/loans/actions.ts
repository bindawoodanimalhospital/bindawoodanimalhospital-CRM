"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const refresh = (id?: string) => {
  revalidatePath("/inventory/loans");
  if (id) revalidatePath(`/inventory/loans/${id}`);
  revalidatePath("/inventory");
};

export type StockItemOption = { id: string; name: string; unit: string; usable: number };

/** Stock-tracked items for a loan line, with what's usable right now. */
export async function searchStockItems(q: string): Promise<StockItemOption[]> {
  await assertCan("inventory.view");
  const term = q.replace(/[^\p{L}\p{N} .\-]/gu, "").trim();
  const supabase = await createClient();
  let query = supabase.from("stock_levels").select("item_id, name, unit, usable_qty").order("name").limit(15);
  if (term) query = query.ilike("name", `%${term}%`);
  const { data } = await query;
  return (data ?? []).map((r) => ({ id: r.item_id, name: r.name, unit: r.unit, usable: Number(r.usable_qty) }));
}

const partnerSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name"),
  kind: z.enum(["clinic", "hospital", "pet_store", "pharmacy", "other"]).default("clinic"),
  contact_name: z.string().trim().optional().transform((v) => v || null),
  phone: z.string().trim().optional().transform((v) => v || null),
  address: z.string().trim().optional().transform((v) => v || null),
  notes: z.string().trim().optional().transform((v) => v || null),
});

export async function savePartner(id: string | null, input: z.input<typeof partnerSchema>): Promise<FormState & { id?: string }> {
  await assertCan("inventory.manage");
  const parsed = partnerSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("partner_businesses").update(parsed.data).eq("id", id).select("id").single()
    : await supabase.from("partner_businesses").insert(parsed.data).select("id").single();
  if (error) return { message: error.code === "23505" ? "A business with this name already exists." : dbErrorMessage(error) };
  refresh();
  return { ok: true, id: data.id, message: id ? "Business updated." : "Business added." };
}

export type LoanLineInput = { item_id: string; qty: number; batch_no?: string; expiry_date?: string; location_id?: string; notes?: string };

export async function recordLoan(input: {
  key: string; direction: "borrowed" | "lent"; partner_id: string; lines: LoanLineInput[];
  loan_date?: string; expected_return?: string; reference?: string; notes?: string;
}): Promise<FormState & { id?: string }> {
  await assertCan("inventory.manage");
  if (!input.partner_id) return { message: "Choose the business." };
  const lines = input.lines.filter((l) => l.item_id && l.qty > 0);
  if (!lines.length) return { message: "Add at least one product with a quantity." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_stock_loan", {
    p_key: input.key, p_direction: input.direction, p_partner: input.partner_id, p_lines: lines,
    p_loan_date: input.loan_date || null, p_expected_return: input.expected_return || null,
    p_reference: input.reference || null, p_notes: input.notes || null,
  });
  if (error) return { message: error.message };
  refresh(data as string);
  return { ok: true, id: data as string, message: input.direction === "borrowed" ? "Borrowed stock recorded — added to stock." : "Lent stock recorded — taken out of stock." };
}

export async function recordLoanReturn(loanId: string, input: {
  key: string; lines: { loan_line_id: string; qty: number; batch_no?: string; expiry_date?: string }[]; returned_on?: string; notes?: string;
}): Promise<FormState> {
  await assertCan("inventory.manage");
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) return { message: "Enter the quantity being returned." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_stock_loan_return", {
    p_key: input.key, p_loan: loanId, p_lines: lines, p_returned_on: input.returned_on || null, p_notes: input.notes || null,
  });
  if (error) return { message: error.message };
  refresh(loanId);
  return { ok: true, message: "Return recorded." };
}

export async function cancelLoan(loanId: string, reason: string): Promise<FormState> {
  await assertCan("inventory.manage");
  if (reason.trim().length < 3) return { message: "Say why it is being cancelled." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_stock_loan", { p_loan: loanId, p_reason: reason.trim() });
  if (error) return { message: error.message };
  refresh(loanId);
  return { ok: true, message: "Record cancelled — stock reversed." };
}
