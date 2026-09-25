"use client";

import { OPEN_SEARCH_EVENT } from "./global-search";

/** Any element that opens the global search when clicked. */
export function OpenSearch({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}>
      {children}
    </button>
  );
}
