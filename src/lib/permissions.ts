/** Mirror of public.permissions keys. The database is the source of truth; this is for type-safety in the UI. */
export type Permission =
  | "dashboard.owner"
  | "customers.view" | "customers.create" | "customers.edit" | "customers.delete" | "customers.merge"
  | "pets.view" | "pets.create" | "pets.edit" | "pets.delete"
  | "appointments.view" | "appointments.manage" | "queue.manage"
  | "clinical.view" | "clinical.create" | "clinical.edit" | "clinical.finalize" | "clinical.reopen"
  | "vaccinations.manage" | "prescriptions.manage" | "diagnostics.manage"
  | "surgery.manage" | "surgery.assist" | "surgery.consent" | "inpatient.manage" | "inpatient.care"
  | "billing.view" | "billing.create" | "billing.discount" | "billing.discount_approve" | "billing.refund" | "billing.void"
  | "pos.use" | "pos.return"
  | "inventory.view" | "inventory.manage" | "inventory.adjust" | "inventory.view_cost" | "suppliers.manage"
  | "expenses.view" | "expenses.manage" | "finance.view"
  | "crm.view" | "crm.manage" | "crm.campaigns" | "tasks.view_all" | "tasks.manage"
  | "reports.view" | "reports.financial" | "data.export"
  | "staff.view" | "staff.manage" | "settings.manage" | "audit.view";
