"use client";

import { useEffect, useState, useTransition } from "react";
import { GitMerge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { cn } from "@/lib/utils";
import { mergeCustomers, searchCustomers, type CustomerOption } from "../actions";

/** Merge this (duplicate) customer INTO another one. Pets move to the target; this record is kept as "merged". */
export function MergeCustomerDialog({ source }: { source: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [target, setTarget] = useState<CustomerOption | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    const t = setTimeout(async () => setOptions((await searchCustomers(q)).filter((o) => o.id !== source.id)), 250);
    return () => clearTimeout(t);
  }, [q, source.id]);

  const submit = () =>
    start(async () => {
      if (!target) return;
      const res = await mergeCustomers(source.id, target.id, reason);
      if (res?.message) toast.error(res.message);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><GitMerge /> Merge</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge duplicate customer</DialogTitle>
          <DialogDescription>
            <b>{source.name}</b> will be merged into the customer you pick. Their pets move across and this record is
            kept (marked “merged”) for the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Keep this customer">
            <Input value={q} onChange={(e) => { setQ(e.target.value); setTarget(null); }} placeholder="Search name or phone…" />
            {options.length > 0 && !target && (
              <ul className="max-h-48 overflow-auto rounded-lg border">
                {options.map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => { setTarget(o); setQ(o.title); }}
                      className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted")}>
                      <span className="font-medium">{o.title}</span>
                      <span className="truncate text-xs text-muted-foreground">{o.subtitle}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">{o.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FormField>
          <FormField label="Reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="e.g. Same person, registered twice with different spelling" />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!target || reason.trim().length < 3 || pending}>
            {pending && <Loader2 className="animate-spin" />} Merge into {target?.title ?? "…"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
