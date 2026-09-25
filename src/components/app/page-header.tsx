import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title, description, actions, back, className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("mb-8", className)}>
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground hover:text-brand">
          <ChevronLeft className="size-4" /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
          {description && <p className="mt-1.5 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-surface px-6 py-16 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Icon className="size-7" /></span>
      <p className="text-lg font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Label/value pair used on profile pages. */
export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-medium">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

const TONES = {
  neutral: "bg-muted text-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
} as const;

export function StatusPill({ tone = "neutral", children, className }: {
  tone?: keyof typeof TONES; children: React.ReactNode; className?: string;
}) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}
