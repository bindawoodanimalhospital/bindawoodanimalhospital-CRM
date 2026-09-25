import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pagination({ page, pageSize, total, params = {} }: {
  page: number; pageSize: number; total: number; params?: Record<string, string>;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    sp.set("page", String(p));
    return `?${sp}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
          <Link href={href(page - 1)}><ChevronLeft /> Previous</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className={page >= pages ? "pointer-events-none opacity-50" : ""}>
          <Link href={href(page + 1)}>Next <ChevronRight /></Link>
        </Button>
      </div>
    </div>
  );
}
