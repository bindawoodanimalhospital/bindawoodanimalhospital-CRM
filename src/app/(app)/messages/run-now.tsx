"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runRemindersNow } from "./actions";

/** The engine runs automatically every 30 minutes; this checks right away. */
export function RunNowButton() {
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await runRemindersNow(); if (r.ok) toast.success(r.message); else toast.error(r.message); })}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
    </Button>
  );
}
