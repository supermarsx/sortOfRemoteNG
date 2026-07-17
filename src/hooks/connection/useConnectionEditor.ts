import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Monitor,
  Terminal,
  Globe,
  Database,
  Server,
  Shield,
  Cloud,
  Folder as FolderIcon,
  Star,
  HardDrive,
  Cable,
  Phone,
  Files,
  Network,
  LucideIcon,
} from "lucide-react";
import {
  INTEGRATION_PROTOCOL_PREFIX,
  isIntegrationConnectionProtocol,
  type Connection,
  type IntegrationConnectionProtocol,
  type IntegrationConnectionSettings,
} from "../../types/connection/connection";
import {
  integrationRegistry,
  type ConnectionTypeCategory,
  type IntegrationDescriptor,
} from "../../types/integrations/registry";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { useToastContext } from "../../contexts/ToastContext";
import { getDefaultPort } from "../../utils/discovery/defaultPorts";
import { generateId } from "../../utils/core/id";
import {
  buildParentFolderProjection,
  canSelectParentFolder,
} from "../../utils/connection/parentFolderTree";
import {
  EXCHANGE_INTEGRATION_KEY,
  exchangeConnectionHost,
  exchangeConnectionTimeout,
  exchangeConnectionUsername,
  normalizeExchangeConnectionFields,
  toExchangeProviderFields,
} from "../../utils/integrations/exchangeConnectionFields";
import { normalizeAdvancedProtocolConnection } from "../../utils/connection/normalizeAdvancedProtocolConnection";

/* ═══════════════════════════════════════════════════════════════
   Static data
   ═══════════════════════════════════════════════════════════════ */

export interface ProtocolOption {
  value: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  /** Which connection-type category this option is filed under. Built-in and
   *  integration-backed options share one taxonomy — the picker groups on this
   *  and nothing else (t56 C5). */
  category: ConnectionTypeCategory;
}

/** i18n key path per category. Consumed by the picker, which resolves each via
 *  `t(PROTOCOL_CATEGORY_LABEL_KEYS[c], PROTOCOL_CATEGORY_LABELS[c])` — this map
 *  holds keys, never rendered strings. Owned by the locale files (t56 C3);
 *  never define these under `integrations.*`, since several categories
 *  (`console`, `lights-out`, `cloud`) contain no integrations at all. */
export const PROTOCOL_CATEGORY_LABEL_KEYS: Record<
  ConnectionTypeCategory,
  string
> = {
  "remote-desktop": "connection.protocolCategory.remote-desktop",
  console: "connection.protocolCategory.console",
  "lights-out": "connection.protocolCategory.lights-out",
  virtualization: "connection.protocolCategory.virtualization",
  networking: "connection.protocolCategory.networking",
  "web-server": "connection.protocolCategory.web-server",
  "mail-server": "connection.protocolCategory.mail-server",
  database: "connection.protocolCategory.database",
  "file-storage": "connection.protocolCategory.file-storage",
  cloud: "connection.protocolCategory.cloud",
  monitoring: "connection.protocolCategory.monitoring",
  vault: "connection.protocolCategory.vault",
  management: "connection.protocolCategory.management",
  "business-app": "connection.protocolCategory.business-app",
};

/** English fallbacks for {@link PROTOCOL_CATEGORY_LABEL_KEYS}, matching the
 *  locale fragment's values verbatim. Also used for non-reactive strings such
 *  as an integration option's `desc`. */
export const PROTOCOL_CATEGORY_LABELS: Record<ConnectionTypeCategory, string> =
  {
    "remote-desktop": "Remote Desktops",
    console: "Consoles & Terminals",
    "lights-out": "Lights-Out & BMC",
    virtualization: "Virtualization & Containers",
    networking: "Networking",
    "web-server": "Web Servers & Proxies",
    "mail-server": "Mail Servers",
    database: "Databases",
    "file-storage": "File Transfer & Storage",
    cloud: "Cloud Platforms",
    monitoring: "Monitoring & Metrics",
    vault: "Secrets & Vaults",
    management: "Management & Automation",
    "business-app": "Business Applications",
  };

export const toIntegrationProtocol = (
  descriptorKey: string,
): IntegrationConnectionProtocol =>
  `${INTEGRATION_PROTOCOL_PREFIX}${descriptorKey}` as IntegrationConnectionProtocol;

export const getIntegrationKeyFromProtocol = (
  protocol: string | undefined,
): string | undefined =>
  isIntegrationConnectionProtocol(protocol)
    ? protocol.slice(INTEGRATION_PROTOCOL_PREFIX.length)
    : undefined;

const findIntegrationDescriptorForProtocol = (
  protocol: string | undefined,
): IntegrationDescriptor | undefined => {
  const descriptorKey = getIntegrationKeyFromProtocol(protocol);
  return descriptorKey
    ? integrationRegistry.find((descriptor) => descriptor.key === descriptorKey)
    : undefined;
};

type IntegrationConnectionFormSettings = IntegrationConnectionSettings & {
  authToken?: string;
  apiKey?: string;
  password?: string;
  providerSecrets?: Record<string, string>;
};

// Only protocols with a registered direct-session route belong here.
// `BUILT_IN_MANAGEMENT_PROTOCOLS` (utils/session/protocolAvailability.ts) —
// the cloud providers plus ilo/lenovo/supermicro — are persisted management
// identities with no session host and must never become selectable, which is
// why the `cloud` and `lights-out` categories have no entries below.
export const PROTOCOL_OPTIONS: ProtocolOption[] = [
  {
    value: "rdp",
    label: "RDP",
    desc: "Remote Desktop",
    icon: Monitor,
    color: "blue",
    category: "remote-desktop",
  },
  {
    value: "ssh",
    label: "SSH",
    desc: "Secure Shell",
    icon: Terminal,
    color: "green",
    category: "console",
  },
  {
    value: "ard",
    label: "Apple Remote Desktop",
    desc: "macOS Screen Sharing (ARD/RFB)",
    icon: Monitor,
    color: "blue",
    category: "remote-desktop",
  },
  {
    value: "serial",
    label: "Serial / RS-232",
    desc: "Local COM or tty terminal",
    icon: Cable,
    color: "cyan",
    category: "console",
  },
  {
    value: "raw",
    label: "Raw Socket",
    desc: "TCP / UDP Payload Client",
    icon: Cable,
    color: "cyan",
    category: "console",
  },
  {
    value: "rlogin",
    label: "RLogin",
    desc: "RFC 1282 Remote Login",
    icon: Phone,
    color: "amber",
    category: "console",
  },
  {
    value: "telnet",
    label: "Telnet",
    desc: "Legacy plaintext terminal",
    icon: Terminal,
    color: "amber",
    category: "console",
  },
  {
    value: "sftp",
    label: "SFTP",
    desc: "SSH File Transfer",
    icon: Files,
    color: "green",
    category: "file-storage",
  },
  {
    value: "ftp",
    label: "FTP / FTPS",
    desc: "Direct FTP file transfer",
    icon: Files,
    color: "amber",
    category: "file-storage",
  },
  {
    value: "scp",
    label: "SCP",
    desc: "SSH Secure Copy",
    icon: Files,
    color: "green",
    category: "file-storage",
  },
  {
    value: "mysql",
    label: "MySQL",
    desc: "MySQL / MariaDB database",
    icon: Database,
    color: "blue",
    category: "database",
  },
  {
    value: "postgresql",
    label: "PostgreSQL",
    desc: "Native PostgreSQL query client",
    icon: Database,
    color: "blue",
    category: "database",
  },
  {
    value: "spice",
    label: "SPICE",
    desc: "Native remote-viewer handoff",
    icon: Monitor,
    color: "red",
    category: "remote-desktop",
  },
  {
    value: "xdmcp",
    label: "XDMCP",
    desc: "Native local X server handoff",
    icon: Monitor,
    color: "amber",
    category: "remote-desktop",
  },
  {
    value: "x2go",
    label: "X2Go (native client)",
    desc: "Installed x2goclient handoff",
    icon: Monitor,
    color: "green",
    category: "remote-desktop",
  },
  {
    value: "nx",
    label: "NX / NoMachine (native client)",
    desc: "Installed nxplayer handoff",
    icon: Monitor,
    color: "purple",
    category: "remote-desktop",
  },
  {
    value: "smb",
    label: "SMB",
    desc: "Windows and Samba file shares",
    icon: Network,
    color: "cyan",
    category: "file-storage",
  },
  {
    value: "rustdesk",
    label: "RustDesk",
    desc: "Remote desktop by device ID",
    icon: Monitor,
    color: "red",
    category: "remote-desktop",
  },
  {
    value: "vnc",
    label: "VNC",
    desc: "Virtual Network",
    icon: Server,
    color: "purple",
    category: "remote-desktop",
  },
  {
    value: "http",
    label: "HTTP",
    desc: "Web Service",
    icon: Globe,
    color: "orange",
    category: "web-server",
  },
  {
    value: "https",
    label: "HTTPS",
    desc: "Secure Web",
    icon: Shield,
    color: "emerald",
    category: "web-server",
  },
  {
    value: "winrm",
    label: "PowerShell Remoting",
    desc: "WSMan / WinRM",
    icon: Terminal,
    color: "amber",
    category: "console",
  },
  {
    value: "anydesk",
    label: "AnyDesk",
    desc: "Remote Access",
    icon: Monitor,
    color: "red",
    category: "remote-desktop",
  },
];

export const INTEGRATION_PROTOCOL_OPTIONS: ProtocolOption[] =
  integrationRegistry.map((descriptor) => ({
    value: toIntegrationProtocol(descriptor.key),
    label: descriptor.label,
    desc: PROTOCOL_CATEGORY_LABELS[descriptor.category],
    icon: descriptor.icon,
    color: "cyan",
    category: descriptor.category,
  }));

export interface IconOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

export const ICON_OPTIONS: IconOption[] = [
  { value: "", label: "Default", icon: Monitor },
  { value: "terminal", label: "Terminal", icon: Terminal },
  { value: "globe", label: "Web", icon: Globe },
  { value: "database", label: "Database", icon: Database },
  { value: "server", label: "Server", icon: Server },
  { value: "shield", label: "Shield", icon: Shield },
  { value: "cloud", label: "Cloud", icon: Cloud },
  { value: "folder", label: "Folder", icon: FolderIcon },
  { value: "star", label: "Star", icon: Star },
  { value: "drive", label: "Drive", icon: HardDrive },
];

export const PROTOCOL_COLOR_MAP: Record<string, string> = {
  blue: "bg-blue-500/20 border-blue-500/60 text-blue-300",
  green: "bg-green-500/20 border-green-500/60 text-green-300",
  purple: "bg-purple-500/20 border-purple-500/60 text-purple-300",
  orange: "bg-orange-500/20 border-orange-500/60 text-orange-300",
  emerald: "bg-emerald-500/20 border-emerald-500/60 text-emerald-300",
  red: "bg-red-500/20 border-red-500/60 text-red-300",
  amber: "bg-amber-500/20 border-amber-500/60 text-amber-300",
  cyan: "bg-cyan-500/20 border-cyan-500/60 text-cyan-300",
};

const getDefaultConnectionPort = (protocol: string | undefined): number =>
  isIntegrationConnectionProtocol(protocol)
    ? 443
    : getDefaultPort(protocol || "rdp");

const hostFromBaseUrl = (baseUrl: string | undefined): string => {
  if (!baseUrl) {
    return "";
  }

  try {
    return new URL(baseUrl).host;
  } catch {
    return "";
  }
};

const buildIntegrationSettings = (
  protocol: string | undefined,
  current?: IntegrationConnectionFormSettings,
  source?: Partial<Connection>,
): IntegrationConnectionFormSettings | undefined => {
  if (!isIntegrationConnectionProtocol(protocol)) {
    return undefined;
  }

  const descriptorKey = getIntegrationKeyFromProtocol(protocol);
  if (!descriptorKey) {
    return undefined;
  }

  const descriptor = findIntegrationDescriptorForProtocol(protocol);
  const baseUrl = current?.baseUrl ?? "";
  const providerFields =
    descriptorKey === EXCHANGE_INTEGRATION_KEY
      ? toExchangeProviderFields(
          normalizeExchangeConnectionFields(current?.providerFields, {
            host: current?.host || source?.hostname,
            username: current?.username || source?.username,
            timeout: current?.timeout ?? source?.timeout,
          }),
        )
      : current?.providerFields;
  const exchangeFields =
    descriptorKey === EXCHANGE_INTEGRATION_KEY
      ? normalizeExchangeConnectionFields(providerFields, {
          host: current?.host || source?.hostname,
          username: current?.username || source?.username,
          timeout: current?.timeout ?? source?.timeout,
        })
      : undefined;

  return {
    descriptorKey,
    descriptorLabel: descriptor?.label ?? current?.descriptorLabel,
    // Denormalized display data with no readers anywhere: routing is by
    // `descriptorKey` via `findDescriptor`, and the live category always comes
    // from the descriptor — never from this persisted copy (t56 R4). Old saved
    // JSON still holds the retired `"infra"`/`"app-service"` values, so the
    // field stays permissive on read.
    // The cast is temporary: `IntegrationConnectionSettings.category`
    // (types/connection/connection.ts) still inlines the retired six literals
    // instead of referencing the category union. Drop it once that widens.
    category: (descriptor?.category ??
      current?.category) as IntegrationConnectionSettings["category"],
    instanceId: current?.instanceId ?? "",
    instanceName: current?.instanceName ?? "",
    credentialRefId: current?.credentialRefId,
    host:
      current?.host ||
      source?.hostname ||
      (exchangeFields ? exchangeConnectionHost(exchangeFields) : "") ||
      hostFromBaseUrl(baseUrl),
    baseUrl,
    authToken: current?.authToken ?? "",
    apiKey: current?.apiKey ?? "",
    username:
      current?.username ??
      source?.username ??
      (exchangeFields ? exchangeConnectionUsername(exchangeFields) : ""),
    password: current?.password ?? source?.password ?? "",
    tlsVerify: current?.tlsVerify ?? true,
    timeout:
      (exchangeFields
        ? exchangeConnectionTimeout(
            exchangeFields,
            current?.timeout ?? source?.timeout,
          )
        : undefined) ??
      current?.timeout ??
      source?.timeout ??
      30,
    providerFields,
    providerSecrets: current?.providerSecrets ?? {},
  };
};

const normalizeIntegrationFields = (
  data: Partial<Connection>,
): Partial<Connection> => {
  const integration = buildIntegrationSettings(
    data.protocol,
    data.integration as IntegrationConnectionFormSettings | undefined,
    data,
  );

  if (!integration) {
    return {
      ...data,
      integration: undefined,
    };
  }

  return {
    ...data,
    hostname: integration.host ?? data.hostname ?? "",
    username: integration.username ?? data.username ?? "",
    password: "",
    timeout: integration.timeout ?? data.timeout,
    integration,
  };
};

const toPersistableIntegrationSettings = (
  integration?: IntegrationConnectionFormSettings,
): IntegrationConnectionSettings | undefined => {
  if (!integration) {
    return undefined;
  }

  const {
    authToken: _authToken,
    apiKey: _apiKey,
    password: _password,
    providerSecrets: _providerSecrets,
    ...persistable
  } = integration;
  return persistable;
};

const stripIntegrationSecretsForPersistence = (
  data: Partial<Connection>,
): Partial<Connection> => {
  if (!isIntegrationConnectionProtocol(data.protocol)) {
    return data;
  }

  return {
    ...data,
    password: "",
    integration: toPersistableIntegrationSettings(
      data.integration as IntegrationConnectionFormSettings | undefined,
    ),
  };
};

/* ═══════════════════════════════════════════════════════════════
   Default form data
   ═══════════════════════════════════════════════════════════════ */

const DEFAULT_FORM: Partial<Connection> = {
  name: "",
  protocol: "rdp",
  hostname: "",
  port: 3389,
  username: "",
  password: "",
  domain: "",
  description: "",
  isGroup: false,
  tags: [],
  parentId: undefined,
  authType: "password",
  privateKey: "",
  passphrase: "",
  ignoreSshSecurityErrors: false,
  sshConnectTimeout: 30,
  sshKeepAliveInterval: 60,
  sshKnownHostsPath: "",
  icon: "",
  basicAuthUsername: "",
  basicAuthPassword: "",
  basicAuthRealm: "",
  httpHeaders: {},
  integration: undefined,
};

type ManagedSshSecretField = "password" | "passphrase" | "privateKey";

export interface ManagedSshSecretsController {
  passwordInputRef: React.RefObject<HTMLInputElement | null>;
  passphraseInputRef: React.RefObject<HTMLInputElement | null>;
  privateKeyInputRef: React.RefObject<HTMLTextAreaElement | null>;
  hasPassword: boolean;
  hasPassphrase: boolean;
  hasPrivateKey: boolean;
  handlePasswordChange: (value: string) => void;
  handlePassphraseChange: (value: string) => void;
  handlePrivateKeyChange: (value: string) => void;
  getPassword: () => string;
  getPassphrase: () => string;
  getPrivateKey: () => string;
  clearAll: () => void;
}

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useConnectionEditor(
  connection: Connection | undefined,
  isOpen: boolean,
  onClose: () => void,
) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const { toast } = useToastContext();

  const [formData, setFormData] = useState<Partial<Connection>>(DEFAULT_FORM);
  const [expandedSections, setExpandedSections] = useState({
    advanced: false,
  });
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "pending" | "saved"
  >("idle");
  const autoSaveTimerRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);
  const originalDataRef = useRef<string>("");
  const sshPasswordRef = useRef(
    connection?.protocol === "ssh" ? connection.password || "" : "",
  );
  const sshPassphraseRef = useRef(
    connection?.protocol === "ssh" ? connection.passphrase || "" : "",
  );
  const sshPrivateKeyRef = useRef(
    connection?.protocol === "ssh" ? connection.privateKey || "" : "",
  );
  const sshTotpSecretRef = useRef(
    connection?.protocol === "ssh" ? connection.totpSecret || "" : "",
  );
  const sshProxyCommandPasswordRef = useRef(
    connection?.protocol === "ssh"
      ? connection.sshConnectionConfigOverride?.proxyCommandPassword || ""
      : "",
  );
  const sshPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const sshPassphraseInputRef = useRef<HTMLInputElement | null>(null);
  const sshPrivateKeyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [hasSshPassword, setHasSshPassword] = useState(
    sshPasswordRef.current.length > 0,
  );
  const [hasSshPassphrase, setHasSshPassphrase] = useState(
    sshPassphraseRef.current.length > 0,
  );
  const [hasSshPrivateKey, setHasSshPrivateKey] = useState(
    sshPrivateKeyRef.current.length > 0,
  );
  const [sshSecretRevision, setSshSecretRevision] = useState(0);

  const syncManagedSshInputs = useCallback(() => {
    if (sshPasswordInputRef.current) {
      sshPasswordInputRef.current.value = sshPasswordRef.current;
    }

    if (sshPassphraseInputRef.current) {
      sshPassphraseInputRef.current.value = sshPassphraseRef.current;
    }

    if (sshPrivateKeyInputRef.current) {
      sshPrivateKeyInputRef.current.value = sshPrivateKeyRef.current;
    }
  }, []);

  const setManagedSshSecret = useCallback(
    (
      field: ManagedSshSecretField,
      value: string,
      options?: { touch?: boolean },
    ) => {
      switch (field) {
        case "password":
          sshPasswordRef.current = value;
          setHasSshPassword(value.length > 0);
          if (
            sshPasswordInputRef.current &&
            sshPasswordInputRef.current.value !== value
          ) {
            sshPasswordInputRef.current.value = value;
          }
          break;
        case "passphrase":
          sshPassphraseRef.current = value;
          setHasSshPassphrase(value.length > 0);
          if (
            sshPassphraseInputRef.current &&
            sshPassphraseInputRef.current.value !== value
          ) {
            sshPassphraseInputRef.current.value = value;
          }
          break;
        case "privateKey":
          sshPrivateKeyRef.current = value;
          setHasSshPrivateKey(value.length > 0);
          if (
            sshPrivateKeyInputRef.current &&
            sshPrivateKeyInputRef.current.value !== value
          ) {
            sshPrivateKeyInputRef.current.value = value;
          }
          break;
      }

      if (options?.touch !== false) {
        setSshSecretRevision((current) => current + 1);
      }
    },
    [],
  );

  const hydrateManagedSshSecrets = useCallback(
    (values: Record<ManagedSshSecretField, string>) => {
      setManagedSshSecret("password", values.password, { touch: false });
      setManagedSshSecret("passphrase", values.passphrase, { touch: false });
      setManagedSshSecret("privateKey", values.privateKey, { touch: false });
    },
    [setManagedSshSecret],
  );

  const clearManagedSshSecrets = useCallback(
    (options?: { touch?: boolean }) => {
      hydrateManagedSshSecrets({
        password: "",
        passphrase: "",
        privateKey: "",
      });
      sshTotpSecretRef.current = "";
      sshProxyCommandPasswordRef.current = "";

      if (options?.touch) {
        setSshSecretRevision((current) => current + 1);
      }
    },
    [hydrateManagedSshSecrets],
  );

  const sanitizeSshConnectionOverride = useCallback(
    (override: Connection["sshConnectionConfigOverride"]) => {
      if (!override) {
        return undefined;
      }

      const { proxyCommandPassword: _, ...rest } = override;
      return Object.keys(rest).length > 0 ? rest : undefined;
    },
    [],
  );

  const mergeManagedSshSecrets = useCallback((data: Partial<Connection>) => {
    if (data.protocol !== "ssh") {
      return data;
    }

    const sshConnectionConfigOverride =
      data.sshConnectionConfigOverride || sshProxyCommandPasswordRef.current
        ? {
            ...(data.sshConnectionConfigOverride || {}),
            ...(sshProxyCommandPasswordRef.current
              ? { proxyCommandPassword: sshProxyCommandPasswordRef.current }
              : {}),
          }
        : undefined;

    return {
      ...data,
      password: sshPasswordRef.current,
      passphrase: sshPassphraseRef.current,
      privateKey: sshPrivateKeyRef.current,
      totpSecret: sshTotpSecretRef.current,
      sshConnectionConfigOverride,
    };
  }, []);

  const buildEditorSnapshot = useCallback(
    (data: Partial<Connection>) => {
      const snapshot = mergeManagedSshSecrets(data);

      return JSON.stringify(snapshot);
    },
    [mergeManagedSshSecrets],
  );

  // ── Derived ───────────────────────────────────────────────────
  const allTags = useMemo(
    () =>
      Array.from(
        new Set(
          state.connections
            .flatMap((conn) => conn.tags || [])
            .filter((tag) => tag.trim() !== ""),
        ),
      ).sort(),
    [state.connections],
  );

  const parentFolderProjection = useMemo(
    () =>
      buildParentFolderProjection({
        connections: state.connections,
        currentConnectionId: formData.id,
        currentIsGroup: !!formData.isGroup,
        selectedParentId: formData.parentId,
      }),
    [formData.id, formData.isGroup, formData.parentId, state.connections],
  );

  const handleParentFolderChange = useCallback(
    (value: string): boolean => {
      if (!canSelectParentFolder(parentFolderProjection, value)) return false;
      setFormData((previous) => ({
        ...previous,
        parentId: value || undefined,
      }));
      return true;
    },
    [parentFolderProjection],
  );

  const isNewConnection = !connection;

  // ── Effects ───────────────────────────────────────────────────
  useEffect(() => {
    if (connection) {
      const isSshConnection = connection.protocol === "ssh";

      if (isSshConnection) {
        hydrateManagedSshSecrets({
          password: connection.password || "",
          passphrase: connection.passphrase || "",
          privateKey: connection.privateKey || "",
        });
        sshTotpSecretRef.current = connection.totpSecret || "";
        sshProxyCommandPasswordRef.current =
          connection.sshConnectionConfigOverride?.proxyCommandPassword || "";
      } else {
        clearManagedSshSecrets();
      }

      const resolved = {
        ...connection,
        password: isSshConnection ? "" : connection.password || "",
        privateKey: isSshConnection ? "" : connection.privateKey || "",
        passphrase: isSshConnection ? "" : connection.passphrase || "",
        totpSecret: isSshConnection ? "" : connection.totpSecret || "",
        ignoreSshSecurityErrors: connection.ignoreSshSecurityErrors ?? false,
        sshConnectTimeout: connection.sshConnectTimeout ?? 30,
        sshKeepAliveInterval: connection.sshKeepAliveInterval ?? 60,
        sshKnownHostsPath: connection.sshKnownHostsPath || "",
        icon: connection.icon || "",
        basicAuthUsername: connection.basicAuthUsername || "",
        basicAuthPassword: connection.basicAuthPassword || "",
        basicAuthRealm: connection.basicAuthRealm || "",
        httpHeaders: connection.httpHeaders || {},
        sshConnectionConfigOverride: isSshConnection
          ? sanitizeSshConnectionOverride(
              connection.sshConnectionConfigOverride,
            )
          : connection.sshConnectionConfigOverride,
      };
      const normalized = normalizeAdvancedProtocolConnection(
        normalizeIntegrationFields(resolved),
      );
      setFormData(normalized);
      originalDataRef.current = buildEditorSnapshot(normalized);
      // Mark as initialized on the *next* effect cycle so the auto-save
      // effect that fires from the setFormData re-render still sees false.
      isInitializedRef.current = false;
      requestAnimationFrame(() => {
        isInitializedRef.current = true;
      });
    } else {
      clearManagedSshSecrets();
      const initial = { ...DEFAULT_FORM, cloudProvider: undefined };
      setFormData(initial);
      originalDataRef.current = buildEditorSnapshot(initial);
      isInitializedRef.current = false;
    }
    setAutoSaveStatus("idle");
  }, [
    buildEditorSnapshot,
    clearManagedSshSecrets,
    connection,
    hydrateManagedSshSecrets,
    isOpen,
    sanitizeSshConnectionOverride,
  ]);

  useEffect(() => {
    if (formData.protocol === "ssh" && isOpen) {
      syncManagedSshInputs();
    }
  }, [
    formData.authType,
    formData.protocol,
    isOpen,
    sshSecretRevision,
    syncManagedSshInputs,
  ]);

  useEffect(() => {
    if (!isOpen) {
      clearManagedSshSecrets();
    }
  }, [clearManagedSshSecrets, isOpen]);

  useEffect(() => {
    return () => {
      clearManagedSshSecrets();
    };
  }, [clearManagedSshSecrets]);

  const buildConnectionData = useCallback((): Connection => {
    const now = new Date().toISOString();
    const effectiveFormData = normalizeAdvancedProtocolConnection(
      stripIntegrationSecretsForPersistence(
        normalizeIntegrationFields(mergeManagedSshSecrets(formData)),
      ),
    );

    // enableWinrmTools, sshConnectionConfigOverride, etc.) are always
    // persisted without having to enumerate them individually.
    return {
      ...(connection || {}),
      ...effectiveFormData,
      id: connection?.id || generateId(),
      name: effectiveFormData.name || "New Connection",
      protocol: effectiveFormData.protocol as Connection["protocol"],
      hostname: effectiveFormData.hostname || "",
      port:
        effectiveFormData.port ||
        getDefaultConnectionPort(effectiveFormData.protocol as string),
      isGroup: effectiveFormData.isGroup || false,
      tags: effectiveFormData.tags || [],
      order: connection?.order ?? Date.now(),
      createdAt: connection?.createdAt || now,
      updatedAt: now,
    } as Connection;
  }, [formData, connection, mergeManagedSshSecrets]);

  // Auto-save effect
  useEffect(() => {
    if (!connection || !settings.autoSaveEnabled || !isInitializedRef.current) {
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setAutoSaveStatus("pending");

    autoSaveTimerRef.current = window.setTimeout(() => {
      const connectionData = buildConnectionData();
      dispatch({ type: "UPDATE_CONNECTION", payload: connectionData });
      setAutoSaveStatus("saved");
      setTimeout(() => setAutoSaveStatus("idle"), 2000);
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [
    formData,
    connection,
    settings.autoSaveEnabled,
    buildConnectionData,
    dispatch,
    sshSecretRevision,
  ]);

  // ── Handlers ──────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

      // Detect whether anything actually changed
      const hasChanges =
        buildEditorSnapshot(formData) !== originalDataRef.current;

      if (connection) {
        if (!hasChanges) {
          toast.info("No changes to save");
          return;
        }
        const connectionData = buildConnectionData();
        dispatch({ type: "UPDATE_CONNECTION", payload: connectionData });
        toast.success(`"${connectionData.name}" saved`);
        // Update the baseline so subsequent saves detect new changes correctly
        originalDataRef.current = buildEditorSnapshot(formData);
      } else {
        const connectionData = buildConnectionData();
        dispatch({ type: "ADD_CONNECTION", payload: connectionData });
        toast.success(`"${connectionData.name}" created`);
        onClose();
      }
    },
    [
      buildConnectionData,
      buildEditorSnapshot,
      connection,
      dispatch,
      onClose,
      formData,
      toast,
    ],
  );

  const handleTagsChange = useCallback(
    (tags: string[]) => setFormData((p) => ({ ...p, tags })),
    [],
  );

  const handleProtocolChange = useCallback(
    (protocol: string) => {
      const nextProtocol = protocol as Connection["protocol"];
      const isNextIntegration = isIntegrationConnectionProtocol(protocol);
      const nextAuthType = isIntegrationConnectionProtocol(protocol)
        ? "header"
        : ["http", "https"].includes(protocol)
          ? "basic"
          : "password";
      const nextIntegration = buildIntegrationSettings(
        protocol,
        undefined,
        formData,
      );

      if (formData.protocol === "ssh" && nextProtocol !== "ssh") {
        const carriedPassword = sshPasswordRef.current;
        clearManagedSshSecrets();
        setFormData((prev) =>
          normalizeAdvancedProtocolConnection({
            ...prev,
            protocol: nextProtocol,
            port: getDefaultConnectionPort(protocol),
            authType: nextAuthType,
            password: isNextIntegration ? "" : carriedPassword,
            integration: buildIntegrationSettings(protocol, undefined, prev),
            passphrase: "",
            privateKey: "",
            totpSecret: "",
            sshConnectionConfigOverride: sanitizeSshConnectionOverride(
              prev.sshConnectionConfigOverride,
            ),
          }),
        );
        return;
      }

      if (formData.protocol !== "ssh" && nextProtocol === "ssh") {
        hydrateManagedSshSecrets({
          password:
            typeof formData.password === "string" ? formData.password : "",
          passphrase:
            typeof formData.passphrase === "string" ? formData.passphrase : "",
          privateKey:
            typeof formData.privateKey === "string" ? formData.privateKey : "",
        });
        sshTotpSecretRef.current =
          typeof formData.totpSecret === "string" ? formData.totpSecret : "";
        sshProxyCommandPasswordRef.current =
          formData.sshConnectionConfigOverride?.proxyCommandPassword || "";
        setFormData((prev) =>
          normalizeAdvancedProtocolConnection({
            ...prev,
            protocol: nextProtocol,
            port: getDefaultConnectionPort(protocol),
            authType: nextAuthType,
            password: "",
            passphrase: "",
            privateKey: "",
            totpSecret: "",
            integration: undefined,
            sshConnectionConfigOverride: sanitizeSshConnectionOverride(
              prev.sshConnectionConfigOverride,
            ),
          }),
        );
        return;
      }

      setFormData((prev) =>
        normalizeAdvancedProtocolConnection({
          ...prev,
          protocol: nextProtocol,
          port: getDefaultConnectionPort(protocol),
          authType: nextAuthType,
          integration: nextIntegration,
        }),
      );
    },
    [
      clearManagedSshSecrets,
      formData,
      hydrateManagedSshSecrets,
      sanitizeSshConnectionOverride,
    ],
  );

  const handleResetToDefaults = useCallback(() => {
    clearManagedSshSecrets();
    setFormData((prev) =>
      normalizeAdvancedProtocolConnection({
        ...DEFAULT_FORM,
        id: prev.id,
        name: prev.name,
        createdAt: prev.createdAt,
        protocol: prev.protocol,
        port: getDefaultConnectionPort(prev.protocol as string),
        integration: buildIntegrationSettings(prev.protocol, undefined),
      }),
    );
  }, [clearManagedSshSecrets]);

  const sshSecrets = useMemo<ManagedSshSecretsController>(
    () => ({
      passwordInputRef: sshPasswordInputRef,
      passphraseInputRef: sshPassphraseInputRef,
      privateKeyInputRef: sshPrivateKeyInputRef,
      hasPassword: hasSshPassword,
      hasPassphrase: hasSshPassphrase,
      hasPrivateKey: hasSshPrivateKey,
      handlePasswordChange: (value: string) =>
        setManagedSshSecret("password", value),
      handlePassphraseChange: (value: string) =>
        setManagedSshSecret("passphrase", value),
      handlePrivateKeyChange: (value: string) =>
        setManagedSshSecret("privateKey", value),
      getPassword: () => sshPasswordRef.current,
      getPassphrase: () => sshPassphraseRef.current,
      getPrivateKey: () => sshPrivateKeyRef.current,
      clearAll: () => clearManagedSshSecrets({ touch: true }),
    }),
    [
      clearManagedSshSecrets,
      hasSshPassphrase,
      hasSshPassword,
      hasSshPrivateKey,
      setManagedSshSecret,
    ],
  );

  const toggleSection = useCallback(
    (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    },
    [],
  );

  const expandSection = useCallback(
    (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) =>
        prev[section] ? prev : { ...prev, [section]: true },
      );
    },
    [],
  );

  return {
    formData,
    setFormData,
    expandedSections,
    autoSaveStatus,
    allTags,
    parentFolderProjection,
    isNewConnection,
    sshSecrets,
    settings,
    connection,
    handleSubmit,
    handleTagsChange,
    handleProtocolChange,
    handleParentFolderChange,
    handleResetToDefaults,
    toggleSection,
    expandSection,
  };
}

export type ConnectionEditorMgr = ReturnType<typeof useConnectionEditor>;
