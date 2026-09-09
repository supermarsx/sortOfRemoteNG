import React, { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

export type IconRole =
  | "folder"
  | "folder-open"
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

// Role emblems share a bottom-right badge. Outlines stop before that corner,
// so no masking or hard-coded background color is needed on either theme.
// Coordinates are on Lucide's 24px grid; plain brand icons bypass this helper.
const ROLE_FRAMES: Record<IconRole, RoleFrame> = {
  folder: {
    outline: <path d="M10 20H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5l2 3h11v3" />,
    inset: [12, 12, 11, 11],
  },
  "folder-open": {
    outline: (
      <>
        <path d="M2 18V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v1" />
        <path d="M10 21H2L5 9h17l-.75 3" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  server: {
    outline: (
      <>
        <path d="M10 21H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5" />
        <path d="M8 3v18M5 7h.01M5 12h.01M5 17h.01" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  "management-server": {
    outline: (
      <>
        <path d="M10 22H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7M6 2v20M4 7h.01M4 12h.01M4 17h.01" />
        <path d="M16 2h4v2h2v4h-2v2h-4V8h-2V4h2Z" />
        <circle cx="18" cy="6" r="1.5" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  database: {
    outline: (
      <>
        <ellipse cx="12" cy="4.5" rx="9" ry="2.5" />
        <path d="M3 4.5v14c0 1.2 3 2.2 7 2.5M21 4.5V10M3 11c0 1.2 3 2.2 7 2.5" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  "access-point": {
    outline: (
      <>
        <path d="M10 21.8A10 10 0 1 1 21.8 10M7 7a7 7 0 0 1 10 0M9 10a4 4 0 0 1 6 0" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  switch: {
    outline: (
      <>
        <path d="M10 21H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5M2 9h20M5 5h2v4H5ZM11 5h2v4h-2ZM17 5h2v4h-2ZM5 17h.01M8 17h.01" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  router: {
    outline: (
      <>
        <path d="M5 2v5M19 2v5" />
        <path d="M10 21H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1" />
        <path d="M5 18h.01M8 18h.01" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  "wired-router": {
    outline: (
      <>
        <path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5M6 6h3v4H6ZM15 6h3v4h-3ZM7.5 20v2" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  nas: {
    outline: (
      <>
        <path d="M10 22H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M7 6h10M7 10h3M7 15v1M7 19h.01" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  cloud: {
    outline: (
      <path d="M10 20H6a4 4 0 0 1-1-7.9A6 6 0 0 1 16.5 8a4 4 0 0 1 5.5 2" />
    ),
    inset: [12, 12, 11, 11],
  },
  printer: {
    outline: (
      <>
        <path d="M6 7V2h12v5M10 22H6v-7h4M10 19H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1M6 11h2" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  laptop: {
    outline: (
      <>
        <path d="M10 17H3V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5M3 17l-2 4h9" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  desktop: {
    outline: (
      <>
        <path d="M10 17H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6M8 17v5M5 22h5" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  "remote-desktop": {
    outline: (
      <>
        <path d="M10 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6" />
        <path d="M4 20h6m-2-2 2 2-2 2M6 18l-2 2 2 2" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  phone: {
    outline: (
      <>
        <path d="M10 23H7a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6M9 3h6M8 20h2" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  "desk-phone": {
    outline: (
      <>
        <path d="M10 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M12 7h6M12 10h.01M17 10h.01" />
        <path d="M3 3h2v5H4v8h1v5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  olt: {
    outline: (
      <>
        <path d="M10 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5M6 14v6M4 14h4M7 7h11" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  "wall-terminal": {
    outline: (
      <>
        <path d="M10 22H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h11l5 5v3M3 17h7M7 20h3" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  tablet: {
    outline: (
      <>
        <path d="M10 21H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5M19 7v2" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  ups: {
    outline: (
      <>
        <path d="M10 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6M9 5l-2 5h4l-2 5M7 19h3" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  pdu: {
    outline: (
      <>
        <path d="M10 22H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6M5 5v3M8 5v3M15 5v3M18 5v3M5 13v3M8 13v3" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  iot: {
    outline: (
      <>
        <path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M8 1v3M16 1v3M8 20v3M1 8h3M1 16h3M20 8h3" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  firewall: {
    outline: (
      <>
        <path d="M10 21H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v6M2 8h20M2 16h8M8 3v5M16 3v5M5 8v8M8 16v5" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  vpn: {
    outline: <path d="M10 22C6 20 2 17.5 2 13V6l10-4 10 4v4" />,
    inset: [12, 12, 11, 11],
  },
  camera: {
    outline: (
      <>
        <path d="M10 17H2V5h17v5M19 8l3-2v4M8 17v4M5 21h5" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
  recorder: {
    outline: (
      <>
        <path d="M10 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3M2 11h8M5 16h.01M8 16h.01" />
      </>
    ),
    inset: [12, 12, 11, 11],
  },
};

/** Combine a recognizable role silhouette with a bottom-right emblem. */
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
