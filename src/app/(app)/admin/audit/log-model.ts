/*
 * The activity log's vocabulary and filters, shared by the server page (first batch) and the
 * browser feed (every batch after it), so both read the log in exactly the same way.
 */

/** Plain-language names for record types (anything not listed is shown with underscores removed). */
export const TABLE_LABEL: Record<string, string> = {
  customers: "Pet owner", customer_contacts: "Owner phone / email", pets: "Pet", pet_owners: "Pet ↔ owner link", pet_alerts: "Pet alert", pet_weights: "Weight",
  staff: "Staff", staff_roles: "Staff role", roles: "Role", role_permissions: "Role permission", permissions: "Permission type",
  system_settings: "Setting", staff_schedules: "Staff schedule",
  appointments: "Appointment", appointment_types: "Appointment type", visits: "Visit", visit_status_events: "Queue status",
  consultations: "Consultation", consultation_diagnoses: "Diagnosis", consultation_revisions: "Consultation edit",
  clinical_templates: "Clinical template", vaccinations: "Vaccination", vaccines: "Vaccine", due_items: "Due reminder",
  vaccination_protocols: "Vaccine schedule", vaccination_protocol_steps: "Vaccine schedule step",
  prescriptions: "Prescription", prescription_items: "Prescription medicine", medicines: "Medicine",
  diagnostic_orders: "Test", diagnostic_types: "Test type", documents: "Document",
  surgeries: "Surgery", surgery_events: "Surgery step", surgery_revisions: "Surgery edit", surgery_team: "Surgery team",
  surgery_consents: "Surgery consent", surgery_consumables: "Surgery consumable", surgery_procedures: "Surgery procedure",
  admissions: "Ward admission", admission_orders: "Ward order", admission_administrations: "Ward dose given",
  admission_notes: "Ward note", kennels: "Kennel",
  invoices: "Bill", invoice_items: "Bill line", payments: "Payment", payment_allocations: "Payment split", dues: "Unpaid bill",
  due_promises: "Payment promise", invoice_returns: "Return", payment_methods: "Payment method",
  catalog_items: "Price-list item", product_families: "Product with sizes", catalog_costs: "Cost price", inventory_movements: "Stock movement",
  inventory_locations: "Stock location", product_batches: "Stock batch", batch_costs: "Batch cost",
  suppliers: "Supplier", purchases: "Stock delivery", purchase_lines: "Stock delivery line", supplier_payments: "Supplier payment",
  stock_loans: "Stock loan", stock_loan_lines: "Stock loan item", stock_loan_returns: "Stock loan return",
  stock_loan_return_lines: "Stock loan return item", partner_businesses: "Nearby business",
  expenses: "Expense", expense_categories: "Expense category", tasks: "Task", task_comments: "Task comment",
  messages: "Message", message_templates: "Message template", reminder_rules: "Reminder rule", reminder_tracks: "Reminder track",
  reminder_events: "Reminder event", campaigns: "Campaign", breeds: "Breed", species: "Species",
};
export const TABLES = Object.keys(TABLE_LABEL).sort((a, b) => TABLE_LABEL[a].localeCompare(TABLE_LABEL[b]));

export const SIGNIN = ["auth.sign_in", "auth.sign_out", "auth.sign_in_failed"];
export const CHANGES = ["insert", "update", "delete"];
export const CONTACT_ACTIONS = ["contact.call", "contact.whatsapp", "contact.email", "link.external", "file.download", "data.copied"];
export const PRESENCE = ["session.idle", "session.active", "session.closed"];
export const KINDS = [
  { key: "", label: "Everything" },
  { key: "signin", label: "Sign-ins & sign-outs" },
  { key: "changes", label: "Changes to records" },
  { key: "views", label: "Pages opened" },
  { key: "prints", label: "Prints" },
  { key: "contact", label: "Calls, WhatsApp, links & copying" },
  { key: "search", label: "Searches" },
  { key: "presence", label: "Away, back & tab closed" },
  { key: "denied", label: "Blocked pages" },
  { key: "events", label: "Other actions" },
] as const;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BATCH = 60;
export const COLUMNS = "id, occurred_at, actor_id, action, table_name, record_id, old_data, new_data, changed, reason, context";

export type LogFilters = { table: string; actor: string; kind: string; from: string; to: string };
export type LogRow = {
  id: number; occurred_at: string; actor_id: string | null; action: string; table_name: string | null; record_id: string | null;
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; changed: string[] | null;
  reason: string | null; context: Record<string, unknown> | null;
};

// Works with both the server and the browser Supabase query builders.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyFilters<Q extends { eq: any; in: any; not: any; gte: any; lte: any }>(q: Q, f: LogFilters): Q {
  let x = q;
  if (f.table) x = x.eq("table_name", f.table);
  if (f.actor) x = x.eq("actor_id", f.actor);
  if (f.kind === "signin") x = x.in("action", SIGNIN);
  if (f.kind === "changes") x = x.in("action", CHANGES);
  if (f.kind === "views") x = x.eq("action", "page.view");
  if (f.kind === "prints") x = x.eq("action", "page.print");
  if (f.kind === "contact") x = x.in("action", CONTACT_ACTIONS);
  if (f.kind === "search") x = x.eq("action", "search.used");
  if (f.kind === "presence") x = x.in("action", PRESENCE);
  if (f.kind === "denied") x = x.eq("action", "access.denied");
  if (f.kind === "events") x = x.not("action", "in", `(${[...SIGNIN, ...CHANGES, ...CONTACT_ACTIONS, ...PRESENCE, "page.view", "page.print", "search.used", "access.denied"].join(",")})`);
  if (f.from) x = x.gte("occurred_at", `${f.from}T00:00:00+05:00`);
  if (f.to) x = x.lte("occurred_at", `${f.to}T23:59:59.999+05:00`);
  return x;
}
