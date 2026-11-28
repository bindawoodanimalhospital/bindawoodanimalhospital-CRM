"use client";

import { useState, useTransition } from "react";
import { Check, ClipboardList, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setVisitProblem } from "./actions";

export type ProblemOption = { id: string; title: string; status: "open" | "resolved" };

const NONE = "__none__";
const NEW = "__new__";

/**
 * Which problem (case) this visit belongs to, e.g. "Diarrhea". Visits for the same problem read as one story in
 * the owner's medical record. Doctors pick an open problem, start a new one, or leave the visit unlinked.
 */
export function ProblemPicker({ visitId, current, options, canEdit }: {
  visitId: string; current: ProblemOption | null; options: ProblemOption[]; canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  const save = (problemId: string | null, newTitle: string | null) => start(async () => {
    const r = await setVisitProblem(visitId, problemId, newTitle);
    if (r.ok) { toast.success(r.message); setAdding(false); setTitle(""); } else toast.error(r.message);
  });
  const shown = options.filter((o) => o.status === "open" || o.id === current?.id);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 ring-1 ring-border">
      <ClipboardList className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Problem:</span>
      {!canEdit ? (
        <span className="text-sm font-medium">{current ? `${current.title}${current.status === "resolved" ? " (resolved)" : ""}` : "Not linked"}</span>
      ) : adding ? (
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim().length >= 2) save(null, title); }}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
            placeholder="e.g. Diarrhea, Skin allergy, Fracture left hind leg" className="h-9 min-w-48 flex-1" />
          <Button type="submit" size="sm" disabled={pending || title.trim().length < 2}>{pending ? <Loader2 className="animate-spin" /> : <Check />} Start problem</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}><X /> Cancel</Button>
        </form>
      ) : (
        <>
          <Select value={current?.id ?? NONE} disabled={pending}
            onValueChange={(v) => (v === NEW ? setAdding(true) : save(v === NONE ? null : v, null))}>
            <SelectTrigger className="h-9 w-auto max-w-full min-w-44">
              {/* Label given explicitly: the picked item's text can go missing after the page loads. */}
              <SelectValue>{current ? `${current.title}${current.status === "resolved" ? " (resolved)" : ""}` : "Not linked to a problem"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not linked to a problem</SelectItem>
              {shown.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}{o.status === "resolved" ? " (resolved)" : ""}</SelectItem>)}
              <SelectItem value={NEW}><Plus className="size-4" /> New problem…</SelectItem>
            </SelectContent>
          </Select>
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </>
      )}
    </div>
  );
}
