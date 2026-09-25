import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Logo className="mb-8 justify-center" />
        <div className="rounded-xl border bg-card p-6 shadow-xs">
          <h1 className="text-lg font-semibold">Staff sign in</h1>
          <p className="mb-5 text-sm text-muted-foreground">Use the account given to you by the hospital admin.</p>
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Forgot your password? Ask the hospital admin to reset it.
        </p>
      </div>
    </main>
  );
}
