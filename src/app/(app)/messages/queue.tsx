"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2, MessageCircle, Phone, PhoneOff, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/app/page-header";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { markMessage } from "./actions";

export type QueueMessage = {
  id: string; channel: string; body: string; to_phone: string | null; template_label: string; language: string | null;
  customer: { id: string; full_name: string } | null; is_promotional: boolean; attempts: number;
};

export function MessageQueue({ items, canSend }: { items: QueueMessage[]; canSend: boolean }) {
  return (
    <ul className="grid gap-3">
      {items.map((m) => <QueueItem key={m.id} m={m} canSend={canSend} />)}
    </ul>
  );
}

function QueueItem({ m, canSend }: { m: QueueMessage; canSend: boolean }) {
  const [opened, setOpened] = useState(false);
  const [noteFor, setNoteFor] = useState<null | "not_reached" | "cancelled">(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const wa = m.channel === "whatsapp" ? whatsappLink(m.to_phone, m.body) : null;
  const run = (status: "sent" | "not_reached" | "cancelled", n?: string) =>
    start(async () => { const r = await markMessage(m.id, status, n); if (r.ok) toast.success(r.message); else toast.error(r.message); });

  return (
    <li className="grid gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border md:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {m.customer ? <Link href={`/customers/${m.customer.id}`} className="font-semibold hover:underline">{m.customer.full_name}</Link> : <b>Unknown</b>}
          <span className="text-sm text-muted-foreground">{formatPhone(m.to_phone)}</span>
          <StatusPill tone={m.is_promotional ? "info" : "brand"}>{m.template_label}</StatusPill>
          {m.channel !== "whatsapp" && <StatusPill>{m.channel === "call" ? "Prefers a call" : m.channel.toUpperCase()}</StatusPill>}
          {m.attempts > 1 && <StatusPill tone="warning">Reminder #{m.attempts}</StatusPill>}
        </div>
        <p dir={m.language === "ur" ? "rtl" : "ltr"} lang={m.language ?? undefined}
          className={cn("mt-2 rounded-xl bg-surface p-3 whitespace-pre-wrap ring-1 ring-border", m.language === "ur" ? "text-base leading-loose" : "text-sm")}>{m.body}</p>
      </div>
      {canSend && (
        <div className="flex flex-wrap items-start gap-2 md:w-56 md:flex-col md:items-stretch">
          {wa ? (
            <Button asChild size="lg" className="bg-[#1faa53] bg-none shadow-none hover:bg-[#178a43]" onClick={() => setOpened(true)}>
              <a href={wa} target="_blank" rel="noreferrer"><MessageCircle /> Open WhatsApp</a>
            </Button>
          ) : m.to_phone && (
            <Button asChild size="lg" variant="outline" onClick={() => setOpened(true)}><a href={`tel:${m.to_phone}`}><Phone /> Call</a></Button>
          )}
          <Button variant={opened ? "default" : "outline"} disabled={pending} onClick={() => run("sent")}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} {m.channel === "call" ? "Called — done" : "Sent"}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setNoteFor("not_reached")}><PhoneOff /> Couldn&apos;t reach</Button>
          <Button variant="ghost" className="text-muted-foreground" disabled={pending} onClick={() => setNoteFor("cancelled")}><SkipForward /> Skip</Button>
        </div>
      )}
      <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{noteFor === "not_reached" ? "Couldn't reach the owner" : "Skip this message?"}</DialogTitle>
            <DialogDescription>{noteFor === "not_reached" ? "The reminder will come up again on its next date." : "The reminder itself stays open until the work is done."}</DialogDescription>
          </DialogHeader>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={noteFor === "not_reached" ? "e.g. Number switched off" : "e.g. Owner already visited today"} />
          <DialogFooter><Button disabled={pending || note.trim().length < 3} onClick={() => { run(noteFor!, note); setNoteFor(null); setNote(""); }}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
