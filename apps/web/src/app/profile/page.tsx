"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { LoadingScreen } from "@/components/Loading";
import { IconArrowLeft, IconLoader, IconLock, IconUser } from "@/components/icons";

export default function ProfilePage() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    api.me().then(({ data, status }) => {
      setLoading(false);
      if (status === 401 || !data) {
        router.replace("/signin");
        return;
      }
      setUsername(data.user.username);
      setEmail(data.user.email);
      setName(data.user.name);
    });
  }, [router]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    const { data, error } = await api.updateProfile(name.trim());
    setSavingName(false);
    if (error) {
      toast.error("Could not update name", error.message);
      return;
    }
    if (data) {
      setName(data.user.name);
      toast.success("Profile updated", data.user.name);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password too short", "Use at least 8 characters");
      return;
    }
    setSavingPw(true);
    const { error } = await api.changePassword(currentPassword, newPassword);
    setSavingPw(false);
    if (error) {
      toast.error("Could not change password", error.message);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Password changed");
  }

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <main className="dt-shell min-h-screen">
      <header className="dt-topbar">
        <div className="mx-auto flex w-full max-w-lg items-center gap-4">
          <BrandMark size={22} withWordmark={false} href="/dashboard" />
          <a href="/dashboard" className="dt-back-link">
            <span className="dt-back-chevron"><IconArrowLeft size={13} /></span>
            Dashboard
          </a>
          <span className="dt-crumb-sep hidden sm:inline">/</span>
          <h1 className="hidden text-[15px] font-semibold text-white sm:block">Profile</h1>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-8 px-6 py-10">
        <div className="dt-anim-in dt-card flex items-center gap-4 rounded-[var(--r-lg)] p-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--blue-light)]">
            <IconUser size={20} />
          </div>
          <div className="min-w-0">
            <p className="dt-label mb-1">Account</p>
            <p className="dt-mono truncate text-sm text-[var(--blue-light)]">@{username}</p>
            <p className="truncate text-sm text-[var(--text-secondary)]">{email}</p>
          </div>
        </div>

        <form
          onSubmit={saveName}
          className="dt-anim-in dt-card space-y-4 rounded-[var(--r-lg)] p-6"
          style={{ animationDelay: "0.05s" }}
        >
          <h2 className="text-sm font-semibold text-white">Display name</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={1}
            maxLength={100}
            className="dt-input"
          />
          <button
            type="submit"
            disabled={savingName || !name.trim()}
            className="dt-btn dt-btn-primary dt-btn-sm"
          >
            {savingName ? <><IconLoader size={13} />Saving…</> : "Save name"}
          </button>
        </form>

        <form
          onSubmit={savePassword}
          className="dt-anim-in dt-card space-y-4 rounded-[var(--r-lg)] p-6"
          style={{ animationDelay: "0.1s" }}
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <IconLock size={13} />
            Change password
          </h2>
          <label className="dt-field block">
            <span className="dt-label">Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="dt-input"
            />
          </label>
          <label className="dt-field block">
            <span className="dt-label">New password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="dt-input"
            />
          </label>
          <label className="dt-field block">
            <span className="dt-label">Confirm new password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="dt-input"
            />
          </label>
          <button type="submit" disabled={savingPw} className="dt-btn dt-btn-primary dt-btn-sm">
            {savingPw ? <><IconLoader size={13} />Updating…</> : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
