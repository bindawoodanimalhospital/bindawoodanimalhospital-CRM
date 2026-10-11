import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { ActivityTracker } from "@/components/app/activity-tracker";

/** Printable documents: no app shell, still signed-in only. */
export default async function PrintLayout({ children }: LayoutProps<"/">) {
  await requireStaff();
  return <>{children}<Suspense><ActivityTracker /></Suspense></>;
}
