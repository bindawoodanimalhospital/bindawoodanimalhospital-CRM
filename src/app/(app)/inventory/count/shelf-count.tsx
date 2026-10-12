"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveCounts } from "../actions";

export type CountRow = { id: string; name: string; category: string | null; unit: string; current: number | null };

/**
 * Shelf count: walk the shelf, type how many of each product you see, press Save.
 * Only the rows you typed in are saved; each becomes "Shelf count" in that item's stock history.
 */
export function ShelfCount({ rows, onlyUncounted }: { rows: CountRow[]; onlyUncounted: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const cats = useMemo(() => [...new Set(rows.map((r) => r.category ?? "Other"))].sort(), [rows]);
  const shown = rows.filter((r) => (!cat || (r.category ?? "Other") === cat) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  const typed = Object.entries(values).filter(([, v]) => v !== "");
  const changed = typed.filter(([id, v]) => { const r = rows.find((x) => x.id === id); return r && (r.current == null || Number(v) !== r.current); });

  const save = () => start(async () => {
    const r = await saveCounts(typed.map(([item_id, v]) => ({ item_id, count: Number(v) })));
    if (r.ok) { toast.success(r.message); setValues({}); router.refresh(); } else toast.error(r.message);
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-11 bg-card pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product…" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-11 max-w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm" aria-label="Category">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
        <ul className="divide-y">
          {shown.map((r) => {
            const v = values[r.id] ?? "";
            const diff = v !== "" && r.current != null ? Number(v) - r.current : null;
            return (
              <li key={r.id} className={cn("flex items-center gap-3 px-4 py-2.5", v !== "" && "bg-brand-wash")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.category ?? "Other"} · {r.current == null ? "not counted yet" : `system has ${r.current} ${r.unit}`}
                    {diff != null && diff !== 0 && <b className={cn("ml-1", diff > 0 ? "text-success" : "text-warning")}>({diff > 0 ? "+" : ""}{diff})</b>}
                  </span>
                </span>
                <Input inputMode="decimal" aria-label={`Count for ${r.name}`} placeholder={r.current == null ? "count" : String(r.current)}
                  className="h-11 w-24 text-center text-lg font-semibold tabular" value={v}
                  onChange={(e) => setValues((x) => ({ ...x, [r.id]: e.target.value.replace(/[^\d.]/g, "") }))} />
              </li>
            );
          })}
          {!shown.length && <li className="p-6 text-center text-sm text-muted-foreground">{onlyUncounted ? "Every product has been counted." : "No products match."}</li>}
        </ul>
      </div>

      {/* Save bar stays in reach on long lists and on phones */}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-ink p-3 pl-4 text-white shadow-float">
        <span className="min-w-0 flex-1 text-sm">{typed.length ? `${typed.length} counted · ${changed.length} different from the system` : "Type the number you see on the shelf next to each product."}</span>
        {typed.length > 0 && <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setValues({})}>Clear</Button>}
        <Button disabled={pending || !typed.length} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <Check />} Save counts</Button>
      </div>
    </div>
  );
}
