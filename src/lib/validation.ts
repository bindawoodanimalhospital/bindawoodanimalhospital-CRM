import { z } from "zod";
import { toE164 } from "@/lib/phone";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const phone = (label: string, required: boolean) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) {
        if (required) ctx.addIssue({ code: "custom", message: `${label} is required` });
        return null;
      }
      const e164 = toE164(v);
      if (!e164) ctx.addIssue({ code: "custom", message: `${label} doesn't look like a valid number` });
      return e164;
    });

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const customerSchema = z.object({
  full_name: z.string().trim().min(2, "Name is required"),
  full_name_ur: optionalText,
  phone: phone("Phone", true),
  whatsapp_same: checkbox,
  whatsapp: phone("WhatsApp", false),
  alt_phone: phone("Alternate phone", false),
  email: z.union([z.literal(""), z.email("Invalid email")]).optional().transform((v) => v || null),
  address: optionalText,
  area: optionalText,
  city: z.string().trim().default("Lahore").transform((v) => v || "Lahore"),
  preferred_channel: z.enum(["whatsapp", "call", "sms", "email"]).default("whatsapp"),
  marketing_opt_in: checkbox,
  referral_source: optionalText,
  notes: optionalText,
});

export type CustomerInput = z.infer<typeof customerSchema>;

export function customerRow(c: CustomerInput) {
  const { whatsapp_same, ...rest } = c;
  return { ...rest, whatsapp: whatsapp_same ? c.phone : c.whatsapp };
}

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid().nullable());

export const petSchema = z
  .object({
    name: z.string().trim().min(1, "Pet name is required"),
    species_id: z.uuid("Choose a species"),
    breed_id: optionalUuid,
    breed_text: optionalText,
    sex: z.enum(["male", "female", "unknown"]).default("unknown"),
    is_neutered: z
      .enum(["yes", "no", "unknown"])
      .default("unknown")
      .transform((v) => (v === "unknown" ? null : v === "yes")),
    // Either an exact date of birth, or an approximate age in years/months.
    date_of_birth: optionalText,
    dob_is_estimate: z.string().optional().transform((v) => v === "true"),
    age_years: z.coerce.number().int().min(0).max(60).optional().catch(undefined),
    age_months: z.coerce.number().int().min(0).max(11).optional().catch(undefined),
    color: optionalText,
    markings: optionalText,
    microchip_no: optionalText,
    tag_no: optionalText,
    special_handling: optionalText,
    notes: optionalText,
  })
  .transform(({ age_years, age_months, ...p }) => {
    let date_of_birth = p.date_of_birth ?? null;
    let dob_is_estimate = Boolean(date_of_birth && p.dob_is_estimate);
    if (!date_of_birth && (age_years || age_months)) {
      const d = new Date();
      d.setMonth(d.getMonth() - ((age_years ?? 0) * 12 + (age_months ?? 0)));
      date_of_birth = d.toISOString().slice(0, 10);
      dob_is_estimate = true;
    }
    return { ...p, date_of_birth, dob_is_estimate };
  });

export type PetInput = z.infer<typeof petSchema>;

export type FormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
};

/** Flattens zod issues to { field: firstMessage }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

/** FormData → plain object, only for keys with a prefix (e.g. "pet."), prefix removed. */
export function formObject(fd: FormData, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    if (prefix) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    } else if (!k.includes(".")) out[k] = v;
  }
  return out;
}

/** Friendlier text for common Postgres errors. */
export function dbErrorMessage(err: { code?: string; message: string } | null): string {
  if (!err) return "Something went wrong.";
  if (err.code === "42501") return "You don't have permission to do that.";
  if (err.code === "23505") {
    if (err.message.includes("microchip")) return "Another pet already has this microchip number.";
    return "That record already exists.";
  }
  return err.message;
}
