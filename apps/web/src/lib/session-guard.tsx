"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";

const PUBLIC = new Set(["/", "/signin", "/create-team", "/join-team"]);

/** Only popup for events that just happened — never for missed/history. */
const LIVE_TOAST_MAX_AGE_MS = 4_000;

/**
 * Polls session on authenticated pages.
 * If session revoked (member removed) → immediate terminate to sign-in.
 * Live notification toasts only for events that occur while this tab is open.
 */
export function SessionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const killed = useRef(false);
  const teamIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (PUBLIC.has(pathname) || pathname.startsWith("/_next")) return;

    let alive = true;
    const tick = async () => {
      if (!alive || killed.current) return;
      const { status, data } = await api.me();
      if (!alive) return;
      if (status === 401) {
        killed.current = true;
        toast.error("Session ended", "You were signed out or removed from the team");
        router.replace("/signin");
        return;
      }
      if (data?.teams?.[0]) {
        teamIdRef.current = data.teams[0].id;
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pathname, router, toast]);

  // Live notifications — popup only at the moment they happen (never for missed history)
  useEffect(() => {
    if (PUBLIC.has(pathname)) return;
    let alive = true;
    const seen = new Set<string>();
    let seeded = false;

    const pollNotifs = async () => {
      if (!alive || !teamIdRef.current) return;
      const { data } = await api.listNotifications(teamIdRef.current);
      if (!data?.notifications?.length) {
        if (!seeded) seeded = true;
        return;
      }

      // First successful poll: mark everything known — never toast backlog
      if (!seeded) {
        for (const n of data.notifications) {
          seen.add(n.id);
        }
        seeded = true;
        return;
      }

      const now = Date.now();
      // Oldest → newest so toasts appear in order
      for (const n of [...data.notifications].reverse()) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);

        const created = new Date(n.createdAt).getTime();
        // Missed while offline / tab closed / away: record only, no popup
        if (!Number.isFinite(created) || now - created > LIVE_TOAST_MAX_AGE_MS) {
          continue;
        }

        const payload = n.payload as Record<string, unknown> | undefined;
        const summary = (payload?.summary as string) || n.type;
        toast.info(n.type.replace(/_/g, " "), summary);

        if (n.type === "MEMBER_REMOVED" && n.targetUserId) {
          const me = await api.me();
          if (me.status === 401) {
            killed.current = true;
            router.replace("/signin");
          }
        }
      }

      // Bound memory of seen ids (list is max 100)
      if (seen.size > 200) {
        const keep = new Set(data.notifications.map((x) => x.id));
        for (const id of [...seen]) {
          if (!keep.has(id)) seen.delete(id);
        }
      }
    };

    const id = window.setInterval(pollNotifs, 1000);
    // slight delay so teamIdRef is filled by me() tick
    const boot = window.setTimeout(pollNotifs, 200);
    return () => {
      alive = false;
      clearInterval(id);
      clearTimeout(boot);
    };
  }, [pathname, router, toast]);

  return <>{children}</>;
}
