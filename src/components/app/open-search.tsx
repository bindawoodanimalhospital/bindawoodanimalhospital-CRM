"use client";

import { openSearch } from "./global-search";

/** Any element that opens the global search when clicked; `q` / `scope` pre-fill it. */
export function OpenSearch({ className, children, q, scope }: {
  className?: string; children: React.ReactNode; q?: string; scope?: "all" | "owner" | "pet" | "bill" | "item";
}) {
  return (
    <button type="button" className={className} onClick={() => openSearch({ q, scope })}>
      {children}
    </button>
  );
}
