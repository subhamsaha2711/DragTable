"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconCheckCircle, IconXCircle, IconInfo, IconAlertTriangle, IconX } from "@/components/icons";

export type ToastKind = "success" | "error" | "info" | "warning";

type ToastItem = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
};

type ToastApi = {
  push: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_MS = 4200;
const LEAVE_MS = 220;

const KIND: Record<
  ToastKind,
  { accent: string; label: string; icon: (p: { size?: number }) => React.ReactElement }
> = {
  success: { accent: "green", label: "Success", icon: IconCheckCircle },
  error: { accent: "red", label: "Error", icon: IconXCircle },
  info: { accent: "blue", label: "Info", icon: IconInfo },
  warning: { accent: "yellow", label: "Notice", icon: IconAlertTriangle },
};

function toastId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, number>>(new Map());

  const reallyRemove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    setLeaving((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) {
        window.clearTimeout(t);
        timers.current.delete(id);
      }
      setLeaving((prev) => new Set(prev).add(id));
      window.setTimeout(() => reallyRemove(id), LEAVE_MS);
    },
    [reallyRemove]
  );

  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = toastId();
      setItems((prev) => [...prev, { id, kind, title, message }]);
      const t = window.setTimeout(() => dismiss(id), TOAST_MS);
      timers.current.set(id, t);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (t, m) => push("success", t, m),
      error: (t, m) => push("error", t, m),
      info: (t, m) => push("info", t, m),
      warning: (t, m) => push("warning", t, m),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2.5 px-4 sm:px-0"
        aria-live="polite"
      >
        {items.map((t) => {
          const k = KIND[t.kind];
          const Icon = k.icon;
          const isLeaving = leaving.has(t.id);
          return (
            <div
              key={t.id}
              className={`dt-noise-edge pointer-events-auto overflow-hidden rounded-[var(--r-lg)] border shadow-[var(--shadow-lg)] ${isLeaving ? "dt-anim-leave" : "animate-slide-in"}`}
              style={{
                background: "rgba(10,10,10,0.92)",
                backdropFilter: "blur(16px)",
                borderColor: `var(--${k.accent}-border)`,
              }}
              role="status"
            >
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span
                  className="mt-0.5 shrink-0"
                  style={{ color: `var(--${k.accent}-light)` }}
                >
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: `var(--${k.accent}-light)` }}
                  >
                    {k.label}
                  </p>
                  <p className="mt-0.5 text-[13.5px] font-medium leading-snug text-white">{t.title}</p>
                  {t.message && (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-tertiary)]">
                      {t.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="mt-0.5 shrink-0 text-[var(--text-quaternary)] transition hover:text-white"
                  aria-label="Dismiss"
                >
                  <IconX size={14} />
                </button>
              </div>
              {!isLeaving && (
                <div className="h-[2px] w-full" style={{ background: `var(--${k.accent}-soft)` }}>
                  <div
                    className="h-full origin-left"
                    style={{
                      background: `var(--${k.accent})`,
                      animation: `dt-toast-bar ${TOAST_MS}ms linear forwards`,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
    };
  }
  return ctx;
}
