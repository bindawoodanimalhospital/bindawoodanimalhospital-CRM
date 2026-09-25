import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FormField({
  label, htmlFor, error, hint, required, className, children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-danger">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-sm font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormSection({ title, description, children, className }: {
  title: string; description?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-2xl bg-card p-6 shadow-card ring-1 ring-border", className)}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}
