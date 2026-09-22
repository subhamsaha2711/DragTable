/**
 * Official DragTable mark — always use this, never invent alternate logos.
 */
type Props = {
  /** Total height of the mark in px */
  size?: number;
  className?: string;
  /** Show wordmark next to mark */
  withWordmark?: boolean;
  href?: string;
};

export function BrandMark({
  size = 28,
  className = "",
  withWordmark = true,
  href = "/",
}: Props) {
  const inner = (
    <span
      className={`dt-brand inline-flex items-center gap-2.5 ${className}`.trim()}
      style={{ lineHeight: 1 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="DragTable"
        width={size}
        height={size}
        className="dt-brand-mark shrink-0"
        style={{ width: size, height: size, display: "block" }}
        draggable={false}
      />
      {withWordmark ? (
        <span className="dt-brand-word">
          Drag<span>Table</span>
        </span>
      ) : null}
    </span>
  );
  if (href) {
    return (
      <a href={href} className="dt-brand-link no-underline text-inherit">
        {inner}
      </a>
    );
  }
  return inner;
}
