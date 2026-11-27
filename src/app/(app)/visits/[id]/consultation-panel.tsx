"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Check, CircleCheck, CloudOff, History, Loader2, Lock, Plus, Star, Stethoscope, Syringe, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/app/page-header";
import { formatDateTime, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cToF, fToC } from "@/lib/clinical";
import {
  HISTORY_QUESTIONS, HISTORY_TEXT, HYDRATION_OPTIONS, MENTATION_OPTIONS, TREATMENT_ROUTES, historyLines, treatmentsGiven, vitalFlag,
  vitalRangeText, type HistoryAnswers, type TreatmentGiven,
} from "@/lib/consult-questions";
import {
  finalizeConsultation, reopenConsultation, saveConsultation, setDiagnoses, startConsultation, type ConsultationPatch,
} from "./actions";

export type Template = { key: string; name: string; description: string | null; sections: string[]; exam_prompts: string[] };
export type Diagnosis = { label: string; certainty: string; is_primary: boolean };
export type Consultation = {
  id: string; status: "draft" | "finalized"; template_key: string; revision: number;
  finalized_at: string | null; finalized_by_name: string | null; reopened_reason: string | null;
  doctor_name: string | null; updated_at: string;
  fields: Record<string, string | number | null>;
  exam: Record<string, string>;
  answers: HistoryAnswers;
  treatments: TreatmentGiven[];
  diagnoses: Diagnosis[];
  revisions: { revision: number; finalized_at: string; reason: string | null }[];
};

const SECTION_TITLES: Record<string, string> = {
  complaint: "Reason for visit", history: "History (what the owner tells you)", vitals: "Vitals",
  exam: "Physical examination", assessment: "Assessment & diagnosis", treatment: "Treatment given", plan: "Plan & follow-up",
};

/** What the visit screen knows about the pet, to guide the doctor (normal ranges, last vaccine / deworming). */
export type PetContext = { species: string | null; lastVaccine: string | null; lastDeworming: string | null; treatmentNames: string[] };

export function ConsultationPanel({ visitId, consultation, templates, perms, pet }: {
  visitId: string;
  consultation: Consultation | null;
  templates: Template[];
  perms: { create: boolean; edit: boolean; finalize: boolean; reopen: boolean; isAuthor: boolean };
  pet: PetContext;
}) {
  if (!consultation) return <StartConsultation visitId={visitId} templates={templates} canCreate={perms.create} />;
  const template = templates.find((t) => t.key === consultation.template_key) ?? templates[0];
  const editable = consultation.status === "draft" && (perms.edit || (perms.create && perms.isAuthor));
  return editable
    ? <ConsultationEditor key={consultation.id + consultation.revision} visitId={visitId} c={consultation} template={template} canFinalize={perms.finalize} pet={pet} />
    : <ConsultationView visitId={visitId} c={consultation} template={template} canReopen={perms.reopen} species={pet.species} />;
}

function StartConsultation({ visitId, templates, canCreate }: { visitId: string; templates: Template[]; canCreate: boolean }) {
  const [pending, start] = useTransition();
  if (!canCreate) return <p className="text-muted-foreground">No consultation has been written for this visit yet.</p>;
  return (
    <div>
      <h3 className="text-lg font-semibold">Start the consultation</h3>
      <p className="mt-1 text-sm text-muted-foreground">Pick the kind of visit — you&apos;ll only see the sections that matter.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <button key={t.key} type="button" disabled={pending}
            onClick={() => start(async () => { const r = await startConsultation(visitId, t.key); if (!r.ok) toast.error(r.message); })}
            className="group flex items-start gap-3 rounded-2xl bg-card p-4 text-left shadow-card ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-brand-muted disabled:opacity-60">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Stethoscope className="size-5" /></span>
            <span>
              <span className="block font-semibold">{t.name}</span>
              <span className="block text-sm text-muted-foreground">{t.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ editor

type SaveState = "idle" | "saving" | "saved" | "error";

function ConsultationEditor({ visitId, c, template, canFinalize, pet }: {
  visitId: string; c: Consultation; template: Template; canFinalize: boolean; pet: PetContext;
}) {
  const [fields, setFields] = useState(c.fields);
  const [exam, setExam] = useState(c.exam);
  const [answers, setAnswers] = useState<HistoryAnswers>(c.answers);
  const [treatments, setTreatments] = useState<TreatmentGiven[]>(c.treatments);
  const [diagnoses, setDx] = useState<Diagnosis[]>(c.diagnoses);
  const [save, setSave] = useState<SaveState>("idle");
  const [finalizing, startFinalize] = useTransition();
  const dirty = useRef<ConsultationPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async () => {
    const patch = dirty.current;
    if (!Object.keys(patch).length) return true;
    dirty.current = {};
    setSave("saving");
    const res = await saveConsultation(c.id, patch);
    if (!res.ok) {
      dirty.current = { ...patch, ...dirty.current }; // keep for retry
      setSave("error");
      toast.error(res.message ?? "Couldn't save — check your connection.");
      return false;
    }
    setSave("saved");
    return true;
  }, [c.id]);

  const queue = (patch: ConsultationPatch) => {
    dirty.current = { ...dirty.current, ...patch };
    setSave("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  };

  // Don't lose typing if the tab is closed mid-save.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(dirty.current).length) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); clearTimeout(timer.current); };
  }, []);

  const setField = (k: string, v: string) => { setFields((f) => ({ ...f, [k]: v })); queue({ [k]: v } as ConsultationPatch); };
  const setExamField = (k: string, v: string) => {
    const next = { ...exam, [k]: v };
    setExam(next);
    queue({ exam: next });
  };
  // Refs hold the latest lists, so quick taps / edits in a row each build on the one before.
  const answersRef = useRef(answers);
  const setAnswer = (k: string, val: string) => {
    const next = { ...answersRef.current, [k]: val };
    if (!val) delete next[k];
    if (!val && !k.endsWith("_detail")) delete next[`${k}_detail`];
    answersRef.current = next;
    setAnswers(next);
    queue({ history_answers: next });
  };
  const changeTreatments = (next: TreatmentGiven[]) => { setTreatments(next); queue({ treatments_given: next }); };
  const saveDx = async (next: Diagnosis[]) => {
    setDx(next);
    const r = await setDiagnoses(visitId, c.id, next);
    if (!r.ok) toast.error(r.message);
  };

  const finalize = () => startFinalize(async () => {
    clearTimeout(timer.current);
    if (!(await flush())) return;
    const r = await finalizeConsultation(visitId, c.id);
    if (r.ok) toast.success(r.message); else toast.error(r.message);
  });

  const v = (k: string) => (fields[k] ?? "") as string | number;
  const has = (s: string) => template.sections.includes(s);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill tone="warning">Draft</StatusPill>
        <span className="text-sm text-muted-foreground">{template.name}{c.doctor_name ? ` · ${c.doctor_name}` : ""}</span>
        {c.reopened_reason && <StatusPill tone="info">Reopened: {c.reopened_reason}</StatusPill>}
        <SaveIndicator state={save} />
      </div>

      {template.sections.map((section) => (
        <section key={section} className="grid gap-3">
          <h3 className="text-base font-semibold">{SECTION_TITLES[section]}</h3>

          {section === "complaint" && (
            <Textarea rows={2} value={v("chief_complaint")} onChange={(e) => setField("chief_complaint", e.target.value)}
              placeholder="e.g. Vomiting since last night, not eating" className="text-base" />
          )}
          {section === "history" && (
            <div className="grid gap-3">
              <HistoryQuestions answers={answers} onChange={setAnswer} pet={pet} />
              <Textarea rows={2} value={v("history")} onChange={(e) => setField("history", e.target.value)}
                placeholder="Anything else the owner tells you — since when, previous illness, other pets at home…" />
            </div>
          )}
          {section === "vitals" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <TempVital value={v("temperature_c")} onChange={(x) => setField("temperature_c", x)} species={pet.species} />
              <Vital label="Heart rate" unit="/min" value={v("heart_rate")} onChange={(x) => setField("heart_rate", x)} kind="hr" species={pet.species} />
              <Vital label="Resp. rate" unit="/min" value={v("resp_rate")} onChange={(x) => setField("resp_rate", x)} kind="rr" species={pet.species} />
              <Vital label="Weight" unit="kg" value={v("weight_kg")} onChange={(x) => setField("weight_kg", x)} step="0.01" />
              <Vital label="CRT" unit="sec" value={v("crt_seconds")} onChange={(x) => setField("crt_seconds", x)} step="0.5" kind="crt" species={pet.species} />
              <TextVital label="Mucous membranes" value={v("mucous_membranes")} onChange={(x) => setField("mucous_membranes", x)} options={["Pink", "Pale", "Congested", "Cyanotic", "Icteric"]} />
              <TextVital label="Hydration" value={v("hydration")} onChange={(x) => setField("hydration", x)} options={HYDRATION_OPTIONS} />
              <TextVital label="Pulse" value={v("pulse_quality")} onChange={(x) => setField("pulse_quality", x)} options={["Strong and synchronous", "Weak", "Bounding", "Irregular", "Pulse deficits"]} />
              <TextVital label="Mentation" value={v("mentation")} onChange={(x) => setField("mentation", x)} options={MENTATION_OPTIONS} />
              <Vital label="Body condition" unit="/9" value={v("body_condition_score")} onChange={(x) => setField("body_condition_score", x)} />
              <Vital label="Pain" unit="/10" value={v("pain_score")} onChange={(x) => setField("pain_score", x)} />
            </div>
          )}
          {section === "exam" && (
            <div className="grid gap-2">
              {template.exam_prompts.map((p) => {
                const val = exam[p] ?? "";
                const normal = val === "Normal";
                return (
                  <div key={p} className="grid items-center gap-2 sm:grid-cols-[190px_auto_1fr]">
                    <Label className="text-sm">{p}</Label>
                    <button type="button" onClick={() => setExamField(p, normal ? "" : "Normal")}
                      className={cn("inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition",
                        normal ? "border-success bg-success-soft text-success" : "hover:bg-muted")}>
                      <Check className="size-4" /> Normal
                    </button>
                    <Input value={normal ? "" : val} disabled={normal} placeholder={normal ? "No abnormality found" : "Findings…"}
                      onChange={(e) => setExamField(p, e.target.value)} />
                  </div>
                );
              })}
              <Textarea rows={2} value={v("observations")} onChange={(e) => setField("observations", e.target.value)}
                placeholder="Other observations" className="mt-2" />
            </div>
          )}
          {section === "assessment" && (
            <div className="grid gap-3">
              <Textarea rows={2} value={v("assessment")} onChange={(e) => setField("assessment", e.target.value)}
                placeholder="Your assessment" />
              <DiagnosisList items={diagnoses} onChange={saveDx} />
              <div className="max-w-xs">
                <TextVital label="Prognosis" value={v("prognosis")} onChange={(x) => setField("prognosis", x)} options={["Excellent", "Good", "Fair", "Guarded", "Poor", "Grave"]} />
              </div>
            </div>
          )}
          {section === "treatment" && (
            <div className="grid gap-3">
              <TreatmentList items={treatments} onChange={changeTreatments} names={pet.treatmentNames} />
              <Textarea rows={2} value={v("treatment")} onChange={(e) => setField("treatment", e.target.value)}
                placeholder="Procedures & other notes (wound cleaned, ear flushed, fluids running 2 hours…)" />
              {!!v("medicines_administered") && (
                <Textarea rows={2} value={v("medicines_administered")} onChange={(e) => setField("medicines_administered", e.target.value)}
                  placeholder="Medicines given in the clinic (older note)" />
              )}
            </div>
          )}
          {section === "plan" && (
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <Textarea rows={2} value={v("follow_up_plan")} onChange={(e) => setField("follow_up_plan", e.target.value)}
                placeholder="Plan & advice for the owner, e.g. Recheck in 5 days" />
              <div className="grid content-start gap-1.5">
                <Label>Follow-up date</Label>
                <Input type="date" value={v("follow_up_date") as string} min={todayPK()}
                  onChange={(e) => setField("follow_up_date", e.target.value)} />
                <span className="text-xs text-muted-foreground">Adds a reminder that stays until someone records an outcome.</span>
              </div>
              <Textarea rows={2} value={v("doctor_notes")} onChange={(e) => setField("doctor_notes", e.target.value)}
                placeholder="Private doctor notes (not printed)" className="sm:col-span-2" />
            </div>
          )}
        </section>
      ))}

      {!has("assessment") && <DiagnosisList items={diagnoses} onChange={saveDx} />}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <span className="mr-auto text-sm text-muted-foreground">Saved automatically as you type.</span>
        {canFinalize ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="lg" disabled={finalizing}>{finalizing ? <Loader2 className="animate-spin" /> : <Lock />} Finalize record</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Finalize this consultation?</AlertDialogTitle>
                <AlertDialogDescription>
                  The record will be locked. Later corrections need a senior doctor to reopen it with a reason — the
                  current version is kept in the history.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Not yet</AlertDialogCancel>
                <AlertDialogAction onClick={finalize}>Finalize & lock</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span className="text-sm text-muted-foreground">A doctor will review and finalize this record.</span>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className={cn("ml-auto inline-flex items-center gap-1.5 text-sm", state === "error" ? "text-danger" : "text-muted-foreground")}>
      {state === "saving" && <><Loader2 className="size-4 animate-spin" /> Saving…</>}
      {state === "saved" && <><CircleCheck className="size-4 text-success" /> Saved</>}
      {state === "error" && <><CloudOff className="size-4" /> Not saved — will retry on next change</>}
    </span>
  );
}

function Vital({ label, unit, value, onChange, step, kind, species }: {
  label: string; unit: string; value: string | number; onChange: (v: string) => void; step?: string;
  kind?: "hr" | "rr" | "crt"; species?: string | null;
}) {
  const flag = kind ? vitalFlag(kind, value, species) : null;
  const hint = kind ? vitalRangeText(kind, species) : null;
  return (
    <label className={cn("grid gap-1 rounded-xl bg-surface p-2.5 ring-1", flag ? "ring-danger/50" : "ring-border")}>
      <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">{label}
        {flag && <FlagBadge dir={flag.dir} />}</span>
      <span className="flex items-baseline gap-1">
        <input type="number" inputMode="decimal" step={step ?? "1"} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent text-lg font-semibold tabular outline-none" />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </span>
      {hint && <span className={cn("text-[11px]", flag ? "text-danger" : "text-muted-foreground")}>{hint}</span>}
    </label>
  );
}

function FlagBadge({ dir }: { dir: "H" | "L" }) {
  return <span className="rounded-full bg-danger-soft px-1.5 text-[10.5px] font-bold text-danger">{dir === "H" ? "↑ High" : "↓ Low"}</span>;
}

/** The standard questions: one tap per answer, a detail box when something is wrong, and what the records say. */
function HistoryQuestions({ answers, onChange, pet }: { answers: HistoryAnswers; onChange: (k: string, v: string) => void; pet: PetContext }) {
  return (
    <div className="grid gap-2 rounded-2xl bg-surface p-3 ring-1 ring-border">
      <p className="text-xs text-muted-foreground">Tap the owner&apos;s answer — anything not normal is highlighted on the record. Tap again to clear.</p>
      {HISTORY_QUESTIONS.map((q) => {
        const val = answers[q.key] ?? "";
        const hint = q.key === "vaccinated" ? pet.lastVaccine : q.key === "dewormed" ? pet.lastDeworming : null;
        return (
          <div key={q.key} className="grid items-start gap-1.5 border-b border-border/60 pb-2 last:border-0 last:pb-0 sm:grid-cols-[130px_1fr]">
            <span className="pt-1.5 text-sm font-semibold">{q.label}</span>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.label}>
                {q.options.map((o, i) => {
                  const on = val === o;
                  return (
                    <button key={o} type="button" role="radio" aria-checked={on} onClick={() => onChange(q.key, on ? "" : o)}
                      className={cn("h-8 rounded-full px-3 text-[13px] font-medium ring-1 transition",
                        on ? (i === 0 || o === "Not sure" ? "bg-success-soft text-success ring-success/40" : "bg-danger-soft text-danger ring-danger/40")
                          : "bg-card ring-border hover:bg-muted")}>
                      {on && <Check className="mr-1 inline size-3.5" />}{o}
                    </button>
                  );
                })}
              </div>
              {q.detail && val && val !== q.options[0] && (
                <Input value={answers[`${q.key}_detail`] ?? ""} onChange={(e) => onChange(`${q.key}_detail`, e.target.value)}
                  placeholder={q.detail} className="h-9 max-w-md" />
              )}
              {hint && <span className="text-[11px] text-muted-foreground">Our records: {hint}</span>}
            </div>
          </div>
        );
      })}
      <div className="grid gap-2 pt-1 sm:grid-cols-2">
        {HISTORY_TEXT.map((t) => (
          <label key={t.key} className="grid gap-1">
            <span className="text-sm font-semibold">{t.label}</span>
            <Input value={answers[t.key] ?? ""} onChange={(e) => onChange(t.key, e.target.value)} placeholder={t.placeholder} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Treatments given at the clinic, one row each (what, dose, route) — printed as a table on the record. */
function TreatmentList({ items, onChange, names }: { items: TreatmentGiven[]; onChange: (t: TreatmentGiven[]) => void; names: string[] }) {
  const [draft, setDraft] = useState<TreatmentGiven>({ what: "", dose: "", route: "" });
  const add = () => {
    if (!draft.what.trim()) return;
    onChange([...items, { what: draft.what.trim(), dose: draft.dose?.trim() || null, route: draft.route || null }]);
    setDraft({ what: "", dose: "", route: draft.route });
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  return (
    <div className="grid gap-2">
      <Label className="flex items-center gap-1.5"><Syringe className="size-4 text-brand" /> Given at the clinic</Label>
      {items.length > 0 && (
        <ul className="grid gap-1.5">
          {items.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 ring-1 ring-border">
              <span className="font-semibold">{t.what}</span>
              {t.dose && <span className="text-sm">{t.dose}</span>}
              {t.route && <span className="rounded-full bg-brand-soft px-2 text-xs font-semibold text-brand">{t.route}</span>}
              <button type="button" title="Remove" aria-label={`Remove ${t.what}`} className="ml-auto rounded-full p-1 hover:bg-muted"
                onClick={() => onChange(items.filter((_, j) => j !== i))}><X className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_130px_auto]">
        <Input list="treatment-names" value={draft.what} onChange={(e) => setDraft({ ...draft, what: e.target.value })}
          placeholder="Medicine or procedure, e.g. Ondansetron inj." onKeyDown={enter} aria-label="Medicine or procedure" />
        <datalist id="treatment-names">{names.map((nm) => <option key={nm} value={nm} />)}</datalist>
        <Input value={draft.dose ?? ""} onChange={(e) => setDraft({ ...draft, dose: e.target.value })} placeholder="Dose, e.g. 0.5 ml"
          onKeyDown={enter} aria-label="Dose" />
        <select value={draft.route ?? ""} onChange={(e) => setDraft({ ...draft, route: e.target.value })} aria-label="Route"
          className="h-10 rounded-xl border bg-card px-2 text-sm">
          <option value="">Route…</option>
          {TREATMENT_ROUTES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <Button type="button" variant="outline" onClick={add} disabled={!draft.what.trim()}><Plus /> Add</Button>
      </div>
      {items.length === 0 && <p className="text-xs text-muted-foreground">Add each injection, drip or procedure — type the name, dose and route, then press Enter.</p>}
    </div>
  );
}

const TEMP_UNIT_KEY = "crm:temp-unit";

function TempVital({ value, onChange, species }: { value: string | number; onChange: (celsius: string) => void; species?: string | null }) {
  const flag = vitalFlag("temp", value, species);
  const hint = vitalRangeText("temp", species);
  const [unit, setUnit] = useState<"C" | "F">(() => {
    try { return localStorage.getItem(TEMP_UNIT_KEY) === "F" ? "F" : "C"; } catch { return "C"; }
  });
  const shown = (u: "C" | "F") => (value === "" || value == null ? "" : String(u === "F" ? cToF(Number(value)) : Number(value)));
  // What the doctor typed stays as typed; only the stored value is converted.
  const [text, setText] = useState(() => shown(unit));
  const switchTo = (u: "C" | "F") => {
    setUnit(u); setText(shown(u));
    try { localStorage.setItem(TEMP_UNIT_KEY, u); } catch { /* private mode */ }
  };
  return (
    <label className={cn("grid gap-1 rounded-xl bg-surface p-2.5 ring-1", flag ? "ring-danger/50" : "ring-border")}>
      <span className="flex items-center justify-between gap-1 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1">Temp {flag && <FlagBadge dir={flag.dir} />}</span>
        <span className="flex overflow-hidden rounded-md ring-1 ring-border">
          {(["C", "F"] as const).map((u) => (
            <button key={u} type="button" onClick={() => switchTo(u)}
              className={cn("px-1.5 text-[11px] font-semibold", unit === u ? "bg-brand text-brand-foreground" : "bg-card")}>°{u}</button>
          ))}
        </span>
      </span>
      <span className="flex items-baseline gap-1">
        <input type="number" inputMode="decimal" step="0.1" value={text} aria-label={`Temperature in °${unit}`}
          onChange={(e) => {
            setText(e.target.value);
            const n = e.target.value === "" ? null : Number(e.target.value);
            onChange(n == null || Number.isNaN(n) ? "" : String(unit === "F" ? fToC(n) : n));
          }}
          className="w-full min-w-0 bg-transparent text-lg font-semibold tabular outline-none" />
        <span className="text-xs text-muted-foreground">°{unit}</span>
      </span>
      {text !== "" && <span className="text-[11px] text-muted-foreground">= {unit === "F" ? `${value} °C` : `${cToF(Number(value))} °F`}</span>}
      {hint && <span className={cn("text-[11px]", flag ? "text-danger" : "text-muted-foreground")}>{hint} °C</span>}
    </label>
  );
}

function TextVital({ label, value, onChange, options }: {
  label: string; value: string | number; onChange: (v: string) => void; options: string[];
}) {
  const id = `dl-${label.replace(/\W/g, "")}`;
  return (
    <label className="grid gap-1 rounded-xl bg-surface p-2.5 ring-1 ring-border">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input list={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-transparent font-semibold outline-none" />
      <datalist id={id}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </label>
  );
}

function DiagnosisList({ items, onChange }: { items: Diagnosis[]; onChange: (d: Diagnosis[]) => void }) {
  const [label, setLabel] = useState("");
  const add = () => {
    if (!label.trim()) return;
    onChange([...items, { label: label.trim(), certainty: "provisional", is_primary: items.length === 0 }]);
    setLabel("");
  };
  return (
    <div className="grid gap-2">
      <Label>Diagnoses</Label>
      <div className="flex flex-wrap gap-2">
        {items.map((d, i) => (
          <span key={i} className={cn("inline-flex items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-sm ring-1",
            d.is_primary ? "bg-brand-soft text-brand ring-brand-muted" : "bg-card ring-border")}>
            {d.label}
            <button type="button" title={d.certainty === "confirmed" ? "Mark provisional" : "Mark confirmed"}
              onClick={() => onChange(items.map((x, j) => j === i ? { ...x, certainty: x.certainty === "confirmed" ? "provisional" : "confirmed" } : x))}
              className="rounded-full px-1.5 text-[11px] font-semibold uppercase hover:bg-muted">
              {d.certainty === "confirmed" ? "confirmed" : "provisional"}
            </button>
            {!d.is_primary && (
              <button type="button" title="Make primary" className="rounded-full p-1 hover:bg-muted"
                onClick={() => onChange(items.map((x, j) => ({ ...x, is_primary: j === i })))}><Star className="size-3.5" /></button>
            )}
            <button type="button" title="Remove" className="rounded-full p-1 hover:bg-muted"
              onClick={() => {
                const rest = items.filter((_, j) => j !== i);
                const hasPrimary = rest.some((x) => x.is_primary);
                onChange(rest.map((x, j) => ({ ...x, is_primary: x.is_primary || (!hasPrimary && j === 0) })));
              }}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">Tap <b>PROVISIONAL</b> to mark a diagnosis confirmed · ★ makes it the main diagnosis.</p>
      )}
      <div className="flex max-w-md gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add diagnosis, e.g. Tick fever"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button type="button" variant="outline" onClick={add}><Plus /> Add</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ read-only

const FIELD_LABELS: [string, string][] = [
  ["chief_complaint", "Reason for visit"], ["history", "History"], ["observations", "Observations"],
  ["assessment", "Assessment"], ["treatment", "Procedures & notes"], ["medicines_administered", "Medicines given in clinic"],
  ["prognosis", "Prognosis"], ["follow_up_plan", "Plan & advice"], ["doctor_notes", "Doctor notes"],
];
const VITALS: [string, string, string][] = [
  ["temperature_c", "Temp", "°C"], ["heart_rate", "Heart rate", "/min"], ["resp_rate", "Resp. rate", "/min"],
  ["weight_kg", "Weight", "kg"], ["crt_seconds", "CRT", "s"], ["mucous_membranes", "Mucous membranes", ""],
  ["hydration", "Hydration", ""], ["body_condition_score", "BCS", "/9"], ["pain_score", "Pain", "/10"],
  ["pulse_quality", "Pulse", ""], ["mentation", "Mentation", ""],
];

const VITAL_KIND: Record<string, "temp" | "hr" | "rr" | "crt"> = { temperature_c: "temp", heart_rate: "hr", resp_rate: "rr", crt_seconds: "crt" };

function ConsultationView({ visitId, c, template, canReopen, species }: {
  visitId: string; c: Consultation; template: Template; canReopen: boolean; species: string | null;
}) {
  const f = c.fields;
  const answers = historyLines(c.answers);
  const given = treatmentsGiven(c.treatments);
  const vitals = VITALS.filter(([k]) => f[k] != null && f[k] !== "");
  const exam = Object.entries(c.exam).filter(([, val]) => val);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {c.status === "finalized"
          ? <StatusPill tone="success"><Lock className="mr-1 size-3" /> Finalized</StatusPill>
          : <StatusPill tone="warning">Draft — read only</StatusPill>}
        <span className="text-sm text-muted-foreground">
          {template.name}{c.doctor_name ? ` · ${c.doctor_name}` : ""}
          {c.finalized_at ? ` · finalized ${formatDateTime(c.finalized_at)}${c.finalized_by_name ? ` by ${c.finalized_by_name}` : ""}` : ""}
        </span>
        {c.status === "finalized" && canReopen && <ReopenDialog visitId={visitId} id={c.id} />}
      </div>

      {vitals.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {vitals.map(([k, label, unit]) => {
            const flag = VITAL_KIND[k] ? vitalFlag(VITAL_KIND[k], f[k], species) : null;
            return (
            <div key={k} className={cn("rounded-xl bg-surface p-2.5 ring-1", flag ? "ring-danger/50" : "ring-border")}>
              <p className="flex items-center justify-between text-xs text-muted-foreground">{label}{flag && <FlagBadge dir={flag.dir} />}</p>
              <p className="font-semibold tabular">{String(f[k])} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
                {k === "temperature_c" && <span className="block text-xs font-normal text-muted-foreground">{cToF(Number(f[k]))} °F</span>}</p>
            </div>
            );
          })}
        </div>
      )}
      {answers.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Owner&apos;s answers</p>
          <div className="flex flex-wrap gap-1.5">
            {answers.map((l) => (
              <span key={l.key} className={cn("rounded-lg px-2 py-1 text-sm ring-1", l.concern ? "bg-danger-soft text-danger ring-danger/25" : "bg-surface ring-border")}>
                <span className={l.concern ? "" : "text-muted-foreground"}>{l.label}:</span> <b>{l.answer}</b>{l.detail ? ` — ${l.detail}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      {given.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Given at the clinic</p>
          <ul className="grid gap-1 text-sm">
            {given.map((t, i) => <li key={i}><b>{t.what}</b>{t.dose ? ` · ${t.dose}` : ""}{t.route ? ` · ${t.route}` : ""}</li>)}
          </ul>
        </div>
      )}
      {c.diagnoses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {c.diagnoses.map((d, i) => (
            <StatusPill key={i} tone={d.is_primary ? "brand" : "neutral"}>{d.label} · {d.certainty.replace("_", " ")}</StatusPill>
          ))}
        </div>
      )}
      <dl className="grid gap-4 sm:grid-cols-2">
        {FIELD_LABELS.filter(([k]) => f[k]).map(([k, label]) => (
          <div key={k}>
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-1 whitespace-pre-wrap">{String(f[k])}</dd>
          </div>
        ))}
        {f.follow_up_date && (
          <div><dt className="text-xs font-medium text-muted-foreground">Follow-up</dt><dd className="mt-1">{String(f.follow_up_date)}</dd></div>
        )}
      </dl>
      {exam.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Physical examination</p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {exam.map(([k, val]) => <li key={k}><span className="text-muted-foreground">{k}:</span> {val}</li>)}
          </ul>
        </div>
      )}
      {c.revisions.length > 1 && (
        <div className="rounded-xl bg-surface p-4 ring-1 ring-border">
          <p className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" /> Version history</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {c.revisions.map((r) => (
              <li key={r.revision}>
                Version {r.revision} · finalized {formatDateTime(r.finalized_at)}
                {r.reason && <span className="text-muted-foreground"> — reopened: “{r.reason}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReopenDialog({ visitId, id }: { visitId: string; id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" className="ml-auto"><Unlock /> Reopen to correct</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Reopen this record?</DialogTitle>
          <DialogDescription>The finalized version is kept. Your reason is saved in the history log.</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why does it need correcting?" />
        <DialogFooter>
          <Button disabled={reason.trim().length < 5 || pending} onClick={() => start(async () => {
            const r = await reopenConsultation(visitId, id, reason);
            if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
          })}>{pending && <Loader2 className="animate-spin" />} Reopen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
