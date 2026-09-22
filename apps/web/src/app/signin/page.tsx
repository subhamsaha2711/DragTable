"use client";

import { useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { IconArrowUpRight, IconLoader, IconLock } from "@/components/icons";

export default function SignInPage() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error: err } = await api.signIn({ email, password });
    setLoading(false);
    if (err) {
      toast.error("Sign in failed", err.message);
      return;
    }
    if (data) {
      toast.success("Signed in", data.user.name);
      router.push("/dashboard");
    }
  }

  return (
    <main className="dt-shell relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 dt-landing-grid opacity-40" />
      <div className="dt-blob dt-blob-blue" style={{ width: 480, height: 480, top: -200, left: "50%", marginLeft: -240 }} />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="dt-anim-in mb-10">
          <BrandMark size={32} />
        </div>
        <div className="dt-anim-in dt-noise-edge overflow-hidden rounded-[var(--r-xl)] border border-[var(--border)] bg-[var(--surface-1)]" style={{ animationDelay: "0.06s", boxShadow: "var(--shadow-lg)" }}>
          <div className="h-[2.5px] w-full" style={{ background: "var(--blue)" }} />
          <div className="border-b border-[var(--border-subtle)] px-6 py-5">
            <h1 className="text-lg font-semibold tracking-tight text-white">Sign in</h1>
            <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">Access your teams and databases.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-5 px-6 py-6">
            <label className="dt-field block">
              <span className="dt-label">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                className="dt-input"
                placeholder="you@company.com"
              />
            </label>
            <label className="dt-field block">
              <span className="dt-label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="dt-input"
                placeholder="••••••••"
              />
            </label>
            <button type="submit" disabled={loading} className="dt-btn dt-btn-primary dt-btn-block">
              {loading ? (
                <>
                  <IconLoader size={15} />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <IconArrowUpRight size={15} />
                </>
              )}
            </button>
          </form>
          <div className="border-t border-[var(--border-subtle)] px-6 py-4 text-center text-[13px] text-[var(--text-tertiary)]">
            <a href="/create-team" className="text-[var(--blue-light)] transition hover:text-white">
              Create a team
            </a>
            <span className="mx-2 text-[var(--text-quaternary)]">·</span>
            <a href="/join-team" className="text-[var(--blue-light)] transition hover:text-white">
              Join with Team ID
            </a>
          </div>
        </div>
        <p className="dt-anim-in mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-[var(--text-quaternary)]" style={{ animationDelay: "0.12s" }}>
          <IconLock size={11} />
          Credentials are never logged or broadcast.
        </p>
      </div>
    </main>
  );
}
