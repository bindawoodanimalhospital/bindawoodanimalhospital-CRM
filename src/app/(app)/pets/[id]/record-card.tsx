"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, FileText, Link2, Loader2, MessageCircle, Printer, RotateCcw, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/app/page-header";
import { formatDate, formatDateTime } from "@/lib/format";
import { cancelRecordShare, createRecordShare, setProblemStatus } from "./record-actions";

export type ProblemRow = { id: string; title: string; status: "open" | "resolved"; opened_at: string; resolved_at: string | null; visits: number };
export type ShareRow = { id: string; problem_id: string | null; created_at: string; expires_at: string; views: number;
  last_viewed_at: string | null; created_by_name: string | null };

/** Problems, the owner's medical record (print / PDF) and private links to it, on the pet's page. */
export function RecordCard({ petId, petName, ownerWhatsapp, problems, shares, draftNotes, canEdit, className }: {
  petId: string; petName: string; ownerWhatsapp: string | null; problems: ProblemRow[]; shares: ShareRow[];
  draftNotes: number; canEdit: boolean; className?: string;
}) {
  const [share, setShare] = useState<{ problem: ProblemRow | null } | null>(null);
  const titleOf = (id: string | null) => (id ? problems.find((p) => p.id === id)?.title ?? "One problem" : "Whole record");
  const printHref = (problemId: string | null) => `/print/medical-record/${petId}${problemId ? `?problem=${problemId}` : ""}`;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="size-4" /> Owner&apos;s medical record</CardTitle>
        <CardAction className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href={printHref(null)} target="_blank"><Printer /> Print / PDF</Link></Button>
          <Button size="sm" onClick={() => setShare({ problem: null })}><Share2 /> Share link</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5">
        <p className="text-sm text-muted-foreground">
          Visits, findings, diagnosis, medicines, lab reports and vaccines — written for the owner. Bills, private doctor notes and
          phone numbers are never included.
          {draftNotes > 0 && <span className="mt-1 block font-medium text-warning">
            {draftNotes} visit{draftNotes > 1 ? "s have" : " has"} consultation notes still in draft — they are left out until the doctor finalises them.</span>}
        </p>

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Problems</h3>
          {problems.length === 0
            ? <p className="text-sm text-muted-foreground">None yet. On a visit, the doctor links it to a problem (e.g. “Diarrhea”) so visits for the same case read as one story.</p>
            : (
              <ul className="grid grid-cols-1 gap-2">
                {problems.map((p) => <ProblemItem key={p.id} p={p} petId={petId} canEdit={canEdit}
                  printHref={printHref(p.id)} onShare={() => setShare({ problem: p })} />)}
              </ul>
            )}
        </section>

        {shares.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">Links that still open</h3>
            <ul className="grid grid-cols-1 gap-2">
              {shares.map((s) => <ShareItem key={s.id} s={s} petId={petId} title={titleOf(s.problem_id)} />)}
            </ul>
          </section>
        )}
      </CardContent>
      {share && <ShareDialog petId={petId} petName={petName} problem={share.problem} ownerWhatsapp={ownerWhatsapp} onClose={() => setShare(null)} />}
    </Card>
  );
}

function ProblemItem({ p, petId, canEdit, printHref, onShare }: {
  p: ProblemRow; petId: string; canEdit: boolean; printHref: string; onShare: () => void;
}) {
  const [pending, start] = useTransition();
  const toggle = () => start(async () => {
    const r = await setProblemStatus(petId, p.id, p.status === "open" ? "resolved" : "open");
    if (r.ok) toast.success(r.message); else toast.error(r.message);
  });
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface px-3 py-2 ring-1 ring-border">
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{p.title}</p>
        <p className="text-xs text-muted-foreground">
          Opened {formatDate(p.opened_at)} · {p.visits} visit{p.visits === 1 ? "" : "s"}
          {p.status === "resolved" && p.resolved_at ? ` · resolved ${formatDate(p.resolved_at)}` : ""}
        </p>
      </div>
      <StatusPill tone={p.status === "open" ? "warning" : "success"}>{p.status === "open" ? "Open" : "Resolved"}</StatusPill>
      <div className="flex flex-wrap gap-1.5">
        <Button asChild variant="ghost" size="sm"><Link href={printHref} target="_blank"><Printer /> Print</Link></Button>
        <Button variant="ghost" size="sm" onClick={onShare}><Share2 /> Share</Button>
        {canEdit && (
          <Button variant="outline" size="sm" disabled={pending} onClick={toggle}>
            {pending ? <Loader2 className="animate-spin" /> : p.status === "open" ? <Check /> : <RotateCcw />}
            {p.status === "open" ? "Mark resolved" : "Reopen"}
          </Button>
        )}
      </div>
    </li>
  );
}

function ShareItem({ s, petId, title }: { s: ShareRow; petId: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-sm ring-1 ring-border">
      <Link2 className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">
          Made {formatDateTime(s.created_at)}{s.created_by_name ? ` by ${s.created_by_name}` : ""} · open until {formatDate(s.expires_at)} ·
          {" "}{s.views ? `opened ${s.views} time${s.views === 1 ? "" : "s"}, last ${formatDateTime(s.last_viewed_at)}` : "not opened yet"}
        </p>
      </div>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => {
        const r = await cancelRecordShare(petId, s.id);
        if (r.ok) toast.success(r.message); else toast.error(r.message);
      })}>{pending ? <Loader2 className="animate-spin" /> : <X />} Cancel link</Button>
    </li>
  );
}

function ShareDialog({ petId, petName, problem, ownerWhatsapp, onClose }: {
  petId: string; petName: string; problem: ProblemRow | null; ownerWhatsapp: string | null; onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const what = problem ? `${petName}'s medical record for “${problem.title}”` : `${petName}'s medical record`;
  const message = url ? `Assalam o Alaikum, here is ${what}. It opens on your phone for 30 days: ${url}` : "";
  const wa = url ? `https://wa.me/${ownerWhatsapp ? ownerWhatsapp.replace(/\D/g, "") : ""}?text=${encodeURIComponent(message)}` : "";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {what}</DialogTitle>
          <DialogDescription>
            A private link the owner can open on their phone — no app or sign-in. It works for 30 days, you can cancel it any time,
            and you can see when it was opened.
          </DialogDescription>
        </DialogHeader>
        {!url ? (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Not now</Button>
            <Button disabled={pending} onClick={() => start(async () => {
              const r = await createRecordShare(petId, problem?.id ?? null);
              if (r.ok && r.url) setUrl(r.url); else toast.error(r.message ?? "Couldn't make the link.");
            })}>{pending ? <Loader2 className="animate-spin" /> : <Link2 />} Make the link</Button>
          </DialogFooter>
        ) : (
          <div className="grid gap-3">
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button variant="outline" onClick={async () => {
                try { await navigator.clipboard.writeText(url); setCopied(true); toast.success("Link copied."); }
                catch { toast.error("Couldn't copy — select the link and copy it."); }
              }}>{copied ? <Check /> : <Copy />} Copy</Button>
            </div>
            <p className="text-xs text-muted-foreground">Send it now: for privacy the link is shown only once. If it&apos;s lost, cancel it and make a new one.</p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Done</Button>
              <Button asChild><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /> Send on WhatsApp</a></Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
