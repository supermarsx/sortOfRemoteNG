import type {
  Connection,
  TunnelChainLayer,
} from "../../../types/connection/connection";
import type { ProxyConfig } from "../../../types/settings/settings";
import {
  buildRuntimeNetworkPath,
  RuntimeNetworkPathError,
  type RuntimeNetworkPathProtocol,
} from "../../../utils/network/resolveRuntimeNetworkPath";
import {
  resolveNetworkPath,
  type NetworkPathCatalog,
  type NetworkPathSummary,
  type NetworkPathValidation,
} from "../../../utils/network/resolveNetworkPath";
import type { NormalizedVpnConnection } from "../../../hooks/network/useVpnManager";
import type { SelectOption } from "../../ui/forms";
import type {
  RloginNetworkPathCapability,
  RloginNetworkPathLayerKind,
} from "../../../types/connection/rloginSettings";
import type { RawSocketNetworkRouteKind } from "../../../types/protocols/rawSocket";
import { getDefaultPort } from "../../../utils/discovery/defaultPorts";

const VPN_TYPES = new Set(["openvpn", "wireguard", "tailscale", "zerotier"]);

export interface NetworkPathRuntimeStatus {
  supported: boolean;
  code?: RuntimeNetworkPathError["code"];
  message: string;
}

export interface NetworkPathEditorModel {
  summary: NetworkPathSummary;
  validation: NetworkPathValidation;
  runtime: NetworkPathRuntimeStatus;
}

export type NetworkPathReferenceField =
  | "connectionChainId"
  | "proxyChainId"
  | "tunnelChainId";

export function getRuntimeNetworkPathProtocol(
  formData: Readonly<Partial<Connection>>,
): RuntimeNetworkPathProtocol {
  switch (formData.protocol) {
    case "rdp":
      return "rdp";
    case "raw":
      return formData.rawSocketSettings?.connection.transport === "udp"
        ? "raw-udp"
        : "raw-tcp";
    case "rlogin":
      return "rlogin";
    case "winrm":
      return "powershell";
    default:
      return "ssh";
  }
}

export function getRuntimeNetworkPathProtocolLabel(
  protocol: RuntimeNetworkPathProtocol,
): string {
  switch (protocol) {
    case "raw-tcp":
      return "Raw TCP";
    case "raw-udp":
      return "Raw UDP";
    case "rlogin":
      return "RLogin";
    case "powershell":
      return "PowerShell Remoting";
    default:
      return protocol.toUpperCase();
  }
}

export function asNetworkPathConnection(
  formData: Readonly<Partial<Connection>>,
): Connection {
  return {
    id: formData.id || "__connection_editor_draft__",
    name: formData.name || "Draft connection",
    protocol: formData.protocol || "ssh",
    hostname: formData.hostname || "",
    port: formData.port ?? getDefaultPort(formData.protocol ?? "ssh"),
    isGroup: false,
    createdAt: formData.createdAt || "",
    updatedAt: formData.updatedAt || "",
    ...formData,
  } as Connection;
}

function catalogWithDraft(
  connection: Connection,
  catalog: NetworkPathCatalog,
): NetworkPathCatalog {
  const connections = (catalog.connections ?? []).filter(
    (candidate) => candidate.id !== connection.id,
  );
  return { ...catalog, connections: [...connections, connection] };
}

/** Build a UI-safe view of the canonical and executable network path. */
export function getNetworkPathEditorModel(
  formData: Readonly<Partial<Connection>>,
  catalog: NetworkPathCatalog,
  protocol: RuntimeNetworkPathProtocol,
): NetworkPathEditorModel {
  const connection = asNetworkPathConnection(formData);
  const currentCatalog = catalogWithDraft(connection, catalog);
  const resolution = resolveNetworkPath(connection, currentCatalog);
  const protocolLabel = getRuntimeNetworkPathProtocolLabel(protocol);

  try {
    buildRuntimeNetworkPath(connection, currentCatalog, protocol);
    if (
      protocol === "powershell" &&
      formData.powerShellRemoting &&
      (formData.powerShellRemoting.networkPath.mode === "connectionPath" ||
        formData.powerShellRemoting.wsman.proxy.mode !== "none")
    ) {
      throw new RuntimeNetworkPathError(
        "unsupported-layer",
        "PowerShell Remoting has a configured route, but the current backend has no network-path adapter. Connection is blocked instead of falling back to direct.",
      );
    }
    return {
      summary: resolution.summary,
      validation: resolution.validation,
      runtime: {
        supported: true,
        message:
          resolution.summary.status === "direct"
            ? protocol === "raw-tcp"
              ? "Direct Raw TCP is supported by the native socket runtime."
              : protocol === "raw-udp"
                ? "Direct Raw UDP is supported by the native socket runtime."
                : protocol === "rlogin"
                  ? "Direct RLogin TCP is supported by the native RFC 1282 runtime."
                  : protocol === "powershell"
                    ? "Direct PowerShell Remoting is available; configured routes remain blocked until a backend adapter is available."
                    : "Direct connection; no network-path layers will run."
            : `${protocolLabel} can execute this resolved path in the displayed order.`,
      },
    };
  } catch (error) {
    return {
      summary: resolution.summary,
      validation: resolution.validation,
      runtime:
        error instanceof RuntimeNetworkPathError
          ? { supported: false, code: error.code, message: error.message }
          : {
              supported: false,
              message: "The network path could not be checked safely.",
            },
    };
  }
}

export function getRawSocketNetworkRoutes(
  model: Pick<NetworkPathEditorModel, "summary">,
): readonly RawSocketNetworkRouteKind[] {
  if (model.summary.layers.length === 0) return ["direct"];
  return model.summary.layers.map((layer) => {
    const transport = layer.transport.toLowerCase();
    if (layer.kind === "ssh") return "ssh_jump";
    if (transport === "socks4") return "socks4";
    if (transport === "socks5") return "socks5";
    if (
      transport === "http" ||
      transport === "https" ||
      transport === "http-connect"
    ) {
      return "http_connect";
    }
    return "unknown";
  });
}

const toRloginLayerKind = (
  kind: NetworkPathSummary["layers"][number]["kind"],
  transport: string,
): RloginNetworkPathLayerKind => {
  if (kind === "vpn" || kind === "connection") return "vpn";
  if (kind === "ssh") return "ssh-jump";
  switch (transport.toLowerCase()) {
    case "http":
    case "http-connect":
      return "http-connect";
    case "https":
      return "https-connect";
    case "socks4":
      return "socks4";
    case "socks5":
      return "socks5";
    default:
      return "unsupported";
  }
};

export function getRloginNetworkPathCapability(
  model: NetworkPathEditorModel,
): RloginNetworkPathCapability {
  return {
    configured: model.summary.layers.length > 0,
    supported: model.runtime.supported,
    summary: model.runtime.message,
    layers: model.summary.layers.map((layer) => ({
      kind: toRloginLayerKind(layer.kind, layer.transport),
      label: layer.transport,
    })),
  };
}

export function setNetworkPathReference(
  formData: Readonly<Partial<Connection>>,
  field: NetworkPathReferenceField,
  value: string,
): Partial<Connection> {
  const next: Partial<Connection> = {
    ...formData,
    [field]: value || undefined,
  };
  if (field === "tunnelChainId" && value) {
    next.security = { ...formData.security, tunnelChain: undefined };
  }
  return next;
}

export function setInlineVpn(
  formData: Readonly<Partial<Connection>>,
  vpn?: Pick<NormalizedVpnConnection, "id" | "name" | "vpnType">,
): Partial<Connection> {
  const remaining = (formData.security?.tunnelChain ?? []).filter(
    (layer) => !VPN_TYPES.has(layer.type),
  );
  const tunnelChain: TunnelChainLayer[] = vpn
    ? [
        {
          id: vpn.id,
          name: vpn.name,
          type: vpn.vpnType,
          enabled: true,
        },
        ...remaining,
      ]
    : remaining;

  return {
    ...formData,
    tunnelChainId: vpn ? undefined : formData.tunnelChainId,
    security: {
      ...formData.security,
      tunnelChain: tunnelChain.length > 0 ? tunnelChain : undefined,
    },
  };
}

export function setLegacyProxy(
  formData: Readonly<Partial<Connection>>,
  proxy?: ProxyConfig,
): Partial<Connection> {
  return {
    ...formData,
    security: { ...formData.security, proxy },
  };
}

export function resetNetworkPath(
  formData: Readonly<Partial<Connection>>,
): Partial<Connection> {
  return {
    ...formData,
    connectionChainId: undefined,
    proxyChainId: undefined,
    tunnelChainId: undefined,
    security: {
      ...formData.security,
      proxy: undefined,
      tunnelChain: undefined,
    },
  };
}

export function selectedInlineVpnId(
  formData: Readonly<Partial<Connection>>,
): string {
  if (formData.tunnelChainId) return "";
  return (
    formData.security?.tunnelChain?.find((layer) => VPN_TYPES.has(layer.type))
      ?.id ?? ""
  );
}

export function withCurrentOrphanOption(
  options: readonly SelectOption[],
  currentId: string | undefined,
  noun: string,
): SelectOption[] {
  const next = [...options];
  if (
    currentId &&
    !next.some((option) => String(option.value) === String(currentId))
  ) {
    next.push({
      value: currentId,
      label: `Unavailable ${noun} (${currentId})`,
      title: `This saved ${noun} is no longer available. Clear or replace it.`,
    });
  }
  return next;
}
