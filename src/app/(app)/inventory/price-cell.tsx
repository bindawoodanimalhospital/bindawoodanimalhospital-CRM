"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { quickPrice } from "./actions";

/** Inline price edit in the price list: type and press Enter / leave the box. */
export function PriceCell({ id, price }: { id: string; price: number }) {
  const [v, setV] = useState(String(price));
  const [pending, start] = useTransition();
  const save = () => {
    const n = Number(v);
    if (n === price || Number.isNaN(n)) return;
    start(async () => { const r = await quickPrice(id, n); if (r.ok) toast.success(r.message); else { toast.error(r.message); setV(String(price)); } });
  };
  return (
    <span className="inline-flex items-center gap-1">
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      <Input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className={cn("h-9 w-28 text-right tabular", price === 0 && "ring-2 ring-warning/50")} aria-label="Price" />
    </span>
  );
}
