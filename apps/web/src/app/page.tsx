"use client";

import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import {
  IconArrowUpRight,
  IconBook,
  IconDatabase,
  IconGitBranch,
  IconShield,
  IconUsers,
  IconZap,
} from "@/components/icons";

function useSpotlight() {
  const ref = useRef<HTMLDivElement | null>(null);
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return { ref, onMouseMove };
}

export default function LandingPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  const heroSpot = useSpotlight();

  return (
    <main className="dt-shell relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 dt-landing-grid opacity-60" />
      <div className="dt-blob dt-blob-blue" style={{ width: 560, height: 560, top: -220, left: "50%", marginLeft: -280 }} />
      <div className="dt-blob dt-blob-green" style={{ width: 420, height: 420, top: 120, right: -160 }} />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.16), transparent)",
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <BrandMark size={32} />
        <nav className="flex items-center gap-6">
          <a href="/docs" className="dt-nav-link hidden sm:inline">
            Docs
          </a>
          <a href="/signin" className="dt-nav-link hidden sm:inline">
            Sign in
          </a>
          <a href="/join-team" className="dt-nav-link hidden sm:inline">
            Join team
          </a>
          <a href="/create-team" className="dt-btn dt-btn-primary dt-btn-sm">
            Create team
          </a>
        </nav>
      </header>

      <section
        className={`relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-16 text-center sm:pt-24 ${ready ? "dt-anim-in" : "opacity-0"}`}
      >
        <p className="dt-eyebrow mb-5 justify-center">
          <span className="dt-live-dot" />
          Relational data platform
        </p>
        <h1 className="dt-gradient-text mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[58px] lg:leading-[1.07]">
          Operate relational databases without writing SQL
        </h1>
        <div className="mx-auto mt-8 max-w-md dt-landing-hero-line" />
        <p className="mx-auto mt-8 max-w-xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
          Collaborative visual schema design, structured data operations, live multi-user
          workspaces, audit history, and self-hosted control for development teams.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a href="/create-team" className="dt-btn dt-btn-primary">
            Create team
            <IconArrowUpRight size={15} />
          </a>
          <a href="/join-team" className="dt-btn dt-btn-ghost">
            Join with Team ID
          </a>
          <a href="/signin" className="dt-btn dt-btn-ghost">
            Sign in
          </a>
        </div>

        {/* Product preview — structural, not decorative chrome dots */}
        <div
          ref={heroSpot.ref}
          onMouseMove={heroSpot.onMouseMove}
          className={`dt-spotlight dt-noise-edge mx-auto mt-16 max-w-4xl overflow-hidden rounded-[var(--r-xl)] border border-[var(--border)] bg-[var(--surface-1)] text-left ${ready ? "dt-anim-in" : "opacity-0"}`}
          style={{ animationDelay: "0.15s", boxShadow: "var(--shadow-lg)" }}
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <span className="dt-mono flex items-center gap-2 text-[var(--text-tertiary)]">
              <span className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--red)]/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--yellow)]/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--green)]/70" />
              </span>
              workspace / production
            </span>
            <span className="dt-chip dt-chip-green">
              <span className="dt-live-dot" /> Live
            </span>
          </div>
          <div className="grid min-h-[260px] grid-cols-12">
            <aside className="col-span-4 border-r border-[var(--border-subtle)] p-4 sm:col-span-3">
              <p className="dt-label">Tables</p>
              <ul className="mt-2 space-y-0.5">
                {["users", "orders", "products", "order_items"].map((t, i) => (
                  <li
                    key={t}
                    className={`rounded-[6px] px-2 py-1.5 text-[13px] transition-colors ${i === 0 ? "border-l-2 border-[var(--blue)] bg-[var(--blue-soft)] text-white" : "text-[var(--text-tertiary)]"}`}
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </aside>
            <div className="col-span-8 flex flex-col justify-center gap-6 p-6 sm:col-span-9 sm:flex-row sm:items-center sm:gap-10">
              <div className="min-w-[140px] rounded-[var(--r-md)] border border-[var(--border-strong)] bg-black p-4">
                <p className="text-[11px] uppercase tracking-wider text-[var(--blue-light)]">users</p>
                <p className="mt-3 dt-mono text-[var(--text-tertiary)]">id · email · name</p>
              </div>
              <div
                className="hidden h-px w-16 sm:block"
                style={{ background: "linear-gradient(90deg, var(--blue), var(--green))" }}
                aria-hidden
              />
              <div
                className="h-8 w-px sm:hidden"
                style={{ background: "linear-gradient(180deg, var(--blue), var(--green))" }}
                aria-hidden
              />
              <div className="min-w-[140px] rounded-[var(--r-md)] border border-[var(--border-strong)] bg-black p-4">
                <p className="text-[11px] uppercase tracking-wider text-[var(--green-light)]">orders</p>
                <p className="mt-3 dt-mono text-[var(--text-tertiary)]">id · user_id · total</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <div className="dt-stagger grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Visual schema",
              body: "Define tables, columns, primary keys, foreign keys, indexes, and check constraints through structured controls.",
              icon: IconDatabase,
              accent: "blue",
            },
            {
              title: "Live collaboration",
              body: "Concurrent editing with conflict detection, workspace presence, and an immutable audit trail per change.",
              icon: IconUsers,
              accent: "green",
            },
            {
              title: "Self-hosted control",
              body: "Deploy with Docker. Credentials, plan limits, and team membership stay under your infrastructure.",
              icon: IconShield,
              accent: "yellow",
            },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <FeatureCard key={f.title} title={f.title} body={f.body} Icon={Icon} accent={f.accent} />
            );
          })}
        </div>

        <div className="dt-anim-in mt-4 grid gap-4 sm:grid-cols-2" style={{ animationDelay: "0.3s" }}>
          <div className="dt-card dt-card-hover dt-spotlight rounded-[var(--r-lg)] p-6" onMouseMove={spotlightMove}>
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--blue-light)]">
              <IconZap size={17} />
            </div>
            <h3 className="text-[15px] font-semibold text-white">Realtime by default</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
              WebSocket-pushed row and schema changes land across every open workspace in
              well under a second, with a lightweight poll as fallback.
            </p>
          </div>
          <div className="dt-card dt-card-hover dt-spotlight rounded-[var(--r-lg)] p-6" onMouseMove={spotlightMove}>
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--green-light)]">
              <IconGitBranch size={17} />
            </div>
            <h3 className="text-[15px] font-semibold text-white">Structured relations</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
              Foreign keys, indexes, and check constraints — no free-form SQL. Every
              mutation is validated server-side before it touches your data.
            </p>
          </div>
        </div>

        <div className="dt-anim-in mt-8 flex flex-wrap items-center justify-center gap-3 text-center" style={{ animationDelay: "0.38s" }}>
          <a href="/docs" className="dt-btn dt-btn-ghost dt-btn-sm">
            <IconBook size={14} />
            Read the docs
          </a>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[var(--border-subtle)] px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-xs text-[var(--text-quaternary)]">DragTable · Self-hosted relational workspace</p>
          <div className="flex gap-6 text-xs">
            <a href="/docs" className="dt-nav-link">
              Docs
            </a>
            <a href="/signin" className="dt-nav-link">
              Sign in
            </a>
            <a href="/create-team" className="dt-nav-link">
              Create team
            </a>
            <a href="/join-team" className="dt-nav-link">
              Join team
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function spotlightMove(e: React.MouseEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

function FeatureCard({
  title,
  body,
  Icon,
  accent,
}: {
  title: string;
  body: string;
  Icon: (p: { size?: number }) => React.ReactElement;
  accent: string;
}) {
  return (
    <div
      className="dt-card dt-card-hover dt-spotlight rounded-[var(--r-lg)] p-6"
      onMouseMove={spotlightMove}
      style={{ borderTop: `2px solid var(--${accent})` }}
    >
      <div
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-[var(--r-md)] border"
        style={{
          borderColor: `var(--${accent}-border)`,
          background: `var(--${accent}-soft)`,
          color: `var(--${accent}-light)`,
        }}
      >
        <Icon size={17} />
      </div>
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{body}</p>
    </div>
  );
}
