"use client";

import { useEffect, type ReactNode } from "react";
import { IconX } from "@/components/icons";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Semantic accent for title bar strip */
  tone?: "neutral" | "danger" | "warn" | "success" | "info";
};

const TONE_VAR: Record<NonNullable<ModalProps["tone"]>, string> = {
  neutral: "var(--border-strong)",
  danger: "var(--red)",
  warn: "var(--yellow)",
  success: "var(--green)",
  info: "var(--blue)",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  tone = "neutral",
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-lg" : "max-w-md";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 dt-anim-fade">
      <button
        type="button"
        className="absolute inset-0 dt-modal-scrim"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative w-full ${width} animate-pop-in overflow-hidden rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-1)]`}
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <div
          className="h-[2.5px] w-full"
          style={{ background: TONE_VAR[tone] }}
        />
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 id="modal-title" className="text-[15px] font-semibold tracking-tight text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-tertiary)] transition hover:bg-[var(--surface-hover)] hover:text-white"
            aria-label="Close"
          >
            <IconX size={15} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
