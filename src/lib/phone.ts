import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * Normalises what staff type ("0300-1234567", "300 1234567", "+92 300 1234567", "923001234567")
 * to E.164 (+923001234567). Pakistan is assumed unless the number starts with "+" or "00".
 * Returns null when it isn't a valid number.
 */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = input.trim().replace(/[^\d+]/g, "");
  if (!raw) return null;
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  if (!raw.startsWith("+") && raw.startsWith("92") && raw.length === 12) raw = `+${raw}`;
  const parsed = parsePhoneNumberFromString(raw, "PK");
  return parsed?.isValid() ? parsed.number : null;
}

/** Display format: Pakistani numbers nationally ("0300 1234567", "042 35761234"), others internationally. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === "PK" ? parsed.formatNational() : parsed.formatInternational();
}

/** wa.me link for click-to-chat. */
export function whatsappLink(e164: string | null | undefined, text?: string): string | null {
  if (!e164) return null;
  const url = `https://wa.me/${e164.replace(/\D/g, "")}`;
  return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}
