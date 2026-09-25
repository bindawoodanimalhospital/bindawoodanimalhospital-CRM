import {
  BedDouble, CalendarClock, CalendarDays, FileClock, Scissors, House, ListOrdered, PawPrint, Settings, ShieldCheck, Syringe, UserCog, Users, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Shown when the user holds ANY of these. Omit = everyone. */
  anyOf?: Permission[];
};

export type NavGroup = { label?: string; items: NavItem[] };

/**
 * Plain-language labels on purpose ("Pet owners", not "CRM"). Only modules that exist are
 * listed — unfinished modules would confuse staff. Add items here as each phase ships.
 */
export const NAV: NavGroup[] = [
  {
    items: [
      { title: "Home", href: "/dashboard", icon: House },
      { title: "Today's queue", href: "/queue", icon: ListOrdered, anyOf: ["queue.manage", "clinical.view"] },
      { title: "Appointments", href: "/appointments", icon: CalendarDays, anyOf: ["appointments.view"] },
      { title: "Due & follow-ups", href: "/due", icon: CalendarClock, anyOf: ["clinical.view", "crm.view"] },
      { title: "Surgery", href: "/surgery", icon: Scissors, anyOf: ["clinical.view", "surgery.consent"] },
      { title: "Ward", href: "/ward", icon: BedDouble, anyOf: ["clinical.view"] },
    ],
  },
  {
    label: "Records",
    items: [
      { title: "Pet owners", href: "/customers", icon: Users, anyOf: ["customers.view"] },
      { title: "Pets", href: "/pets", icon: PawPrint, anyOf: ["pets.view"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Staff", href: "/admin/staff", icon: UserCog, anyOf: ["staff.view"] },
      { title: "Who can do what", href: "/admin/roles", icon: ShieldCheck, anyOf: ["staff.view"] },
      { title: "History log", href: "/admin/audit", icon: FileClock, anyOf: ["audit.view"] },
      { title: "Vaccine schedules", href: "/settings/vaccines", icon: Syringe, anyOf: ["clinical.reopen"] },
      { title: "Settings", href: "/settings", icon: Settings, anyOf: ["settings.manage"] },
    ],
  },
];
