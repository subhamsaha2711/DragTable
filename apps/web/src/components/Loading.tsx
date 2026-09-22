import { IconLoader } from "@/components/icons";

/** Full-viewport branded loading state — purely presentational. */
export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="dt-loading-screen">
      <span className="text-[var(--blue-light)]">
        <IconLoader size={18} />
      </span>
      <span>{label}</span>
    </main>
  );
}

/** Inline spinner for buttons / small areas. */
export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <IconLoader size={size} className={className} />;
}
