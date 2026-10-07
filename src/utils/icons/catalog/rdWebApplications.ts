import { createLucideIcon } from "lucide-react";
import { defineIcon } from "./types";

/** App-authored browser/remote-window identifier, not a Microsoft logo. */
const rdWebAccess = createLucideIcon("RdWebAccessIdentifier", [
  [
    "rect",
    { x: "2", y: "3", width: "20", height: "18", rx: "2", key: "browser" },
  ],
  ["path", { d: "M2 8h20M6 5.5h.01M9 5.5h.01", key: "toolbar" }],
  [
    "rect",
    { x: "6", y: "11", width: "8", height: "6", rx: "1", key: "remote" },
  ],
  ["path", { d: "M9 19h3m-1.5-2v2M17 12l2.5 2.5L17 17", key: "launch" }],
]);

export const RD_WEB_APPLICATION_ICONS = [
  defineIcon(
    "rd-web-access",
    "RD Web Access / RemoteApp",
    "web-applications",
    rdWebAccess,
    ["rdweb", "rd web", "remoteapp", "windows", "remote desktop", "portal"],
    "App-authored browser window containing a remote screen and launch chevron; not the official Microsoft logo. Theme-aware vector for RD Web Access and RemoteApp portals.",
  ),
] as const;
