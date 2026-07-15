import {
  Cloud,
  Gauge,
  KeyRound,
  LifeBuoy,
  MonitorUp,
  Network,
  PlugZap,
  Route,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import type { Connection } from "../../../types/connection/connection";
import type { ConnectionEditorProtocolSubtabId } from "./editorRegistry";

export type ProtocolSubtabId = ConnectionEditorProtocolSubtabId;

export interface ProtocolSubtabDescriptor {
  id: ProtocolSubtabId;
  label: string;
  description: string;
  icon: LucideIcon;
}

const SUBTABS: Record<ProtocolSubtabId, ProtocolSubtabDescriptor> = {
  connection: {
    id: "connection",
    label: "Connection",
    description: "Protocol identity and connection-specific defaults.",
    icon: PlugZap,
  },
  authentication: {
    id: "authentication",
    label: "Authentication",
    description: "Credentials and authentication methods for this connection.",
    icon: KeyRound,
  },
  security: {
    id: "security",
    label: "Security",
    description: "Trust, encryption, and certificate verification controls.",
    icon: ShieldCheck,
  },
  "display-input": {
    id: "display-input",
    label: "Display & Input",
    description: "Screen, audio, keyboard, and pointer behavior.",
    icon: MonitorUp,
  },
  resources: {
    id: "resources",
    label: "Resources",
    description: "Device redirection and performance tuning.",
    icon: Gauge,
  },
  network: {
    id: "network",
    label: "Network",
    description: "Gateway, transport, and protocol networking controls.",
    icon: Network,
  },
  "network-path": {
    id: "network-path",
    label: "Network Path",
    description:
      "Ordered VPN, proxy, and SSH-hop routing applied before the target.",
    icon: Route,
  },
  advanced: {
    id: "advanced",
    label: "Advanced",
    description: "Specialized protocol and recovery behavior.",
    icon: Settings2,
  },
  provider: {
    id: "provider",
    label: "Provider",
    description: "Cloud provider account and resource configuration.",
    icon: Cloud,
  },
  terminal: {
    id: "terminal",
    label: "Terminal",
    description: "Per-connection terminal display and input overrides.",
    icon: TerminalSquare,
  },
  recovery: {
    id: "recovery",
    label: "Recovery",
    description: "Two-factor, backup code, and account recovery information.",
    icon: LifeBuoy,
  },
};

const CLOUD_PROTOCOLS = new Set([
  "gcp",
  "azure",
  "ibm-csp",
  "digital-ocean",
  "heroku",
  "scaleway",
  "linode",
  "ovhcloud",
]);

export const isCloudProtocol = (protocol: string): boolean =>
  CLOUD_PROTOCOLS.has(protocol);

const selectSubtabs = (
  ids: readonly ProtocolSubtabId[],
): readonly ProtocolSubtabDescriptor[] => ids.map((id) => SUBTABS[id]);

const withWindowsManagement = (
  ids: readonly ProtocolSubtabId[],
  formData: Readonly<Partial<Connection>>,
): readonly ProtocolSubtabId[] => {
  if (formData.osType !== "windows" || ids.includes("network")) return ids;
  const recoveryIndex = ids.indexOf("recovery");
  if (recoveryIndex < 0) return [...ids, "network"];
  return [
    ...ids.slice(0, recoveryIndex),
    "network",
    ...ids.slice(recoveryIndex),
  ];
};

export function getProtocolSubtabs(
  formData: Readonly<Partial<Connection>>,
): readonly ProtocolSubtabDescriptor[] {
  const protocol = formData.protocol ?? "";

  if (protocol === "rdp") {
    return selectSubtabs([
      "connection",
      "authentication",
      "display-input",
      "resources",
      "security",
      "network-path",
      "network",
      "advanced",
      "recovery",
    ]);
  }

  if (protocol === "ssh") {
    return selectSubtabs([
      "authentication",
      "terminal",
      "network-path",
      "network",
      "recovery",
    ]);
  }

  if (protocol === "raw" || protocol === "rlogin") {
    return selectSubtabs([
      "connection",
      "terminal",
      "security",
      "network-path",
      "advanced",
    ]);
  }

  if (protocol === "http" || protocol === "https") {
    return selectSubtabs(
      withWindowsManagement(
        ["authentication", "security", "advanced", "recovery"],
        formData,
      ),
    );
  }

  if (protocol === "winrm") {
    return selectSubtabs([
      "connection",
      "authentication",
      "security",
      "network-path",
      "advanced",
    ]);
  }

  if (isCloudProtocol(protocol)) {
    return selectSubtabs(
      withWindowsManagement(
        ["provider", "authentication", "recovery"],
        formData,
      ),
    );
  }

  if (formData.osType === "windows") {
    return selectSubtabs(["authentication", "network", "recovery"]);
  }

  return selectSubtabs(["authentication", "recovery"]);
}
