import { createClient } from "@/lib/supabase/server";
import type { CurrentStaff } from "@/lib/auth";

export type RemovalRequest = {
  id: string; reason: string | null; created_at: string; reminders: number; requested_by: string;
  requester: { full_name: string | null } | null;
};
export type RemovalState = {
  kind: "customer" | "pet"; id: string; name: string;
  /** Hospital owner: may delete pet owners / pets. */
  canDelete: boolean;
  /** Why it can't be deleted (owner only; null = it can). */
  blocker: string | null;
  request: RemovalRequest | null;
};

/** Everything the removal panel needs for one pet owner or pet. */
export async function removalState(me: CurrentStaff, kind: "customer" | "pet", id: string, name: string): Promise<RemovalState> {
  const supabase = await createClient();
  const canDelete = me.can(kind === "customer" ? "customers.delete" : "pets.delete");
  const [{ data: req }, blockerQ] = await Promise.all([
    supabase.from("removal_requests").select("id, reason, created_at, reminders, requested_by, requester:requested_by(full_name)")
      .eq("status", "open").eq(kind === "customer" ? "customer_id" : "pet_id", id).maybeSingle(),
    canDelete ? supabase.rpc("record_delete_blocker", { p_kind: kind, p_id: id }) : Promise.resolve({ data: null }),
  ]);
  return { kind, id, name, canDelete, blocker: (blockerQ.data as string | null) ?? null, request: (req as unknown as RemovalRequest | null) ?? null };
}
