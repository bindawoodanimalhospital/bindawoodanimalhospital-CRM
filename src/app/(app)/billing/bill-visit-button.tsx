"use client";

import { useTransition } from "react";
import { Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { billVisit } from "./actions";

/** Opens (or creates) the draft bill for a visit, pre-filled with suggestions from what happened. */
export function BillVisitButton({ visitId, label = "Bill this visit", variant = "default", className }: {
  visitId: string; label?: string; variant?: "default" | "outline"; className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button variant={variant} className={className} disabled={pending}
      onClick={() => start(async () => { const r = await billVisit(visitId); if (r && !r.ok) toast.error(r.message); })}>
      {pending ? <Loader2 className="animate-spin" /> : <Receipt />} {label}
    </Button>
  );
}
