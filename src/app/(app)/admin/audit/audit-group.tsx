"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type GroupRow = { id: number; text: string; detail: string | null; href: string | null; reason: string | null; isChange: boolean };
type Change = { id: number; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; changed: string[] | null };

/** Keys that are noise in a diff view. */
const HIDDEN = new Set(["search_text", "updated_at", "created_at", "idempotency_key", "refresh_token_hmac_key"]);
const SHOW_ROWS = 25;

/**
 * One entry of the activity log. The before → after values are fetched only when someone opens
 * the entry, so the page stays light even with hundreds of entries (each can hold many fields).
 */
export function AuditGroup({ header, rows }: { header: React.ReactNode; rows: GroupRow[] }) {
  const [changes, setChanges] = useState<Map<number, Change> | null>(null);
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);

  const onToggle = async (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!e.currentTarget.open || changes || loading) return;
    const ids = rows.filter((r) => r.isChange).map((r) => r.id);
    if (!ids.length) { setChanges(new Map()); return; }
    setLoading(true);
    const { data } = await createClient().from("audit_logs").select("id, action, old_data, new_data, changed").in("id", ids.slice(0, 200));
    setChanges(new Map(((data ?? []) as Change[]).map((c) => [c.id, c])));
    setLoading(false);
  };

  const visible = all ? rows : rows.slice(0, SHOW_ROWS);
  return (
    <details className="group text-sm open:bg-muted/30" onToggle={onToggle}>
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3">{header}</summary>
      <div className="grid gap-2 px-4 pb-3 sm:pl-15">
        {loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading the details…</p>}
        {visible.map((r) => {
          const c = changes?.get(r.id);
          return (
            <div key={r.id} className="rounded-xl bg-card p-3 ring-1 ring-border">
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-medium">{r.text}</span>
                {r.href && <Link href={r.href} className="text-xs font-semibold text-brand hover:underline">open</Link>}
              </p>
              {r.detail && <p className="text-xs break-all text-muted-foreground">{r.detail}</p>}
              {r.reason && <p className="mt-1 text-xs"><b>Reason:</b> {r.reason}</p>}
              {c && <Diff c={c} />}
            </div>
          );
        })}
        {rows.length > SHOW_ROWS && !all && (
          <button type="button" onClick={() => setAll(true)} className="justify-self-start text-xs font-semibold text-brand hover:underline">
            Show all {rows.length} changes
          </button>
        )}
      </div>
    </details>
  );
}

function Diff({ c }: { c: Change }) {
  const only = c.action === "update" ? (c.changed ?? []).filter((f) => !HIDDEN.has(f)) : null;
  const keys = (only ?? Object.keys(c.new_data ?? c.old_data ?? {})).filter((k) => !HIDDEN.has(k));
  if (!keys.length) return null;
  const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs">
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="align-top">
              <td className="w-32 py-0.5 pr-3 text-muted-foreground sm:w-40">{k.replace(/_/g, " ")}</td>
              {only && <td className="py-0.5 pr-3 break-all text-danger line-through">{show(c.old_data?.[k])}</td>}
              <td className="py-0.5 break-all">{show((c.new_data ?? c.old_data)?.[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
