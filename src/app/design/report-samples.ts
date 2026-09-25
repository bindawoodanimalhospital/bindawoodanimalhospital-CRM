import type { FinancialReport, OperationsReport } from "@/lib/reports";

// Deterministic made-up numbers for the style guide only.
const wave = (i: number, base: number, amp: number) => Math.round(base + amp * Math.sin(i / 2.2) + (i % 7 === 5 ? amp * 0.9 : 0) + ((i * 37) % 11) * amp * 0.05);
const days = Array.from({ length: 25 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);

export const SAMPLE_FIN: FinancialReport = {
  range: { from: "2026-09-01", to: "2026-09-25", grain: "day", days: 25 },
  billed: { gross: 1_284_500, returns: 6_500, net: 1_278_000, discounts: 18_200, bills: 412, voided_bills: 3, average_bill: 3_118, average_per_visit: 3_640, clinic: 1_052_000, store: 232_500 },
  collected: { received: 1_196_300, refunded: 8_000, net: 1_188_300, payments: 398, written_off: 2_500,
    by_method: [{ method: "Cash", amount: 742_000, count: 301 }, { method: "JazzCash", amount: 214_300, count: 52 }, { method: "Easypaisa", amount: 131_000, count: 31 }, { method: "Bank transfer", amount: 109_000, count: 14 }] },
  owed: { total: 146_700, bills: 23, customers: 19, overdue_promises: 6, credit_held: 12_000,
    aging: [{ label: "0–30 days", amount: 98_200 }, { label: "31–60 days", amount: 31_500 }, { label: "61–90 days", amount: 9_000 }, { label: "Over 90 days", amount: 8_000 }] },
  expenses: { total: 386_000, by_category: [{ label: "Salaries", amount: 240_000 }, { label: "Rent", amount: 85_000 }, { label: "Electricity", amount: 38_500 }, { label: "Cleaning", amount: 12_500 }, { label: "Tea & refreshments", amount: 10_000 }] },
  estimate: { stock_cost: 214_800, wastage_cost: 6_300, items_without_cost: 4, gross_margin: 1_063_200, profit: 670_900 },
  series: days.map((d, i) => ({ bucket: d, billed: wave(i, 50_000, 16_000), collected: wave(i + 1, 46_000, 15_000), expenses: 12_000 })),
  by_category: [{ label: "Surgery", kind: "service", amount: 412_000, lines: 22 }, { label: "Consultation", kind: "service", amount: 268_500, lines: 179 },
    { label: "Vaccines", kind: "service", amount: 196_000, lines: 98 }, { label: "Medicines", kind: "product", amount: 171_300, lines: 244 },
    { label: "Diagnostics", kind: "service", amount: 118_000, lines: 41 }, { label: "Pet food", kind: "product", amount: 94_200, lines: 63 },
    { label: "Grooming", kind: "service", amount: 24_500, lines: 17 }],
  top_items: [{ label: "Spay (ovariohysterectomy)", kind: "service", amount: 250_000, qty: 10 }, { label: "Consultation fee", kind: "service", amount: 268_500, qty: 179 },
    { label: "DHPPi", kind: "service", amount: 96_000, qty: 48 }, { label: "Abdominal ultrasound", kind: "service", amount: 87_500, qty: 25 }],
  by_doctor: [{ label: "Dr. Musab Bin Dawood", amount: 742_000, bills: 221 }, { label: "Dr. Hira", amount: 318_000, bills: 118 }, { label: "Pet store", amount: 218_000, bills: 73 }],
  by_species: [{ label: "Cat", amount: 612_000, bills: 208 }, { label: "Dog", amount: 481_000, bills: 131 }, { label: "No pet (walk-in sale)", amount: 118_000, bills: 51 }, { label: "Bird", amount: 67_000, bills: 22 }],
  top_customers: [{ id: "c1", label: "Ahmed Raza", amount: 64_500, bills: 5 }, { id: "c2", label: "Ayesha Khan", amount: 41_200, bills: 3 }, { id: "c3", label: "Bilal Sheikh", amount: 29_800, bills: 4 }],
  customer_value: { active_customers: 1_842, average_yearly_spend: 9_450, average_bills_per_year: 3.1 },
};

export const SAMPLE_OPS: OperationsReport = {
  range: { from: "2026-09-01", to: "2026-09-25", grain: "day", days: 25 },
  visits: { total: 351, completed: 339, cancelled: 6, urgent: 21, pets: 298, per_day: 14, median_wait_min: 12, median_visit_min: 18 },
  series: days.map((d, i) => ({ bucket: d, visits: Math.max(4, Math.round(wave(i, 14, 5) / 1)) })),
  peak_hours: [1, 2, 3, 4, 5, 6, 7].flatMap((dow) => Array.from({ length: 12 }, (_, k) => {
    const hour = 10 + k;
    const visits = Math.max(0, Math.round((hour >= 17 && hour <= 20 ? 5 : 2) + (dow === 7 ? 3 : 0) + ((dow * 13 + hour * 7) % 4) - 1));
    return { dow, hour, visits };
  })),
  by_doctor: [{ label: "Dr. Musab Bin Dawood", visits: 221, completed: 216, median_visit_min: 19 }, { label: "Dr. Hira", visits: 130, completed: 123, median_visit_min: 16 }],
  by_type: [{ label: "Consultation", visits: 164 }, { label: "Vaccination", visits: 98 }, { label: "Follow-up", visits: 61 }, { label: "Walk-in", visits: 28 }],
  by_species: [{ label: "Cat", pets: 161 }, { label: "Dog", pets: 102 }, { label: "Bird", pets: 23 }, { label: "Rabbit", pets: 12 }],
  customers: { seen: 280, new: 64, returning: 216, registered: 71, lapsed: 188,
    referrals: [{ label: "Google", customers: 24 }, { label: "Friend / family", customers: 21 }, { label: "Instagram", customers: 14 }, { label: "Not recorded", customers: 12 }] },
  appointments: { total: 212, completed: 178, no_show: 19, cancelled: 15, no_show_rate: 9.6, cancel_rate: 7.1,
    by_source: [{ label: "whatsapp", appointments: 121 }, { label: "phone", appointments: 64 }, { label: "in_person", appointments: 27 }] },
  vaccinations: { doses: 131, by_vaccine: [], due: { total: 142, done: 109, done_on_time: 91, skipped: 6, still_pending: 27, completion_rate: 76.8 }, overdue_now: 58, overdue_pets: 44 },
  surgery: { total: 24, completed: 21, cancelled: 2, emergency: 3, by_procedure: [{ label: "Spay (ovariohysterectomy)", surgeries: 10 }, { label: "Castration", surgeries: 8 }, { label: "Wound repair", surgeries: 4 }] },
  diagnostics: { total: 58, resulted: 55, by_category: [{ label: "ultrasound", tests: 25 }, { label: "lab", tests: 21 }, { label: "rapid_test", tests: 12 }] },
  ward: { admissions: 17, average_stay_days: 2.4 },
};
