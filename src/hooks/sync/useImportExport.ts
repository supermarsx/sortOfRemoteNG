import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Connection,
  ConnectionDatabase,
} from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useToastContext } from "../../contexts/ToastContext";
import {
  DatabaseManager,
  type DatabaseExportSnapshot,
} from "../../utils/connection/databaseManager";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { getInvoke } from "../../utils/tauri/invoke";
import {
  ExportDatabaseOption,
  ExportInclusionConfig,
  ExportScopeMode,
  ImportFilterState,
  ImportOptions,
  ImportPreviewItem,
  ImportResult,
  ImportSourceMetadata,
  ImportVpnData,
  ImportTargetMode,
  CloneResult,
  CloneSourceCatalogItem,
} from "../../components/ImportExport/types";
import {
  decryptWithPassword,
  isWebCryptoPayload,
  normalizePbkdf2Iterations,
} from "../../utils/crypto/webCryptoAes";
import {
  encryptExport,
  decryptAesCbcEnvelope,
  decryptMremotengDocument,
  isAesCbcEnvelope,
  isMremotengEncryptedXml,
  DecryptError,
  DECRYPT_ERROR_I18N_KEYS,
  DECRYPT_ERROR_DEFAULT_MESSAGES,
  type DecryptErrorKind,
} from "../../utils/crypto/exportEncryption";
import { analyzePasswordStrength } from "../security/usePasswordStrength";
import {
  defaultExportSecuritySettings,
  type ExportFormat,
  type ExportSecuritySettings,
} from "../../types/settings/settings";
import {
  importConnections,
  detectImportFormat,
  getFormatName,
  getImportFormatCompatibility,
  detectMRemoteNGEncryption,
  decryptMRemoteNGXml,
  verifyMRemoteNGPassword,
  MREMOTENG_DEFAULT_MASTER_PASSWORD,
  type ImportFormat,
} from "../../components/ImportExport/utils";
import { ProxyOpenVPNManager } from "../../utils/network/proxyOpenVPNManager";
import {
  resolveTunnelLayerVpnProfileId,
  withTunnelLayerVpnProfileId,
} from "../../utils/network/vpnProviderCatalog";
import { proxyCollectionManager } from "../../utils/connection/proxyCollectionManager";
import { generateId } from "../../utils/core/id";
import {
  remapConnectionsForApply,
  buildApplyItems,
  type ApplyConnectionsItem,
} from "../../components/ImportExport/applyConnections";
import {
  formatPortableProtocolLabel,
  hasAdvancedProtocolSettings,
  normalizeImportedAdvancedProtocolConnection,
  prepareConnectionForClone,
  prepareConnectionForExport,
  serializeConnectionsToNativeXml,
  serializeDatasetsToNativeCsv,
  stripArdAppleAccountCredentials,
} from "../../components/ImportExport/advancedProtocolPortability";
import {
  getVpnPortabilityWarnings,
  isVpnProfileExecutable,
  normalizeVpnImportData,
  prepareVpnConnectionForTransfer,
  prepareVpnDataForTransfer,
} from "../../components/ImportExport/vpnPortability";

const DEFAULT_IMPORT_FILTERS: ImportFilterState = {
  search: "",
  protocol: "all",
  issueSeverity: "all",
  itemKind: "all",
  selection: "all",
  conflict: "all",
  missingHostnameOnly: false,
  withCredentialsOnly: false,
};

const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  preserveFolders: true,
  includeCredentials: true,
  includeVpnData: true,
  includeTunnelChains: true,
  includeSshTunnels: true,
  conflictPolicy: "duplicate",
  addTags: "",
  switchToTargetDatabaseAfterImport: false,
};

const EMPTY_IMPORT_PREVIEW_ITEMS: ImportPreviewItem[] = [];

const chooseImportTargetDatabaseId = (
  options: ExportDatabaseOption[],
  currentSelection: string,
  mode: ImportTargetMode,
): string => {
  const exportableOptions = options.filter((option) => option.isExportable);
  const currentOption = exportableOptions.find((option) => option.isCurrent);
  const selectedOption = exportableOptions.find(
    (option) => option.id === currentSelection,
  );

  if (mode === "current") {
    return currentOption?.id ?? exportableOptions[0]?.id ?? "";
  }

  if (mode === "selected") {
    return (
      selectedOption?.id ??
      exportableOptions.find((option) => !option.isCurrent)?.id ??
      currentOption?.id ??
      exportableOptions[0]?.id ??
      ""
    );
  }

  return (
    selectedOption?.id ?? currentOption?.id ?? exportableOptions[0]?.id ?? ""
  );
};

interface ExportInventoryRow {
  databaseId: string;
  databaseName: string;
  id: string;
  name: string;
  kind: string;
  protocol: string;
  hostname: string;
  port: string;
  username: string;
  domain: string;
  description: string;
  path: string;
  parentId: string;
  tags: string;
  hasCredentials: string;
  createdAt: string;
  updatedAt: string;
}

interface ExportInventorySummary {
  totalItems: number;
  folders: number;
  leafConnections: number;
  credentialConnections: number;
  protocolCount: number;
}

interface ExportDatabaseDataset {
  databaseId: string;
  databaseName: string;
  databaseDescription?: string;
  isCurrent: boolean;
  isEncrypted: boolean;
  connections: Connection[];
  settings: Record<string, unknown>;
  tabGroups: DatabaseExportSnapshot["tabGroups"];
  colorTags: DatabaseExportSnapshot["colorTags"];
}

interface ExportSidecars {
  vpnConnections?: ImportVpnData;
  vpnWarnings?: string[];
  tunnelChainTemplates?: ImportResult["tunnelChainTemplates"];
  proxyProfiles?: ReturnType<typeof proxyCollectionManager.getProfiles>;
  proxyChains?: ReturnType<typeof proxyCollectionManager.getChains>;
}

type ExportProxyChain = NonNullable<ExportSidecars["proxyChains"]>[number];
type ExportTunnelChain = NonNullable<
  ExportSidecars["tunnelChainTemplates"]
>[number];

interface CloneSidecarCounts {
  total: number;
  proxyProfiles: number;
  proxyChains: number;
  tunnelChains: number;
  vpnConnections: number;
}

interface CloneSidecarResult {
  connections: Connection[];
  idMaps: {
    proxyProfileIds: Map<string, string>;
    proxyChainIds: Map<string, string>;
    tunnelChainIds: Map<string, string>;
    vpnConnectionIds: Map<string, string>;
  };
  counts: CloneSidecarCounts;
  errors: string[];
  warnings: string[];
}

interface ExportBuildResult {
  datasets: ExportDatabaseDataset[];
  options: ExportDatabaseOption[];
  effectiveDatabaseIds: string[];
}

const EXPORT_PACKAGE_SCHEMA = "sortOfRemoteNG.database-export-package";
const EXPORT_PACKAGE_VERSION = 1;
const EXPORT_SINGLE_DATABASE_SCHEMA = "sortOfRemoteNG.database-export";
const EXPORT_CLIENT_ID_STORAGE_KEY = "mremote-export-client-id";
const SECRET_PLACEHOLDER = "***ENCRYPTED***";

const createDefaultExportInclusion = (
  settings: ExportSecuritySettings,
): ExportInclusionConfig => ({
  includeConnections: settings.includeConnectionsByDefault,
  includeCredentials: settings.includePasswordsByDefault,
  includeSettings: settings.includeSettingsByDefault,
  includeFolderItems: settings.includeFolderItemsByDefault,
  includeEmptyFolders: settings.includeEmptyFoldersByDefault,
  includeTabGroups: settings.includeTabGroupsByDefault,
  includeColorTags: settings.includeColorTagsByDefault,
  includeVpnData: settings.includeVpnDataByDefault,
  includeTunnelChains: settings.includeTunnelChainsByDefault,
  includeExportMetadata: settings.includeExportMetadataByDefault,
  includeDatabaseMetadata: settings.includeDatabaseMetadataByDefault,
  includedProtocols: [],
  includedConnectionIds: [],
  includedFolderIds: [],
  includedTextTags: [],
  includedColorTagIds: [],
  includedProxyProfileIds: [],
  includedProxyChainIds: [],
  includedVpnConnectionIds: [],
});

const EXPORT_INVENTORY_COLUMNS: Array<{
  key: keyof ExportInventoryRow;
  label: string;
}> = [
  { key: "name", label: "Name" },
  { key: "kind", label: "Kind" },
  { key: "protocol", label: "Protocol" },
  { key: "hostname", label: "Hostname" },
  { key: "port", label: "Port" },
  { key: "username", label: "Username" },
  { key: "domain", label: "Domain" },
  { key: "path", label: "Path" },
  { key: "tags", label: "Tags" },
  { key: "hasCredentials", label: "Has credentials" },
  { key: "description", label: "Description" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Updated" },
];

const EXPORT_INVENTORY_DATABASE_COLUMNS: Array<{
  key: keyof ExportInventoryRow;
  label: string;
}> = [
  { key: "databaseName", label: "Database" },
  { key: "databaseId", label: "Database ID" },
];

const getExportInventoryColumns = (
  includeDatabaseColumns: boolean,
): Array<{ key: keyof ExportInventoryRow; label: string }> =>
  includeDatabaseColumns
    ? [...EXPORT_INVENTORY_DATABASE_COLUMNS, ...EXPORT_INVENTORY_COLUMNS]
    : EXPORT_INVENTORY_COLUMNS;

const getExportSecuritySettings = (
  settingsManager: SettingsManager,
): ExportSecuritySettings => {
  try {
    const managerWithOptionalGetter = settingsManager as SettingsManager & {
      getSettings?: () => {
        exportSecurity?: Partial<ExportSecuritySettings>;
        exportEncryption?: boolean;
      };
    };
    const settings = managerWithOptionalGetter.getSettings?.();
    return {
      ...defaultExportSecuritySettings,
      ...(settings?.exportSecurity ?? {}),
      encryptByDefault:
        settings?.exportSecurity?.encryptByDefault ??
        settings?.exportEncryption ??
        defaultExportSecuritySettings.encryptByDefault,
      keyDerivationIterations: normalizePbkdf2Iterations(
        settings?.exportSecurity?.keyDerivationIterations ??
          defaultExportSecuritySettings.keyDerivationIterations,
      ),
    };
  } catch {
    return defaultExportSecuritySettings;
  }
};

const normalizeSearch = (value: string): string => value.trim().toLowerCase();

const safeString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
};

const safeTrimmedLower = (value: unknown): string =>
  safeString(value).trim().toLowerCase();

const safeTags = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((tag) => safeString(tag)).filter(Boolean)
    : [];

const splitTags = (value: string): string[] =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const SECRET_FIELD_NAMES = new Set([
  "password",
  "basicauthpassword",
  "rustdeskpassword",
  "proxypassword",
  "privatekey",
  "passphrase",
  "totpsecret",
  "apikey",
  "accesstoken",
  "clientsecret",
  "serviceaccountkey",
  "presharedkey",
  "authkey",
  "authtoken",
  "seedphrase",
  "answer",
  "savedcredentialid",
  "vaultref",
  "clientcertificateref",
  "credentialref",
  "privatekeycredentialref",
]);

const SECRET_HEADER_NAMES =
  /authorization|cookie|token|secret|password|api[-_ ]?key/i;

const normalizeSecretFieldName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const hasSecretishValue = (value: unknown, fieldName?: string): boolean => {
  const normalizedFieldName = fieldName
    ? normalizeSecretFieldName(fieldName)
    : "";
  if (normalizedFieldName && SECRET_FIELD_NAMES.has(normalizedFieldName)) {
    return value !== undefined && value !== null && value !== "";
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasSecretishValue(item));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nestedValue]) => hasSecretishValue(nestedValue, key),
    );
  }
  return false;
};

const connectionHasCredentials = (connection: Connection): boolean =>
  hasSecretishValue(connection);

// mRemoteNG-imported tunnels seed a chain layer whose type follows the
// §1.4 contract: 'ssh-jump' for SSH targets and 'ssh-tunnel' for non-SSH
// targets (RDP/VNC/HTTP/…). The import option / preview / strip helpers
// must recognise BOTH so a jump-host layer (Rust-path output or an
// ssh-target import) is not invisible to the "Import SSH tunnels" option,
// the sshTunnel preview rows, or the strip logic.
const SSH_TUNNEL_LAYER_TYPES = new Set<string>(["ssh-tunnel", "ssh-jump"]);

const isSshTunnelLayer = (layer: { type?: string }): boolean =>
  SSH_TUNNEL_LAYER_TYPES.has(layer.type ?? "");

const getConnectionSshTunnelLayers = (connection: Connection) =>
  (connection.security?.tunnelChain ?? []).filter(isSshTunnelLayer);

const hasConnectionSshTunnel = (connection: Connection): boolean =>
  Boolean(connection.security?.sshTunnel) ||
  getConnectionSshTunnelLayers(connection).length > 0;

const stripConnectionSshTunnels = (connection: Connection): Connection => {
  if (!hasConnectionSshTunnel(connection) || !connection.security) {
    return connection;
  }

  const nextSecurity: NonNullable<Connection["security"]> = {
    ...connection.security,
  };
  delete nextSecurity.sshTunnel;

  if (nextSecurity.tunnelChain) {
    const keptLayers = nextSecurity.tunnelChain.filter(
      (layer) => !isSshTunnelLayer(layer),
    );
    if (keptLayers.length > 0) {
      nextSecurity.tunnelChain = keptLayers;
    } else {
      delete nextSecurity.tunnelChain;
    }
  }

  if (Object.keys(nextSecurity).length === 0) {
    const next = { ...connection };
    delete next.security;
    return next;
  }

  return {
    ...connection,
    security: nextSecurity,
  };
};

const redactSecretFields = <T>(value: T, fieldName?: string): T | undefined => {
  const normalizedFieldName = fieldName
    ? normalizeSecretFieldName(fieldName)
    : "";
  if (normalizedFieldName && SECRET_FIELD_NAMES.has(normalizedFieldName)) {
    return normalizedFieldName.includes("password")
      ? (SECRET_PLACEHOLDER as T)
      : undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => redactSecretFields(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(
      ([key, nestedValue]) => {
        if (
          key === "httpHeaders" &&
          nestedValue &&
          typeof nestedValue === "object"
        ) {
          next[key] = Object.fromEntries(
            Object.entries(nestedValue as Record<string, unknown>).filter(
              ([headerName]) => !SECRET_HEADER_NAMES.test(headerName),
            ),
          );
          return;
        }

        const redactedValue = redactSecretFields(nestedValue, key);
        if (redactedValue !== undefined) {
          next[key] = redactedValue;
        }
      },
    );
    return next as T;
  }

  return value;
};

const redactConnectionSecretsForExport = (
  connection: Connection,
): Connection => {
  return stripArdAppleAccountCredentials(
    redactSecretFields(connection) ?? { ...connection },
  );
};

const stripSecretFields = <T>(value: T, fieldName?: string): T | undefined => {
  const normalizedFieldName = fieldName
    ? normalizeSecretFieldName(fieldName)
    : "";
  if (normalizedFieldName && SECRET_FIELD_NAMES.has(normalizedFieldName)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripSecretFields(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(
      ([key, nestedValue]) => {
        if (
          key === "httpHeaders" &&
          nestedValue &&
          typeof nestedValue === "object"
        ) {
          next[key] = Object.fromEntries(
            Object.entries(nestedValue as Record<string, unknown>).filter(
              ([headerName]) => !SECRET_HEADER_NAMES.test(headerName),
            ),
          );
          return;
        }

        const strippedValue = stripSecretFields(nestedValue, key);
        if (strippedValue !== undefined) {
          next[key] = strippedValue;
        }
      },
    );
    return next as T;
  }

  return value;
};

const stripConnectionCredentials = (connection: Connection): Connection =>
  stripArdAppleAccountCredentials(
    stripSecretFields(connection) ?? { ...connection },
  );

const connectionEndpointKey = (connection: Connection): string =>
  [
    safeTrimmedLower(connection.protocol),
    safeTrimmedLower(connection.hostname),
    String(Number(connection.port) || 0),
    safeTrimmedLower(connection.username),
  ].join("|");

const getParentNameById = (
  connections: Connection[],
  parentId?: string,
): string | undefined => {
  if (!parentId) return undefined;
  const parent = connections.find((connection) => connection.id === parentId);
  return parent ? safeString(parent.name) : undefined;
};

const getConnectionPath = (
  connection: Connection,
  connectionsById: Map<string, Connection>,
): string => {
  const names = [safeString(connection.name) || "Unnamed item"];
  let parentId = connection.parentId;
  const seen = new Set<string>();

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = connectionsById.get(parentId);
    if (!parent) break;
    names.unshift(safeString(parent.name) || "Unnamed folder");
    parentId = parent.parentId;
  }

  return names.join(" / ");
};

const getAncestorFolderIds = (
  connection: Connection,
  connectionsById: Map<string, Connection>,
): string[] => {
  const ids: string[] = [];
  let parentId = connection.parentId;
  const seen = new Set<string>();

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = connectionsById.get(parentId);
    if (!parent?.isGroup) break;
    ids.push(parent.id);
    parentId = parent.parentId;
  }

  return ids;
};

const normalizeIncludedProtocols = (
  protocols: Connection["protocol"][] = [],
): Connection["protocol"][] => Array.from(new Set(protocols)).sort();

const getIncludedProtocolSet = (
  inclusion: ExportInclusionConfig,
): Set<Connection["protocol"]> | null =>
  inclusion.includedProtocols.length > 0
    ? new Set(inclusion.includedProtocols)
    : null;

const filterConnectionsForExport = (
  connections: Connection[],
  inclusion: ExportInclusionConfig,
): Connection[] => {
  if (!inclusion.includeConnections) return [];

  const includedProtocolSet = getIncludedProtocolSet(inclusion);
  const includedConnectionIdSet =
    (inclusion.includedConnectionIds ?? []).length > 0
      ? new Set(inclusion.includedConnectionIds)
      : null;
  const includedFolderIdSet =
    (inclusion.includedFolderIds ?? []).length > 0
      ? new Set(inclusion.includedFolderIds)
      : null;
  const includedTextTagSet =
    (inclusion.includedTextTags ?? []).length > 0
      ? new Set(inclusion.includedTextTags)
      : null;
  const includedColorTagIdSet =
    (inclusion.includedColorTagIds ?? []).length > 0
      ? new Set(inclusion.includedColorTagIds)
      : null;
  const connectionsById = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const leafConnections = connections.filter(
    (connection) =>
      !connection.isGroup &&
      (!includedProtocolSet || includedProtocolSet.has(connection.protocol)) &&
      (!includedConnectionIdSet ||
        includedConnectionIdSet.has(connection.id)) &&
      (!includedTextTagSet ||
        (connection.tags ?? []).some((tag) => includedTextTagSet.has(tag))) &&
      (!includedColorTagIdSet ||
        (connection.colorTag != null &&
          includedColorTagIdSet.has(connection.colorTag))) &&
      (!includedFolderIdSet ||
        getAncestorFolderIds(connection, connectionsById).some((folderId) =>
          includedFolderIdSet.has(folderId),
        )),
  );
  const leafIds = new Set(leafConnections.map((connection) => connection.id));
  let keptFolderIds = new Set<string>();

  if (inclusion.includeFolderItems) {
    if (inclusion.includeEmptyFolders) {
      const selectedFolderAncestorIds = new Set<string>();
      if (includedFolderIdSet) {
        includedFolderIdSet.forEach((folderId) => {
          const folder = connectionsById.get(folderId);
          if (folder?.isGroup) {
            getAncestorFolderIds(folder, connectionsById).forEach((id) =>
              selectedFolderAncestorIds.add(id),
            );
          }
        });
      }

      keptFolderIds = new Set();
      connections
        .filter((connection) => connection.isGroup)
        .forEach((folder) => {
          if (!includedFolderIdSet) {
            keptFolderIds.add(folder.id);
            return;
          }
          const ancestors = getAncestorFolderIds(folder, connectionsById);
          if (
            includedFolderIdSet.has(folder.id) ||
            selectedFolderAncestorIds.has(folder.id) ||
            ancestors.some((id) => includedFolderIdSet.has(id))
          ) {
            keptFolderIds.add(folder.id);
          }
        });
    } else {
      leafConnections.forEach((connection) => {
        let parentId = connection.parentId;
        const visited = new Set<string>();
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          const parent = connectionsById.get(parentId);
          if (!parent || !parent.isGroup) break;
          keptFolderIds.add(parent.id);
          parentId = parent.parentId;
        }
      });
    }
  }

  const keptConnections = connections.filter((connection) =>
    connection.isGroup
      ? inclusion.includeFolderItems && keptFolderIds.has(connection.id)
      : leafIds.has(connection.id),
  );
  const keptIds = new Set(keptConnections.map((connection) => connection.id));

  return keptConnections.map((connection) =>
    connection.parentId && !keptIds.has(connection.parentId)
      ? { ...connection, parentId: undefined }
      : connection,
  );
};

const prepareConnectionsForExport = (
  connections: Connection[],
  inclusion: ExportInclusionConfig,
): Connection[] => {
  const filteredConnections = filterConnectionsForExport(
    connections,
    inclusion,
  );
  const portableConnections = filteredConnections.map((connection) =>
    prepareConnectionForExport(connection, true),
  );
  return inclusion.includeCredentials
    ? portableConnections
    : portableConnections.map(redactConnectionSecretsForExport);
};

const createEmptyCloneSidecarCounts = (): CloneSidecarCounts => ({
  total: 0,
  proxyProfiles: 0,
  proxyChains: 0,
  tunnelChains: 0,
  vpnConnections: 0,
});

const collectConnectionSidecarReferences = (connections: Connection[]) => {
  const proxyChainIds = new Set<string>();
  const tunnelChainIds = new Set<string>();
  const vpnConnectionIds = new Set<string>();

  connections.forEach((connection) => {
    if (connection.proxyChainId) proxyChainIds.add(connection.proxyChainId);
    if (connection.tunnelChainId) tunnelChainIds.add(connection.tunnelChainId);
    const legacyOpenVpnId = connection.security?.openvpn?.configId;
    if (legacyOpenVpnId) vpnConnectionIds.add(legacyOpenVpnId);
    connection.security?.tunnelChain?.forEach((layer) => {
      const layerVpnId = resolveTunnelLayerVpnProfileId(layer);
      if (layerVpnId) vpnConnectionIds.add(layerVpnId);
    });
  });

  return { proxyChainIds, tunnelChainIds, vpnConnectionIds };
};

const remapConnectionVpnReferences = (
  connection: Connection,
  vpnConnectionIds: Map<string, string>,
): Connection => {
  let next: Connection = connection;
  const legacyOpenVpnId = connection.security?.openvpn?.configId
    ? vpnConnectionIds.get(connection.security.openvpn.configId)
    : undefined;
  if (legacyOpenVpnId) {
    next = {
      ...next,
      security: {
        ...next.security,
        openvpn: {
          ...next.security?.openvpn,
          enabled: next.security?.openvpn?.enabled ?? true,
          configId: legacyOpenVpnId,
        },
      },
    };
  }

  const tunnelChain = next.security?.tunnelChain;
  if (tunnelChain?.some((layer) => resolveTunnelLayerVpnProfileId(layer))) {
    next = {
      ...next,
      security: {
        ...next.security,
        tunnelChain: tunnelChain.map((layer) => {
          const currentVpnId = resolveTunnelLayerVpnProfileId(layer);
          const layerVpnId = currentVpnId
            ? vpnConnectionIds.get(currentVpnId)
            : undefined;
          return layerVpnId
            ? withTunnelLayerVpnProfileId(layer, layerVpnId)
            : layer;
        }),
      },
    };
  }

  return next;
};

const remapConnectionVpnReferencesStrict = (
  connection: Connection,
  vpnConnectionIds: Map<string, string>,
  onUnresolved: (profileId: string) => void,
  requiresMapping: (profileId: string) => boolean = () => true,
): Connection => {
  let nextSecurity = connection.security
    ? { ...connection.security }
    : undefined;
  const legacyOpenVpnId = connection.security?.openvpn?.configId;
  if (legacyOpenVpnId) {
    const mapped = vpnConnectionIds.get(legacyOpenVpnId);
    if (mapped) {
      nextSecurity = {
        ...nextSecurity,
        openvpn: {
          ...connection.security?.openvpn,
          enabled: connection.security?.openvpn?.enabled ?? true,
          configId: mapped,
        },
      };
    } else if (requiresMapping(legacyOpenVpnId)) {
      onUnresolved(legacyOpenVpnId);
      if (nextSecurity) {
        const { openvpn: _unresolvedOpenVpn, ...rest } = nextSecurity;
        nextSecurity = rest;
      }
    }
  }

  const tunnelChain = connection.security?.tunnelChain;
  if (tunnelChain) {
    const remappedLayers = tunnelChain.flatMap((layer) => {
      const currentVpnId = resolveTunnelLayerVpnProfileId(layer);
      if (!currentVpnId) return [layer];
      const mapped = vpnConnectionIds.get(currentVpnId);
      if (!mapped && requiresMapping(currentVpnId)) {
        onUnresolved(currentVpnId);
        return [];
      }
      return mapped ? [withTunnelLayerVpnProfileId(layer, mapped)] : [layer];
    });
    nextSecurity = {
      ...nextSecurity,
      ...(remappedLayers.length > 0
        ? { tunnelChain: remappedLayers }
        : { tunnelChain: undefined }),
    };
  }

  return nextSecurity ? { ...connection, security: nextSecurity } : connection;
};

const remapConnectionSidecars = (
  connection: Connection,
  result: CloneSidecarResult,
  options: {
    requireVpnMapping: boolean;
    requireProxyChainMapping: boolean;
    requireTunnelChainMapping: boolean;
  },
): Connection => {
  let next = options.requireVpnMapping
    ? remapConnectionVpnReferencesStrict(
        connection,
        result.idMaps.vpnConnectionIds,
        (profileId) => {
          result.warnings.push(
            `Connection "${connection.name}" had unresolved VPN profile ${profileId}; that association was removed.`,
          );
        },
      )
    : remapConnectionVpnReferences(connection, result.idMaps.vpnConnectionIds);
  const proxyChainId = connection.proxyChainId
    ? result.idMaps.proxyChainIds.get(connection.proxyChainId)
    : undefined;
  const tunnelChainId = connection.tunnelChainId
    ? result.idMaps.tunnelChainIds.get(connection.tunnelChainId)
    : undefined;

  if (proxyChainId) {
    next = { ...next, proxyChainId };
  } else if (connection.proxyChainId && options.requireProxyChainMapping) {
    result.warnings.push(
      `Connection "${connection.name}" had unresolved proxy chain ${connection.proxyChainId}; that association was removed.`,
    );
    const { proxyChainId: _unresolvedProxyChainId, ...withoutProxyChain } =
      next;
    next = withoutProxyChain as Connection;
  }
  if (tunnelChainId) {
    next = { ...next, tunnelChainId };
  } else if (connection.tunnelChainId && options.requireTunnelChainMapping) {
    result.warnings.push(
      `Connection "${connection.name}" had unresolved tunnel chain ${connection.tunnelChainId}; that association was removed.`,
    );
    const { tunnelChainId: _unresolvedTunnelChainId, ...withoutTunnelChain } =
      next;
    next = withoutTunnelChain as Connection;
  }

  return next;
};

const remapProxyChain = (
  chain: ExportProxyChain,
  profileIds: Map<string, string>,
  vpnConnectionIds: Map<string, string>,
): ExportProxyChain => ({
  ...chain,
  layers: chain.layers.map((layer) => ({
    ...layer,
    proxyProfileId: layer.proxyProfileId
      ? (profileIds.get(layer.proxyProfileId) ?? layer.proxyProfileId)
      : layer.proxyProfileId,
    vpnProfileId: layer.vpnProfileId
      ? (vpnConnectionIds.get(layer.vpnProfileId) ?? layer.vpnProfileId)
      : layer.vpnProfileId,
  })),
});

const remapTunnelChain = (
  chain: ExportTunnelChain,
  vpnConnectionIds: Map<string, string>,
): ExportTunnelChain => ({
  ...chain,
  layers: chain.layers.map((layer) => {
    const currentVpnId = resolveTunnelLayerVpnProfileId(layer);
    const mappedVpnId = currentVpnId
      ? vpnConnectionIds.get(currentVpnId)
      : undefined;
    return mappedVpnId
      ? withTunnelLayerVpnProfileId(layer, mappedVpnId)
      : layer;
  }),
});

const getOrCreateExportClientId = (): string => {
  const fallback = () => `sorng-client-${generateId()}`;
  try {
    if (typeof localStorage === "undefined") return fallback();
    const existing = localStorage.getItem(EXPORT_CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = fallback();
    localStorage.setItem(EXPORT_CLIENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return fallback();
  }
};

const detectJsonShape = (content: string): ImportSourceMetadata["json"] => {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return { shape: "array", topLevelKeys: [] };
    }
    if (!parsed || typeof parsed !== "object") {
      return { shape: "unknown", topLevelKeys: [] };
    }
    const keys = Object.keys(parsed);
    const shape = Array.isArray(parsed.databases)
      ? "database-package"
      : Array.isArray(parsed.connections)
        ? keys.includes("version") ||
          keys.includes("exportDate") ||
          keys.includes("collection")
          ? "collection-export"
          : "connections-object"
        : "object";
    return { shape, topLevelKeys: keys.slice(0, 20) };
  } catch {
    return { shape: "unknown", topLevelKeys: [] };
  }
};

const detectCsvMetadata = (content: string): ImportSourceMetadata["csv"] => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], dataRows: 0 };
  const headers = lines[0]
    .split(",")
    .map((header) => header.trim().replace(/"/g, ""));
  return { headers, dataRows: Math.max(0, lines.length - 1) };
};

const detectXmlMetadata = (content: string): ImportSourceMetadata["xml"] => {
  try {
    const doc = new DOMParser().parseFromString(content, "text/xml");
    const root = doc.documentElement;
    return {
      rootElement: root?.tagName,
      nodeCount: doc.querySelectorAll(
        "Connection, Node, server, group, session",
      ).length,
    };
  } catch {
    return { nodeCount: 0 };
  }
};

const buildImportPreviewItems = (
  connections: Connection[],
  existingConnections: Connection[],
  sidecars?: {
    vpnConnections?: ImportVpnData;
    tunnelChainTemplates?: ImportResult["tunnelChainTemplates"];
  },
): ImportPreviewItem[] => {
  const importedById = new Map(
    connections.map((connection, index) => [
      safeString(connection.id) || `import-${index + 1}`,
      connection,
    ]),
  );
  const existingById = new Map(
    existingConnections.map((connection) => [connection.id, connection]),
  );
  const existingNameKeys = new Map<string, Connection>();
  const existingEndpointKeys = new Map<string, Connection>();

  existingConnections.forEach((connection) => {
    const nameKey = `${connection.parentId || ""}|${safeTrimmedLower(connection.name)}`;
    existingNameKeys.set(nameKey, connection);
    if (!connection.isGroup && safeString(connection.hostname).trim()) {
      existingEndpointKeys.set(connectionEndpointKey(connection), connection);
    }
  });

  const connectionItems: ImportPreviewItem[] = connections.map(
    (connection, index) => {
      const connectionId = safeString(connection.id) || `import-${index + 1}`;
      const name = safeString(connection.name);
      const hostname = safeString(connection.hostname);
      const username = safeString(connection.username);
      const port = Number(connection.port);
      const tags = safeTags(connection.tags);
      const issues: ImportPreviewItem["issues"] = [];
      let conflictStatus: ImportPreviewItem["conflictStatus"] = "none";
      let duplicateOf: string | undefined;

      if (!name.trim()) {
        issues.push({
          severity: "error",
          code: "missing_name",
          field: "name",
          message: "Name is required.",
        });
      }

      if (!connection.isGroup && !hostname.trim()) {
        issues.push({
          severity: "warning",
          code: "missing_hostname",
          field: "hostname",
          message: "Hostname is empty.",
        });
      }

      if (!connection.isGroup && (!Number.isFinite(port) || port <= 0)) {
        issues.push({
          severity: "warning",
          code: "invalid_port",
          field: "port",
          message: "Port is missing or invalid.",
        });
      }

      const sameId = existingById.get(connectionId);
      if (sameId) {
        conflictStatus = "sameId";
        duplicateOf = sameId.id;
      } else {
        const sameName = existingNameKeys.get(
          `${connection.parentId || ""}|${safeTrimmedLower(name)}`,
        );
        if (sameName) {
          conflictStatus = "sameName";
          duplicateOf = sameName.id;
        } else if (!connection.isGroup && hostname.trim()) {
          const sameEndpoint = existingEndpointKeys.get(
            connectionEndpointKey(connection),
          );
          if (sameEndpoint) {
            conflictStatus = "sameEndpoint";
            duplicateOf = sameEndpoint.id;
          }
        }
      }

      if (conflictStatus !== "none") {
        issues.push({
          severity: "warning",
          code: `conflict_${conflictStatus}`,
          message:
            conflictStatus === "sameEndpoint"
              ? "Existing connection uses the same protocol, host, port, and username."
              : conflictStatus === "sameName"
                ? "Existing item has the same name in the same folder."
                : "Existing item has the same id.",
        });
      }

      const importable = !issues.some((issue) => issue.severity === "error");
      return {
        id: `${connection.isGroup ? "folder" : "connection"}:${connectionId}:${index}`,
        kind: connection.isGroup ? "folder" : "connection",
        sourceIndex: index + 1,
        sourcePath: getConnectionPath(connection, importedById),
        name: name || "Unnamed item",
        protocol: connection.protocol,
        hostname,
        port: Number.isFinite(port) ? port : undefined,
        username,
        parentName: getParentNameById(connections, connection.parentId),
        tags,
        connection,
        importable,
        selectedByDefault: importable,
        conflictStatus,
        duplicateOf,
        issues,
      };
    },
  );

  const sidecarItems: ImportPreviewItem[] = [];
  let sourceIndex = connectionItems.length + 1;

  connections.forEach((connection, index) => {
    if (connection.isGroup || !hasConnectionSshTunnel(connection)) return;

    const connectionId = safeString(connection.id) || `import-${index + 1}`;
    const sshTunnelLayers = getConnectionSshTunnelLayers(connection);
    const firstLayer = sshTunnelLayers[0];
    const firstTunnel = firstLayer?.sshTunnel;
    const legacyTunnel = connection.security?.sshTunnel;
    const issues: ImportPreviewItem["issues"] = [];

    if (
      sshTunnelLayers.length > 0 &&
      !firstTunnel?.host &&
      !firstTunnel?.connectionId
    ) {
      issues.push({
        severity: "error",
        code: "unresolved_ssh_tunnel",
        field: "security.tunnelChain",
        message:
          "The SSH tunnel server could not be resolved from the source file.",
      });
    }

    const importable = !issues.some((issue) => issue.severity === "error");
    sidecarItems.push({
      id: `sshTunnel:${connectionId}:${index}:${sourceIndex}`,
      kind: "sshTunnel",
      sourceIndex,
      sourcePath: getConnectionPath(connection, importedById),
      // 'ssh-jump' (SSH target) and 'ssh-tunnel' (RDP/VNC/HTTP target) layers
      // are both surfaced as SSH tunnels here. Prefer the layer's own name
      // (carries "via <jump host>") so the jump host is visible in the row.
      name:
        safeString(firstLayer?.name) ||
        `${safeString(connection.name) || "Unnamed item"} SSH tunnel`,
      protocol: "ssh",
      hostname:
        firstTunnel?.host ||
        firstTunnel?.connectionId ||
        legacyTunnel?.connectionId ||
        "",
      port: firstTunnel?.port || undefined,
      username: firstTunnel?.username,
      parentName: safeString(connection.name) || undefined,
      tags: safeTags(connection.tags),
      connection,
      sshTunnelConnectionId: connectionId,
      sshTunnelLayers,
      importable,
      selectedByDefault: importable,
      conflictStatus: "none",
      issues,
    });
    sourceIndex += 1;
  });

  const appendVpnItems = <K extends keyof ImportVpnData>(
    vpnType: K,
    label: string,
    items: ImportVpnData[K],
  ) => {
    items.forEach((vpnConnection, index) => {
      const name = safeString(vpnConnection.name);
      const issues: ImportPreviewItem["issues"] = [];
      if (!name.trim()) {
        issues.push({
          severity: "error",
          code: "missing_name",
          field: "name",
          message: "Name is required.",
        });
      }
      if (!vpnConnection.config) {
        issues.push({
          severity: "error",
          code: "missing_config",
          field: "config",
          message: "VPN configuration is required.",
        });
      }
      getVpnPortabilityWarnings(vpnConnection).forEach((message) => {
        issues.push({
          severity: "warning",
          code: "vpn_credentials_unresolved",
          field: "config",
          message,
        });
      });
      const importable = !issues.some((issue) => issue.severity === "error");
      sidecarItems.push({
        id: `vpn:${vpnType}:${safeString(vpnConnection.id) || index}:${sourceIndex}`,
        kind: "vpn",
        sourceIndex,
        sourcePath: `VPN / ${label}`,
        name: name || `${label} connection`,
        parentName: label,
        tags: safeTags((vpnConnection as { tags?: unknown }).tags),
        vpnType,
        vpnConnection,
        importable,
        selectedByDefault: importable,
        conflictStatus: "none",
        issues,
      });
      sourceIndex += 1;
    });
  };

  if (sidecars?.vpnConnections) {
    appendVpnItems("openvpn", "OpenVPN", sidecars.vpnConnections.openvpn);
    appendVpnItems("wireguard", "WireGuard", sidecars.vpnConnections.wireguard);
    appendVpnItems("tailscale", "Tailscale", sidecars.vpnConnections.tailscale);
    appendVpnItems("zerotier", "ZeroTier", sidecars.vpnConnections.zerotier);
  }

  sidecars?.tunnelChainTemplates?.forEach((chain, index) => {
    const name = safeString(chain.name);
    const issues: ImportPreviewItem["issues"] = [];
    if (!name.trim()) {
      issues.push({
        severity: "error",
        code: "missing_name",
        field: "name",
        message: "Name is required.",
      });
    }
    if (!Array.isArray(chain.layers)) {
      issues.push({
        severity: "error",
        code: "missing_layers",
        field: "layers",
        message: "Tunnel chain layers are required.",
      });
    }
    const importable = !issues.some((issue) => issue.severity === "error");
    sidecarItems.push({
      id: `tunnelChain:${safeString(chain.id) || index}:${sourceIndex}`,
      kind: "tunnelChain",
      sourceIndex,
      sourcePath: "Tunnel chains",
      name: name || "Tunnel chain",
      parentName: "Tunnel chain template",
      tags: safeTags(chain.tags),
      tunnelChainTemplate: chain,
      importable,
      selectedByDefault: importable,
      conflictStatus: "none",
      issues,
    });
    sourceIndex += 1;
  });

  return [...connectionItems, ...sidecarItems];
};

const buildImportAnalysis = (params: {
  filename: string;
  sizeBytes?: number;
  format: string;
  formatName: string;
  detectedFormat?: string;
  detectedFormatName?: string;
  formatForced?: boolean;
  formatWarning?: string;
  content: string;
  connections: Connection[];
  previewItems: ImportPreviewItem[];
  vpnConnections?: ImportVpnData;
  tunnelChainTemplates?: ImportResult["tunnelChainTemplates"];
  encryption?: ImportSourceMetadata["encryption"];
}): ImportSourceMetadata => {
  const extension = params.filename
    .replace(/\.encrypted\./i, ".")
    .split(".")
    .pop()
    ?.toLowerCase();
  const warnings = params.previewItems.reduce(
    (count, item) =>
      count +
      item.issues.filter((issue) => issue.severity === "warning").length,
    0,
  );
  const errors = params.previewItems.reduce(
    (count, item) =>
      count + item.issues.filter((issue) => issue.severity === "error").length,
    0,
  );
  const conflicts = params.previewItems.filter(
    (item) => item.conflictStatus !== "none",
  ).length;
  const rootName = (() => {
    if (!params.content.trim().startsWith("<")) return undefined;
    try {
      const doc = new DOMParser().parseFromString(params.content, "text/xml");
      return (
        doc.documentElement?.getAttribute("Name") ||
        doc.documentElement?.tagName ||
        undefined
      );
    } catch {
      return undefined;
    }
  })();

  return {
    filename: params.filename,
    extension,
    sizeBytes: params.sizeBytes,
    format: params.format,
    formatName: params.formatName,
    detectedFormat: params.detectedFormat,
    detectedFormatName: params.detectedFormatName,
    formatForced: params.formatForced,
    formatWarning: params.formatWarning,
    detectedAt: new Date().toISOString(),
    confidence:
      params.format === "csv" && !extension
        ? "medium"
        : params.format === "json"
          ? "high"
          : "high",
    encrypted: Boolean(
      params.encryption?.protected || params.encryption?.fullFileEncryption,
    ),
    sourceApplication: params.formatName,
    rootName,
    counts: {
      totalItems: params.previewItems.length,
      connections: params.connections.filter(
        (connection) => !connection.isGroup,
      ).length,
      folders: params.connections.filter((connection) => connection.isGroup)
        .length,
      vpnConnections: params.vpnConnections
        ? params.vpnConnections.openvpn.length +
          params.vpnConnections.wireguard.length +
          params.vpnConnections.tailscale.length +
          params.vpnConnections.zerotier.length
        : 0,
      tunnelChains: params.tunnelChainTemplates?.length || 0,
      sshTunnels: params.previewItems.filter(
        (item) => item.kind === "sshTunnel",
      ).length,
      warnings,
      errors,
      conflicts,
    },
    encryption: params.encryption,
    csv:
      params.format === "csv" ? detectCsvMetadata(params.content) : undefined,
    json:
      params.format === "json" ? detectJsonShape(params.content) : undefined,
    xml: params.content.trim().startsWith("<")
      ? detectXmlMetadata(params.content)
      : undefined,
  };
};

const filterImportPreviewItems = (
  items: ImportPreviewItem[],
  filters: ImportFilterState,
  selectedIds: Set<string>,
): ImportPreviewItem[] => {
  const query = normalizeSearch(filters.search);
  return items.filter((item) => {
    if (filters.protocol !== "all" && item.protocol !== filters.protocol)
      return false;
    if (
      filters.issueSeverity !== "all" &&
      !item.issues.some((issue) => issue.severity === filters.issueSeverity)
    ) {
      return false;
    }
    if (filters.itemKind !== "all" && item.kind !== filters.itemKind)
      return false;
    if (filters.selection === "selected" && !selectedIds.has(item.id))
      return false;
    if (filters.selection === "unselected" && selectedIds.has(item.id))
      return false;
    if (filters.conflict === "conflicts" && item.conflictStatus === "none")
      return false;
    if (filters.conflict === "clean" && item.conflictStatus !== "none")
      return false;
    if (
      filters.missingHostnameOnly &&
      !item.issues.some((issue) => issue.code === "missing_hostname")
    ) {
      return false;
    }
    if (filters.withCredentialsOnly && !item.connection) return false;
    if (
      filters.withCredentialsOnly &&
      item.connection &&
      !connectionHasCredentials(item.connection)
    ) {
      return false;
    }
    if (!query) return true;
    return [
      item.name,
      item.hostname,
      item.username,
      item.sourcePath,
      item.protocol,
      item.kind,
      item.vpnType,
      ...item.tags,
      ...item.issues.map((issue) => issue.message),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
};

type ImportExportTab = "export" | "import" | "clone";

interface UseImportExportParams {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: ImportExportTab;
}

export function useImportExport({
  isOpen,
  onClose,
  initialTab = "export",
}: UseImportExportParams) {
  const { state, dispatch, loadData } = useConnections();
  const { toast } = useToastContext();
  const { t } = useTranslation();
  const databaseManager = useMemo(() => DatabaseManager.getInstance(), []);
  const settingsManager = useMemo(() => SettingsManager.getInstance(), []);
  const [exportSecuritySettings] = useState(() =>
    getExportSecuritySettings(settingsManager),
  );
  const [activeTab, setActiveTab] = useState<ImportExportTab>(initialTab);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(
    exportSecuritySettings.defaultFormat,
  );
  const [exportScopeMode, setExportScopeMode] =
    useState<ExportScopeMode>("current");
  const [selectedExportDatabaseIds, setSelectedExportDatabaseIds] = useState<
    string[]
  >([]);
  const [exportDatabaseOptions, setExportDatabaseOptions] = useState<
    ExportDatabaseOption[]
  >([]);
  const [exportEncrypted, setExportEncrypted] = useState(
    exportSecuritySettings.encryptByDefault,
  );
  const [exportPassword, setExportPassword] = useState("");
  const [exportInclusion, setExportInclusion] = useState<ExportInclusionConfig>(
    () => createDefaultExportInclusion(exportSecuritySettings),
  );
  const [exportKeyDerivationIterations, setExportKeyDerivationIterations] =
    useState(exportSecuritySettings.keyDerivationIterations);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importFilename, setImportFilename] = useState<string>("");
  const [importAnalysis, setImportAnalysis] =
    useState<ImportSourceMetadata | null>(null);
  const [importFilters, setImportFilters] = useState<ImportFilterState>(
    DEFAULT_IMPORT_FILTERS,
  );
  const [importOptions, setImportOptions] = useState<ImportOptions>(
    DEFAULT_IMPORT_OPTIONS,
  );
  const [importDatabaseOptions, setImportDatabaseOptions] = useState<
    ExportDatabaseOption[]
  >([]);

  // ─── Clone tab state ──────────────────────────────────────────────
  //
  // Clone shares ExportInclusionConfig for the source-filter side and
  // the apply-pipeline knobs (conflict policy / addTags /
  // preserveFolders / includeCredentials) for the destination side.
  // `cloneDatabaseOptions` is the same shape as
  // `importDatabaseOptions` / `exportDatabaseOptions` so the picker
  // UI can be reused without translation.
  const [cloneSourceMode, setCloneSourceMode] =
    useState<ExportScopeMode>("current");
  const [selectedCloneSourceDatabaseIds, setSelectedCloneSourceDatabaseIds] =
    useState<string[]>([]);
  const [cloneInclusion, setCloneInclusion] = useState<ExportInclusionConfig>(
    () => createDefaultExportInclusion(exportSecuritySettings),
  );
  const [cloneTargetDatabaseIds, setCloneTargetDatabaseIds] = useState<
    string[]
  >([]);
  const [cloneConflictPolicy, setCloneConflictPolicy] =
    useState<ImportOptions["conflictPolicy"]>("duplicate");
  const [cloneAddTags, setCloneAddTags] = useState<string>("");
  const [clonePreserveFolders, setClonePreserveFolders] =
    useState<boolean>(true);
  const [cloneIncludeCredentials, setCloneIncludeCredentials] =
    useState<boolean>(true);
  const [
    cloneSwitchToTargetDatabaseAfterClone,
    setCloneSwitchToTargetDatabaseAfterClone,
  ] = useState<boolean>(false);
  const [cloneDatabaseOptions, setCloneDatabaseOptions] = useState<
    ExportDatabaseOption[]
  >([]);
  const [cloneSourceCatalog, setCloneSourceCatalog] = useState<
    CloneSourceCatalogItem[]
  >([]);
  const [isCloneSourceCatalogLoading, setIsCloneSourceCatalogLoading] =
    useState<boolean>(false);
  const [isCloning, setIsCloning] = useState<boolean>(false);
  const [cloneResult, setCloneResult] = useState<CloneResult | null>(null);

  const updateCloneInclusion = useCallback(
    (updates: Partial<ExportInclusionConfig>) => {
      setCloneInclusion((current) => ({
        ...current,
        ...updates,
        includedProtocols:
          updates.includedProtocols !== undefined
            ? normalizeIncludedProtocols(updates.includedProtocols)
            : current.includedProtocols,
      }));
    },
    [],
  );
  const [importTargetMode, setImportTargetModeState] =
    useState<ImportTargetMode>("current");
  const [selectedImportDatabaseId, setSelectedImportDatabaseId] =
    useState<string>("");
  const importTargetModeRef = useRef<ImportTargetMode>("current");
  const selectedImportDatabaseIdRef = useRef<string>("");
  const [importFormatSelection, setImportFormatSelectionState] = useState<
    "auto" | ImportFormat
  >("auto");
  const [importSourceFile, setImportSourceFile] = useState<{
    filename: string;
    content: string;
    sizeBytes?: number;
  } | null>(null);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentConnectionsRef = useRef<Connection[]>(state.connections);

  useEffect(() => {
    currentConnectionsRef.current = state.connections;
  }, [state.connections]);

  // In-app password prompt state. `pendingPasswordRequest` carries the
  // resolver for the awaiting import flow; the dialog UI lives in
  // ImportExport/index.tsx and calls submit/cancel here.
  const [passwordPrompt, setPasswordPrompt] = useState<{
    title: string;
    description: string;
    error?: string;
  } | null>(null);
  const pendingPasswordResolverRef = useRef<
    ((value: string | null) => void) | null
  >(null);

  const updateExportInclusion = useCallback(
    (updates: Partial<ExportInclusionConfig>) => {
      setExportInclusion((current) => ({
        ...current,
        ...updates,
        includedProtocols:
          updates.includedProtocols !== undefined
            ? normalizeIncludedProtocols(updates.includedProtocols)
            : current.includedProtocols,
      }));
    },
    [],
  );

  const includePasswords = exportInclusion.includeCredentials;
  const includeVpnData = exportInclusion.includeVpnData;
  const includeTunnelChains = exportInclusion.includeTunnelChains;
  const includeTabGroups = exportInclusion.includeTabGroups;
  const includeColorTags = exportInclusion.includeColorTags;

  const setIncludePasswords = useCallback(
    (value: boolean) => updateExportInclusion({ includeCredentials: value }),
    [updateExportInclusion],
  );
  const setIncludeVpnData = useCallback(
    (value: boolean) => updateExportInclusion({ includeVpnData: value }),
    [updateExportInclusion],
  );
  const setIncludeTunnelChains = useCallback(
    (value: boolean) => updateExportInclusion({ includeTunnelChains: value }),
    [updateExportInclusion],
  );
  const setIncludeTabGroups = useCallback(
    (value: boolean) => updateExportInclusion({ includeTabGroups: value }),
    [updateExportInclusion],
  );
  const setIncludeColorTags = useCallback(
    (value: boolean) => updateExportInclusion({ includeColorTags: value }),
    [updateExportInclusion],
  );

  const requestPassword = (opts: {
    title: string;
    description: string;
    error?: string;
  }): Promise<string | null> => {
    // Cancel any in-flight prompt before queuing a new one.
    if (pendingPasswordResolverRef.current) {
      pendingPasswordResolverRef.current(null);
      pendingPasswordResolverRef.current = null;
    }
    setPasswordPrompt(opts);
    return new Promise<string | null>((resolve) => {
      pendingPasswordResolverRef.current = resolve;
    });
  };

  const submitPasswordPrompt = (value: string) => {
    const resolve = pendingPasswordResolverRef.current;
    pendingPasswordResolverRef.current = null;
    setPasswordPrompt(null);
    resolve?.(value);
  };

  const cancelPasswordPrompt = () => {
    const resolve = pendingPasswordResolverRef.current;
    pendingPasswordResolverRef.current = null;
    setPasswordPrompt(null);
    resolve?.(null);
  };

  const refreshExportDatabaseOptions = useCallback(async () => {
    const managerWithExportability = databaseManager as DatabaseManager & {
      getExportableDatabases?: () => ReturnType<
        DatabaseManager["getExportableDatabases"]
      >;
    };
    const currentDatabase = databaseManager.getCurrentDatabase();
    const exportableDatabases = managerWithExportability.getExportableDatabases
      ? await managerWithExportability.getExportableDatabases()
      : currentDatabase
        ? [
            {
              ...currentDatabase,
              isCurrent: true,
              isUnlocked: true,
              isExportable: true,
            },
          ]
        : [];
    const options: ExportDatabaseOption[] = exportableDatabases.map(
      (database) => ({
        id: database.id,
        name: database.name,
        description: database.description,
        isCurrent: database.id === currentDatabase?.id || database.isCurrent,
        isEncrypted: database.isEncrypted,
        isUnlocked: database.isUnlocked,
        isExportable: database.isExportable,
        lockedReason: database.lockedReason,
        connectionCount:
          database.id === currentDatabase?.id
            ? state.connections.length
            : undefined,
        lastAccessed: database.lastAccessed,
      }),
    );

    setExportDatabaseOptions(options);
    setSelectedExportDatabaseIds((currentSelection) => {
      const exportableIds = new Set(
        options
          .filter((option) => option.isExportable)
          .map((option) => option.id),
      );
      const retainedSelection = currentSelection.filter((id) =>
        exportableIds.has(id),
      );
      if (retainedSelection.length > 0) {
        return retainedSelection;
      }

      const currentOption = options.find(
        (option) => option.isCurrent && option.isExportable,
      );
      return currentOption ? [currentOption.id] : [];
    });
  }, [databaseManager, state.connections.length]);

  const refreshImportDatabaseOptions = useCallback(async () => {
    const managerWithExportability = databaseManager as DatabaseManager & {
      getExportableDatabases?: () => ReturnType<
        DatabaseManager["getExportableDatabases"]
      >;
    };
    const currentDatabase = databaseManager.getCurrentDatabase();
    const databases = managerWithExportability.getExportableDatabases
      ? await managerWithExportability.getExportableDatabases()
      : currentDatabase
        ? [
            {
              ...currentDatabase,
              isCurrent: true,
              isUnlocked: true,
              isExportable: true,
            },
          ]
        : [];

    const options: ExportDatabaseOption[] = databases.map((database) => ({
      id: database.id,
      name: database.name,
      description: database.description,
      isCurrent: database.id === currentDatabase?.id || database.isCurrent,
      isEncrypted: database.isEncrypted,
      isUnlocked: database.isUnlocked,
      isExportable: database.isExportable,
      lockedReason: database.isExportable
        ? undefined
        : "Unlock this database before importing.",
      connectionCount:
        database.id === currentDatabase?.id
          ? state.connections.length
          : undefined,
      lastAccessed: database.lastAccessed,
    }));

    setImportDatabaseOptions(options);
    setSelectedImportDatabaseId((currentSelection) => {
      const nextSelection = chooseImportTargetDatabaseId(
        options,
        currentSelection,
        importTargetModeRef.current,
      );
      selectedImportDatabaseIdRef.current = nextSelection;
      return nextSelection;
    });
  }, [databaseManager, state.connections.length]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const refreshCloneDatabaseOptions = useCallback(async () => {
    // Clone consumes the same per-database option shape as Import /
    // Export, just with both sides (source + target) drawing from one
    // list. Encryption-locked databases land in the list as
    // non-exportable so the UI can still show them with an "unlock
    // to use" affordance.
    const managerWithExportability = databaseManager as DatabaseManager & {
      getExportableDatabases?: () => ReturnType<
        DatabaseManager["getExportableDatabases"]
      >;
    };
    const currentDatabase = databaseManager.getCurrentDatabase();
    const databases = managerWithExportability.getExportableDatabases
      ? await managerWithExportability.getExportableDatabases()
      : currentDatabase
        ? [
            {
              ...currentDatabase,
              isCurrent: true,
              isUnlocked: true,
              isExportable: true,
            },
          ]
        : [];

    const options: ExportDatabaseOption[] = databases.map((database) => ({
      id: database.id,
      name: database.name,
      description: database.description,
      isCurrent: database.id === currentDatabase?.id || database.isCurrent,
      isEncrypted: database.isEncrypted,
      isUnlocked: database.isUnlocked,
      isExportable: database.isExportable,
      lockedReason: database.isExportable
        ? undefined
        : "Unlock this database before cloning to or from it.",
      connectionCount:
        database.id === currentDatabase?.id
          ? state.connections.length
          : undefined,
      lastAccessed: database.lastAccessed,
    }));

    setCloneDatabaseOptions(options);
  }, [databaseManager, state.connections.length]);

  const getEffectiveCloneSourceIds = useCallback(
    (
      options: ExportDatabaseOption[] = cloneDatabaseOptions,
      mode: ExportScopeMode = cloneSourceMode,
    ): string[] => {
      const exportableIds = new Set(
        options
          .filter((option) => option.isExportable)
          .map((option) => option.id),
      );
      if (mode === "current") {
        const current = options.find(
          (option) => option.isCurrent && option.isExportable,
        );
        return current ? [current.id] : [];
      }
      if (mode === "all") {
        return Array.from(exportableIds);
      }
      return selectedCloneSourceDatabaseIds.filter((id) =>
        exportableIds.has(id),
      );
    },
    [cloneDatabaseOptions, cloneSourceMode, selectedCloneSourceDatabaseIds],
  );

  const buildCloneSourceCatalog = useCallback(
    async (sourceIds: string[]): Promise<CloneSourceCatalogItem[]> => {
      const currentDatabase = databaseManager.getCurrentDatabase();
      const optionsById = new Map(
        cloneDatabaseOptions.map((option) => [option.id, option]),
      );
      const catalog: CloneSourceCatalogItem[] = [];

      for (const databaseId of sourceIds) {
        const option = optionsById.get(databaseId);
        const databaseName = option?.name ?? databaseId;
        let sourceConnections: Connection[] = [];

        if (databaseId === currentDatabase?.id) {
          sourceConnections = currentConnectionsRef.current;
        } else {
          try {
            const snapshot =
              await databaseManager.readExportableDatabaseSnapshot(databaseId);
            sourceConnections = snapshot?.connections ?? [];
          } catch (e) {
            console.warn(
              `[clone] Failed to read snapshot of source database ${databaseId}:`,
              e,
            );
          }
        }

        const byId = new Map(
          sourceConnections.map((connection) => [connection.id, connection]),
        );
        sourceConnections.forEach((connection) => {
          const ancestorKeys = getAncestorFolderIds(connection, byId).map(
            (ancestorId) => `${databaseId}:${ancestorId}`,
          );
          catalog.push({
            key: `${databaseId}:${connection.id}`,
            sourceDatabaseId: databaseId,
            sourceDatabaseName: databaseName,
            connectionId: connection.id,
            name: safeString(connection.name) || "Unnamed item",
            path: getConnectionPath(connection, byId),
            protocol: connection.protocol,
            protocolLabel: formatPortableProtocolLabel(connection),
            hostname: connection.hostname,
            tags: safeTags(connection.tags),
            colorTag: connection.colorTag,
            isGroup: Boolean(connection.isGroup),
            parentId: connection.parentId,
            ancestorKeys,
          });
        });
      }

      return catalog;
    },
    [cloneDatabaseOptions, databaseManager],
  );

  const refreshCloneSourceCatalog = useCallback(async () => {
    const sourceIds = getEffectiveCloneSourceIds();
    if (sourceIds.length === 0) {
      setCloneSourceCatalog([]);
      return;
    }

    setIsCloneSourceCatalogLoading(true);
    try {
      const catalog = await buildCloneSourceCatalog(sourceIds);
      setCloneSourceCatalog(catalog);
    } finally {
      setIsCloneSourceCatalogLoading(false);
    }
  }, [buildCloneSourceCatalog, getEffectiveCloneSourceIds]);

  /**
   * Drive an inline unlock for an encrypted database from any of the
   * three pickers (Export selected, Import target, Clone source /
   * target). Loops the password prompt on `InvalidPasswordError`
   * until the user cancels or enters the right password. On success
   * the three option lists are re-fetched so every picker that was
   * showing this row as locked instantly flips it to exportable.
   *
   * Returns `true` on success, `false` if the user cancelled (or the
   * database wasn't found, or it isn't actually encrypted — those
   * are no-ops from the UI's perspective).
   */
  const handleUnlockDatabase = useCallback(
    async (databaseId: string): Promise<boolean> => {
      // All three pickers draw from the same `getExportableDatabases()`
      // output so any list works for the name/encryption lookup.
      const option = [
        ...exportDatabaseOptions,
        ...importDatabaseOptions,
        ...cloneDatabaseOptions,
      ].find((entry) => entry.id === databaseId);
      if (!option) {
        return false;
      }
      if (!option.isEncrypted) {
        // Nothing to unlock — bail with a refresh just in case the
        // exportability flag was stale.
        await Promise.all([
          refreshExportDatabaseOptions(),
          refreshImportDatabaseOptions(),
          refreshCloneDatabaseOptions(),
        ]);
        return true;
      }

      // Loop until the user enters the right password or cancels.
      let attemptError: string | undefined;
      while (true) {
        const password = await requestPassword({
          title: `Unlock "${option.name}"`,
          description:
            "Enter the password for this encrypted database. The unlock lasts for this session only.",
          error: attemptError,
        });
        if (password === null) {
          return false;
        }
        try {
          await databaseManager.unlockDatabase(databaseId, password);
          break;
        } catch (e) {
          // InvalidPasswordError carries `Invalid password` / similar
          // — surface to the user and re-prompt. Any other error
          // (e.g. corrupted data) is fatal: stop the loop and toast.
          const message = e instanceof Error ? e.message : String(e);
          if (e instanceof Error && e.name === "InvalidPasswordError") {
            attemptError = "Wrong password — try again.";
            continue;
          }
          toast.error(`Failed to unlock "${option.name}": ${message}`);
          return false;
        }
      }

      // Refresh every picker that draws from the same source so the
      // newly-unlocked row flips state across the whole dialog.
      await Promise.all([
        refreshExportDatabaseOptions(),
        refreshImportDatabaseOptions(),
        refreshCloneDatabaseOptions(),
      ]);
      toast.success(`Unlocked "${option.name}".`);
      return true;
    },
    [
      exportDatabaseOptions,
      importDatabaseOptions,
      cloneDatabaseOptions,
      databaseManager,
      refreshExportDatabaseOptions,
      refreshImportDatabaseOptions,
      refreshCloneDatabaseOptions,
      toast,
    ],
  );

  useEffect(() => {
    if (!isOpen) return;
    void refreshExportDatabaseOptions();
    void refreshImportDatabaseOptions();
    void refreshCloneDatabaseOptions();
  }, [
    isOpen,
    refreshExportDatabaseOptions,
    refreshImportDatabaseOptions,
    refreshCloneDatabaseOptions,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshCloneSourceCatalog();
  }, [isOpen, refreshCloneSourceCatalog]);

  // ── Helpers ──────────────────────────────────────────────────

  const escapeXml = (str: string): string =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapeHtml = (str: string): string =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapeMarkdownCell = (str: string): string =>
    escapeHtml(str).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

  const buildExportSummary = (
    connections: Connection[],
  ): ExportInventorySummary => {
    const folders = connections.filter(
      (connection) => connection.isGroup,
    ).length;
    const leafConnections = connections.length - folders;
    const credentialConnections = connections.filter(
      connectionHasCredentials,
    ).length;
    const protocolCount = new Set(
      connections
        .filter((connection) => !connection.isGroup)
        .map((connection) => connection.protocol),
    ).size;
    return {
      totalItems: connections.length,
      folders,
      leafConnections,
      credentialConnections,
      protocolCount,
    };
  };

  const buildExportInventoryRows = (
    dataset: ExportDatabaseDataset,
  ): ExportInventoryRow[] => {
    const connectionsById = new Map(
      dataset.connections.map((connection) => [connection.id, connection]),
    );

    return dataset.connections.map((connection) => ({
      databaseId: dataset.databaseId,
      databaseName: dataset.databaseName,
      id: safeString(connection.id),
      name: safeString(connection.name),
      kind: connection.isGroup ? "Folder" : "Connection",
      protocol: connection.isGroup
        ? ""
        : formatPortableProtocolLabel(connection),
      hostname: safeString(connection.hostname),
      port: connection.isGroup ? "" : safeString(connection.port),
      username: safeString(connection.username),
      domain: safeString(connection.domain),
      description: safeString(connection.description),
      path: getConnectionPath(connection, connectionsById),
      parentId: safeString(connection.parentId),
      tags: (connection.tags || []).map((tag) => safeString(tag)).join("; "),
      hasCredentials: connectionHasCredentials(connection) ? "Yes" : "No",
      createdAt: safeString(connection.createdAt),
      updatedAt: safeString(connection.updatedAt),
    }));
  };

  const buildConnectionTree = (connections: Connection[]) => {
    const ids = new Set(connections.map((connection) => connection.id));
    const roots: Connection[] = [];
    const childrenByParent = new Map<string, Connection[]>();

    connections.forEach((connection) => {
      if (connection.parentId && ids.has(connection.parentId)) {
        const children = childrenByParent.get(connection.parentId) || [];
        children.push(connection);
        childrenByParent.set(connection.parentId, children);
      } else {
        roots.push(connection);
      }
    });

    return { roots, childrenByParent };
  };

  const mapToMRemoteNGProtocol = (protocol: Connection["protocol"]): string => {
    switch (protocol) {
      case "rdp":
        return "RDP";
      case "ssh":
      case "sftp":
      case "scp":
        return "SSH2";
      case "vnc":
        return "VNC";
      case "telnet":
        return "Telnet";
      case "rlogin":
        return "Rlogin";
      case "http":
        return "HTTP";
      case "https":
        return "HTTPS";
      case "winrm":
        return "PowerShell";
      default:
        return "RAW";
    }
  };

  const generateExportFilename = (format: string): string => {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const randomHex = Math.random().toString(16).substring(2, 8);
    return `sortofremoteng-exports-${datetime}-${randomHex}.${format}`;
  };

  const downloadFile = (
    content: string,
    filename: string,
    mimeType: string,
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  };

  const importPreviewItems =
    importResult?.previewItems ?? EMPTY_IMPORT_PREVIEW_ITEMS;
  const visiblePreviewItems = useMemo(
    () =>
      filterImportPreviewItems(
        importPreviewItems,
        importFilters,
        selectedPreviewIds,
      ),
    [importFilters, importPreviewItems, selectedPreviewIds],
  );
  const availableImportProtocols = useMemo(
    () =>
      Array.from(
        new Set(
          importPreviewItems
            .map((item) => item.protocol)
            .filter(Boolean) as Connection["protocol"][],
        ),
      ).sort(),
    [importPreviewItems],
  );
  const selectedImportCount = useMemo(
    () =>
      importPreviewItems.filter((item) => selectedPreviewIds.has(item.id))
        .length,
    [importPreviewItems, selectedPreviewIds],
  );

  const updateImportFilters = useCallback(
    (updates: Partial<ImportFilterState>) => {
      setImportFilters((current) => ({ ...current, ...updates }));
    },
    [],
  );

  const resetImportFilters = useCallback(() => {
    setImportFilters(DEFAULT_IMPORT_FILTERS);
  }, []);

  const updateImportOptions = useCallback((updates: Partial<ImportOptions>) => {
    setImportOptions((current) => ({ ...current, ...updates }));
  }, []);

  const togglePreviewSelection = useCallback((itemId: string) => {
    setSelectedPreviewIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const selectPreviewItems = useCallback((itemIds: string[]) => {
    setSelectedPreviewIds((current) => {
      const next = new Set(current);
      itemIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const deselectPreviewItems = useCallback((itemIds: string[]) => {
    setSelectedPreviewIds((current) => {
      const next = new Set(current);
      itemIds.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const selectAllVisiblePreviewItems = useCallback(() => {
    selectPreviewItems(
      visiblePreviewItems
        .filter((item) => item.importable)
        .map((item) => item.id),
    );
  }, [selectPreviewItems, visiblePreviewItems]);

  const deselectAllVisiblePreviewItems = useCallback(() => {
    deselectPreviewItems(visiblePreviewItems.map((item) => item.id));
  }, [deselectPreviewItems, visiblePreviewItems]);

  const selectAllImportablePreviewItems = useCallback(() => {
    setSelectedPreviewIds(
      new Set(
        importPreviewItems
          .filter((item) => item.importable)
          .map((item) => item.id),
      ),
    );
  }, [importPreviewItems]);

  // ── Export ───────────────────────────────────────────────────

  const getEffectiveExportDatabaseIds = useCallback(
    (
      options: ExportDatabaseOption[] = exportDatabaseOptions,
      mode: ExportScopeMode = exportScopeMode,
    ): string[] => {
      const exportableOptions = options.filter((option) => option.isExportable);
      if (mode === "current") {
        const currentOption = exportableOptions.find(
          (option) => option.isCurrent,
        );
        return currentOption ? [currentOption.id] : [];
      }

      if (mode === "all") {
        return exportableOptions.map((option) => option.id);
      }

      const exportableIds = new Set(
        exportableOptions.map((option) => option.id),
      );
      return selectedExportDatabaseIds.filter((id) => exportableIds.has(id));
    },
    [exportDatabaseOptions, exportScopeMode, selectedExportDatabaseIds],
  );

  const buildCurrentDatabaseDataset = (
    currentDatabase: ConnectionDatabase,
  ): ExportDatabaseDataset => {
    const rawSettings = settingsManager.getSettings?.();
    const settings = (rawSettings ?? {}) as unknown as Record<string, unknown>;
    const colorTags = (
      includeColorTags && rawSettings?.colorTags ? rawSettings.colorTags : {}
    ) as DatabaseExportSnapshot["colorTags"];
    return {
      databaseId: currentDatabase.id,
      databaseName: currentDatabase.name,
      databaseDescription: currentDatabase.description,
      isCurrent: true,
      isEncrypted: currentDatabase.isEncrypted,
      connections: prepareConnectionsForExport(
        state.connections,
        exportInclusion,
      ),
      settings: exportInclusion.includeSettings ? settings : {},
      tabGroups: includeTabGroups ? (state.tabGroups ?? []) : [],
      colorTags,
    };
  };

  const snapshotToDataset = (
    snapshot: DatabaseExportSnapshot,
  ): ExportDatabaseDataset => ({
    databaseId: snapshot.collection.id,
    databaseName: snapshot.collection.name,
    databaseDescription: snapshot.collection.description,
    isCurrent: false,
    isEncrypted: snapshot.collection.isEncrypted,
    connections: prepareConnectionsForExport(
      snapshot.connections,
      exportInclusion,
    ),
    settings: exportInclusion.includeSettings ? (snapshot.settings ?? {}) : {},
    tabGroups: includeTabGroups ? (snapshot.tabGroups ?? []) : [],
    colorTags: includeColorTags ? (snapshot.colorTags ?? {}) : {},
  });

  const buildExportDatasets = async (): Promise<ExportBuildResult> => {
    const currentDatabase = databaseManager.getCurrentDatabase();
    if (!currentDatabase) throw new Error("No collection selected");

    const exportableDatabases = await databaseManager.getExportableDatabases();
    const options: ExportDatabaseOption[] = exportableDatabases.map(
      (database) => ({
        id: database.id,
        name: database.name,
        description: database.description,
        isCurrent: database.id === currentDatabase.id || database.isCurrent,
        isEncrypted: database.isEncrypted,
        isUnlocked: database.isUnlocked,
        isExportable: database.isExportable,
        lockedReason: database.lockedReason,
        connectionCount:
          database.id === currentDatabase.id
            ? state.connections.length
            : undefined,
        lastAccessed: database.lastAccessed,
      }),
    );
    setExportDatabaseOptions(options);

    const selectedIds = getEffectiveExportDatabaseIds(options);
    if (selectedIds.length === 0) {
      return { datasets: [], options, effectiveDatabaseIds: [] };
    }

    const datasets: ExportDatabaseDataset[] = [];
    for (const databaseId of selectedIds) {
      if (databaseId === currentDatabase.id) {
        datasets.push(buildCurrentDatabaseDataset(currentDatabase));
        continue;
      }

      const snapshot = await databaseManager.readExportableDatabaseSnapshot(
        databaseId,
        exportInclusion.includeConnections &&
          exportInclusion.includeCredentials,
      );
      datasets.push(snapshotToDataset(snapshot));
    }

    return { datasets, options, effectiveDatabaseIds: selectedIds };
  };

  const loadSidecarsForInclusion = async (
    inclusion: ExportInclusionConfig,
    options?: {
      includeProxyCollectionsWhenAll?: boolean;
      includeCredentials?: boolean;
    },
  ): Promise<ExportSidecars> => {
    const sidecars: ExportSidecars = {};

    if (inclusion.includeVpnData) {
      const proxyMgr = ProxyOpenVPNManager.getInstance();
      const [vpnOpenVPN, vpnWireGuard, vpnTailscale, vpnZeroTier] =
        await Promise.allSettled([
          proxyMgr.listOpenVPNConnections(),
          proxyMgr.listWireGuardConnections(),
          proxyMgr.listTailscaleConnections(),
          proxyMgr.listZeroTierConnections(),
        ]);

      const includedVpnIds =
        (inclusion.includedVpnConnectionIds ?? []).length > 0
          ? new Set(inclusion.includedVpnConnectionIds)
          : null;
      const keepVpn = <T extends { id?: string | null }>(items: T[]): T[] =>
        includedVpnIds == null
          ? items
          : items.filter(
              (item) => item.id != null && includedVpnIds.has(item.id),
            );

      const selectedVpnConnections: ImportVpnData = {
        openvpn: keepVpn(
          vpnOpenVPN.status === "fulfilled" ? vpnOpenVPN.value : [],
        ),
        wireguard: keepVpn(
          vpnWireGuard.status === "fulfilled" ? vpnWireGuard.value : [],
        ),
        tailscale: keepVpn(
          vpnTailscale.status === "fulfilled" ? vpnTailscale.value : [],
        ),
        zerotier: keepVpn(
          vpnZeroTier.status === "fulfilled" ? vpnZeroTier.value : [],
        ),
      };
      const prepared = prepareVpnDataForTransfer(
        selectedVpnConnections,
        options?.includeCredentials ?? inclusion.includeCredentials,
      );
      sidecars.vpnConnections = prepared.data;
      sidecars.vpnWarnings = prepared.warnings;
    }

    if (inclusion.includeTunnelChains) {
      const includedChainIds =
        (inclusion.includedProxyChainIds ?? []).length > 0
          ? new Set(inclusion.includedProxyChainIds)
          : null;
      const allChains = proxyCollectionManager.getTunnelChains();
      sidecars.tunnelChainTemplates = includedChainIds
        ? allChains.filter((chain) => includedChainIds.has(chain.id))
        : allChains;
    }

    const includedProxyProfileIds =
      (inclusion.includedProxyProfileIds ?? []).length > 0
        ? new Set(inclusion.includedProxyProfileIds)
        : null;
    const includedProxyChainIds =
      (inclusion.includedProxyChainIds ?? []).length > 0
        ? new Set(inclusion.includedProxyChainIds)
        : null;
    if (
      inclusion.includeTunnelChains &&
      (includedProxyProfileIds ||
        includedProxyChainIds ||
        options?.includeProxyCollectionsWhenAll)
    ) {
      // Stash proxy collections in the sidecar payload so the exporter
      // picks them up alongside everything else.
      const allProfiles = proxyCollectionManager.getProfiles();
      const allChains = proxyCollectionManager.getChains();
      sidecars.proxyProfiles = includedProxyProfileIds
        ? allProfiles.filter((p) => includedProxyProfileIds.has(p.id))
        : allProfiles;
      sidecars.proxyChains = includedProxyChainIds
        ? allChains.filter((c) => includedProxyChainIds.has(c.id))
        : allChains;
    }

    return sidecars;
  };

  const loadExportSidecars = async (): Promise<ExportSidecars> =>
    loadSidecarsForInclusion(exportInclusion);

  const cloneSidecarsForConnections = async (
    connections: Connection[],
    inclusion: ExportInclusionConfig,
  ): Promise<CloneSidecarResult> => {
    const sidecars = await loadSidecarsForInclusion(inclusion, {
      includeProxyCollectionsWhenAll: true,
      includeCredentials: cloneIncludeCredentials,
    });
    const result: CloneSidecarResult = {
      connections,
      idMaps: {
        proxyProfileIds: new Map(),
        proxyChainIds: new Map(),
        tunnelChainIds: new Map(),
        vpnConnectionIds: new Map(),
      },
      counts: createEmptyCloneSidecarCounts(),
      errors: [],
      warnings: [...(sidecars.vpnWarnings ?? [])],
    };

    const references = collectConnectionSidecarReferences(connections);
    const profileById = new Map(
      (sidecars.proxyProfiles ?? []).map((profile) => [profile.id, profile]),
    );
    const proxyChainById = new Map(
      (sidecars.proxyChains ?? []).map((chain) => [chain.id, chain]),
    );
    const tunnelChainById = new Map(
      (sidecars.tunnelChainTemplates ?? []).map((chain) => [chain.id, chain]),
    );

    if (inclusion.includeTunnelChains) {
      references.proxyChainIds.forEach((id) => {
        const chain = proxyCollectionManager.getChain(id);
        if (chain) proxyChainById.set(id, chain);
      });
      references.tunnelChainIds.forEach((id) => {
        const chain = proxyCollectionManager.getTunnelChain(id);
        if (chain) tunnelChainById.set(id, chain);
      });
    }

    proxyChainById.forEach((chain) => {
      chain.layers.forEach((layer) => {
        if (layer.proxyProfileId && !profileById.has(layer.proxyProfileId)) {
          const profile = proxyCollectionManager.getProfile(
            layer.proxyProfileId,
          );
          if (profile) profileById.set(layer.proxyProfileId, profile);
        }
        if (layer.vpnProfileId)
          references.vpnConnectionIds.add(layer.vpnProfileId);
      });
    });
    tunnelChainById.forEach((chain) => {
      chain.layers.forEach((layer) => {
        const vpnProfileId = resolveTunnelLayerVpnProfileId(layer);
        if (vpnProfileId) references.vpnConnectionIds.add(vpnProfileId);
      });
    });

    const selectedVpnById = new Map<
      string,
      {
        type: keyof ImportVpnData;
        connection: ImportVpnData[keyof ImportVpnData][number];
      }
    >();
    const addVpnItems = <T extends ImportVpnData[keyof ImportVpnData][number]>(
      type: keyof ImportVpnData,
      items: T[] | undefined,
    ) => {
      (items ?? []).forEach((connection) => {
        if (connection.id)
          selectedVpnById.set(connection.id, { type, connection });
      });
    };
    addVpnItems("openvpn", sidecars.vpnConnections?.openvpn);
    addVpnItems("wireguard", sidecars.vpnConnections?.wireguard);
    addVpnItems("tailscale", sidecars.vpnConnections?.tailscale);
    addVpnItems("zerotier", sidecars.vpnConnections?.zerotier);

    const explicitVpnAllowlist =
      (inclusion.includedVpnConnectionIds ?? []).length > 0
        ? new Set(inclusion.includedVpnConnectionIds)
        : null;

    if (inclusion.includeVpnData) {
      const proxyMgr = ProxyOpenVPNManager.getInstance();
      const [openvpn, wireguard, tailscale, zerotier] =
        await Promise.allSettled([
          proxyMgr.listOpenVPNConnections(),
          proxyMgr.listWireGuardConnections(),
          proxyMgr.listTailscaleConnections(),
          proxyMgr.listZeroTierConnections(),
        ]);
      const addReferenced = <
        T extends ImportVpnData[keyof ImportVpnData][number],
      >(
        type: keyof ImportVpnData,
        response: PromiseSettledResult<T[]>,
      ) => {
        if (response.status !== "fulfilled") return;
        response.value.forEach((connection) => {
          if (
            connection.id &&
            references.vpnConnectionIds.has(connection.id) &&
            !selectedVpnById.has(connection.id)
          ) {
            if (
              explicitVpnAllowlist &&
              !explicitVpnAllowlist.has(connection.id)
            ) {
              result.warnings.push(
                `VPN profile "${connection.name}" (${connection.id}) was excluded by the explicit clone VPN selection; its associations and dependent chains were omitted.`,
              );
              return;
            }
            const prepared = prepareVpnConnectionForTransfer(
              type,
              connection,
              cloneIncludeCredentials,
            );
            result.warnings.push(...prepared.warnings);
            selectedVpnById.set(connection.id, {
              type,
              connection: prepared.connection,
            });
          }
        });
      };
      addReferenced("openvpn", openvpn);
      addReferenced("wireguard", wireguard);
      addReferenced("tailscale", tailscale);
      addReferenced("zerotier", zerotier);
    }

    for (const profile of profileById.values()) {
      try {
        const created = await proxyCollectionManager.createProfile(
          profile.name,
          { ...profile.config },
          {
            description: profile.description,
            tags: profile.tags ? [...profile.tags] : undefined,
            isDefault: false,
          },
        );
        result.idMaps.proxyProfileIds.set(profile.id, created.id);
        result.counts.proxyProfiles++;
      } catch (e) {
        result.errors.push(
          `Proxy profile "${profile.name}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const proxyMgr = ProxyOpenVPNManager.getInstance();
    for (const { type, connection } of selectedVpnById.values()) {
      if (!isVpnProfileExecutable(type, connection)) {
        result.warnings.push(
          `VPN profile "${connection.name}" was omitted because its credentials are unavailable. Recreate it with credentials before restoring associations.`,
        );
        continue;
      }
      try {
        let createdId: string;
        if (type === "openvpn") {
          const typed = connection as ImportVpnData["openvpn"][number];
          createdId = await proxyMgr.createOpenVPNConnection(
            typed.name,
            typed.config,
          );
        } else if (type === "wireguard") {
          const typed = connection as ImportVpnData["wireguard"][number];
          createdId = await proxyMgr.createWireGuardConnection(
            typed.name,
            typed.config,
          );
        } else if (type === "tailscale") {
          const typed = connection as ImportVpnData["tailscale"][number];
          createdId = await proxyMgr.createTailscaleConnection(
            typed.name,
            typed.config,
          );
        } else {
          const typed = connection as ImportVpnData["zerotier"][number];
          createdId = await proxyMgr.createZeroTierConnection(
            typed.name,
            typed.config,
          );
        }
        result.idMaps.vpnConnectionIds.set(connection.id, createdId);
        result.counts.vpnConnections++;
      } catch (e) {
        result.errors.push(
          `VPN connection "${connection.name}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    for (const chain of proxyChainById.values()) {
      try {
        const unresolvedVpnIds = Array.from(
          new Set(
            chain.layers
              .map((layer) => layer.vpnProfileId)
              .filter(
                (id): id is string =>
                  Boolean(id) &&
                  inclusion.includeVpnData &&
                  !result.idMaps.vpnConnectionIds.has(id as string),
              ),
          ),
        );
        if (unresolvedVpnIds.length > 0) {
          result.warnings.push(
            `Proxy chain "${chain.name}" was omitted because VPN profile(s) ${unresolvedVpnIds.join(", ")} were not cloned.`,
          );
          continue;
        }
        const remapped = remapProxyChain(
          chain,
          result.idMaps.proxyProfileIds,
          result.idMaps.vpnConnectionIds,
        );
        const created = await proxyCollectionManager.createChain(
          remapped.name,
          remapped.layers.map((layer) => ({ ...layer })),
          {
            description: remapped.description,
            tags: remapped.tags ? [...remapped.tags] : undefined,
          },
        );
        result.idMaps.proxyChainIds.set(chain.id, created.id);
        result.counts.proxyChains++;
      } catch (e) {
        result.errors.push(
          `Proxy chain "${chain.name}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    for (const chain of tunnelChainById.values()) {
      try {
        const unresolvedVpnIds = Array.from(
          new Set(
            chain.layers
              .map(resolveTunnelLayerVpnProfileId)
              .filter(
                (id): id is string =>
                  Boolean(id) &&
                  inclusion.includeVpnData &&
                  !result.idMaps.vpnConnectionIds.has(id as string),
              ),
          ),
        );
        if (unresolvedVpnIds.length > 0) {
          result.warnings.push(
            `Tunnel chain "${chain.name}" was omitted because VPN profile(s) ${unresolvedVpnIds.join(", ")} were not cloned.`,
          );
          continue;
        }
        const remapped = remapTunnelChain(
          chain,
          result.idMaps.vpnConnectionIds,
        );
        const created = await proxyCollectionManager.createTunnelChain(
          remapped.name,
          remapped.layers.map((layer) => ({ ...layer })),
          {
            description: remapped.description,
            tags: remapped.tags ? [...remapped.tags] : undefined,
          },
        );
        result.idMaps.tunnelChainIds.set(chain.id, created.id);
        result.counts.tunnelChains++;
      } catch (e) {
        result.errors.push(
          `Tunnel chain "${chain.name}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    result.counts.total =
      result.counts.proxyProfiles +
      result.counts.proxyChains +
      result.counts.tunnelChains +
      result.counts.vpnConnections;
    result.connections = connections.map((connection) =>
      remapConnectionSidecars(connection, result, {
        requireVpnMapping: inclusion.includeVpnData,
        requireProxyChainMapping: inclusion.includeTunnelChains,
        requireTunnelChainMapping: inclusion.includeTunnelChains,
      }),
    );
    result.warnings = Array.from(new Set(result.warnings));

    return result;
  };

  const buildDatabaseExportMetadata = (dataset: ExportDatabaseDataset) => ({
    collectionId: dataset.databaseId,
    name: dataset.databaseName,
    description: dataset.databaseDescription,
    isEncrypted: dataset.isEncrypted,
    wasCurrentAtExport: dataset.isCurrent,
    counts: buildExportSummary(dataset.connections),
  });

  const buildExportWarnings = (
    datasets: ExportDatabaseDataset[],
    options: ExportDatabaseOption[],
    sidecars: ExportSidecars,
  ): string[] => {
    const warnings: string[] = [...(sidecars.vpnWarnings ?? [])];
    const lockedSkippedCount = options.filter(
      (option) => option.isEncrypted && !option.isExportable,
    ).length;

    if (lockedSkippedCount > 0) {
      warnings.push(
        `${lockedSkippedCount} locked encrypted database(s) were skipped.`,
      );
    }
    if (!exportInclusion.includeConnections) {
      warnings.push(
        "Connections are excluded by the export inclusion settings.",
      );
    }
    if (
      exportInclusion.includeConnections &&
      !exportInclusion.includeCredentials
    ) {
      warnings.push("Credentials and private secret fields were redacted.");
    }
    if (exportInclusion.includeVpnData && !exportInclusion.includeCredentials) {
      warnings.push(
        "VPN profiles were exported as non-executable recovery records with credentials and credential paths removed; import and clone omit them and their dependent associations.",
      );
    }
    if (!exportInclusion.includeSettings) {
      warnings.push(
        "Database settings are excluded by the export inclusion settings.",
      );
    }
    if (!exportInclusion.includeFolderItems) {
      warnings.push(
        "Folder/group records are excluded and exported connections are moved to the root.",
      );
    } else if (!exportInclusion.includeEmptyFolders) {
      warnings.push("Empty folders/groups are excluded.");
    }
    if (exportInclusion.includedProtocols.length > 0) {
      warnings.push(
        `Protocol filter active: ${exportInclusion.includedProtocols.join(", ")}.`,
      );
    }
    if (!["json", "xml", "csv"].includes(exportFormat)) {
      warnings.push(
        "Selected non-JSON format is an inventory export and may not preserve every app-specific inclusion.",
      );
    }
    if (
      exportFormat === "mremoteng" &&
      datasets.some((dataset) =>
        dataset.connections.some(hasAdvancedProtocolSettings),
      )
    ) {
      warnings.push(
        "mRemoteNG cannot preserve every advanced Raw Socket, RLogin, or PowerShell Remoting setting; review the imported connections after transfer.",
      );
    }
    if (datasets.some((dataset) => !dataset.isCurrent)) {
      warnings.push(
        "Counts for non-current databases were calculated when the export ran.",
      );
    }

    return warnings;
  };

  const buildExportMetadata = (params: {
    datasets: ExportDatabaseDataset[];
    options: ExportDatabaseOption[];
    sidecars: ExportSidecars;
    warnings: string[];
    encrypted: boolean;
    keyDerivationIterations: number;
  }) => {
    const exportedAt = new Date().toISOString();
    const aggregateConnections = params.datasets.flatMap(
      (dataset) => dataset.connections,
    );
    const aggregateSummary = buildExportSummary(aggregateConnections);
    const protocols = Array.from(
      new Set(
        aggregateConnections
          .filter((connection) => !connection.isGroup)
          .map((connection) => connection.protocol),
      ),
    ).sort();
    const vpnDefinitions = params.sidecars.vpnConnections
      ? params.sidecars.vpnConnections.openvpn.length +
        params.sidecars.vpnConnections.wireguard.length +
        params.sidecars.vpnConnections.tailscale.length +
        params.sidecars.vpnConnections.zerotier.length
      : 0;
    const lockedSkippedCount = params.options.filter(
      (option) => option.isEncrypted && !option.isExportable,
    ).length;
    const timezone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    })();
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const clientId = getOrCreateExportClientId();
    const exportId = generateId();

    return {
      id: exportId,
      exportId,
      createdAt: exportedAt,
      exportedAt,
      app: {
        name: "sortOfRemoteNG",
        version: "0.0.0",
      },
      schema: {
        name:
          params.datasets.length > 1
            ? EXPORT_PACKAGE_SCHEMA
            : EXPORT_SINGLE_DATABASE_SCHEMA,
        version: EXPORT_PACKAGE_VERSION,
      },
      format: exportFormat,
      scope: {
        mode: exportScopeMode,
        requestedDatabaseIds:
          exportScopeMode === "selected"
            ? selectedExportDatabaseIds
            : undefined,
        effectiveDatabaseIds: params.datasets.map(
          (dataset) => dataset.databaseId,
        ),
        selectedDatabases: params.datasets.map((dataset) => ({
          id: dataset.databaseId,
          name: dataset.databaseName,
          wasCurrentAtExport: dataset.isCurrent,
        })),
        exportableDatabaseCount: params.options.filter(
          (option) => option.isExportable,
        ).length,
        lockedSkippedCount,
      },
      encrypted: params.encrypted,
      encryption: {
        encrypted: params.encrypted,
        keyDerivationIterations: params.encrypted
          ? params.keyDerivationIterations
          : undefined,
      },
      inclusion: exportInclusion,
      warnings: params.warnings,
      totals: {
        databases: params.datasets.length,
        totalItems: aggregateSummary.totalItems,
        connections: aggregateSummary.leafConnections,
        folders: aggregateSummary.folders,
        credentialConnections: aggregateSummary.credentialConnections,
        protocolCount: aggregateSummary.protocolCount,
        protocols,
        vpnDefinitions,
        tunnelChains: params.sidecars.tunnelChainTemplates?.length ?? 0,
        settingsObjects: exportInclusion.includeSettings
          ? params.datasets.length
          : 0,
      },
      sourceClient: {
        clientId,
        machineId: clientId,
        userAgent: nav?.userAgent,
        platform: nav?.platform,
        language: nav?.language,
        timezone,
      },
    };
  };

  const buildSingleDatabaseJsonPayload = (
    dataset: ExportDatabaseDataset,
    sidecars: ExportSidecars,
    exportMetadata?: ReturnType<typeof buildExportMetadata>,
  ) => ({
    collection: {
      id: dataset.databaseId,
      name: dataset.databaseName,
      description: dataset.databaseDescription,
      isEncrypted: dataset.isEncrypted,
      exportDate: new Date().toISOString(),
    },
    connections: dataset.connections,
    ...(exportInclusion.includeSettings ? { settings: dataset.settings } : {}),
    ...(includeTabGroups ? { tabGroups: dataset.tabGroups ?? [] } : {}),
    ...(includeColorTags ? { colorTags: dataset.colorTags ?? {} } : {}),
    ...(exportInclusion.includeDatabaseMetadata
      ? { databaseMetadata: buildDatabaseExportMetadata(dataset) }
      : {}),
    ...(exportMetadata ? { exportMetadata } : {}),
    ...(sidecars.vpnConnections
      ? { vpnConnections: sidecars.vpnConnections }
      : {}),
    ...(sidecars.tunnelChainTemplates
      ? { tunnelChainTemplates: sidecars.tunnelChainTemplates }
      : {}),
  });

  const buildMultiDatabaseJsonPackage = (
    datasets: ExportDatabaseDataset[],
    sidecars: ExportSidecars,
    exportMetadata?: ReturnType<typeof buildExportMetadata>,
  ) => ({
    schema: EXPORT_PACKAGE_SCHEMA,
    version: EXPORT_PACKAGE_VERSION,
    exportDate: new Date().toISOString(),
    ...(exportMetadata ? { exportMetadata } : {}),
    databases: datasets.map((dataset) => ({
      collection: {
        id: dataset.databaseId,
        name: dataset.databaseName,
        description: dataset.databaseDescription,
        isEncrypted: dataset.isEncrypted,
        wasCurrentAtExport: dataset.isCurrent,
      },
      connections: dataset.connections,
      ...(exportInclusion.includeSettings
        ? { settings: dataset.settings }
        : {}),
      ...(includeTabGroups ? { tabGroups: dataset.tabGroups ?? [] } : {}),
      ...(includeColorTags ? { colorTags: dataset.colorTags ?? {} } : {}),
      ...(exportInclusion.includeDatabaseMetadata
        ? { databaseMetadata: buildDatabaseExportMetadata(dataset) }
        : {}),
    })),
    ...(sidecars.vpnConnections
      ? { vpnConnections: sidecars.vpnConnections }
      : {}),
    ...(sidecars.tunnelChainTemplates
      ? { tunnelChainTemplates: sidecars.tunnelChainTemplates }
      : {}),
  });

  const exportToXML = (dataset: ExportDatabaseDataset): string =>
    serializeConnectionsToNativeXml(dataset.connections);

  const exportToCSV = (datasets: ExportDatabaseDataset[]): string =>
    serializeDatasetsToNativeCsv(datasets);

  const exportToText = (datasets: ExportDatabaseDataset[]): string => {
    const lines = [
      "sortOfRemoteNG connection inventory",
      `Generated: ${new Date().toISOString()}`,
      "",
      `Databases: ${datasets.length}`,
    ];

    const renderConnection = (
      connection: Connection,
      depth: number,
      childrenByParent: Map<string, Connection[]>,
      visited: Set<string>,
    ) => {
      if (visited.has(connection.id)) return;
      visited.add(connection.id);
      const indent = "  ".repeat(depth);
      const childIndent = `${indent}  `;
      lines.push(
        `${indent}- [${connection.isGroup ? "Folder" : "Connection"}] ${safeString(connection.name) || "Unnamed item"}`,
      );
      if (!connection.isGroup) {
        lines.push(
          `${childIndent}Protocol: ${formatPortableProtocolLabel(connection)}`,
        );
        lines.push(
          `${childIndent}Host: ${safeString(connection.hostname)}${connection.port ? `:${connection.port}` : ""}`,
        );
        if (connection.username)
          lines.push(
            `${childIndent}Username: ${safeString(connection.username)}`,
          );
        if (connection.domain)
          lines.push(`${childIndent}Domain: ${safeString(connection.domain)}`);
        if (connectionHasCredentials(connection))
          lines.push(`${childIndent}Credentials: present (not included)`);
      }
      if (connection.tags?.length)
        lines.push(
          `${childIndent}Tags: ${connection.tags.map((tag) => safeString(tag)).join(", ")}`,
        );
      if (connection.description)
        lines.push(
          `${childIndent}Description: ${safeString(connection.description)}`,
        );
      (childrenByParent.get(connection.id) || []).forEach((child) =>
        renderConnection(child, depth + 1, childrenByParent, visited),
      );
    };

    datasets.forEach((dataset, index) => {
      const summary = buildExportSummary(dataset.connections);
      const { roots, childrenByParent } = buildConnectionTree(
        dataset.connections,
      );
      const visited = new Set<string>();
      if (index > 0) lines.push("");
      lines.push(`Database: ${dataset.databaseName}`);
      lines.push(`Database ID: ${dataset.databaseId}`);
      lines.push(`Total items: ${summary.totalItems}`);
      lines.push(`Folders/groups: ${summary.folders}`);
      lines.push(`Leaf connections: ${summary.leafConnections}`);
      lines.push(
        `Credential-bearing connections: ${summary.credentialConnections}`,
      );
      lines.push(`Protocols: ${summary.protocolCount}`);
      lines.push("");
      lines.push("Inventory");
      roots.forEach((connection) =>
        renderConnection(connection, 0, childrenByParent, visited),
      );
    });

    return `${lines.join("\n")}\n`;
  };

  const exportToMarkdown = (datasets: ExportDatabaseDataset[]): string => {
    const includeDatabaseColumns = datasets.length > 1;
    const columns = getExportInventoryColumns(includeDatabaseColumns);
    const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
    const separator = `| ${columns.map(() => "---").join(" | ")} |`;
    const lines = [
      "# sortOfRemoteNG Connection Inventory",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      `- Databases: ${datasets.length}`,
    ];

    datasets.forEach((dataset) => {
      const summary = buildExportSummary(dataset.connections);
      const rows = buildExportInventoryRows(dataset);
      const tableRows = rows.map(
        (row) =>
          `| ${columns.map((column) => escapeMarkdownCell(row[column.key])).join(" | ")} |`,
      );

      lines.push(
        "",
        `## Database: ${dataset.databaseName}`,
        "",
        `- Database ID: ${dataset.databaseId}`,
        `- Total items: ${summary.totalItems}`,
        `- Folders/groups: ${summary.folders}`,
        `- Leaf connections: ${summary.leafConnections}`,
        `- Credential-bearing connections: ${summary.credentialConnections}`,
        `- Protocols: ${summary.protocolCount}`,
        "",
        header,
        separator,
        ...tableRows,
      );
    });

    return `${lines.join("\n")}\n`;
  };

  const buildHtmlTableDocument = (
    title: string,
    datasets: ExportDatabaseDataset[],
    excelCompatible = false,
  ): string => {
    const includeDatabaseColumns = datasets.length > 1;
    const columns = getExportInventoryColumns(includeDatabaseColumns);
    const rows = datasets.flatMap(buildExportInventoryRows);
    const aggregateConnections = datasets.flatMap(
      (dataset) => dataset.connections,
    );
    const summary = buildExportSummary(aggregateConnections);
    const htmlAttrs = excelCompatible
      ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"'
      : "";
    const generatedAt = new Date().toISOString();
    const summaryRows = [
      ["Databases", datasets.length],
      ["Total items", summary.totalItems],
      ["Folders/groups", summary.folders],
      ["Leaf connections", summary.leafConnections],
      ["Credential-bearing connections", summary.credentialConnections],
      ["Protocols", summary.protocolCount],
    ];
    const tableHeader = columns
      .map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`)
      .join("");
    const tableRows = rows
      .map(
        (row) =>
          `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}</tr>`,
      )
      .join("\n");

    return `<!DOCTYPE html>
<html${htmlAttrs}>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    .meta { color: #4b5563; font-size: 12px; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #e5eef8; font-weight: 700; }
    .summary { margin: 0 0 16px; }
    .summary th { width: 220px; background: #f3f4f6; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated ${escapeHtml(generatedAt)}</p>
  <table class="summary" aria-label="Export summary">
    <tbody>
      ${summaryRows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(String(label))}</th><td>${escapeHtml(String(value))}</td></tr>`).join("\n      ")}
    </tbody>
  </table>
  <table aria-label="Connection inventory">
    <thead><tr>${tableHeader}</tr></thead>
    <tbody>
${tableRows}
    </tbody>
  </table>
</body>
</html>`;
  };

  const exportToMRemoteNG = (dataset: ExportDatabaseDataset): string => {
    const { roots, childrenByParent } = buildConnectionTree(
      dataset.connections,
    );
    const visited = new Set<string>();
    const renderNode = (connection: Connection, depth: number): string => {
      if (visited.has(connection.id)) return "";
      visited.add(connection.id);
      const indent = "  ".repeat(depth);
      const children = childrenByParent.get(connection.id) || [];
      const attributes = connection.isGroup
        ? [
            `Name="${escapeXml(safeString(connection.name) || "Unnamed folder")}"`,
            'Type="Container"',
            `Descr="${escapeXml(safeString(connection.description))}"`,
            `Expanded="${connection.expanded === false ? "False" : "True"}"`,
            `Id="${escapeXml(safeString(connection.id))}"`,
          ]
        : [
            `Name="${escapeXml(safeString(connection.name) || "Unnamed connection")}"`,
            'Type="Connection"',
            `Descr="${escapeXml(safeString(connection.description))}"`,
            `Protocol="${mapToMRemoteNGProtocol(connection.protocol)}"`,
            `Hostname="${escapeXml(safeString(connection.hostname))}"`,
            `Port="${escapeXml(safeString(connection.port))}"`,
            `Username="${escapeXml(safeString(connection.username))}"`,
            `Domain="${escapeXml(safeString(connection.domain))}"`,
            'Password=""',
            'Panel="General"',
            `Id="${escapeXml(safeString(connection.id))}"`,
          ];

      if (children.length === 0) {
        return `${indent}<Node ${attributes.join(" ")} />`;
      }

      const childXml = children
        .map((child) => renderNode(child, depth + 1))
        .filter(Boolean)
        .join("\n");
      return `${indent}<Node ${attributes.join(" ")}>\n${childXml}\n${indent}</Node>`;
    };

    const nodes = roots
      .map((connection) => renderNode(connection, 1))
      .filter(Boolean)
      .join("\n");

    return `<?xml version="1.0" encoding="utf-8"?>\n<Connections Name="Connections" Export="False" Protected="" ConfVersion="2.6">\n${nodes}\n</Connections>`;
  };

  const handleExport = async () => {
    setIsProcessing(true);
    try {
      let content: string;
      let filename: string;
      let mimeType: string;
      const shouldUsePasswordEncryption =
        exportEncrypted && Boolean(exportPassword);
      const normalizedExportIterations = normalizePbkdf2Iterations(
        exportKeyDerivationIterations,
      );

      if (
        shouldUsePasswordEncryption &&
        exportSecuritySettings.enforceMinimumPasswordScore
      ) {
        const strength = analyzePasswordStrength(exportPassword, {
          detectCommonPasswords: exportSecuritySettings.detectCommonPasswords,
          detectRepeatedCharacters:
            exportSecuritySettings.detectRepeatedCharacters,
          detectSequentialPatterns:
            exportSecuritySettings.detectSequentialPatterns,
          rewardUncommonSymbols: exportSecuritySettings.rewardUncommonSymbols,
          customCommonPasswords: exportSecuritySettings.customCommonPasswords,
        });
        if (strength.score < exportSecuritySettings.minimumPasswordScore) {
          toast.error(
            `Export password is too weak. Minimum required strength is ${exportSecuritySettings.minimumPasswordScore}/4.`,
          );
          return;
        }
      }

      const exportBuild = await buildExportDatasets();
      const { datasets, options } = exportBuild;
      if (datasets.length === 0) {
        toast.error(
          "No exportable databases are selected. Unlock encrypted databases or choose a different scope.",
        );
        return;
      }

      if (
        datasets.length > 1 &&
        (exportFormat === "xml" || exportFormat === "mremoteng")
      ) {
        toast.error(
          "XML and mRemoteNG exports support one database at a time. Choose JSON or an inventory format for a database package.",
        );
        return;
      }

      switch (exportFormat) {
        case "json": {
          const sidecars = await loadExportSidecars();
          const exportedVpnCount = sidecars.vpnConnections
            ? sidecars.vpnConnections.openvpn.length +
              sidecars.vpnConnections.wireguard.length +
              sidecars.vpnConnections.tailscale.length +
              sidecars.vpnConnections.zerotier.length
            : 0;
          if (
            exportedVpnCount > 0 &&
            exportInclusion.includeCredentials &&
            !shouldUsePasswordEncryption
          ) {
            toast.error(
              "VPN credentials can only be exported in an encrypted JSON file. Enable encryption, enter a password, or exclude credentials.",
            );
            return;
          }
          const warnings = buildExportWarnings(datasets, options, sidecars);
          const exportMetadata = exportInclusion.includeExportMetadata
            ? buildExportMetadata({
                datasets,
                options,
                sidecars,
                warnings,
                encrypted: shouldUsePasswordEncryption,
                keyDerivationIterations: normalizedExportIterations,
              })
            : undefined;
          const payload =
            datasets.length === 1
              ? buildSingleDatabaseJsonPayload(
                  datasets[0],
                  sidecars,
                  exportMetadata,
                )
              : buildMultiDatabaseJsonPackage(
                  datasets,
                  sidecars,
                  exportMetadata,
                );
          content = JSON.stringify(payload, null, 2);

          filename = generateExportFilename("json");
          mimeType = "application/json";
          break;
        }
        case "xml":
          content = exportToXML(datasets[0]);
          filename = generateExportFilename("xml");
          mimeType = "application/xml";
          break;
        case "csv":
          content = exportToCSV(datasets);
          filename = generateExportFilename("csv");
          mimeType = "text/csv";
          break;
        case "txt":
          content = exportToText(datasets);
          filename = generateExportFilename("txt");
          mimeType = "text/plain";
          break;
        case "markdown":
          content = exportToMarkdown(datasets);
          filename = generateExportFilename("md");
          mimeType = "text/markdown";
          break;
        case "html":
          content = buildHtmlTableDocument(
            datasets.length > 1
              ? "sortOfRemoteNG Database Package Inventory"
              : "sortOfRemoteNG Connection Inventory",
            datasets,
          );
          filename = generateExportFilename("html");
          mimeType = "text/html";
          break;
        case "excel":
          content = buildHtmlTableDocument(
            datasets.length > 1
              ? "sortOfRemoteNG Database Package Inventory"
              : "sortOfRemoteNG Connection Inventory",
            datasets,
            true,
          );
          filename = generateExportFilename("xls");
          mimeType = "application/vnd.ms-excel";
          break;
        case "mremoteng":
          content = exportToMRemoteNG(datasets[0]);
          filename = generateExportFilename("mremoteng.xml");
          mimeType = "application/xml";
          break;
        default:
          throw new Error("Unsupported export format");
      }

      if (shouldUsePasswordEncryption) {
        const payloadBytes = new TextEncoder().encode(content);
        const result = await encryptExport(exportFormat as ExportFormat, {
          payload: payloadBytes,
          payloadString: content,
          password: exportPassword,
          iterations: normalizedExportIterations,
        });
        // The dispatcher may swap mime / extension when it falls back
        // (e.g. OOXML missing → AES-GCM JSON envelope) or finalize the
        // native filename (e.g. mRemoteNG returns the XML envelope).
        if (result.mimeType) mimeType = result.mimeType;
        if (result.extension) {
          filename = filename.replace(/\.[^.]+$/, "") + result.extension;
        } else {
          filename = filename.replace(/\.[^.]+$/, ".encrypted$&");
        }
        if (result.warning || result.warningKey) {
          const translated = result.warningKey
            ? (t(result.warningKey, {
                defaultValue: result.warning ?? "",
              }) as string)
            : (result.warning as string);
          if (translated) toast.warning(translated);
        }
        const encryptedBlob = new Blob([result.bytes as unknown as BlobPart], {
          type: mimeType,
        });
        const url = URL.createObjectURL(encryptedBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(`Exported successfully: ${filename}`);
        settingsManager.logAction(
          "info",
          "Data exported",
          undefined,
          `Exported ${datasets.reduce((count, dataset) => count + dataset.connections.length, 0)} connections from ${datasets.length} database(s) to ${exportFormat.toUpperCase()} (encrypted, ${normalizedExportIterations} PBKDF2 iterations) [scheme=${result.scheme}]`,
        );
        setIsProcessing(false);
        return;
      }

      downloadFile(content, filename, mimeType);
      toast.success(`Exported successfully: ${filename}`);
      settingsManager.logAction(
        "info",
        "Data exported",
        undefined,
        `Exported ${datasets.reduce((count, dataset) => count + dataset.connections.length, 0)} connections from ${datasets.length} database(s) to ${exportFormat.toUpperCase()}${shouldUsePasswordEncryption ? ` (encrypted, ${normalizedExportIterations} PBKDF2 iterations)` : ""}`,
      );
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Export failed. Check the console for details.");
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Import ───────────────────────────────────────────────────

  const getImportTargetDatabases = (
    mode: ImportTargetMode = importTargetModeRef.current,
    selectedDatabaseId: string = selectedImportDatabaseIdRef.current,
  ): ExportDatabaseOption[] => {
    const exportableOptions = importDatabaseOptions.filter(
      (option) => option.isExportable,
    );
    const currentOption = exportableOptions.find((option) => option.isCurrent);
    const selectedOption = exportableOptions.find(
      (option) => option.id === selectedDatabaseId,
    );
    if (mode === "current") {
      if (selectedOption && !selectedOption.isCurrent) {
        return [selectedOption];
      }
      return currentOption ? [currentOption] : exportableOptions.slice(0, 1);
    }
    if (mode === "all") {
      return exportableOptions;
    }
    return selectedOption ? [selectedOption] : [];
  };

  const loadImportTargetConnections = async (
    mode: ImportTargetMode = importTargetModeRef.current,
    targetDatabaseId: string = selectedImportDatabaseIdRef.current,
  ): Promise<Connection[]> => {
    const currentDatabase = databaseManager.getCurrentDatabase();
    const targets = getImportTargetDatabases(mode, targetDatabaseId);
    if (targets.length === 0) {
      return mode === "current" ? state.connections : [];
    }

    const targetConnections = await Promise.all(
      targets.map(async (target) => {
        if (target.id === currentDatabase?.id) {
          return state.connections;
        }
        const snapshot = await databaseManager.readExportableDatabaseSnapshot(
          target.id,
          true,
        );
        return snapshot.connections ?? [];
      }),
    );

    return targetConnections.flat();
  };

  const processImportFile = async (
    filename: string,
    content: string,
    sizeBytes?: number,
    formatSelection: "auto" | ImportFormat = importFormatSelection,
    targetMode: ImportTargetMode = importTargetModeRef.current,
    targetDatabaseId: string = selectedImportDatabaseIdRef.current,
  ): Promise<ImportResult> => {
    const errors: string[] = [];
    try {
      let processedContent = content;
      const isAesCbc = isAesCbcEnvelope(processedContent);
      const isMremoteng = isMremotengEncryptedXml(processedContent);
      const encryptedWrapper =
        filename.includes(".encrypted.") ||
        filename.split(".").pop()?.toLowerCase() === "encrypted" ||
        isWebCryptoPayload(processedContent) ||
        isAesCbc ||
        isMremoteng;
      if (encryptedWrapper) {
        const password = await requestPassword({
          title: "Decrypt import file",
          description:
            "This file is encrypted. Enter the password used during export to decrypt it.",
        });
        if (!password) throw new Error("Password required for encrypted file");
        let decrypted: string | null = null;
        // Track the most informative failure across all attempted decoders
        // so the final error message can pick a targeted category.
        const failureKinds: DecryptErrorKind[] = [];
        const recordFailure = (e: unknown) => {
          if (e instanceof DecryptError) {
            failureKinds.push(e.kind);
          } else {
            // Native Web Crypto / unknown JS errors — most often surface as
            // OperationError on wrong key. Treat as wrong-password by
            // default; the corrupted/unsupported buckets are reserved for
            // cases we can detect structurally.
            failureKinds.push("wrong-password");
          }
        };
        // Try the AES-CBC text envelope first when the content matches.
        if (!decrypted && isAesCbc) {
          try {
            const bytes = await decryptAesCbcEnvelope(
              processedContent,
              password,
            );
            decrypted = new TextDecoder().decode(bytes);
          } catch (e) {
            recordFailure(e);
          }
        }
        // Try the mRemoteNG-native scheme via Tauri IPC.
        if (!decrypted && isMremoteng) {
          try {
            decrypted = await decryptMremotengDocument(
              processedContent,
              password,
            );
          } catch (e) {
            recordFailure(e);
          }
        }
        // Try WebCrypto export envelopes next, then legacy salt.iv.ciphertext.
        if (!decrypted && isWebCryptoPayload(processedContent)) {
          try {
            decrypted = await decryptWithPassword(processedContent, password);
          } catch (e) {
            recordFailure(e);
          }
        }
        // Fallback: legacy CryptoJS-format ciphertext decrypted via Rust backend.
        if (!decrypted) {
          const invoke = await getInvoke();
          if (invoke) {
            try {
              decrypted = (await invoke("crypto_legacy_decrypt_cryptojs", {
                ciphertext: processedContent,
                password,
              })) as string;
            } catch (e) {
              recordFailure(e);
            }
          } else if (failureKinds.length === 0) {
            // No detector matched and no legacy backend available —
            // we have nothing to try.
            failureKinds.push("unsupported");
          }
        }
        if (!decrypted) {
          // Pick the most actionable category. Priority order:
          //   corrupted > unsupported > wrong-password > unknown
          // because "corrupted" / "unsupported" tell the user the file
          // itself is the problem, while "wrong-password" hints at a
          // recoverable user action.
          const pickKind = (): DecryptErrorKind => {
            if (failureKinds.includes("corrupted")) return "corrupted";
            if (failureKinds.includes("unsupported")) return "unsupported";
            if (failureKinds.includes("wrong-password"))
              return "wrong-password";
            // No decoder threw but none produced plaintext either — a
            // decoder must have silently returned a falsy value. Mirror
            // the legacy "wrong password" framing since that's the most
            // recoverable user action.
            return "wrong-password";
          };
          const kind = pickKind();
          const message = t(DECRYPT_ERROR_I18N_KEYS[kind], {
            defaultValue: DECRYPT_ERROR_DEFAULT_MESSAGES[kind],
          });
          throw new DecryptError(kind, message);
        }
        processedContent = decrypted;
      }

      const autoDetectedFormat = detectImportFormat(processedContent, filename);
      const detectedFormat =
        formatSelection === "auto" ? autoDetectedFormat : formatSelection;
      const detectedFormatName = getFormatName(detectedFormat);
      const autoDetectedFormatName = getFormatName(autoDetectedFormat);
      const formatForced = formatSelection !== "auto";
      const forcedFormatCompatibility =
        getImportFormatCompatibility(detectedFormat);
      const formatWarning = [
        formatForced && detectedFormat !== autoDetectedFormat
          ? `Forced ${detectedFormatName}; auto-detect suggested ${autoDetectedFormatName}.`
          : "",
        forcedFormatCompatibility.warning ?? "",
      ]
        .filter(Boolean)
        .join(" ");
      let encryptionAnalysis: ImportSourceMetadata["encryption"] | undefined =
        encryptedWrapper
          ? {
              protected: true,
              fullFileEncryption: false,
              requiresPassword: true,
            }
          : undefined;
      let vpnConnections: ImportVpnData | undefined;
      let tunnelChainTemplates: ImportResult["tunnelChainTemplates"];
      if (detectedFormat === "json") {
        try {
          const parsed = JSON.parse(processedContent);
          const legacySidecars =
            parsed && typeof parsed.sidecars === "object"
              ? parsed.sidecars
              : undefined;
          vpnConnections = normalizeVpnImportData(
            parsed.vpnConnections ??
              parsed.vpn_connections ??
              legacySidecars?.vpnConnections ??
              legacySidecars?.vpn_connections,
          );
          const importedTunnelChains =
            parsed.tunnelChainTemplates ??
            parsed.tunnel_chain_templates ??
            legacySidecars?.tunnelChainTemplates ??
            legacySidecars?.tunnel_chain_templates;
          if (Array.isArray(importedTunnelChains)) {
            tunnelChainTemplates = importedTunnelChains;
          }
        } catch {
          // Not a JSON file or no VPN data -- ignore
        }
      }

      const hasJsonSidecarData =
        Boolean(
          vpnConnections &&
          (vpnConnections.openvpn.length > 0 ||
            vpnConnections.wireguard.length > 0 ||
            vpnConnections.tailscale.length > 0 ||
            vpnConnections.zerotier.length > 0),
        ) || Boolean(tunnelChainTemplates?.length);

      let connections: Connection[] = [];
      if (detectedFormat === "mremoteng") {
        const enc = detectMRemoteNGEncryption(processedContent);
        encryptionAnalysis = {
          protected: enc.isEncrypted,
          fullFileEncryption: enc.fullFileEncryption,
          requiresPassword: enc.requiresPassword,
        };
        if (enc.isEncrypted) {
          // Step 1: figure out which master password to use by validating
          // against the file's `Protected` sentinel. If the user never set a
          // master password, the literal `mR3m` decrypts everything; only
          // prompt when the file uses a custom master.
          const defaultCheck = await verifyMRemoteNGPassword(
            processedContent,
            MREMOTENG_DEFAULT_MASTER_PASSWORD,
          );

          let masterPassword: string | null = null;
          if (defaultCheck.valid) {
            masterPassword = MREMOTENG_DEFAULT_MASTER_PASSWORD;
            encryptionAnalysis.defaultMasterPasswordAccepted = true;
          } else {
            // Custom master password set — prompt and re-validate.
            let attemptError: string | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
              const candidate = await requestPassword({
                title: "Encrypted mRemoteNG file",
                description:
                  "Enter the mRemoteNG master password used to encrypt this export.",
                error: attemptError,
              });
              if (!candidate) break;
              const check = await verifyMRemoteNGPassword(
                processedContent,
                candidate,
              );
              if (check.valid) {
                masterPassword = candidate;
                encryptionAnalysis.defaultMasterPasswordAccepted = false;
                break;
              }
              attemptError = "Incorrect master password — try again.";
            }
          }

          if (!masterPassword) {
            throw new Error("Password required for encrypted mRemoteNG file");
          }

          // Step 2: actual decryption. With the password validated this can
          // only fail on cipher-mode incompatibility or corrupted bodies.
          let decryptedXml: string;
          try {
            decryptedXml = await decryptMRemoteNGXml(
              processedContent,
              masterPassword,
            );
          } catch (e) {
            throw new Error(
              `Failed to decrypt mRemoteNG file: ${e instanceof Error ? e.message : String(e)}`,
            );
          }

          connections = await importConnections(
            decryptedXml,
            filename,
            detectedFormat,
          );
          console.log(
            `[mRemoteNG] decrypted import returned ${connections.length} connections (master=${defaultCheck.valid ? "default mR3m" : "user-supplied"})`,
          );
        } else {
          connections = await importConnections(
            processedContent,
            filename,
            detectedFormat,
          );
        }
      } else {
        try {
          connections = await importConnections(
            processedContent,
            filename,
            detectedFormat,
          );
        } catch (error) {
          if (!hasJsonSidecarData) {
            throw error;
          }
          connections = [];
        }
      }
      console.log(`Import format detected: ${detectedFormatName}`);

      const actualExtension = filename
        .replace(".encrypted", "")
        .split(".")
        .pop()
        ?.toLowerCase();

      const hasVpnData =
        vpnConnections &&
        (vpnConnections.openvpn.length > 0 ||
          vpnConnections.wireguard.length > 0 ||
          vpnConnections.tailscale.length > 0 ||
          vpnConnections.zerotier.length > 0);
      const hasTunnelChains =
        tunnelChainTemplates && tunnelChainTemplates.length > 0;

      if (
        (!connections || connections.length === 0) &&
        !hasVpnData &&
        !hasTunnelChains
      ) {
        throw new Error(
          `No connections found in ${actualExtension?.toUpperCase()} file`,
        );
      }
      const targetConnections = await loadImportTargetConnections(
        targetMode,
        targetDatabaseId,
      );
      const previewItems = buildImportPreviewItems(
        connections,
        targetConnections,
        { vpnConnections, tunnelChainTemplates },
      );
      const analysis = buildImportAnalysis({
        filename,
        sizeBytes,
        format: detectedFormat,
        formatName: detectedFormatName,
        detectedFormat: autoDetectedFormat,
        detectedFormatName: autoDetectedFormatName,
        formatForced,
        formatWarning,
        content: processedContent,
        connections,
        previewItems,
        vpnConnections,
        tunnelChainTemplates,
        encryption: encryptionAnalysis,
      });

      return {
        success: true,
        imported: connections.length,
        errors,
        connections,
        vpnConnections,
        tunnelChainTemplates,
        analysis,
        previewItems,
        selectedIds: previewItems
          .filter((item) => item.selectedByDefault)
          .map((item) => item.id),
        selectedCount: previewItems.filter((item) => item.selectedByDefault)
          .length,
      };
    } catch (error) {
      return {
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : "Import failed"],
        connections: [],
      };
    }
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const processSelectedImportFile = async (
    file: File,
    formatSelection: "auto" | ImportFormat = importFormatSelection,
  ) => {
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File is too large. Maximum allowed size is 50 MB.");
      return;
    }
    setIsProcessing(true);
    setImportResult(null);
    setImportAnalysis(null);
    setSelectedPreviewIds(new Set());
    setImportFilters(DEFAULT_IMPORT_FILTERS);
    setImportFilename(file.name);
    try {
      const content = await readFileContent(file);
      setImportSourceFile({
        filename: file.name,
        content,
        sizeBytes: file.size,
      });
      const result = await processImportFile(
        file.name,
        content,
        file.size,
        formatSelection,
        importTargetModeRef.current,
        selectedImportDatabaseIdRef.current,
      );
      setImportResult(result);
      setImportAnalysis(result.analysis ?? null);
      setSelectedPreviewIds(new Set(result.selectedIds ?? []));
      if (!result.success) {
        console.error("Import failed:", result.errors);
        toast.error("Import failed. Check the file format and try again.");
      }
    } catch (error) {
      console.error("Import failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setImportResult({
        success: false,
        imported: 0,
        errors: [errorMessage],
        connections: [],
      });
      setImportAnalysis(null);
      setSelectedPreviewIds(new Set());
      toast.error("Import failed. Check the console for details.");
    } finally {
      setIsProcessing(false);
    }
  };

  const reprocessImportSource = async (
    source: { filename: string; content: string; sizeBytes?: number },
    formatSelection: "auto" | ImportFormat = importFormatSelection,
    targetMode: ImportTargetMode = importTargetModeRef.current,
    targetDatabaseId: string = selectedImportDatabaseIdRef.current,
  ) => {
    setIsProcessing(true);
    setImportResult(null);
    setImportAnalysis(null);
    setSelectedPreviewIds(new Set());
    setImportFilters(DEFAULT_IMPORT_FILTERS);
    try {
      const result = await processImportFile(
        source.filename,
        source.content,
        source.sizeBytes,
        formatSelection,
        targetMode,
        targetDatabaseId,
      );
      setImportResult(result);
      setImportAnalysis(result.analysis ?? null);
      setSelectedPreviewIds(new Set(result.selectedIds ?? []));
      if (!result.success) {
        console.error("Import failed:", result.errors);
        toast.error("Import failed. Check the file format and try again.");
      }
    } catch (error) {
      console.error("Import failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setImportResult({
        success: false,
        imported: 0,
        errors: [errorMessage],
        connections: [],
      });
      setImportAnalysis(null);
      setSelectedPreviewIds(new Set());
      toast.error("Import failed. Check the console for details.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await processSelectedImportFile(file);
    } finally {
      // Clear the file input so re-selecting the same file fires onChange again
      // (browsers suppress change events when the value is unchanged, so a user
      // who cancels the password prompt and re-picks the same file would
      // otherwise see nothing happen).
      if (event.target) {
        try {
          (event.target as HTMLInputElement).value = "";
        } catch {
          // ignored — some test harnesses make .value read-only
        }
      }
    }
  };

  const handleFileDrop = async (file: File) => {
    await processSelectedImportFile(file);
  };

  const updateImportFormatSelection = async (
    selection: "auto" | ImportFormat,
  ) => {
    setImportFormatSelectionState(selection);
    if (importSourceFile) {
      await reprocessImportSource(importSourceFile, selection);
    }
  };

  const updateSelectedImportDatabaseId = async (databaseId: string) => {
    selectedImportDatabaseIdRef.current = databaseId;
    importTargetModeRef.current = "selected";
    setSelectedImportDatabaseId(databaseId);
    setImportTargetModeState("selected");
    if (importSourceFile) {
      await reprocessImportSource(
        importSourceFile,
        importFormatSelection,
        "selected",
        databaseId,
      );
    }
  };

  const updateImportTargetMode = async (mode: ImportTargetMode) => {
    importTargetModeRef.current = mode;
    setImportTargetModeState(mode);
    const nextDatabaseId = chooseImportTargetDatabaseId(
      importDatabaseOptions,
      selectedImportDatabaseIdRef.current,
      mode,
    );
    if (nextDatabaseId !== selectedImportDatabaseIdRef.current) {
      selectedImportDatabaseIdRef.current = nextDatabaseId;
      setSelectedImportDatabaseId(nextDatabaseId);
    }
    if (importSourceFile) {
      await reprocessImportSource(
        importSourceFile,
        importFormatSelection,
        mode,
        nextDatabaseId,
      );
    }
  };

  const confirmImport = async (filename?: string) => {
    if (importResult && importResult.success) {
      const selectedPreviewItems = importResult.previewItems
        ? importResult.previewItems.filter(
            (item) => selectedPreviewIds.has(item.id) && item.importable,
          )
        : null;
      const selectedItems = selectedPreviewItems
        ? selectedPreviewItems.filter(
            (item) =>
              (item.kind === "connection" || item.kind === "folder") &&
              item.connection,
          )
        : importResult.connections.map((connection, index) => ({
            id: `legacy:${connection.id}:${index}`,
            connection,
            conflictStatus: "none" as const,
          }));
      const hasSshTunnelPreviewRows = Boolean(
        importResult.previewItems?.some((item) => item.kind === "sshTunnel"),
      );
      const selectedSshTunnelConnectionIds = new Set<string>(
        selectedPreviewItems
          ?.filter((item) => item.kind === "sshTunnel")
          .map((item) => item.sshTunnelConnectionId || item.connection?.id)
          .filter((id): id is string => Boolean(id)) ?? [],
      );

      const addTags = splitTags(importOptions.addTags);

      // Strip credentials *before* the shared remap so the helper
      // stays free of secret-handling concerns. Both Import and
      // Clone funnel through the same `remapConnectionsForApply`
      // helper; clone keeps credentials by default, import strips
      // unless the user opts in.
      // Upstream already filtered `selectedItems` to importable
      // entries with a non-null `connection` — don't double-filter
      // here because the legacy fallback shape omits `importable`.
      const preparedItems: ApplyConnectionsItem[] = selectedItems
        .filter((item) => Boolean(item.connection))
        .map((item) => {
          const connection = normalizeImportedAdvancedProtocolConnection(
            item.connection as Connection,
          );
          const keepSshTunnels =
            !hasConnectionSshTunnel(connection) ||
            (importOptions.includeSshTunnels &&
              (!hasSshTunnelPreviewRows ||
                selectedSshTunnelConnectionIds.has(connection.id)));
          const connectionWithSelectedSshTunnels = keepSshTunnels
            ? connection
            : stripConnectionSshTunnels(connection);
          return {
            connection: importOptions.includeCredentials
              ? connectionWithSelectedSshTunnels
              : stripConnectionCredentials(connectionWithSelectedSshTunnels),
            conflictStatus: item.conflictStatus,
          };
        });

      const applied = remapConnectionsForApply(preparedItems, {
        conflictPolicy: importOptions.conflictPolicy,
        addTags,
        preserveFolders: importOptions.preserveFolders,
      });
      const baseConnectionsToImport = applied.remapped;

      const selectedVpnItems =
        selectedPreviewItems?.filter(
          (item) => item.kind === "vpn" && item.vpnType && item.vpnConnection,
        ) ?? [];
      const selectedTunnelChainItems =
        selectedPreviewItems?.filter(
          (item) => item.kind === "tunnelChain" && item.tunnelChainTemplate,
        ) ?? [];

      const currentDatabase = databaseManager.getCurrentDatabase();
      const targetDatabases = getImportTargetDatabases();
      const lockedSelectedTarget = importDatabaseOptions.find(
        (option) =>
          option.id === selectedImportDatabaseIdRef.current &&
          !option.isExportable,
      );
      if (importTargetModeRef.current === "selected" && lockedSelectedTarget) {
        toast.error("Unlock the selected database before importing.");
        return;
      }
      if (targetDatabases.length === 0) {
        toast.error("Choose a database before importing.");
        return;
      }

      // Restore selected VPN connections
      let vpnImportedCount = 0;
      const importedVpnIds = new Map<string, string>();
      const vpnImportWarnings: string[] = [];
      if (importOptions.includeVpnData && selectedVpnItems.length > 0) {
        const proxyMgr = ProxyOpenVPNManager.getInstance();

        for (const item of selectedVpnItems) {
          const conn = item.vpnConnection;
          if (!conn || !item.vpnType) continue;
          try {
            const prepared = prepareVpnConnectionForTransfer(
              item.vpnType,
              conn,
              importOptions.includeCredentials,
            );
            vpnImportWarnings.push(...prepared.warnings);
            const portableConnection = prepared.connection as typeof conn;
            if (!isVpnProfileExecutable(item.vpnType, portableConnection)) {
              vpnImportWarnings.push(
                `VPN profile "${portableConnection.name}" was omitted because its credentials are unavailable. Recreate it with credentials before restoring associations.`,
              );
              continue;
            }
            let createdId: string;
            if (item.vpnType === "openvpn") {
              const openvpn =
                portableConnection as ImportVpnData["openvpn"][number];
              createdId = await proxyMgr.createOpenVPNConnection(
                openvpn.name,
                openvpn.config,
              );
            } else if (item.vpnType === "wireguard") {
              const wireguard =
                portableConnection as ImportVpnData["wireguard"][number];
              createdId = await proxyMgr.createWireGuardConnection(
                wireguard.name,
                wireguard.config,
              );
            } else if (item.vpnType === "tailscale") {
              const tailscale =
                portableConnection as ImportVpnData["tailscale"][number];
              createdId = await proxyMgr.createTailscaleConnection(
                tailscale.name,
                tailscale.config,
              );
            } else if (item.vpnType === "zerotier") {
              const zerotier =
                portableConnection as ImportVpnData["zerotier"][number];
              createdId = await proxyMgr.createZeroTierConnection(
                zerotier.name,
                zerotier.config,
              );
            } else {
              continue;
            }
            if (conn.id) importedVpnIds.set(conn.id, createdId);
            vpnImportedCount++;
          } catch (e) {
            console.warn(`VPN import skip (${item.vpnType}):`, e);
          }
        }
      }

      // Restore selected tunnel chain templates
      let tunnelChainsImportedCount = 0;
      const importedTunnelChainIds = new Map<string, string>();
      if (
        importOptions.includeTunnelChains &&
        selectedTunnelChainItems.length > 0
      ) {
        for (const item of selectedTunnelChainItems) {
          const chain = item.tunnelChainTemplate;
          if (!chain) continue;
          try {
            const unresolvedVpnIds = Array.from(
              new Set(
                chain.layers
                  .map(resolveTunnelLayerVpnProfileId)
                  .filter(
                    (id): id is string =>
                      Boolean(id) && !importedVpnIds.has(id as string),
                  ),
              ),
            );
            if (unresolvedVpnIds.length > 0) {
              vpnImportWarnings.push(
                `Tunnel chain "${chain.name}" was omitted because VPN profile(s) ${unresolvedVpnIds.join(", ")} were not imported.`,
              );
              continue;
            }
            const remappedChain = remapTunnelChain(chain, importedVpnIds);
            const created = await proxyCollectionManager.createTunnelChain(
              remappedChain.name,
              remappedChain.layers,
              {
                description: remappedChain.description,
                tags: remappedChain.tags,
              },
            );
            if (chain.id) importedTunnelChainIds.set(chain.id, created.id);
            tunnelChainsImportedCount++;
          } catch (e) {
            console.warn("Tunnel chain import skip:", e);
          }
        }
      }

      // Sidecars receive fresh app-local IDs. Rewrite every imported
      // connection only after the selected VPN profiles and saved chains have
      // been created, while preserving stable layer IDs inside inline chains.
      const connectionsToImport = baseConnectionsToImport.map((connection) => {
        const remapped = remapConnectionVpnReferencesStrict(
          connection,
          importedVpnIds,
          (profileId) => {
            vpnImportWarnings.push(
              `Connection "${connection.name}" had unresolved VPN profile ${profileId}; that association was removed.`,
            );
          },
        );
        if (!remapped.tunnelChainId) return remapped;
        const tunnelChainId = importedTunnelChainIds.get(
          remapped.tunnelChainId,
        );
        if (tunnelChainId) return { ...remapped, tunnelChainId };
        vpnImportWarnings.push(
          `Connection "${connection.name}" had unresolved tunnel chain ${remapped.tunnelChainId}; that association was removed.`,
        );
        const { tunnelChainId: _unresolvedTunnelChainId, ...withoutChain } =
          remapped;
        return withoutChain as Connection;
      });
      const sshTunnelsImportedCount = importOptions.includeSshTunnels
        ? connectionsToImport.filter(hasConnectionSshTunnel).length
        : 0;

      for (const targetDatabase of targetDatabases) {
        if (targetDatabase.id === currentDatabase?.id) {
          connectionsToImport.forEach((conn) => {
            dispatch({ type: "ADD_CONNECTION", payload: conn });
          });
        } else {
          await databaseManager.appendConnectionsToDatabase(
            targetDatabase.id,
            connectionsToImport,
          );
        }
      }

      const connectionCount = connectionsToImport.length;
      const parts: string[] = [];
      if (connectionCount > 0) {
        parts.push(`${connectionCount} connection(s)`);
      }
      if (vpnImportedCount > 0) {
        parts.push(`${vpnImportedCount} VPN connection(s)`);
      }
      if (tunnelChainsImportedCount > 0) {
        parts.push(`${tunnelChainsImportedCount} tunnel chain(s)`);
      }
      if (sshTunnelsImportedCount > 0) {
        parts.push(`${sshTunnelsImportedCount} SSH tunnel(s)`);
      }

      if (vpnImportWarnings.length > 0) {
        toast.warning(Array.from(new Set(vpnImportWarnings)).join(" "));
      }
      const summary = parts.join(", ") || "0 items";
      const singleTarget =
        targetDatabases.length === 1 ? targetDatabases[0] : null;
      const targetSuffix = singleTarget
        ? singleTarget.isCurrent
          ? ""
          : ` into ${singleTarget.name}`
        : ` into ${targetDatabases.length} databases`;

      toast.success(
        filename
          ? `Imported ${summary}${targetSuffix} from ${filename}`
          : `Imported ${summary}${targetSuffix} successfully`,
      );
      settingsManager.logAction(
        "info",
        "Data imported",
        undefined,
        `Imported ${summary}${targetSuffix}${filename ? ` from ${filename}` : ""}`,
      );

      if (
        singleTarget &&
        !singleTarget.isCurrent &&
        importOptions.switchToTargetDatabaseAfterImport
      ) {
        await databaseManager.selectDatabase(singleTarget.id);
        await loadData();
      }
      setImportResult(null);
      setImportAnalysis(null);
      setImportSourceFile(null);
      setSelectedPreviewIds(new Set());
      setImportFilters(DEFAULT_IMPORT_FILTERS);
      onClose();
    }
  };

  const cancelImport = () => {
    setImportResult(null);
    setImportFilename("");
    setImportAnalysis(null);
    setImportSourceFile(null);
    setSelectedPreviewIds(new Set());
    setImportFilters(DEFAULT_IMPORT_FILTERS);
  };

  // ─── Clone action ────────────────────────────────────────────────
  //
  // Runs Export's filter pipeline against the selected source
  // databases, then funnels the filtered result through the same
  // shared `remapConnectionsForApply` helper Import uses, and writes
  // into every selected target via `appendConnectionsToDatabase`
  // (or directly into the active database via dispatch when it's
  // one of the targets — same pattern as multi-target import).
  const handleClone = useCallback(async (): Promise<CloneResult | null> => {
    if (isCloning) return null;

    // ── Resolve sources ─────────────────────────────────────────
    const sourceIds = getEffectiveCloneSourceIds();
    if (sourceIds.length === 0) {
      toast.error("Pick at least one source database before cloning.");
      return null;
    }

    // ── Resolve targets ─────────────────────────────────────────
    const sourceIdSet = new Set(sourceIds);
    const targetIds = cloneTargetDatabaseIds.filter(
      (id) => !sourceIdSet.has(id),
    );
    if (targetIds.length === 0) {
      toast.error(
        cloneTargetDatabaseIds.length === 0
          ? "Pick at least one target database before cloning."
          : "Targets cannot overlap with sources — pick a different database.",
      );
      return null;
    }
    const targetOptionsById = new Map(
      cloneDatabaseOptions.map((option) => [option.id, option]),
    );
    const lockedTargets = targetIds.filter(
      (id) => !targetOptionsById.get(id)?.isExportable,
    );
    if (lockedTargets.length > 0) {
      toast.error(
        "Unlock the target database(s) before cloning: " +
          lockedTargets
            .map((id) => targetOptionsById.get(id)?.name ?? id)
            .join(", "),
      );
      return null;
    }

    setIsCloning(true);
    setCloneResult(null);
    try {
      // ── Collect + filter source connections ──────────────────
      const currentDatabase = databaseManager.getCurrentDatabase();
      const sourceDatasets: Array<{
        databaseId: string;
        connections: Connection[];
      }> = [];
      for (const id of sourceIds) {
        if (id === currentDatabase?.id) {
          sourceDatasets.push({
            databaseId: id,
            connections: state.connections,
          });
        } else {
          try {
            const snapshot =
              await databaseManager.readExportableDatabaseSnapshot(id);
            sourceDatasets.push({
              databaseId: id,
              connections: snapshot?.connections ?? [],
            });
          } catch (e) {
            console.warn(
              `[clone] Failed to read snapshot of source database ${id}:`,
              e,
            );
          }
        }
      }

      const selectedConnectionIds = cloneInclusion.includedConnectionIds ?? [];
      const usesQualifiedConnectionIds = selectedConnectionIds.some((id) =>
        id.includes(":"),
      );
      const selectedConnectionIdSet = new Set(selectedConnectionIds);
      const selectedFolderIds = cloneInclusion.includedFolderIds ?? [];
      const usesQualifiedFolderIds = selectedFolderIds.some((id) =>
        id.includes(":"),
      );
      const selectedFolderIdSet = new Set(selectedFolderIds);
      const filtered = sourceDatasets.flatMap((dataset) => {
        if (!usesQualifiedConnectionIds && !usesQualifiedFolderIds) {
          return filterConnectionsForExport(
            dataset.connections,
            cloneInclusion,
          );
        }

        const sourceSelectedIds = usesQualifiedConnectionIds
          ? dataset.connections
              .filter((connection) =>
                selectedConnectionIdSet.has(
                  `${dataset.databaseId}:${connection.id}`,
                ),
              )
              .map((connection) => connection.id)
          : selectedConnectionIds;
        const sourceSelectedFolderIds = usesQualifiedFolderIds
          ? dataset.connections
              .filter((connection) =>
                selectedFolderIdSet.has(
                  `${dataset.databaseId}:${connection.id}`,
                ),
              )
              .map((connection) => connection.id)
          : selectedFolderIds;
        if (
          (usesQualifiedConnectionIds &&
            selectedConnectionIds.length > 0 &&
            sourceSelectedIds.length === 0) ||
          (usesQualifiedFolderIds &&
            selectedFolderIds.length > 0 &&
            sourceSelectedFolderIds.length === 0)
        ) {
          return [];
        }
        return filterConnectionsForExport(dataset.connections, {
          ...cloneInclusion,
          includedConnectionIds: sourceSelectedIds,
          includedFolderIds: sourceSelectedFolderIds,
        });
      });
      const sidecarClone = await cloneSidecarsForConnections(
        filtered,
        cloneInclusion,
      );
      const filteredForApply = sidecarClone.connections;
      if (filteredForApply.length === 0 && sidecarClone.counts.total === 0) {
        toast.error("Nothing to clone with the current filter.");
        return null;
      }

      // ── Fan out to every target ──────────────────────────────
      const addTags = splitTags(cloneAddTags);
      const perTarget: CloneResult["perTarget"] = [];
      let totalCloned = 0;
      let totalRenamed = 0;
      let totalSkipped = 0;
      const errors: string[] = [...sidecarClone.errors];
      const warnings: string[] = [...sidecarClone.warnings];

      for (const targetId of targetIds) {
        const targetOption = targetOptionsById.get(targetId);
        const targetName = targetOption?.name ?? targetId;
        try {
          if (filteredForApply.length === 0) {
            perTarget.push({
              databaseId: targetId,
              databaseName: targetName,
              cloned: 0,
            });
            continue;
          }

          // Compute conflict status against this target's existing
          // contents so id collisions are caught per-target.
          let existing: Connection[] = [];
          if (targetId === currentDatabase?.id) {
            existing = state.connections;
          } else {
            const snapshot =
              await databaseManager.readExportableDatabaseSnapshot(targetId);
            existing = snapshot?.connections ?? [];
          }
          const items = buildApplyItems(
            filteredForApply.map((connection) =>
              prepareConnectionForClone(connection, cloneIncludeCredentials),
            ),
            existing,
          );
          const applied = remapConnectionsForApply(items, {
            conflictPolicy: cloneConflictPolicy,
            addTags,
            preserveFolders: clonePreserveFolders,
          });

          if (targetId === currentDatabase?.id) {
            applied.remapped.forEach((conn) => {
              dispatch({ type: "ADD_CONNECTION", payload: conn });
            });
          } else {
            await databaseManager.appendConnectionsToDatabase(
              targetId,
              applied.remapped,
            );
          }

          totalCloned += applied.remapped.length;
          totalRenamed += applied.renamed;
          totalSkipped += applied.skipped;
          perTarget.push({
            databaseId: targetId,
            databaseName: targetName,
            cloned: applied.remapped.length,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          errors.push(`${targetName}: ${message}`);
          perTarget.push({
            databaseId: targetId,
            databaseName: targetName,
            cloned: 0,
            error: message,
          });
        }
      }

      // ── Optionally switch to the (first successful) target ──
      if (cloneSwitchToTargetDatabaseAfterClone) {
        const firstSuccessful = perTarget.find((row) => !row.error);
        if (
          firstSuccessful &&
          firstSuccessful.databaseId !== currentDatabase?.id
        ) {
          try {
            await databaseManager.selectDatabase(firstSuccessful.databaseId);
            await loadData();
          } catch (e) {
            console.warn("[clone] Failed to switch active database:", e);
          }
        }
      }

      // ── Surface result ──────────────────────────────────────
      const success =
        errors.length === 0 &&
        (totalCloned > 0 || sidecarClone.counts.total > 0);
      const result: CloneResult = {
        success,
        cloned: totalCloned,
        renamed: totalRenamed,
        skipped: totalSkipped,
        sidecarsCloned: sidecarClone.counts,
        errors,
        warnings,
        perTarget,
      };
      setCloneResult(result);

      if (success) {
        const targetSummary =
          targetIds.length === 1
            ? ` to ${perTarget[0].databaseName}`
            : ` to ${targetIds.length} databases`;
        const renameNote = totalRenamed > 0 ? `, renamed ${totalRenamed}` : "";
        const skipNote = totalSkipped > 0 ? `, skipped ${totalSkipped}` : "";
        const sidecarNote =
          sidecarClone.counts.total > 0
            ? `, cloned ${sidecarClone.counts.total} sidecar definition(s)`
            : "";
        toast.success(
          totalCloned > 0
            ? `Cloned ${totalCloned} connection(s)${targetSummary}${renameNote}${skipNote}${sidecarNote}.`
            : `Cloned ${sidecarClone.counts.total} sidecar definition(s).`,
        );
        if (warnings.length > 0) {
          toast.warning(warnings.join(" "));
        }
      } else if (errors.length > 0) {
        toast.error(`Clone partially failed: ${errors.join("; ")}`);
      }
      return result;
    } finally {
      setIsCloning(false);
    }
    // cloneSidecarsForConnections closes over the same manager singletons and
    // current operation state consumed here; listing the inline helper would
    // recreate this action on every render without making the inputs safer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isCloning,
    getEffectiveCloneSourceIds,
    cloneTargetDatabaseIds,
    cloneInclusion,
    cloneConflictPolicy,
    cloneAddTags,
    clonePreserveFolders,
    cloneIncludeCredentials,
    cloneSwitchToTargetDatabaseAfterClone,
    cloneDatabaseOptions,
    databaseManager,
    state.connections,
    dispatch,
    toast,
    loadData,
  ]);

  const clearCloneResult = useCallback(() => setCloneResult(null), []);

  return {
    connections: state.connections,
    activeTab,
    setActiveTab,
    exportFormat,
    setExportFormat,
    exportScopeMode,
    setExportScopeMode,
    selectedExportDatabaseIds,
    setSelectedExportDatabaseIds,
    exportDatabaseOptions,
    refreshExportDatabaseOptions,
    exportEncrypted,
    setExportEncrypted,
    exportPassword,
    setExportPassword,
    exportInclusion,
    updateExportInclusion,
    includePasswords,
    setIncludePasswords,
    includeVpnData,
    setIncludeVpnData,
    includeTunnelChains,
    setIncludeTunnelChains,
    includeTabGroups,
    setIncludeTabGroups,
    includeColorTags,
    setIncludeColorTags,
    exportKeyDerivationIterations,
    setExportKeyDerivationIterations,
    exportSecuritySettings,
    importResult,
    importFilename,
    importAnalysis,
    importDatabaseOptions,
    importTargetMode,
    setImportTargetMode: updateImportTargetMode,
    selectedImportDatabaseId,
    setSelectedImportDatabaseId: updateSelectedImportDatabaseId,
    importFormatSelection,
    setImportFormatSelection: updateImportFormatSelection,
    importFilters,
    updateImportFilters,
    resetImportFilters,
    importOptions,
    updateImportOptions,
    importPreviewItems,
    visiblePreviewItems,
    availableImportProtocols,
    selectedPreviewIds,
    selectedImportCount,
    togglePreviewSelection,
    selectAllVisiblePreviewItems,
    deselectAllVisiblePreviewItems,
    selectAllImportablePreviewItems,
    isProcessing,
    fileInputRef,
    handleExport,
    handleImport,
    handleFileSelect,
    handleFileDrop,
    confirmImport,
    cancelImport,
    passwordPrompt,
    submitPasswordPrompt,
    cancelPasswordPrompt,
    // ── Clone state + actions ──
    cloneSourceMode,
    setCloneSourceMode,
    selectedCloneSourceDatabaseIds,
    setSelectedCloneSourceDatabaseIds,
    cloneInclusion,
    updateCloneInclusion,
    cloneTargetDatabaseIds,
    setCloneTargetDatabaseIds,
    cloneConflictPolicy,
    setCloneConflictPolicy,
    cloneAddTags,
    setCloneAddTags,
    clonePreserveFolders,
    setClonePreserveFolders,
    cloneIncludeCredentials,
    setCloneIncludeCredentials,
    cloneSwitchToTargetDatabaseAfterClone,
    setCloneSwitchToTargetDatabaseAfterClone,
    cloneDatabaseOptions,
    refreshCloneDatabaseOptions,
    cloneSourceCatalog,
    isCloneSourceCatalogLoading,
    refreshCloneSourceCatalog,
    isCloning,
    cloneResult,
    clearCloneResult,
    handleClone,
    // Inline unlock — shared by all three pickers (Export selected,
    // Import target, Clone source/target).
    handleUnlockDatabase,
  };
}
