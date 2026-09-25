import {
  BarChart3, Bell, Boxes, CalendarDays, ClipboardList, CreditCard, FileClock, LayoutDashboard, ListOrdered,
  PawPrint, Receipt, Scissors, Settings, ShieldCheck, ShoppingBag, Stethoscope, Syringe, Truck, Users, UserCog,
  Wallet, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Shown when the user holds ANY of these. Omit = everyone. */
  anyOf?: Permission[];
  /** Roadmap phase not built yet — rendered disabled. */
  soon?: string;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Today",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Live queue", href: "/queue", icon: ListOrdered, anyOf: ["queue.manage"], soon: "Phase 2" },
      { title: "Appointments", href: "/appointments", icon: CalendarDays, anyOf: ["appointments.view"], soon: "Phase 2" },
      { title: "Tasks & alerts", href: "/tasks", icon: Bell, anyOf: ["tasks.manage", "tasks.view_all"], soon: "Phase 5" },
    ],
  },
  {
    label: "Records",
    items: [
      { title: "Customers", href: "/customers", icon: Users, anyOf: ["customers.view"] },
      { title: "Pets", href: "/pets", icon: PawPrint, anyOf: ["pets.view"] },
      { title: "Consultations", href: "/consultations", icon: Stethoscope, anyOf: ["clinical.view"], soon: "Phase 2" },
      { title: "Vaccinations", href: "/vaccinations", icon: Syringe, anyOf: ["vaccinations.manage"], soon: "Phase 2" },
      { title: "Surgery & inpatient", href: "/surgery", icon: Scissors, anyOf: ["surgery.manage", "inpatient.manage"], soon: "Phase 3" },
    ],
  },
  {
    label: "Money & stock",
    items: [
      { title: "Billing", href: "/billing", icon: Receipt, anyOf: ["billing.view"], soon: "Phase 4" },
      { title: "Customer dues", href: "/dues", icon: CreditCard, anyOf: ["billing.view"], soon: "Phase 4" },
      { title: "Pet store POS", href: "/pos", icon: ShoppingBag, anyOf: ["pos.use"], soon: "Phase 4" },
      { title: "Inventory", href: "/inventory", icon: Boxes, anyOf: ["inventory.view"], soon: "Phase 4" },
      { title: "Suppliers", href: "/suppliers", icon: Truck, anyOf: ["suppliers.manage"], soon: "Phase 4" },
      { title: "Expenses", href: "/expenses", icon: Wallet, anyOf: ["expenses.view"], soon: "Phase 4" },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Reports", href: "/reports", icon: BarChart3, anyOf: ["reports.view"], soon: "Phase 6" },
      { title: "Staff", href: "/admin/staff", icon: UserCog, anyOf: ["staff.view"] },
      { title: "Roles & permissions", href: "/admin/roles", icon: ShieldCheck, anyOf: ["staff.view"] },
      { title: "Audit log", href: "/admin/audit", icon: FileClock, anyOf: ["audit.view"] },
      { title: "Settings", href: "/settings", icon: Settings, anyOf: ["settings.manage"] },
      { title: "Clinical templates", href: "/settings/templates", icon: ClipboardList, anyOf: ["settings.manage"], soon: "Phase 2" },
    ],
  },
];
