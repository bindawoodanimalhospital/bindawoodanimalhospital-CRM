"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FileSignature, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { formatPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recordConsent } from "../actions";

export function ConsentDialog({ surgeryId, procedure, estimate, ownerName, ownerPhone, text, draft }: {
  surgeryId: string; procedure: string; estimate: number | null; ownerName: string; ownerPhone: string;
  text: { en: string; ur: string }; draft: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<"en" | "ur">("ur");
  const [name, setName] = useState(ownerName);
  const [relationship, setRelationship] = useState("Owner");
  const [phone, setPhone] = useState(ownerPhone);
  const [method, setMethod] = useState<"signed_paper" | "signed_on_screen" | "verbal_phone">("signed_paper");
  const [risks, setRisks] = useState(false);
  const [cost, setCost] = useState(false);
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    const r = await recordConsent(surgeryId, {
      signed_by_name: name, relationship, signer_phone: phone, method, language: lang,
      risks_explained: risks as true, estimate_explained: cost as true,
    });
    if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><FileSignature /> Record consent</Button></DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Owner consent — {procedure}</DialogTitle>
          <DialogDescription>
            Read this to the owner (or let them read it), explain the risks and the cost, then record who agreed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            {(["ur", "en"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)}
                className={cn("h-9 rounded-xl px-4 text-sm font-semibold ring-1", lang === l ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>
                {l === "ur" ? "اردو" : "English"}
              </button>
            ))}
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <Link href={`/print/consent/${surgeryId}`} target="_blank"><Printer /> Print form to sign</Link>
            </Button>
          </div>
          {draft && (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
              This wording is a draft — the clinic should review it (Settings) before regular use.
            </p>
          )}
          <div dir={lang === "ur" ? "rtl" : "ltr"} lang={lang}
            className={cn("rounded-xl bg-surface p-4 ring-1 ring-border", lang === "ur" ? "text-lg leading-loose" : "leading-relaxed")}>
            {lang === "ur" ? text.ur : text.en}
          </div>
          <p className="text-sm">Estimated cost: <b>{estimate != null ? formatPKR(estimate) : "not set"}</b></p>

          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Consent given by" required><Input value={name} onChange={(e) => setName(e.target.value)} /></FormField>
            <FormField label="Relationship"><Input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Owner, son, wife…" /></FormField>
            <FormField label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></FormField>
          </div>
          <FormField label="How was consent given?">
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="signed_paper">Signed the printed form (keep the paper)</SelectItem>
                <SelectItem value="signed_on_screen">Signed in person on screen</SelectItem>
                <SelectItem value="verbal_phone">By phone (owner not present)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid gap-2 rounded-xl bg-brand-wash p-3 ring-1 ring-brand-muted">
            <Label className="font-normal"><Checkbox checked={risks} onCheckedChange={(v) => setRisks(v === true)} /> I explained the risks, including anaesthesia</Label>
            <Label className="font-normal"><Checkbox checked={cost} onCheckedChange={(v) => setCost(v === true)} /> I explained the estimated cost</Label>
          </div>
        </div>
        <DialogFooter>
          <Button size="lg" disabled={!risks || !cost || name.trim().length < 2 || pending} onClick={submit}>
            {pending && <Loader2 className="animate-spin" />} Record consent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
