import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/lib/utils";
import { EnvVarWarning } from "@/components/env-var-warning";
import Link from "next/link";
import { Suspense } from "react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <div className="flex gap-5 items-center font-semibold">
              <Link href={"/"}>Kassel Family Tree</Link>
            </div>
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense>
                <AuthButton />
              </Suspense>
            )}
          </div>
        </nav>
        <div className="flex-1 w-full flex flex-col gap-8 max-w-6xl p-6">
          <main className="flex-1 flex flex-col gap-6 items-center justify-center">
            <section className="rounded-2xl border border-foreground/10 bg-gradient-to-br from-emerald-50 via-amber-50 to-rose-50 dark:from-emerald-950 dark:via-amber-950 dark:to-rose-950 p-6 md:p-8 shadow-sm max-w-xl text-center">
              <div className="flex flex-col gap-4">
                <p className="uppercase tracking-[0.3em] text-xs text-foreground/60">
                  Kassel Family
                </p>
                <h1 className="text-3xl md:text-4xl font-[600]">
                  A living tree of connections
                </h1>
                <p className="text-foreground/70">
                  Explore our family history and discover the connections that
                  bind us together across generations.
                </p>
                <div className="mt-4">
                  <Link
                    href="/auth/login"
                    className="inline-block rounded-lg bg-foreground text-background px-6 py-3 font-medium hover:opacity-90 transition-opacity"
                  >
                    Sign in to view the family tree
                  </Link>
                </div>
              </div>
            </section>
          </main>
        </div>

        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
          <p>
            Powered by{" "}
            <a
              href="https://supabase.com/?utm_source=create-next-app&utm_medium=template&utm_term=nextjs"
              target="_blank"
              className="font-bold hover:underline"
              rel="noreferrer"
            >
              Supabase
            </a>
          </p>
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  );
}
