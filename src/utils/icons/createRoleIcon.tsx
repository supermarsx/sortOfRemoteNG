import React, { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

export type IconRole =
  | "folder"
  | "server"
  | "management-server"
  | "database"
  | "access-point"
  | "switch"
  | "router"
  | "wired-router"
  | "nas"
  | "cloud"
  | "printer"
  | "laptop"
  | "desktop"
  | "remote-desktop"
  | "phone"
  | "desk-phone"
  | "olt"
  | "wall-terminal"
  | "tablet"
  | "ups"
  | "pdu"
  | "iot"
  | "firewall"
  | "vpn"
  | "camera"
  | "recorder";

type RoleFrame = {
  outline: React.ReactNode;
  inset: readonly [x: number, y: number, width: number, height: number];
};

// Every mark has its own clear interior: no masking, external images, font
// glyphs or hard-coded background colors. Coordinates are on Lucide's 24px grid.
const ROLE_FRAMES: Record<IconRole, RoleFrame> = {
  folder: {
    outline: <path d="M3 4h5l2 3h11v13H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />,
    inset: [6, 8, 12, 11],
  },
  server: {
    outline: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <path d="M8 3v18M5 7h.01M5 12h.01M5 17h.01" />
      </>
    ),
    inset: [9, 5, 12, 14],
  },
  "management-server": {
    outline: (
      <>
        <path d="M12 22H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M6 2v20M4 7h.01M4 12h.01M4 17h.01" />
        <path d="M16 14h4v2h2v4h-2v2h-4v-2h-2v-4h2Z" />
        <circle cx="18" cy="18" r="1.5" />
      </>
    ),
    inset: [8, 3, 13, 10],
  },
  database: {
    outline: (
      <>
        <ellipse cx="12" cy="4.5" rx="9" ry="2.5" />
        <path d="M3 4.5v14c0 1.4 4 2.5 9 2.5s9-1.1 9-2.5v-14" />
      </>
    ),
    inset: [6, 8, 12, 11],
  },
  "access-point": {
    outline: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M10 20h4" />
      </>
    ),
    inset: [5, 5, 14, 13],
  },
  switch: {
    outline: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <path d="M2 16h20M6 16v3M10 16v3M14 16v3M18 16v3" />
      </>
    ),
    inset: [6, 4, 12, 11],
  },
  router: {
    outline: (
      <>
        <path d="M5 2v5M19 2v5" />
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M5 18h.01M8 18h.01" />
      </>
    ),
    inset: [6, 8, 12, 10],
  },
  "wired-router": {
    outline: (
      <>
        <rect x="2" y="3" width="20" height="17" rx="2" />
        <path d="M2 15h20M6 17h3v3H6ZM15 17h3v3h-3ZM7.5 20v2M16.5 20v2" />
      </>
    ),
    inset: [6, 4, 12, 10],
  },
  nas: {
    outline: (
      <>
        <rect x="3" y="2" width="18" height="20" rx="2" />
        <path d="M3 17h18M7 19.5h.01M12 19.5h.01M17 19.5h.01" />
      </>
    ),
    inset: [5, 3, 14, 13],
  },
  cloud: {
    outline: (
      <path d="M6 20h12a4 4 0 0 0 2-7.5A6 6 0 0 0 8.5 6a4 4 0 0 0-5 6.5A4 4 0 0 0 6 20Z" />
    ),
    inset: [6, 9, 12, 10],
  },
  printer: {
    outline: (
      <>
        <path d="M6 7V2h12v5M6 19v3h12v-3" />
        <rect x="2" y="7" width="20" height="12" rx="2" />
      </>
    ),
    inset: [6, 8, 12, 10],
  },
  laptop: {
    outline: (
      <>
        <rect x="3" y="3" width="18" height="14" rx="2" />
        <path d="m3 17-2 4h22l-2-4M10 19h4" />
      </>
    ),
    inset: [6, 4, 12, 12],
  },
  desktop: {
    outline: (
      <>
        <rect x="2" y="2" width="20" height="15" rx="2" />
        <path d="M12 17v5M8 22h8" />
      </>
    ),
    inset: [6, 3, 12, 13],
  },
  "remote-desktop": {
    outline: (
      <>
        <rect x="2" y="2" width="20" height="13" rx="2" />
        <path d="M5 20h14m-3-3 3 3-3 3M8 17l-3 3 3 3" />
      </>
    ),
    inset: [6, 3, 12, 11],
  },
  phone: {
    outline: (
      <>
        <rect x="4" y="1" width="16" height="22" rx="3" />
        <path d="M9 3h6M10 20h4" />
      </>
    ),
    inset: [6, 5, 12, 13],
  },
  "desk-phone": {
    outline: (
      <>
        <rect x="8" y="3" width="14" height="18" rx="2" />
        <path d="M3 3h2v5H4v8h1v5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM12 17h.01M17 17h.01M12 19h.01M17 19h.01" />
      </>
    ),
    inset: [9, 5, 12, 10],
  },
  olt: {
    outline: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M6 14v6M12 14v8M18 14v6M4 14h4M10 14h4M16 14h4" />
      </>
    ),
    inset: [6, 4, 12, 9],
  },
  "wall-terminal": {
    outline: (
      <>
        <path d="M5 2h11l5 5v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
        <path d="M3 17h18M7 20h4M16 20h.01" />
      </>
    ),
    inset: [6, 4, 12, 12],
  },
  tablet: {
    outline: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <path d="M20 11v2" />
      </>
    ),
    inset: [4, 5, 14, 14],
  },
  ups: {
    outline: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M4 16h16M7 19h6M17 19h.01" />
      </>
    ),
    inset: [6, 3, 12, 12],
  },
  pdu: {
    outline: (
      <>
        <rect x="2" y="2" width="20" height="20" rx="2" />
        <path d="M2 14h20M7 17v2M10 17v2M15 17v2M18 17v2" />
      </>
    ),
    inset: [6, 3, 12, 10],
  },
  iot: {
    outline: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 1v3M16 1v3M8 20v3M16 20v3M1 8h3M1 16h3M20 8h3M20 16h3" />
      </>
    ),
    inset: [6, 6, 12, 12],
  },
  firewall: {
    outline: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="1" />
        <path d="M2 8h20M2 16h20M8 3v5M16 3v5M5 8v8M19 8v8M8 16v5M16 16v5" />
      </>
    ),
    inset: [6, 9, 12, 6],
  },
  vpn: {
    outline: <path d="m12 2 10 4v7c0 5-4.5 8-10 10C6.5 21 2 18 2 13V6l10-4Z" />,
    inset: [6, 6, 12, 12],
  },
  camera: {
    outline: (
      <>
        <path d="M2 5h17v12H2V5ZM19 8l3-2v10l-3-2M8 17v4M5 21h6" />
      </>
    ),
    inset: [4, 6, 13, 10],
  },
  recorder: {
    outline: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 15h20M5 17h.01M8 17h.01M15 17h4" />
      </>
    ),
    inset: [6, 6, 12, 8],
  },
};

/** Combine a recognizable role silhouette with a distinct inset mark. */
export function createRoleIcon(
  name: string,
  role: IconRole,
  Glyph: LucideIcon,
): LucideIcon {
  const frame = ROLE_FRAMES[role];
  const [x, y, width, height] = frame.inset;
  const RoleIcon = forwardRef<SVGSVGElement, LucideProps>(
    (
      {
        size = 24,
        strokeWidth = 2,
        absoluteStrokeWidth = false,
        color = "currentColor",
        className,
        children,
        ...props
      },
      ref,
    ) => {
      const numericSize = Number(size);
      const lineWidth =
        absoluteStrokeWidth && numericSize > 0
          ? (Number(strokeWidth) * 24) / numericSize
          : Number(strokeWidth);
      const hasAccessibleContent =
        !!children ||
        Object.keys(props).some(
          (key) => key.startsWith("aria-") || key === "role" || key === "title",
        );
      return (
        <svg
          ref={ref}
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          color={color}
          stroke={color}
          strokeWidth={lineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={["lucide", `sor-role-icon-${role}`, className]
            .filter(Boolean)
            .join(" ")}
          aria-hidden={hasAccessibleContent ? undefined : true}
          {...props}
        >
          <g data-role-frame={role}>{frame.outline}</g>
          <Glyph
            x={x}
            y={y}
            width={width}
            height={height}
            color={color}
            // Compensate for the inset scale so line glyphs remain legible at
            // 16px. Solid brand marks retain their own fill/stroke attributes.
            strokeWidth={((lineWidth * 24) / Math.min(width, height)) * 0.8}
            aria-hidden="true"
            focusable="false"
          />
          {children}
        </svg>
      );
    },
  );
  RoleIcon.displayName = name;
  return RoleIcon;
}
