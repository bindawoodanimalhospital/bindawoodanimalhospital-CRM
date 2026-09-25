"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Megaphone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";
import { createCampaign, previewCampaign } from "../actions";

const AUDIENCES = [
  { key: "birthdays_this_month", label: "Pets with a birthday this month" },
  { key: "inactive_6_months", label: "Pets not seen for 6+ months" },
];

export function CampaignBuilder({ templates }: { templates: { key: string; label: string }[] }) {
  const [audience, setAudience] = useState(AUDIENCES[0].key);
  const [template, setTemplate] = useState(templates[0]?.key ?? "");
  const [name, setName] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { let live = true; previewCampaign(audience).then((n) => { if (live) setCount(n); }); return () => { live = false; }; }, [audience]);
  return (
    <section className="grid gap-4 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
      <p className="flex items-center gap-2 rounded-xl bg-brand-wash px-3 py-2 text-sm ring-1 ring-brand-muted"><ShieldCheck className="size-4 text-brand" />
        Only owners who agreed to receive offers (“campaign messages” ticked on their profile) are included.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Who"><Select value={audience} onValueChange={setAudience}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{AUDIENCES.map((a) => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}</SelectContent></Select></FormField>
        <FormField label="Message"><Select value={template} onValueChange={setTemplate}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{templates.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}</SelectContent></Select></FormField>
        <FormField label="Name (for your records)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. October birthdays" /></FormField>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-lg">{count == null ? "Counting…" : <><b>{count}</b> owner{count === 1 ? "" : "s"} will get this message</>}</p>
        <Button size="lg" disabled={pending || !count || !template} onClick={() => start(async () => {
          const r = await createCampaign(name, audience, template); if (r.ok) toast.success(r.message); else toast.error(r.message);
        })}>{pending ? <Loader2 className="animate-spin" /> : <Megaphone />} Add to “Messages to send”</Button>
      </div>
    </section>
  );
}
