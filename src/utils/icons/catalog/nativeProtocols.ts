import {
  ArrowUpDown,
  createLucideIcon,
  FolderLock,
  GlobeLock,
  LogIn,
  MonitorCog,
  Network,
  PlugZap,
} from "lucide-react";
import { nomachine, x2go } from "../brand";
import { defineIcon } from "./types";

const SecureShell = createLucideIcon("SecureShell", [
  [
    "path",
    {
      d: "M11 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3M6 8l3 3-3 3M11 14h1",
      key: "shell",
    },
  ],
  ["rect", { x: "14", y: "13", width: "8", height: "8", rx: "1", key: "lock" }],
  ["path", { d: "M16 13v-2a2 2 0 0 1 4 0v2", key: "shackle" }],
]);
const XDisplay = createLucideIcon("XDisplay", [
  [
    "rect",
    { x: "2", y: "3", width: "20", height: "14", rx: "2", key: "display" },
  ],
  ["path", { d: "M9 7l6 6M15 7l-6 6M8 21h8M12 17v4", key: "x-display" }],
]);

/** Protocol symbols are not vendor logos unless their source is explicitly identified. */
export const NATIVE_PROTOCOL_ICONS = [
  defineIcon(
    "ssh",
    "SSH",
    "remote-protocols",
    SecureShell,
    ["ssh", "secure shell", "terminal", "encrypted console"],
    "App-authored secure-shell terminal and lock; not an OpenSSH product logo.",
  ),
  defineIcon("https", "HTTPS", "remote-protocols", GlobeLock, [
    "https",
    "secure web",
    "tls",
    "ssl",
  ]),
  defineIcon("raw-socket", "Raw TCP socket", "remote-protocols", PlugZap, [
    "raw",
    "socket",
    "tcp",
    "raw connection",
  ]),
  defineIcon("rlogin", "Rlogin", "remote-protocols", LogIn, [
    "rlogin",
    "remote login",
    "legacy console",
  ]),
  defineIcon("ftp", "FTP", "remote-protocols", ArrowUpDown, [
    "ftp",
    "file transfer protocol",
    "transfer",
  ]),
  defineIcon("sftp", "SFTP", "remote-protocols", FolderLock, [
    "sftp",
    "ssh file transfer",
    "secure file transfer",
  ]),
  defineIcon("smb", "SMB", "remote-protocols", Network, [
    "smb",
    "cifs",
    "shared files",
    "windows file sharing",
  ]),
  defineIcon(
    "spice",
    "SPICE",
    "remote-protocols",
    MonitorCog,
    ["spice", "virtual desktop", "remote display"],
    "Generic remote-display protocol symbol; not an official SPICE project logo.",
  ),
  defineIcon(
    "xdmcp",
    "XDMCP",
    "remote-protocols",
    XDisplay,
    ["xdmcp", "x11", "x display manager", "unix desktop"],
    "App-authored X-display terminal symbol, not an X.Org logo.",
  ),
  defineIcon(
    "nomachine",
    "NoMachine",
    "remote-protocols",
    nomachine,
    ["nomachine", "no machine", "nx", "remote desktop"],
    "Distinct app-authored NX identifier, not the official NoMachine logo.",
  ),
  defineIcon(
    "x2go",
    "X2Go",
    "remote-protocols",
    x2go,
    ["x2go", "x2 go", "linux remote desktop"],
    "Distinct app-authored X2 identifier, not the official X2Go logo; the publisher artwork's no-derivatives license is not used for this adaptation.",
  ),
] as const;
