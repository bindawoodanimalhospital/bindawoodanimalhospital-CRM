"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan, getCurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type FormState } from "@/lib/validation";

const refresh = () => { revalidatePath("/tasks"); revalidatePath("/alerts"); revalidatePath("/dashboard"); };

const taskSchema = z.object({
  title: z.string().trim().min(2, "What needs to be done?"),
  details: z.string().trim().optional().transform((v) => v || null),
  assigned_to: z.string().optional().transform((v) => (v && v !== "none" ? v : null)),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_date: z.string().optional(), due_time: z.string().optional(),
  customer_id: z.string().optional().transform((v) => v || null),
  pet_id: z.string().optional().transform((v) => v || null),
});

export async function createTask(input: z.input<typeof taskSchema>): Promise<FormState> {
  const me = await assertCan("tasks.manage");
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };
  const { due_date, due_time, ...row } = parsed.data;
  const due_at = due_date ? new Date(`${due_date}T${due_time || "18:00"}:00+05:00`).toISOString() : null;
  const supabase = await createClient();
  // The assignee is notified by a database trigger; the engine reminds them again when it's due.
  const { error } = await supabase.from("tasks").insert({ ...row, due_at, created_by: me.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: "Task created." };
}

export async function setTaskStatus(id: string, status: "open" | "in_progress" | "done" | "cancelled", outcome?: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me) return { message: "Please sign in." };
  if ((status === "done" || status === "cancelled") && (outcome ?? "").trim().length < 3) return { message: "Write what was done (or why it's cancelled)." };
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ status, outcome: status === "done" || status === "cancelled" ? outcome!.trim() : null }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: status === "done" ? "Done — nice work." : "Updated." };
}

export async function updateTask(id: string, patch: { due_at?: string | null; assigned_to?: string | null; priority?: string }): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: "Saved." };
}

export async function addComment(taskId: string, body: string): Promise<FormState> {
  const me = await getCurrentStaff();
  if (!me) return { message: "Please sign in." };
  if (!body.trim()) return { message: "Write a comment." };
  const supabase = await createClient();
  const { error } = await supabase.from("task_comments").insert({ task_id: taskId, body: body.trim(), created_by: me.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}
