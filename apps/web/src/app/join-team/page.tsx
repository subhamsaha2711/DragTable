"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { LoadingScreen } from "@/components/Loading";
import { IconArrowUpRight, IconLoader } from "@/components/icons";

/**
 * Two paths:
 * 1) New user — create account + join team with Team ID
 * 2) Already signed in — join with Team ID only
 */
export default function JoinTeamPage() {
  const router = useRouter();
  const toast = useToast();
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.me().then(({ data, status }) => {
      setChecking(false);
      if (status === 200 && data?.user) setSignedIn(true);
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = teamCode.trim().toUpperCase();
    if (code.length !== 5) {
      toast.error("Invalid Team ID", "Team ID must be 5 characters");
      return;
    }
    setLoading(true);

    if (signedIn) {
      const { data, error: err, status } = await api.joinTeam(code);
      setLoading(false);
      if (status === 401) {
        toast.error("Session expired", "Sign in again, or register below");
        setSignedIn(false);
        return;
      }
      if (err) {
        toast.error("Could not join", err.message);
        return;
      }
      if (data) {
        toast.success("Joined team", data.team.name);
        router.push(`/dashboard?team=${data.team.id}`);
      }
      return;
    }

    const { data, error: err } = await api.registerAndJoin({
      name: name.trim(),
      email: email.trim(),
      password,
      teamCode: code,
    });
    setLoading(false);
    if (err) {
      toast.error("Could not join", err.message);
      return;
    }
    if (data) {
      toast.success("Account created", `${data.user.username} · ${data.team.name}`);
      router.push(`/dashboard?team=${data.team.id}`);
    }
  }

  if (checking) {
    return <LoadingScreen />;
  }

  return (
    <main className="dt-shell relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 dt-landing-grid opacity-30" />
      <div className="dt-blob dt-blob-blue" style={{ width: 460, height: 460, top: -200, left: "50%", marginLeft: -230 }} />
      <div className="relative z-10 mx-auto max-w-md px-6 py-14">
        <div className="dt-anim-in mb-8">
          <BrandMark size={32} />
        </div>
        <div className="dt-anim-in dt-noise-edge overflow-hidden rounded-[var(--r-xl)] border border-[var(--border)] bg-[var(--surface-1)]" style={{ animationDelay: "0.06s", boxShadow: "var(--shadow-lg)" }}>
          <div className="h-[2.5px] w-full" style={{ background: "var(--blue)" }} />
          <div className="border-b border-[var(--border-subtle)] px-6 py-5">
            <h1 className="text-lg font-semibold tracking-tight text-white">Join a team</h1>
            <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
              {signedIn
                ? "Enter the 5-character Team ID provided by your admin."
                : "Create an account and join with a Team ID. You do not need to create your own team."}
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-5 px-6 py-6">
            {!signedIn && (
              <>
                <label className="dt-field block">
                  <span className="dt-label">Your name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={1}
                    maxLength={100}
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
                    maxLength={128}
                    className="dt-input"
                    placeholder="At least 8 characters"
                  />
                  <span className="dt-hint">Minimum 8 characters</span>
                </label>
              </>
            )}

            <label className="dt-field block">
              <span className="dt-label">Team ID</span>
              <input
                type="text"
                value={teamCode}
                onChange={(e) => setTeamCode(e.target.value.toUpperCase().slice(0, 5))}
                required
                maxLength={5}
                pattern="[A-Z0-9]{5}"
                placeholder="ABC12"
                className="dt-input text-center font-mono text-lg tracking-[0.3em] uppercase"
              />
            </label>

            <button
              type="submit"
              disabled={
                loading ||
                teamCode.length !== 5 ||
                (!signedIn && (!name.trim() || !email.trim() || password.length < 8))
              }
              className="dt-btn dt-btn-primary dt-btn-block"
            >
              {loading ? (
                <>
                  <IconLoader size={15} />
                  Joining…
                </>
              ) : (
                <>
                  {signedIn ? "Join team" : "Create account and join"}
                  <IconArrowUpRight size={15} />
                </>
              )}
            </button>
          </form>
          <div className="border-t border-[var(--border-subtle)] px-6 py-4 text-center text-[13px] text-[var(--text-tertiary)]">
            {signedIn ? (
              <a href="/signin" className="text-[var(--blue-light)] transition hover:text-white">
                Switch account
              </a>
            ) : (
              <>
                <a href="/signin" className="text-[var(--blue-light)] transition hover:text-white">
                  Sign in
                </a>
                <span className="mx-2 text-[var(--text-quaternary)]">·</span>
                <a href="/create-team" className="text-[var(--blue-light)] transition hover:text-white">
                  Create a team
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
