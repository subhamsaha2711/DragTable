"use client";

import { useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { IconArrowUpRight, IconCheck, IconLoader } from "@/components/icons";

type PlanId = "personal" | "startup" | "enterprise";

const PLANS: {
  id: PlanId;
  label: string;
  limits: string;
}[] = [
  { id: "personal", label: "Personal", limits: "1 database · 5 tables · 5 members" },
  { id: "startup", label: "Startup", limits: "5 databases · 10 tables · 50 members" },
  { id: "enterprise", label: "Enterprise", limits: "10 databases · 100 tables · 100 members" },
];

export default function CreateTeamPage() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamName, setTeamName] = useState("");
  const [planId, setPlanId] = useState<PlanId>("startup");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error: err } = await api.createTeam({
      name,
      email,
      password,
      teamName,
      planId,
    });
    setLoading(false);
    if (err) {
      toast.error("Could not create team", err.message);
      return;
    }
    if (data) {
      toast.success("Team created", `Team ID ${data.team.teamCode}`);
      router.push(`/dashboard?team=${data.team.id}`);
    }
  }

  return (
    <main className="dt-shell relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 dt-landing-grid opacity-30" />
      <div className="dt-blob dt-blob-green" style={{ width: 480, height: 480, top: -220, left: "50%", marginLeft: -240 }} />
      <div className="relative z-10 mx-auto max-w-lg px-6 py-14">
        <div className="dt-anim-in mb-8">
          <BrandMark size={32} />
        </div>
        <div className="dt-anim-in dt-noise-edge overflow-hidden rounded-[var(--r-xl)] border border-[var(--border)] bg-[var(--surface-1)]" style={{ animationDelay: "0.06s", boxShadow: "var(--shadow-lg)" }}>
          <div className="h-[2.5px] w-full" style={{ background: "var(--green)" }} />
          <div className="border-b border-[var(--border-subtle)] px-6 py-5">
            <h1 className="text-lg font-semibold tracking-tight text-white">Create team</h1>
            <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
              You become the admin. All plans are available without payment; limits only.
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-5 px-6 py-6">
            <label className="dt-field block">
              <span className="dt-label">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                className="dt-input"
                placeholder="Ada Lovelace"
              />
            </label>
            <label className="dt-field block">
              <span className="dt-label">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
                minLength={8}
                className="dt-input"
                placeholder="At least 8 characters"
              />
            </label>
            <label className="dt-field block">
              <span className="dt-label">Team name</span>
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
                className="dt-input"
                placeholder="Acme Engineering"
              />
            </label>

            <div className="dt-field">
              <span className="dt-label">Plan</span>
              <div className="mt-1 grid gap-2">
                {PLANS.map((p) => {
                  const active = planId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanId(p.id)}
                      className={`rounded-[var(--r-md)] border px-4 py-3 text-left transition-all duration-200 ${
                        active
                          ? "border-[var(--blue)] bg-[var(--blue-soft)]"
                          : "border-[var(--border)] bg-black hover:border-[var(--border-hover)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-white">{p.label}</span>
                        {active && (
                          <span className="dt-chip dt-chip-blue">
                            <IconCheck size={10} />
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-tertiary)]">{p.limits}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <button type="submit" disabled={loading} className="dt-btn dt-btn-success dt-btn-block">
              {loading ? (
                <>
                  <IconLoader size={15} />
                  Creating…
                </>
              ) : (
                <>
                  Create team
                  <IconArrowUpRight size={15} />
                </>
              )}
            </button>
          </form>
          <div className="border-t border-[var(--border-subtle)] px-6 py-4 text-center text-[13px] text-[var(--text-tertiary)]">
            Already registered?{" "}
            <a href="/signin" className="text-[var(--blue-light)] transition hover:text-white">
              Sign in
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
