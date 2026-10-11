import {
  FileClock, House, PawPrint, Settings, ShieldCheck, UserCog, Users, type LucideIcon,
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
      { title: "Settings", href: "/settings", icon: Settings, anyOf: ["settings.manage"] },
    ],
  },
];
