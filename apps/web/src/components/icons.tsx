/**
 * Minimal stroke-icon set for DragTable.
 * Pure presentational — no dependencies, inherits color via currentColor.
 */
type IconProps = {
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function base(
  paths: React.ReactNode,
  { size = 16, className = "", strokeWidth = 1.8 }: IconProps,
  viewBox = "0 0 24 24"
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

export const IconChevronDown = (p: IconProps = {}) => base(<polyline points="6 9 12 15 18 9" />, p);
export const IconChevronRight = (p: IconProps = {}) => base(<polyline points="9 6 15 12 9 18" />, p);
export const IconChevronLeft = (p: IconProps = {}) => base(<polyline points="15 6 9 12 15 18" />, p);
export const IconArrowLeft = (p: IconProps = {}) =>
  base(
    <>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </>,
    p
  );
export const IconArrowUpRight = (p: IconProps = {}) =>
  base(
    <>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </>,
    p
  );
export const IconPlus = (p: IconProps = {}) =>
  base(
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>,
    p
  );
export const IconX = (p: IconProps = {}) =>
  base(
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
    p
  );
export const IconCheck = (p: IconProps = {}) => base(<polyline points="20 6 9 17 4 12" />, p);
export const IconCheckCircle = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M8 12.3 10.8 15 16 9.3" />
    </>,
    p
  );
export const IconXCircle = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="12" cy="12" r="9.25" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </>,
    p
  );
export const IconInfo = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="12" cy="12" r="9.25" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.75" r="0.9" fill="currentColor" stroke="none" />
    </>,
    p
  );
export const IconAlertTriangle = (p: IconProps = {}) =>
  base(
    <>
      <path d="M12 3.5 22 20.5H2z" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
    </>,
    p
  );
export const IconTrash = (p: IconProps = {}) =>
  base(
    <>
      <polyline points="4 7 20 7" />
      <path d="M6 7 7 20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M9.5 7V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
      <line x1="10" y1="11.5" x2="10" y2="17" />
      <line x1="14" y1="11.5" x2="14" y2="17" />
    </>,
    p
  );
export const IconCopy = (p: IconProps = {}) =>
  base(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2.2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
    p
  );
export const IconDatabase = (p: IconProps = {}) =>
  base(
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
      <path d="M4 11.5v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </>,
    p
  );
export const IconTable = (p: IconProps = {}) =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </>,
    p
  );
export const IconUsers = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19c.9-3.3 3.3-5 6.2-5s5.3 1.7 6.2 5" />
      <path d="M15.5 4.8c1.6.4 2.8 1.8 2.8 3.5 0 1.7-1.2 3.1-2.8 3.5" />
      <path d="M18 14.3c1.9.5 3.2 1.9 3.9 4.3" />
    </>,
    p
  );
export const IconUser = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.1-4 4-6 7.5-6s6.4 2 7.5 6" />
    </>,
    p
  );
export const IconLock = (p: IconProps = {}) =>
  base(
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
    </>,
    p
  );
export const IconKey = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="8" cy="15.5" r="4.25" />
      <path d="M11 12.5 20 3.5" />
      <path d="M16.2 8.3 19 5.5" />
      <path d="M19 8.5 21.5 6" />
    </>,
    p
  );
export const IconLink = (p: IconProps = {}) =>
  base(
    <>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M11 6.5 12.7 4.8a4 4 0 1 1 5.6 5.6L16.5 12" />
      <path d="M13 17.5 11.3 19.2a4 4 0 1 1-5.6-5.6L7.5 12" />
    </>,
    p
  );
export const IconGrid = (p: IconProps = {}) =>
  base(
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.4" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4" />
    </>,
    p
  );
export const IconShield = (p: IconProps = {}) =>
  base(
    <>
      <path d="M12 3.2 19.5 6v6.1c0 4.4-3.1 7.2-7.5 8.7-4.4-1.5-7.5-4.3-7.5-8.7V6z" />
      <path d="M9 12l2.2 2.2L15.5 9.5" />
    </>,
    p
  );
export const IconActivity = (p: IconProps = {}) =>
  base(<polyline points="3 13 8 13 10.5 19 14 5 16.5 13 21 13" />, p);
export const IconLogOut = (p: IconProps = {}) =>
  base(
    <>
      <path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5" />
      <polyline points="15.5 16 20.5 11 15.5 6" />
      <line x1="20.5" y1="11" x2="8.5" y2="11" />
    </>,
    p
  );
export const IconDownload = (p: IconProps = {}) =>
  base(
    <>
      <path d="M12 3v12.5" />
      <polyline points="7 11 12 16 17 11" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>,
    p
  );
export const IconUpload = (p: IconProps = {}) =>
  base(
    <>
      <path d="M12 21V8.5" />
      <polyline points="7 12.5 12 7.5 17 12.5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>,
    p
  );
export const IconRefresh = (p: IconProps = {}) =>
  base(
    <>
      <path d="M20 11A8.1 8.1 0 0 0 6.3 6.3L4 8.6" />
      <polyline points="4 3.5 4 8.6 9.1 8.6" />
      <path d="M4 13a8.1 8.1 0 0 0 13.7 4.7l2.3-2.3" />
      <polyline points="20 20.5 20 15.4 14.9 15.4" />
    </>,
    p
  );
export const IconPencil = (p: IconProps = {}) =>
  base(
    <>
      <path d="M4 20.5h4L19.5 9a2.4 2.4 0 0 0-4-4L4 16.5z" />
      <line x1="13.5" y1="6.5" x2="17.5" y2="10.5" />
    </>,
    p
  );
export const IconWifi = (p: IconProps = {}) =>
  base(
    <>
      <path d="M3.5 8.5a13 13 0 0 1 17 0" />
      <path d="M6.5 12.2a8.5 8.5 0 0 1 11 0" />
      <path d="M9.7 15.8a4 4 0 0 1 4.6 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>,
    p
  );
export const IconWifiOff = (p: IconProps = {}) =>
  base(
    <>
      <line x1="2.5" y1="2.5" x2="21.5" y2="21.5" />
      <path d="M9.7 15.8a4 4 0 0 1 4.6 0" />
      <path d="M6.5 12.2a8.5 8.5 0 0 1 3.8-2.1" />
      <path d="M17.5 12.2a8.5 8.5 0 0 0-2.7-1.9" />
      <path d="M3.5 8.5a13 13 0 0 1 5.6-3" />
      <path d="M20.5 8.5a13 13 0 0 0-3.3-2.4" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>,
    p
  );
export const IconSettings = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .35 1.9l.07.07a2.1 2.1 0 1 1-3 3l-.07-.07a1.7 1.7 0 0 0-1.9-.35 1.7 1.7 0 0 0-1 1.55V20a2.1 2.1 0 0 1-4.2 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.9.35l-.07.07a2.1 2.1 0 1 1-3-3l.07-.07a1.7 1.7 0 0 0 .35-1.9 1.7 1.7 0 0 0-1.55-1H3.7a2.1 2.1 0 0 1 0-4.2h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.35-1.9l-.07-.07a2.1 2.1 0 1 1 3-3l.07.07a1.7 1.7 0 0 0 1.9.35H9a1.7 1.7 0 0 0 1-1.55V3.7a2.1 2.1 0 0 1 4.2 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.9-.35l.07-.07a2.1 2.1 0 1 1 3 3l-.07.07a1.7 1.7 0 0 0-.35 1.9V9a1.7 1.7 0 0 0 1.55 1h.1a2.1 2.1 0 0 1 0 4.2h-.1a1.7 1.7 0 0 0-1.55 1z" />
    </>,
    p
  );
export const IconLayers = (p: IconProps = {}) =>
  base(
    <>
      <path d="M12 2.5 21.5 8 12 13.5 2.5 8Z" />
      <path d="M2.5 13 12 18.5 21.5 13" />
      <path d="M2.5 18 12 23.5 21.5 18" />
    </>,
    p
  );
export const IconHistory = (p: IconProps = {}) =>
  base(
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <polyline points="3.2 4.5 3.5 9 8 8.3" />
      <polyline points="12 7.5 12 12.3 15.5 14.3" />
    </>,
    p
  );
export const IconSparkles = (p: IconProps = {}) =>
  base(
    <>
      <path d="M11 3 12.4 8.6 18 10 12.4 11.4 11 17 9.6 11.4 4 10 9.6 8.6Z" />
      <path d="M18.5 15 19.2 17.3 21.5 18 19.2 18.7 18.5 21 17.8 18.7 15.5 18 17.8 17.3Z" />
    </>,
    p
  );
export const IconExternalLink = (p: IconProps = {}) =>
  base(
    <>
      <path d="M9 4.5H5.5A2.5 2.5 0 0 0 3 7v11.5A2.5 2.5 0 0 0 5.5 21H17a2.5 2.5 0 0 0 2.5-2.5V15" />
      <path d="M14.5 3.5H20.5V9.5" />
      <line x1="10.5" y1="13.5" x2="20" y2="4" />
    </>,
    p
  );
export const IconBook = (p: IconProps = {}) =>
  base(
    <>
      <path d="M4 4.5A2 2 0 0 1 6 3h6v18H6a2 2 0 0 1-2-2Z" />
      <path d="M20 4.5A2 2 0 0 0 18 3h-6v18h6a2 2 0 0 0 2-2Z" />
    </>,
    p
  );
export const IconSearch = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <line x1="20" y1="20" x2="15.7" y2="15.7" />
    </>,
    p
  );
export const IconMenu = (p: IconProps = {}) =>
  base(
    <>
      <line x1="3.5" y1="6.5" x2="20.5" y2="6.5" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
      <line x1="3.5" y1="17.5" x2="20.5" y2="17.5" />
    </>,
    p
  );
export const IconHash = (p: IconProps = {}) =>
  base(
    <>
      <line x1="5" y1="9" x2="19" y2="9" />
      <line x1="4.5" y1="15" x2="18.5" y2="15" />
      <line x1="10" y1="4" x2="7.5" y2="20" />
      <line x1="16" y1="4" x2="13.5" y2="20" />
    </>,
    p
  );
export const IconTerminal = (p: IconProps = {}) =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.2" />
      <polyline points="7 9.5 10.5 12.5 7 15.5" />
      <line x1="12.5" y1="15.5" x2="17" y2="15.5" />
    </>,
    p
  );
export const IconLayout = (p: IconProps = {}) =>
  base(
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2.2" />
      <line x1="9.5" y1="3.5" x2="9.5" y2="20.5" />
      <line x1="3" y1="9" x2="9.5" y2="9" />
    </>,
    p
  );
export const IconZap = (p: IconProps = {}) =>
  base(<path d="M12.5 2.5 4 14h6.5L11 21.5 20 10h-6.5Z" />, p);
export const IconGitBranch = (p: IconProps = {}) =>
  base(
    <>
      <circle cx="6" cy="5" r="2.3" />
      <circle cx="6" cy="19" r="2.3" />
      <circle cx="18" cy="9" r="2.3" />
      <path d="M6 7.3V16.7" />
      <path d="M6 9.5c0 4 3 4.6 6 4.6h2.7" />
    </>,
    p
  );
export const IconLoader = (p: IconProps = {}) => (
  <svg
    width={p.size ?? 16}
    height={p.size ?? 16}
    viewBox="0 0 24 24"
    className={`dt-spin-el ${p.className ?? ""}`}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9.5" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2.2" />
    <path
      d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);
