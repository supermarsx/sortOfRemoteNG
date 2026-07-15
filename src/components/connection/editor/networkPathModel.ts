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

export function asNetworkPathConnection(
  formData: Readonly<Partial<Connection>>,
): Connection {
  return {
    id: formData.id || "__connection_editor_draft__",
    name: formData.name || "Draft connection",
    protocol: formData.protocol || "ssh",
    hostname: formData.hostname || "",
    port: formData.port ?? (formData.protocol === "rdp" ? 3389 : 22),
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

  try {
    buildRuntimeNetworkPath(connection, currentCatalog, protocol);
    return {
      summary: resolution.summary,
      validation: resolution.validation,
      runtime: {
        supported: true,
        message:
          resolution.summary.status === "direct"
            ? "Direct connection; no network-path layers will run."
            : `${protocol.toUpperCase()} can execute this resolved path in the displayed order.`,
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
