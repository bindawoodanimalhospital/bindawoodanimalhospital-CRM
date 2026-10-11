"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const schema = z.object({
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  category_id: z.uuid("Choose a category"),
  amount: z.coerce.number().positive("Enter the amount"),
  method: z.string().min(1),
  payee: z.string().trim().optional().transform((v) => v || null),
  description: z.string().trim().min(2, "What was it for?"),
  reference: z.string().trim().optional().transform((v) => v || null),
  document_id: z.string().optional().transform((v) => v || null),
});

export async function addExpense(input: z.input<typeof schema>): Promise<FormState> {
  const me = await assertCan("expenses.manage");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({ ...parsed.data, created_by: me.id });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/expenses");
  return { ok: true, message: "Expense recorded." };
}

/** Expenses are never edited: a mistake is cancelled with a matching negative entry. */
export async function reverseExpense(id: string, reason: string): Promise<FormState> {
  const me = await assertCan("expenses.manage");
  if (reason.trim().length < 3) return { message: "Give a reason." };
  const supabase = await createClient();
  const { data: e } = await supabase.from("expenses").select("*").eq("id", id).single();
  if (!e) return { message: "Not found." };
  if (e.amount < 0) return { message: "This is already a reversal." };
  const { error } = await supabase.from("expenses").insert({
    spent_on: e.spent_on, category_id: e.category_id, amount: -e.amount, method: e.method, payee: e.payee,
    description: `Reversal: ${reason.trim()}`, reverses_id: e.id, created_by: me.id,
  });
  if (error) return { message: error.code === "23505" ? "Already reversed." : dbErrorMessage(error) };
  revalidatePath("/expenses");
  return { ok: true, message: "Reversed." };
}

export async function recordBusinessFile(doc: { path: string; file_name: string; mime_type: string; size_bytes: number }): Promise<{ id?: string; message?: string }> {
  await assertCan("expenses.manage");
  if (!doc.path.startsWith("expenses/")) return { message: "Invalid path." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents")
    .insert({ ...doc, bucket: "business-files", entity_type: "expense", entity_id: crypto.randomUUID(), category: "receipt" }).select("id").single();
  if (error) return { message: dbErrorMessage(error) };
  return { id: data.id };
}

export async function receiptUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.storage.from("business-files").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
