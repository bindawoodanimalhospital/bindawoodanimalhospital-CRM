/*
 * Pet owners' phone numbers and email live in public.customer_contacts, which only staff with the
 * customers.contact permission can read or change (Owner by default). Embed it in a customers
 * query with CONTACT, then read it with contactOf(): for everyone else it is simply empty.
 */
export const CONTACT = "customer_contacts(phone, whatsapp, alt_phone, email)";

export type Contact = { phone: string | null; whatsapp: string | null; alt_phone: string | null; email: string | null };
const EMPTY: Contact = { phone: null, whatsapp: null, alt_phone: null, email: null };

/** The contact details embedded in a customer row (empty when the viewer may not see them). */
export function contactOf(customer: unknown): Contact {
  const raw = (customer as { customer_contacts?: unknown } | null | undefined)?.customer_contacts;
  const c = (Array.isArray(raw) ? raw[0] : raw) as Partial<Contact> | null | undefined;
  return c ? { ...EMPTY, ...c } : EMPTY;
}

/** Best number to message: WhatsApp if saved, else the main phone. */
export function messagingNumber(customer: unknown): string | null {
  const c = contactOf(customer);
  return c.whatsapp ?? c.phone;
}

/** The row with its contact fields laid on top (all null when the viewer may not see them). */
export function withContact<T extends object>(customer: T): T & Contact;
export function withContact<T extends object>(customer: T | null | undefined): (T & Contact) | null;
export function withContact<T extends object>(customer: T | null | undefined): (T & Contact) | null {
  return customer ? { ...customer, ...contactOf(customer) } : null;
}
