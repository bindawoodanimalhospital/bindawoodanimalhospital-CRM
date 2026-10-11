import { requireStaff } from "@/lib/auth";

/** Printable documents: no app shell, still signed-in only. */
export default async function PrintLayout({ children }: LayoutProps<"/">) {
  await requireStaff();
  return <>{children}</>;
}
