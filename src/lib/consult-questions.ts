/**
 * The owner's answers taken at the start of a consultation (what the owner tells the doctor), the treatments given
 * at the clinic, and the usual vital-sign ranges. Pure — used by the visit screen, the records and the printouts.
 */

export type HistoryQuestion = {
  key: string; label: string;
  /** The first option is the "all fine" answer; any other one is shown highlighted on the record. */
  options: string[];
  /** Ask for a detail ("white foam, 3 times") when the answer isn't the first option. */
  detail?: string;
};

export const HISTORY_QUESTIONS: HistoryQuestion[] = [
  { key: "appetite", label: "Eating", options: ["Normal", "Eating less", "Not eating", "Eating more"] },
  { key: "drinking", label: "Drinking", options: ["Normal", "Drinking less", "Drinking more", "Not drinking"] },
  { key: "energy", label: "Activity", options: ["Normal", "Quieter than usual", "Very weak / lying down"] },
  { key: "vomiting", label: "Vomiting", options: ["No", "Yes"], detail: "How often, what it looks like" },
  { key: "diarrhoea", label: "Stool", options: ["Normal", "Soft", "Watery", "With blood", "Constipated"], detail: "Since when, how often" },
  { key: "urine", label: "Urine", options: ["Normal", "More often", "Straining", "With blood", "Not passing"] },
  { key: "breathing", label: "Cough / sneeze", options: ["No", "Coughing", "Sneezing", "Breathing hard"] },
  { key: "vaccinated", label: "Vaccinated", options: ["Up to date", "Not up to date", "Never", "Not sure"] },
  { key: "dewormed", label: "Dewormed", options: ["Up to date", "Not up to date", "Never", "Not sure"] },
];

/** Free-text answers asked on every visit. */
export const HISTORY_TEXT: { key: string; label: string; placeholder: string }[] = [
  { key: "diet", label: "Food", placeholder: "e.g. Dry food twice a day, some home food" },
  { key: "medicines", label: "Medicines already given", placeholder: "e.g. Paracetamol at home yesterday — none if blank" },
];

export type HistoryAnswers = Record<string, string>;
export type HistoryLine = { key: string; label: string; answer: string; detail: string | null; concern: boolean };

/** The answered questions in a fixed order, with whether each one is a concern (anything but the "fine" answer). */
export function historyLines(answers: unknown): HistoryLine[] {
  const a = (answers && typeof answers === "object" ? answers : {}) as HistoryAnswers;
  const out: HistoryLine[] = [];
  for (const q of HISTORY_QUESTIONS) {
    const answer = a[q.key]?.trim();
    if (!answer) continue;
    out.push({ key: q.key, label: q.label, answer, detail: a[`${q.key}_detail`]?.trim() || null,
      concern: answer !== q.options[0] && answer !== "Not sure" });
  }
  for (const t of HISTORY_TEXT) {
    const answer = a[t.key]?.trim();
    if (answer) out.push({ key: t.key, label: t.label, answer, detail: null, concern: false });
  }
  return out;
}

/** "Diarrhoea: Watery (since yesterday)" — one short line per answer, for chips and plain lists. */
export function historyText(l: HistoryLine): string {
  return `${l.label}: ${l.answer}${l.detail ? ` (${l.detail})` : ""}`;
}

// ---------------------------------------------------------------------------------------------- treatments

/** `id` lets the bill offer each one once (rows saved before ids existed have none and aren't offered). */
export type TreatmentGiven = { id?: string; what: string; dose?: string | null; route?: string | null; note?: string | null };
export const TREATMENT_ROUTES = ["IV", "IM", "SC", "Oral", "Topical", "Eye / ear", "Nebulised", "Rectal"];

export function treatmentsGiven(v: unknown): TreatmentGiven[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t) => t && typeof t === "object" && String((t as TreatmentGiven).what ?? "").trim())
    .map((t) => {
      const x = t as TreatmentGiven;
      return { ...(x.id ? { id: String(x.id) } : {}), what: String(x.what).trim(), dose: x.dose?.trim() || null, route: x.route?.trim() || null, note: x.note?.trim() || null };
    });
}

// ---------------------------------------------------------------------------------------------- vitals

/** Usual resting ranges for an adult (textbook values — a guide only; puppies, kittens and stressed pets differ). */
const VITAL_RANGES: Record<string, Partial<Record<"temp" | "hr" | "rr" | "crt", [number, number]>>> = {
  dog: { temp: [37.5, 39.2], hr: [60, 140], rr: [10, 30], crt: [0, 2] },
  cat: { temp: [37.8, 39.2], hr: [140, 220], rr: [20, 30], crt: [0, 2] },
  rabbit: { temp: [38.5, 40.0], hr: [130, 325], rr: [30, 60], crt: [0, 2] },
};

export type VitalFlag = { dir: "H" | "L"; range: [number, number] } | null;

/** "H" / "L" against the usual range for the species (dog, cat, rabbit); null when normal or unknown. */
export function vitalFlag(kind: "temp" | "hr" | "rr" | "crt", value: unknown, species: string | null | undefined): VitalFlag {
  if (value == null || value === "") return null;
  const v = Number(value);
  const r = VITAL_RANGES[(species ?? "").trim().toLowerCase()]?.[kind];
  if (!r || !Number.isFinite(v)) return null;
  if (v > r[1]) return { dir: "H", range: r };
  if (v < r[0] && kind !== "crt") return { dir: "L", range: r };
  return null;
}

/** "Normal 37.5–39.2" for the hint under a vital. */
export function vitalRangeText(kind: "temp" | "hr" | "rr" | "crt", species: string | null | undefined): string | null {
  const r = VITAL_RANGES[(species ?? "").trim().toLowerCase()]?.[kind];
  if (!r) return null;
  return kind === "crt" ? `Normal under ${r[1]} s` : `Normal ${r[0]}–${r[1]}`;
}

export const CONDITION_OPTIONS = ["Stable", "Fair", "Poor", "Critical"];
/** Poor / Critical show in red on the record. */
export const conditionIsConcern = (c: string | null | undefined) => /poor|critical|unstable|grave/i.test(c ?? "");

/** Body parts a doctor can add to any examination, beyond the ones the visit type lists. */
export const EXAM_SYSTEMS = ["General appearance", "Eyes", "Ears", "Nose & throat", "Mouth & teeth", "Skin & coat", "Lymph nodes",
  "Heart", "Lungs", "Abdomen", "Gastrointestinal", "Musculoskeletal", "Neurological", "Urogenital"];

/** Examination findings in body order: the visit type's own list first, then the standard order, then anything else. */
export function examInOrder(exam: Record<string, string>, prompts: string[] = []): [string, string][] {
  const order = [...prompts, ...EXAM_SYSTEMS.filter((x) => !prompts.includes(x))];
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return Object.entries(exam).sort(([a], [b]) => rank(a) - rank(b));
}

export const HYDRATION_OPTIONS = ["Normal (under 5%)", "Mild (5–6%)", "Moderate (7–9%)", "Severe (10–12%)", "Shock (over 12%)"];
export const MENTATION_OPTIONS = ["BAR (bright, alert, responsive)", "QAR (quiet, alert, responsive)", "Depressed", "Obtunded", "Stuporous", "Comatose"];
