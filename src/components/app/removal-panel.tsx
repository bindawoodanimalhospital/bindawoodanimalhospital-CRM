"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2, ShieldAlert, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import type { RemovalState } from "@/lib/removals";
import { declineRemoval, deleteRecord, requestRemoval } from "@/app/(app)/removals/actions";

const OWNER = "Mr. Musab Bin Dawood";

/**
 * Bottom of a pet owner / pet page. The hospital owner deletes records added by mistake (only if
 * never used). Everyone else is told to contact the owner and can send a removal request — the owner
 * is reminded several times a day until he deletes it or declines.
 */
export function RemovalPanel({ state: s }: { state: RemovalState }) {
  const what = s.kind === "customer" ? "pet owner" : "pet";
  const req = s.request;

  if (s.canDelete) {
    return (
      <section className="mt-8 grid gap-3 rounded-2xl border border-dashed border-danger/30 p-4">
        {req && (
          <p className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
            <BellRing className="size-4 shrink-0" />
            <span><b>{req.requester?.full_name ?? "Staff"}</b> asked you to remove this {what} on {formatDateTime(req.created_at)}
              {req.reason ? <> — “{req.reason}”</> : null}{req.reminders > 1 ? ` · reminded ${req.reminders} times` : ""}.</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <ShieldAlert className="size-5 text-danger" />
          <span className="min-w-0 flex-1 text-sm">
            {s.blocker
              ? <>This {what} can&apos;t be deleted — it has <b>{s.blocker}</b>.{s.kind === "customer" ? " If it's a duplicate, use Merge instead." : ""}</>
              : <>Added by mistake? This {what} has never been used, so it can be deleted.{s.kind === "customer" ? " Their pets that belong to nobody else are deleted with them." : ""}</>}
          </span>
          {req && <DeclineButton requestId={req.id} />}
          {!s.blocker && <DeleteButton state={s} />}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8 grid gap-3 rounded-2xl border border-dashed p-4">
      {req ? (
        <div className="flex flex-wrap items-center gap-3">
          <BellRing className="size-5 text-warning" />
          <span className="min-w-0 flex-1 text-sm">
            <b>Removal requested</b> by {req.requester?.full_name ?? "staff"} on {formatDateTime(req.created_at)}{req.reason ? ` — “${req.reason}”` : ""}.
            {" "}Waiting for <b>{OWNER}</b>; he is reminded several times a day until it&apos;s removed{req.reminders > 1 ? ` (reminded ${req.reminders} times so far)` : ""}.
          </span>
          <RequestButton state={s} again />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <ShieldAlert className="size-5 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">
            Added by mistake? Only the owner, <b className="text-foreground">{OWNER}</b>, can remove a {what}. Contact him for removal — or send him a request below, and he&apos;ll be reminded until it&apos;s done.
          </span>
          <RequestButton state={s} />
        </div>
      )}
    </section>
  );
}

function RequestButton({ state: s, again }: { state: RemovalState; again?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    const r = await requestRemoval(s.kind, s.id, reason);
    if (r.ok) { toast.success(r.message); setOpen(false); setReason(""); } else toast.error(r.message);
  });
  if (again) return (
    <Button variant="outline" disabled={pending} onClick={send}>
      {pending ? <Loader2 className="animate-spin" /> : <BellRing />} Remind him again
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><BellRing /> Ask Mr. Musab to remove</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Ask for removal of {s.name}</DialogTitle>
          <DialogDescription>
            Only {OWNER} can remove a {s.kind === "customer" ? "pet owner" : "pet"}. He gets a notification now and is reminded several times a day until he removes it or replies.
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (optional) — e.g. registered twice, wrong name" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={send}>{pending ? <Loader2 className="animate-spin" /> : <BellRing />} Send request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteButton({ state: s }: { state: RemovalState }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = () => start(async () => {
    const r = await deleteRecord(s.kind, s.id, reason || s.request?.reason || "");
    if (r.ok) { toast.success(r.message); setOpen(false); router.push(s.kind === "customer" ? "/customers" : "/pets"); } else toast.error(r.message);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" className="text-danger hover:text-danger"><Trash2 /> Delete</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Delete {s.name}?</DialogTitle>
          <DialogDescription>
            This removes the {s.kind === "customer" ? "pet owner, their contact details and any pets that belong only to them" : "pet, its owner links, weights and alerts"}. It can&apos;t be undone; the deletion is kept in the activity log.
          </DialogDescription>
        </DialogHeader>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={s.request?.reason ? `Reason — ${s.request.reason}` : "Reason (optional) — e.g. added by mistake"} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Keep it</Button>
          <Button variant="destructive" disabled={pending} onClick={go}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeclineButton({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = () => start(async () => {
    const r = await declineRemoval(requestId, note);
    if (r.ok) { toast.success(r.message); setOpen(false); router.refresh(); } else toast.error(r.message);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost"><X /> Keep — decline</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Keep this record?</DialogTitle>
          <DialogDescription>The request is closed and the reminders stop. Your note is shown to the person who asked.</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. it's a real client" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={go}>{pending && <Loader2 className="animate-spin" />} Decline request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
