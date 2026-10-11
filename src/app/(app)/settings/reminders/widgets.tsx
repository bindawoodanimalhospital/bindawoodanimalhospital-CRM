"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";
import { saveRule, saveTemplate } from "./actions";

export type Rule = {
  key: string; label: string; is_active: boolean; customer_offsets: number[]; customer_repeat_days: number | null; staff_offsets: number[];
  staff_repeat_days: number | null; staff_role: string | null; escalation: { after_days: number; role: string }[]; customer_template: string | null;
};

function describe(days: number[], repeat: number | null) {
  if (!days.length) return "Never";
  const parts = days.map((d) => (d < 0 ? `${-d} day${d === -1 ? "" : "s"} before` : d === 0 ? "on the day" : `${d} day${d === 1 ? "" : "s"} late`));
  return parts.join(", ") + (repeat ? `, then every ${repeat} days until done` : "");
}

export function RuleCard({ rule, roles }: { rule: Rule; roles: { key: string; name: string }[] }) {
  const [f, setF] = useState({
    is_active: rule.is_active, customer_offsets: rule.customer_offsets.join(", "), customer_repeat_days: rule.customer_repeat_days?.toString() ?? "",
    staff_offsets: rule.staff_offsets.join(", "), staff_repeat_days: rule.staff_repeat_days?.toString() ?? "", staff_role: rule.staff_role ?? "",
  });
  const [esc, setEsc] = useState(rule.escalation);
  const [pending, start] = useTransition();
  const days = (s: string) => s.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  const rep = (s: string) => (s ? Number(s) : null);
  return (
    <article className="grid gap-4 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
      <header className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">{rule.label}</h3>
        <label className="ml-auto flex items-center gap-2 text-sm">{f.is_active ? "On" : "Off"}<Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} /></label>
      </header>
      {rule.customer_template && (
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <FormField label="Message the owner — days from the due date" hint={describe(days(f.customer_offsets), rep(f.customer_repeat_days))}>
            <Input value={f.customer_offsets} onChange={(e) => setF({ ...f, customer_offsets: e.target.value })} placeholder="-3, 0, 3, 7" />
          </FormField>
          <FormField label="Then repeat every"><Input value={f.customer_repeat_days} onChange={(e) => setF({ ...f, customer_repeat_days: e.target.value })} placeholder="days" inputMode="numeric" /></FormField>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_200px]">
        <FormField label="Alert staff — days from the due date" hint={describe(days(f.staff_offsets), rep(f.staff_repeat_days))}>
          <Input value={f.staff_offsets} onChange={(e) => setF({ ...f, staff_offsets: e.target.value })} placeholder="0, 1, 3" />
        </FormField>
        <FormField label="Then every"><Input value={f.staff_repeat_days} onChange={(e) => setF({ ...f, staff_repeat_days: e.target.value })} placeholder="days" inputMode="numeric" /></FormField>
        <FormField label="If nobody is assigned, alert">
          <Select value={f.staff_role || "none"} onValueChange={(v) => setF({ ...f, staff_role: v === "none" ? "" : v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">Nobody</SelectItem>{roles.map((r) => <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Escalate when still not done</p>
        {esc.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span>After</span>
            <Input className="w-20" inputMode="numeric" value={e.after_days} onChange={(ev) => setEsc(esc.map((x, j) => j === i ? { ...x, after_days: Number(ev.target.value) || 0 } : x))} />
            <span>days late, tell</span>
            <Select value={e.role} onValueChange={(v) => setEsc(esc.map((x, j) => j === i ? { ...x, role: v } : x))}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{roles.map((r) => <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" size="icon-sm" onClick={() => setEsc(esc.filter((_, j) => j !== i))} aria-label="Remove"><X /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setEsc([...esc, { after_days: (esc.at(-1)?.after_days ?? 0) + 7, role: "owner" }])}><Plus /> Add step</Button>
      </div>
      <div className="flex justify-end">
        <Button disabled={pending} onClick={() => start(async () => { const r = await saveRule(rule.key, { ...f, escalation: esc }); if (r.ok) toast.success(r.message); else toast.error(r.message); })}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
      </div>
    </article>
  );
}

export function TemplateEditor({ t }: { t: { key: string; language: string; label: string; body: string; is_promotional: boolean } }) {
  const [body, setBody] = useState(t.body);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
      <p className="text-sm font-semibold">{t.label} <span className="font-normal text-muted-foreground">· {t.language === "ur" ? "اردو" : "English"}{t.is_promotional ? " · promotional (opt-in only)" : ""}</span></p>
      <Textarea rows={3} dir={t.language === "ur" ? "rtl" : "ltr"} lang={t.language} value={body} onChange={(e) => setBody(e.target.value)} className={t.language === "ur" ? "text-base leading-loose" : ""} />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">You can use {"{owner} {pet} {title} {date} {time} {amount} {invoice} {clinic} {clinic_phone}"}</span>
        {body !== t.body && <Button size="sm" className="ml-auto" disabled={pending} onClick={() => start(async () => { const r = await saveTemplate(t.key, t.language, body); if (r.ok) toast.success(r.message); else toast.error(r.message); })}>Save</Button>}
      </div>
    </div>
  );
}
