"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelOrder } from "./actions";

type Method = { key: string; label: string };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** "Cancel order" for a pet-store / delivery order. The reason is optional; anything paid is refunded. */
export function CancelOrderButton({ invoiceId, number, paid, methods, size = "sm" }: {
  invoiceId: string; number: string; paid: number; methods: Method[]; size?: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = useRef(newKey());
  const confirm = () => start(async () => {
    const r = await cancelOrder(invoiceId, reason, method, key.current);
    if (r.ok) { toast.success(r.message); setOpen(false); router.refresh(); } else toast.error(r.message);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size={size} className="text-danger hover:bg-danger-soft hover:text-danger"><Ban /> Cancel order</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Cancel order {number}?</DialogTitle>
          <DialogDescription>The products go back into stock and the order is kept as <b>Cancelled</b> in the records and the activity log.</DialogDescription>
        </DialogHeader>
        {paid > 0 && (
          <div className="grid gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning">
            <p><b>{formatPKR(paid)}</b> was paid — it will be recorded as refunded. Give it back by:</p>
            <div className="flex flex-wrap gap-1.5">
              {[{ key: "", label: "Same way it was paid" }, ...methods].slice(0, 6).map((m) => (
                <button key={m.key} type="button" onClick={() => setMethod(m.key || null)}
                  className={cn("h-8 rounded-lg px-3 text-xs font-semibold ring-1", (method ?? "") === m.key ? "bg-ink text-white ring-ink" : "bg-card text-foreground ring-border")}>
                  {m.label.split(" (")[0]}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="grid gap-1.5 text-sm font-medium">
          Reason <span className="font-normal text-muted-foreground">(optional)</span>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer cancelled on the phone" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Keep the order</Button>
          <Button variant="destructive" disabled={pending} onClick={confirm}>{pending ? <Loader2 className="animate-spin" /> : <Ban />} Cancel order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
