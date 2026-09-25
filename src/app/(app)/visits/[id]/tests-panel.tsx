"use client";

import { useRef, useState, useTransition } from "react";
import { FileImage, FlaskConical, Loader2, Lock, Paperclip, Plus, Siren } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/format";
import { cancelDiagnostic, orderDiagnostic, recordDocument, saveDiagnosticResult, signedFileUrl } from "./actions";

export type DiagnosticType = { id: string; name: string; category: string; result_fields: { key: string; label: string; unit?: string }[] };
export type DiagnosticOrder = {
  id: string; code: string; status: "ordered" | "in_progress" | "resulted" | "reviewed" | "cancelled";
  type: DiagnosticType; reason: string | null; is_urgent: boolean; findings: string | null; impression: string | null;
  result_values: Record<string, string>; created_at: string; ordered_by_name: string | null;
  reviewed_at: string | null; cancel_reason: string | null;
  files: { id: string; file_name: string; path: string; mime_type: string | null }[];
};

const STATUS = {
  ordered: { label: "Ordered", tone: "warning" }, in_progress: { label: "In progress", tone: "info" },
  resulted: { label: "Result ready — needs review", tone: "brand" }, reviewed: { label: "Reviewed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
} as const;

const MAX_BYTES = 25 * 1024 * 1024;

export function TestsPanel({ visitId, petId, consultationId, types, orders, canManage, canUpload }: {
  visitId: string; petId: string; consultationId: string | null; types: DiagnosticType[];
  orders: DiagnosticOrder[]; canManage: boolean; canUpload: boolean;
}) {
  const [typeId, setTypeId] = useState("");
  const [reason, setReason] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="grid gap-8">
      {canManage && (
        <section className="grid gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
          <h3 className="font-semibold">Order a test</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end">
            <FormField label="Test">
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose test" /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField label="Why (clinical reason)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rule out foreign body" />
            </FormField>
            <Label className="h-10 font-normal"><Checkbox checked={urgent} onCheckedChange={(v) => setUrgent(v === true)} /> Urgent</Label>
            <Button disabled={!typeId || pending} onClick={() => start(async () => {
              const r = await orderDiagnostic(visitId, petId, consultationId, typeId, reason, urgent);
              if (r.ok) { toast.success(r.message); setTypeId(""); setReason(""); setUrgent(false); } else toast.error(r.message);
            })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Order</Button>
          </div>
        </section>
      )}
      {orders.length === 0 ? <p className="text-muted-foreground">No tests for this visit.</p>
        : orders.map((o) => <OrderCard key={o.id} visitId={visitId} petId={petId} o={o} canManage={canManage} canUpload={canUpload} />)}
    </div>
  );
}

function OrderCard({ visitId, petId, o, canManage, canUpload }: {
  visitId: string; petId: string; o: DiagnosticOrder; canManage: boolean; canUpload: boolean;
}) {
  const [findings, setFindings] = useState(o.findings ?? "");
  const [impression, setImpression] = useState(o.impression ?? "");
  const [values, setValues] = useState<Record<string, string>>(o.result_values ?? {});
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = o.status === "reviewed" || o.status === "cancelled";
  const editable = canManage && !locked;
  const s = STATUS[o.status];

  const save = (status: "in_progress" | "resulted" | "reviewed") => start(async () => {
    const r = await saveDiagnosticResult(visitId, o.id, { findings, impression, result_values: values, status });
    if (r.ok) toast.success(r.message); else toast.error(r.message);
  });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) { toast.error(`${file.name} is larger than 25 MB.`); continue; }
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `pets/${petId}/diagnostics/${o.id}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from("clinical-files").upload(path, file, { contentType: file.type, upsert: false });
      if (error) { toast.error(`Couldn't upload ${file.name}: ${error.message}`); continue; }
      const r = await recordDocument(visitId, {
        path, pet_id: petId, entity_type: "diagnostic_order", entity_id: o.id, file_name: file.name,
        mime_type: file.type, size_bytes: file.size, category: file.type.startsWith("image/") ? "image" : "report",
      });
      if (!r.ok) toast.error(r.message);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const open = async (path: string) => {
    const url = await signedFileUrl(path);
    if (url) window.open(url, "_blank", "noopener"); else toast.error("You don't have access to this file.");
  };

  return (
    <article className="grid gap-4 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand"><FlaskConical className="size-5" /></span>
        <div>
          <p className="font-semibold">{o.type.name}</p>
          <p className="text-xs text-muted-foreground">{o.code} · ordered {formatDateTime(o.created_at)}{o.ordered_by_name ? ` by ${o.ordered_by_name}` : ""}</p>
        </div>
        {o.is_urgent && <StatusPill tone="danger"><Siren className="mr-1 size-3" /> Urgent</StatusPill>}
        <StatusPill tone={s.tone} className="ml-auto">{o.status === "reviewed" && <Lock className="mr-1 size-3" />}{s.label}</StatusPill>
      </div>
      {o.reason && <p className="text-sm"><span className="text-muted-foreground">Reason:</span> {o.reason}</p>}
      {o.status === "cancelled" && <p className="text-sm text-muted-foreground">Cancelled: {o.cancel_reason}</p>}

      {o.status !== "cancelled" && (
        <>
          {o.type.result_fields.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {o.type.result_fields.map((f) => (
                <label key={f.key} className="grid gap-1 rounded-xl bg-surface p-2.5 ring-1 ring-border">
                  <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
                  <span className="flex items-baseline gap-1">
                    <input value={values[f.key] ?? ""} disabled={!editable} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className="w-full min-w-0 bg-transparent font-semibold tabular outline-none disabled:opacity-80" />
                    {f.unit && <span className="text-xs text-muted-foreground">{f.unit}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Findings">
              <Textarea rows={3} value={findings} disabled={!editable} onChange={(e) => setFindings(e.target.value)} />
            </FormField>
            <FormField label="Impression / conclusion">
              <Textarea rows={3} value={impression} disabled={!editable} onChange={(e) => setImpression(e.target.value)} />
            </FormField>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {o.files.map((f) => (
              <button key={f.id} type="button" onClick={() => open(f.path)}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm hover:bg-accent">
                <FileImage className="size-4" /> {f.file_name}
              </button>
            ))}
            {canUpload && !locked && (
              <>
                <input ref={fileRef} type="file" multiple hidden accept="image/*,application/pdf,.dcm"
                  onChange={(e) => upload(e.target.files)} />
                <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />} Attach report / images
                </Button>
              </>
            )}
          </div>

          {editable && (
            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button variant="ghost" disabled={pending} onClick={() => {
                const reason = window.prompt("Why cancel this test?");
                if (reason) start(async () => { const r = await cancelDiagnostic(visitId, o.id, reason); if (!r.ok) toast.error(r.message); });
              }}>Cancel test</Button>
              <Button variant="outline" disabled={pending} onClick={() => save("resulted")}>Save result</Button>
              <Button disabled={pending || (!findings.trim() && !impression.trim() && !Object.keys(values).length)} onClick={() => save("reviewed")}>
                {pending ? <Loader2 className="animate-spin" /> : <Lock />} Mark reviewed
              </Button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
