"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

const MESSAGES: Record<string, [kind: "success" | "error", text: string]> = {
  created: ["success", "Saved."],
  saved: ["success", "Changes saved."],
  merged: ["success", "Customers merged."],
  "pet-failed": ["error", "Customer saved, but the pet couldn't be registered. Please add it again."],
};

/** Shows a one-off toast for ?notice=… after a redirect, then strips it from the URL. */
export function NoticeToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const notice = params.get("notice");

  useEffect(() => {
    if (!notice) return;
    const m = MESSAGES[notice];
    if (m) toast[m[0]](m[1]);
    const rest = new URLSearchParams(params);
    rest.delete("notice");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [notice, params, pathname, router]);

  return null;
}
