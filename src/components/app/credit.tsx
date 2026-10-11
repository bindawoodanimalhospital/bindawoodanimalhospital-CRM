import { cn } from "@/lib/utils";

/** "Designed and developed by OBD" — shown at the foot of the app and the sign-in page. */
export function Credit({ className }: { className?: string }) {
  return (
    <p className={cn("no-print text-center text-xs text-muted-foreground", className)}>
      Designed and developed by{" "}
      <a href="https://omerbindawood.github.io/Portfolio-Website/" target="_blank" rel="noopener noreferrer"
        className="font-semibold text-brand underline-offset-4 hover:underline">OBD</a>
    </p>
  );
}
