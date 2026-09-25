"use client";

import { useRef, useState, useTransition } from "react";
import { FileImage, Loader2, Paperclip, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { createClient } from "@/lib/supabase/client";
import { todayPK } from "@/lib/format";
import { addExpense, receiptUrl, recordBusinessFile, reverseExpense } from "./actions";

export function AddExpenseDialog({ categories, methods }: { categories: { id: string; name: string }[]; methods: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const blank = { spent_on: todayPK(), category_id: "", amount: "", method: "cash", payee: "", description: "", reference: "", document_id: "" };
  const [f, setF] = useState(blank);
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  const upload = async (fl: File | undefined) => {
    if (!fl) return;
    if (fl.size > 10 * 1024 * 1024) { toast.error("Max 10 MB."); return; }
    setUploading(true);
    const path = `expenses/${todayPK().slice(0, 7)}/${crypto.randomUUID()}-${fl.name.replace(/[^\w.\-]+/g, "_").slice(-60)}`;
    const { error } = await createClient().storage.from("business-files").upload(path, fl, { contentType: fl.type });
    if (error) { toast.error(error.message); setUploading(false); return; }
    const r = await recordBusinessFile({ path, file_name: fl.name, mime_type: fl.type, size_bytes: fl.size });
    setUploading(false);
    if (r.id) { setF((x) => ({ ...x, document_id: r.id! })); setFileName(fl.name); } else toast.error(r.message);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="lg"><Plus /> Add expense</Button></DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader><DialogTitle>Add expense</DialogTitle><DialogDescription>Rent, bills, salaries, supplies… Only finance staff can see these.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Category" required><Select value={f.category_id} onValueChange={(v) => setF({ ...f, category_id: v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></FormField>
          <FormField label="Amount (Rs.)" required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></FormField>
          <FormField label="What for" required className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. LESCO bill — August" /></FormField>
          <FormField label="Date"><Input type="date" value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} /></FormField>
          <FormField label="Paid by"><Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{methods.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent></Select></FormField>
          <FormField label="Paid to"><Input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></FormField>
          <FormField label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Bill / cheque no." /></FormField>
          <div className="sm:col-span-2">
            <input ref={file} type="file" hidden accept="image/*,application/pdf" onChange={(e) => upload(e.target.files?.[0])} />
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => file.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />} {fileName || "Attach receipt photo"}</Button>
          </div>
        </div>
        <DialogFooter><Button disabled={pending || uploading || !f.category_id || !(Number(f.amount) > 0) || f.description.trim().length < 2} onClick={() => start(async () => {
          const r = await addExpense({ ...f, amount: Number(f.amount) });
          if (r.ok) { toast.success(r.message); setOpen(false); setF(blank); setFileName(""); } else toast.error(r.message);
        })}>{pending && <Loader2 className="animate-spin" />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReverseButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button variant="ghost" size="icon-sm" title="Cancel this entry (reversal)" disabled={pending} onClick={() => {
    const reason = window.prompt("Why cancel this expense?"); if (!reason) return;
    start(async () => { const r = await reverseExpense(id, reason); if (r.ok) toast.success(r.message); else toast.error(r.message); });
  }}>{pending ? <Loader2 className="animate-spin" /> : <Undo2 />}</Button>;
}

export function ReceiptLink({ path }: { path: string }) {
  return <button type="button" className="text-brand" title="Receipt" onClick={async () => {
    const url = await receiptUrl(path); if (url) window.open(url, "_blank", "noopener"); else toast.error("No access.");
  }}><FileImage className="size-4" /></button>;
}
