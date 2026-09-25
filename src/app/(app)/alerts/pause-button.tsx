"use client";

import { useState, useTransition } from "react";
import { Loader2, PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { addDaysPK, todayPK } from "@/lib/format";
import { pauseReminder } from "../messages/actions";

/** Pause reminders for an item (with a reason) — e.g. owner travelling. The item itself stays open. */
export function PauseButton({ trackId, pausedUntil }: { trackId: string; pausedUntil: string | null }) {
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState(addDaysPK(7));
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  if (pausedUntil) {
    return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await pauseReminder(trackId, null, ""); if (r.ok) toast.success(r.message); else toast.error(r.message); })}>
      {pending ? <Loader2 className="animate-spin" /> : <PlayCircle />} Resume</Button>;
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost"><PauseCircle /> Pause</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Pause reminders</DialogTitle><DialogDescription>No messages or alerts until this date. The item stays on the list.</DialogDescription></DialogHeader>
        <Input type="date" min={todayPK()} value={until} onChange={(e) => setUntil(e.target.value)} />
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required) — e.g. owner abroad until the 15th" />
        <DialogFooter><Button disabled={pending || reason.trim().length < 3 || !until} onClick={() => start(async () => {
          const r = await pauseReminder(trackId, until, reason); if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
        })}>Pause</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
