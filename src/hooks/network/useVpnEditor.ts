import { useState, useCallback, useEffect } from "react";
import { ProxyOpenVPNManager } from "../../utils/network/proxyOpenVPNManager";
import { consumePendingVpnEdit } from "../../utils/network/vpnEditorStore";
import {
  getVpnProviderLabel,
  type LegacyVpnEditorType,
} from "../../utils/network/vpnProviderCatalog";
import {
  isMaskedSecretPlaceholder,
  type IkeV2SecretMutation,
  type IpsecSecretMutation,
  type L2tpSecretMutation,
  type OpenVpnSecretMutation,
  type PptpSecretMutation,
  type SstpSecretMutation,
  type TailscaleSecretMutation,
  type VpnSecretPresence,
  type WireGuardSecretMutation,
  type ZeroTierSecretMutation,
} from "../../utils/network/vpnIpcAdapter";
import { resolveVpnRoutingPolicy } from "../../utils/network/vpnRoutingPolicy";
import type {
  OpenVPNProtocol,
  OpenVPNRedirectGatewayFlag,
  OpenVPNVerifyX509Type,
} from "../../types/settings/vpnSettings";

export type VpnEditorType = LegacyVpnEditorType;

export interface VpnEditingConnection {
  id: string;
  vpnType: VpnEditorType;
  name: string;
  config: Record<string, any>;
  secretPresence?: VpnSecretPresence;
}

export type VpnEditorSecretField =
  | "password"
  | "inlineConfig"
  | "clientKey"
  | "privateKey"
  | "psk"
  | "presharedKey"
  | "authKey"
  | "identitySecret"
  | "authtokenSecret";

type EditorSecretState = Partial<Record<VpnEditorSecretField, boolean>>;

const OPENVPN_PROTOCOLS = [
  "udp",
  "udp4",
  "udp6",
  "tcp",
  "tcp4",
  "tcp6",
] as const satisfies readonly OpenVPNProtocol[];
const OPENVPN_VERIFY_X509_TYPES = [
  "subject",
  "name",
  "name-prefix",
] as const satisfies readonly OpenVPNVerifyX509Type[];
const OPENVPN_REDIRECT_GATEWAY_FLAGS = [
  "local",
  "autolocal",
  "def1",
  "bypass-dhcp",
  "bypass-dns",
  "block-local",
  "ipv6",
  "!ipv4",
] as const satisfies readonly OpenVPNRedirectGatewayFlag[];

type OpenVpnEditorRemote = {
  host: string;
  port: number;
  protocol: OpenVPNProtocol;
};

function openVpnEditorRemotes(
  config: Record<string, any>,
): OpenVpnEditorRemote[] {
  if (Array.isArray(config.remotes) && config.remotes.length > 0) {
    return config.remotes.map((remote: Record<string, any>) => ({
      host: typeof remote?.host === "string" ? remote.host : "",
      port:
        typeof remote?.port === "number" && Number.isFinite(remote.port)
          ? remote.port
          : 1194,
      protocol: OPENVPN_PROTOCOLS.includes(remote?.protocol)
        ? remote.protocol
        : "udp",
    }));
  }
  if (nonEmptyString(config.remoteHost)) {
    return [
      {
        host: config.remoteHost,
        port: typeof config.remotePort === "number" ? config.remotePort : 1194,
        protocol: config.protocol === "tcp" ? "tcp" : "udp",
      },
    ];
  }
  return [];
}

function splitOpenVpnDataCiphers(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[,:\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function openVpnRedirectGatewayFlags(
  value: unknown,
): OpenVPNRedirectGatewayFlag[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (flag): flag is OpenVPNRedirectGatewayFlag =>
          typeof flag === "string" &&
          OPENVPN_REDIRECT_GATEWAY_FLAGS.includes(
            flag as OpenVPNRedirectGatewayFlag,
          ),
      ),
    ),
  );
}

export function buildOpenVpnEditorConfig(
  config: Record<string, any>,
): Record<string, unknown> {
  const cfg: Record<string, unknown> = { enabled: true };
  for (const key of [
    "configFile",
    "inlineConfig",
    "authFile",
    "caCert",
    "clientCert",
    "clientKey",
    "username",
    "password",
    "cipher",
    "auth",
    "tlsVersionMin",
    "verifyX509Name",
    "deviceName",
  ]) {
    if (nonEmptyString(config[key])) cfg[key] = config[key];
  }

  const remotes = openVpnEditorRemotes(config)
    .map((remote) => ({ ...remote, host: remote.host.trim() }))
    .filter((remote) => remote.host !== "");
  if (remotes.length > 0) cfg.remotes = remotes;

  cfg.remoteRandom = config.remoteRandom === true;
  cfg.remoteRandomHostname = config.remoteRandomHostname === true;
  if (typeof config.resolveRetryInfinite === "boolean") {
    cfg.resolveRetryInfinite = config.resolveRetryInfinite;
  }
  cfg.deviceType = config.deviceType === "tap" ? "tap" : "tun";
  cfg.remoteCertTls = config.remoteCertTls !== false;
  cfg.persistTun = config.persistTun !== false;
  cfg.persistKey = config.persistKey !== false;
  cfg.nobind = config.nobind !== false;
  cfg.float = config.float === true;
  cfg.redirectGateway = config.redirectGateway === true;
  if (
    config.redirectGateway === true &&
    Array.isArray(config.redirectGatewayFlags)
  ) {
    cfg.redirectGatewayFlags = openVpnRedirectGatewayFlags(
      config.redirectGatewayFlags,
    );
  }
  cfg.blockOutsideDns = config.blockOutsideDns === true;

  if (nonEmptyString(config.verifyX509Name)) {
    cfg.verifyX509Type = OPENVPN_VERIFY_X509_TYPES.includes(
      config.verifyX509Type,
    )
      ? config.verifyX509Type
      : "name";
  }

  const dataCiphers = splitOpenVpnDataCiphers(
    config.dataCiphersText ?? config.dataCiphers,
  );
  if (dataCiphers.length > 0) cfg.dataCiphers = dataCiphers;

  if (config.tlsAuth) cfg.tlsAuth = true;
  if (config.tlsAuth && config.tlsAuthFile) {
    cfg.tlsAuthFile = config.tlsAuthFile;
  }
  if (config.tlsCrypt) cfg.tlsCrypt = true;
  if (config.tlsCrypt && config.tlsCryptFile) {
    cfg.tlsCryptFile = config.tlsCryptFile;
  }
  if (config.compression) cfg.compression = true;
  if (config.routeNoPull) cfg.routeNoPull = true;
  if (config.mtuDiscover) cfg.mtuDiscover = true;

  for (const key of [
    "mssFix",
    "tunMtu",
    "fragment",
    "connectTimeout",
    "connectRetry",
    "connectRetryMax",
    "serverPollTimeout",
  ]) {
    if (typeof config[key] === "number" && Number.isFinite(config[key])) {
      cfg[key] = config[key];
    }
  }
  if (
    typeof config.connectRetry === "number" &&
    Number.isFinite(config.connectRetry) &&
    typeof config.connectRetryMaxSeconds === "number" &&
    Number.isFinite(config.connectRetryMaxSeconds)
  ) {
    cfg.connectRetryMaxSeconds = config.connectRetryMaxSeconds;
  }
  if (config.keepAliveInterval || config.keepAliveTimeout) {
    cfg.keepAlive = {
      interval: config.keepAliveInterval ?? 10,
      timeout: config.keepAliveTimeout ?? 60,
    };
  }
  if (Array.isArray(config.route)) cfg.route = config.route;
  if (Array.isArray(config.dns)) cfg.dns = config.dns;
  if (typeof config.customOptions === "string") {
    const options = config.customOptions
      .split(/\r?\n/)
      .map((option: string) => option.trim())
      .filter(Boolean);
    if (options.length > 0) cfg.customOptions = options;
  } else if (Array.isArray(config.customOptions)) {
    cfg.customOptions = config.customOptions;
  }
  return cfg;
}

export function getUnsupportedVpnEditorSettings(
  vpnType: VpnEditorType,
  config: Record<string, any>,
): string[] {
  if (vpnType === "wireguard") {
    const hasTable = config.table !== undefined && config.table !== null;
    const tableIsAuto =
      typeof config.table === "string" &&
      config.table.trim().toLowerCase() === "auto";
    return [
      ...(hasTable && !tableIsAuto ? ["custom routing table"] : []),
      ...(config.fwmark !== undefined && config.fwmark !== null
        ? ["FwMark"]
        : []),
    ];
  }
  if (vpnType === "tailscale") {
    return [
      ...(config.funnel === true ? ["Funnel"] : []),
      ...(nonEmptyString(config.stateDir)
        ? ["custom daemon state directory"]
        : []),
      ...(nonEmptyString(config.socket) ? ["custom daemon socket"] : []),
    ];
  }
  return [];
}

export function getVpnEditorValidationError(
  vpnType: VpnEditorType,
  config: Record<string, any>,
): string | null {
  if (vpnType === "ikev2" || vpnType === "ipsec") {
    const { connectDisabledReason } = resolveVpnRoutingPolicy(config);
    if (connectDisabledReason) return connectDisabledReason;
  }
  if (
    vpnType === "openvpn" &&
    !nonEmptyString(config.configFile) &&
    !nonEmptyString(config.inlineConfig)
  ) {
    const remotes = openVpnEditorRemotes(config);
    if (remotes.length === 0) {
      return "Add at least one remote server before saving this OpenVPN profile.";
    }
    for (const [index, remote] of remotes.entries()) {
      if (!nonEmptyString(remote.host)) {
        return `Remote ${index + 1} requires a host.`;
      }
      if (
        !Number.isInteger(remote.port) ||
        remote.port < 1 ||
        remote.port > 65535
      ) {
        return `Remote ${index + 1} requires a port between 1 and 65535.`;
      }
      if (!OPENVPN_PROTOCOLS.includes(remote.protocol)) {
        return `Remote ${index + 1} has an unsupported protocol.`;
      }
    }
    const incompleteRoute = Array.isArray(config.route)
      ? config.route.find(
          (route: Record<string, any>) =>
            !nonEmptyString(route?.network) || !nonEmptyString(route?.netmask),
        )
      : undefined;
    if (incompleteRoute) {
      return "Every OpenVPN route requires both a network and netmask.";
    }
    const incompleteDns = Array.isArray(config.dns)
      ? config.dns.find(
          (entry: Record<string, any>) => !nonEmptyString(entry?.server),
        )
      : undefined;
    if (incompleteDns) {
      return "Every OpenVPN DNS entry requires a server address.";
    }
    if (
      typeof config.connectRetryMaxSeconds === "number" &&
      !(
        typeof config.connectRetry === "number" &&
        Number.isFinite(config.connectRetry)
      )
    ) {
      return "Set a retry delay before setting its maximum retry delay.";
    }
    if (config.tlsAuth === true && config.tlsCrypt === true) {
      return "TLS Auth and TLS Crypt are mutually exclusive for an OpenVPN client profile.";
    }
    if (config.tlsAuth === true && !nonEmptyString(config.tlsAuthFile)) {
      return "Select a TLS Auth key file before saving this OpenVPN profile.";
    }
    if (config.tlsCrypt === true && !nonEmptyString(config.tlsCryptFile)) {
      return "Select a TLS Crypt key file before saving this OpenVPN profile.";
    }
  }
  return null;
}

export function useVpnEditor(
  isOpen: boolean,
  editingConnection: VpnEditingConnection | null | undefined,
  onSave: () => void,
) {
  const mgr = ProxyOpenVPNManager.getInstance();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [vpnType, setVpnType] = useState<VpnEditorType>("openvpn");
  const [config, setConfig] = useState<Record<string, any>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [storedSecrets, setStoredSecrets] = useState<EditorSecretState>({});
  const [secretClears, setSecretClears] = useState<EditorSecretState>({});

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setVpnType("openvpn");
    setConfig({});
    setTags([]);
    setTagInput("");
    setError(null);
    setEditingId(null);
    setStoredSecrets({});
    setSecretClears({});
  }, []);

  // Populate form when editing, reset when creating
  useEffect(() => {
    if (!isOpen) return;

    // Check for pending edit from the store (passed from VpnConnectionsTab)
    const pending = consumePendingVpnEdit();
    const toEdit =
      editingConnection ?? (pending ? (pending as VpnEditingConnection) : null);

    if (toEdit) {
      setName(toEdit.name);
      setVpnType(toEdit.vpnType as VpnEditorType);
      setConfig(toVpnEditorFormConfig(toEdit.vpnType, toEdit.config ?? {}));
      setStoredSecrets(
        mergeEditorSecretPresence(
          inferEditorSecretPresence(toEdit.vpnType, toEdit.config ?? {}),
          normalizeEditorSecretPresence(toEdit.vpnType, toEdit.secretPresence),
        ),
      );
      setSecretClears({});
      setDescription("");
      setTags([]);
      setEditingId(toEdit.id);
    } else {
      resetForm();
    }
  }, [isOpen, editingConnection, resetForm]);

  // Reset config when vpnType changes (only in create mode)
  const handleTypeChange = useCallback(
    (newType: VpnEditorType) => {
      setVpnType(newType);
      if (!editingConnection && !editingId) {
        setConfig({});
      }
    },
    [editingConnection, editingId],
  );

  const updateConfig = useCallback((updates: Record<string, any>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
    setSecretClears((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [field, value] of Object.entries(updates)) {
        if (
          isVpnEditorSecretField(field) &&
          nonEmptyString(value) &&
          next[field]
        ) {
          next[field] = false;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  const clearSecret = useCallback(
    (field: VpnEditorSecretField) => {
      // Imported OpenVPN source is authoritative and cannot be reconstructed
      // from the redacted metadata returned to the editor. It may be replaced,
      // but clearing it would strand or silently alter the profile.
      if (field === "inlineConfig" && storedSecrets.inlineConfig === true) {
        return;
      }
      setConfig((previous) => ({ ...previous, [field]: undefined }));
      setSecretClears((previous) => ({ ...previous, [field]: true }));
    },
    [storedSecrets.inlineConfig],
  );

  const undoClearSecret = useCallback((field: VpnEditorSecretField) => {
    setSecretClears((previous) => ({ ...previous, [field]: false }));
  }, []);

  const getSecretState = useCallback(
    (field: VpnEditorSecretField) => ({
      stored: storedSecrets[field] === true,
      clearRequested: secretClears[field] === true,
      replacementEntered: nonEmptyString(config[field]),
    }),
    [config, secretClears, storedSecrets],
  );

  const unsupportedSettings = getUnsupportedVpnEditorSettings(vpnType, config);
  const validationConfig =
    vpnType === "openvpn" &&
    storedSecrets.inlineConfig === true &&
    secretClears.inlineConfig !== true &&
    !nonEmptyString(config.inlineConfig)
      ? { ...config, inlineConfig: "stored-inline-config" }
      : config;
  const validationError =
    getVpnEditorValidationError(vpnType, validationConfig) ??
    getSecretEditorValidationError(config, secretClears);
  const removeUnsupportedSettings = useCallback(() => {
    setError(null);
    setConfig((previous) => {
      switch (vpnType) {
        case "wireguard":
          return { ...previous, table: undefined, fwmark: undefined };
        case "tailscale":
          return {
            ...previous,
            funnel: undefined,
            stateDir: undefined,
            socket: undefined,
          };
        case "zerotier":
          return { ...previous, identity: undefined };
        default:
          return previous;
      }
    });
  }, [vpnType]);

  // Tags
  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
      setTagInput("");
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag],
  );

  // Build typed config from form state
  const buildTypedConfig = useCallback((): Record<string, unknown> => {
    const splitCsv = (s?: string): string[] =>
      s
        ? s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
    const splitLines = (s?: string): string[] =>
      s
        ? s
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];

    switch (vpnType) {
      case "openvpn": {
        return buildOpenVpnEditorConfig(config);
      }
      case "wireguard": {
        return {
          enabled: true,
          configFile: config.configFile || undefined,
          interface: {
            privateKey: config.privateKey || undefined,
            address: splitCsv(config.address),
            dns: splitCsv(config.dns).length ? splitCsv(config.dns) : undefined,
            mtu: config.mtu || undefined,
            table: config.table ?? undefined,
          },
          peer: {
            publicKey: config.publicKey || undefined,
            presharedKey: config.presharedKey || undefined,
            endpoint: config.endpoint || undefined,
            allowedIPs: splitCsv(config.allowedIPs || "0.0.0.0/0"),
            persistentKeepalive: config.persistentKeepalive || undefined,
          },
          listenPort: config.listenPort || undefined,
          fwmark: config.fwmark || undefined,
          interfaceName: config.interfaceName || undefined,
        };
      }
      case "tailscale": {
        const cfg: Record<string, unknown> = { enabled: true };
        if (config.authKey) cfg.authKey = config.authKey;
        if (config.loginServer) cfg.loginServer = config.loginServer;
        if (config.exitNode) cfg.exitNode = config.exitNode;
        const advRoutes = splitCsv(config.advertiseRoutes);
        if (advRoutes.length) cfg.advertiseRoutes = advRoutes;
        if (Array.isArray(config.advertiseTags))
          cfg.advertiseTags = config.advertiseTags;
        if (config.acceptRoutes !== undefined)
          cfg.acceptRoutes = config.acceptRoutes;
        if (config.acceptDNS !== undefined) cfg.acceptDNS = config.acceptDNS;
        if (config.hostname) cfg.hostname = config.hostname;
        if (config.exitNodeAllowLanAccess !== undefined)
          cfg.exitNodeAllowLanAccess = config.exitNodeAllowLanAccess;
        if (config.ssh !== undefined) cfg.ssh = config.ssh;
        if (config.funnel !== undefined) cfg.funnel = config.funnel;
        if (config.stateDir) cfg.stateDir = config.stateDir;
        if (config.socket) cfg.socket = config.socket;
        return cfg;
      }
      case "zerotier": {
        const cfg: Record<string, unknown> = {
          enabled: true,
          networkId: config.networkId ?? "",
        };
        if (config.allowManaged !== undefined)
          cfg.allowManaged = config.allowManaged;
        if (config.allowGlobal !== undefined)
          cfg.allowGlobal = config.allowGlobal;
        if (config.allowDefault !== undefined)
          cfg.allowDefault = config.allowDefault;
        if (config.allowDNS !== undefined) cfg.allowDNS = config.allowDNS;
        if (config.zerotierHome) cfg.zerotierHome = config.zerotierHome;
        if (config.identityPublic || config.identitySecret) {
          cfg.identity = {
            public: config.identityPublic || undefined,
            secret: config.identitySecret || undefined,
          };
        }
        if (config.authtokenSecret)
          cfg.authtokenSecret = config.authtokenSecret;
        return cfg;
      }
      case "pptp": {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? "",
          username: config.username ?? "",
          password: config.password ?? "",
        };
        if (config.domain) cfg.domain = config.domain;
        if (config.requireMppe !== undefined)
          cfg.requireMppe = config.requireMppe;
        if (config.mppeStateful !== undefined)
          cfg.mppeStateful = config.mppeStateful;
        if (config.refuseEap !== undefined) cfg.refuseEap = config.refuseEap;
        if (config.refusePap !== undefined) cfg.refusePap = config.refusePap;
        if (config.refuseChap !== undefined) cfg.refuseChap = config.refuseChap;
        if (config.refuseMsChap !== undefined)
          cfg.refuseMsChap = config.refuseMsChap;
        if (config.refuseMsChapV2 !== undefined)
          cfg.refuseMsChapV2 = config.refuseMsChapV2;
        if (config.nobsdcomp !== undefined) cfg.nobsdcomp = config.nobsdcomp;
        if (config.nodeflate !== undefined) cfg.nodeflate = config.nodeflate;
        if (config.noVjComp !== undefined) cfg.noVjComp = config.noVjComp;
        const pptpOpts = splitLines(config.customOptions);
        if (pptpOpts.length) cfg.customOptions = pptpOpts;
        return cfg;
      }
      case "l2tp": {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? "",
          username: config.username ?? "",
          password: config.password ?? "",
        };
        if (config.psk) cfg.psk = config.psk;
        // PPP settings
        const ppp: Record<string, unknown> = {};
        if (config.pppMru !== undefined) ppp.mru = config.pppMru;
        if (config.pppMtu !== undefined) ppp.mtu = config.pppMtu;
        if (config.lcpEchoInterval !== undefined)
          ppp.lcpEchoInterval = config.lcpEchoInterval;
        if (config.lcpEchoFailure !== undefined)
          ppp.lcpEchoFailure = config.lcpEchoFailure;
        if (config.requireChap !== undefined)
          ppp.requireChap = config.requireChap;
        if (config.refuseChap !== undefined) ppp.refuseChap = config.refuseChap;
        if (config.requireMsChap !== undefined)
          ppp.requireMsChap = config.requireMsChap;
        if (config.refuseMsChap !== undefined)
          ppp.refuseMsChap = config.refuseMsChap;
        if (config.requireMsChapV2 !== undefined)
          ppp.requireMsChapV2 = config.requireMsChapV2;
        if (config.refuseMsChapV2 !== undefined)
          ppp.refuseMsChapV2 = config.refuseMsChapV2;
        if (config.requireEap !== undefined) ppp.requireEap = config.requireEap;
        if (config.refuseEap !== undefined) ppp.refuseEap = config.refuseEap;
        if (config.requirePap !== undefined) ppp.requirePap = config.requirePap;
        if (config.refusePap !== undefined) ppp.refusePap = config.refusePap;
        if (Object.keys(ppp).length) cfg.pppSettings = ppp;
        // IPsec settings
        const ipsec: Record<string, unknown> = {};
        if (config.ipsecIke) ipsec.ike = config.ipsecIke;
        if (config.ipsecEsp) ipsec.esp = config.ipsecEsp;
        if (config.ipsecPfs) ipsec.pfs = config.ipsecPfs;
        if (config.ipsecIkeLifetime !== undefined)
          ipsec.ikelifetime = config.ipsecIkeLifetime;
        if (config.ipsecLifetime !== undefined)
          ipsec.lifetime = config.ipsecLifetime;
        if (config.ipsecPhase2Alg) ipsec.phase2alg = config.ipsecPhase2Alg;
        if (Object.keys(ipsec).length) cfg.ipsecSettings = ipsec;
        const l2tpOpts = splitLines(config.customOptions);
        if (l2tpOpts.length) cfg.customOptions = l2tpOpts;
        return cfg;
      }
      case "ikev2": {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? "",
          routingMode: config.routingMode ?? "full",
          remoteSubnets:
            config.routingMode === "split"
              ? normalizeRemoteSubnets(config.remoteSubnets)
              : [],
          username: config.username ?? "",
        };
        if (config.password) cfg.password = config.password;
        if (config.certificate) cfg.certificate = config.certificate;
        if (config.privateKey) cfg.privateKey = config.privateKey;
        if (config.caCertificate) cfg.caCertificate = config.caCertificate;
        if (config.eapMethod) cfg.eapMethod = config.eapMethod;
        if (config.phase1Algorithms)
          cfg.phase1Algorithms = config.phase1Algorithms;
        if (config.phase2Algorithms)
          cfg.phase2Algorithms = config.phase2Algorithms;
        if (config.localId) cfg.localId = config.localId;
        if (config.remoteId) cfg.remoteId = config.remoteId;
        if (config.fragmentation !== undefined)
          cfg.fragmentation = config.fragmentation;
        if (config.mobike !== undefined) cfg.mobike = config.mobike;
        const ikev2Opts = splitLines(config.customOptions);
        if (ikev2Opts.length) cfg.customOptions = ikev2Opts;
        return cfg;
      }
      case "ipsec": {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? "",
          routingMode: config.routingMode ?? "full",
          remoteSubnets:
            config.routingMode === "split"
              ? normalizeRemoteSubnets(config.remoteSubnets)
              : [],
        };
        if (config.authMethod) cfg.authMethod = config.authMethod;
        if (config.psk) cfg.psk = config.psk;
        if (config.certificate) cfg.certificate = config.certificate;
        if (config.privateKey) cfg.privateKey = config.privateKey;
        if (config.caCertificate) cfg.caCertificate = config.caCertificate;
        if (config.phase1Proposals)
          cfg.phase1Proposals = config.phase1Proposals;
        if (config.phase2Proposals)
          cfg.phase2Proposals = config.phase2Proposals;
        if (config.saLifetime) cfg.saLifetime = config.saLifetime;
        if (config.dpdDelay) cfg.dpdDelay = config.dpdDelay;
        if (config.dpdTimeout) cfg.dpdTimeout = config.dpdTimeout;
        if (config.tunnelMode !== undefined) cfg.tunnelMode = config.tunnelMode;
        const ipsecOpts = splitLines(config.customOptions);
        if (ipsecOpts.length) cfg.customOptions = ipsecOpts;
        return cfg;
      }
      case "sstp": {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? "",
          username: config.username ?? "",
        };
        if (config.password) cfg.password = config.password;
        if (config.domain) cfg.domain = config.domain;
        if (config.certificate) cfg.certificate = config.certificate;
        if (config.caCertificate) cfg.caCertificate = config.caCertificate;
        if (config.ignoreCertificate !== undefined)
          cfg.ignoreCertificate = config.ignoreCertificate;
        if (config.proxy) cfg.proxy = config.proxy;
        const sstpOpts = splitLines(config.customOptions);
        if (sstpOpts.length) cfg.customOptions = sstpOpts;
        return cfg;
      }
    }
  }, [vpnType, config]);

  const buildSecretMutation = useCallback(():
    | OpenVpnSecretMutation
    | WireGuardSecretMutation
    | TailscaleSecretMutation
    | ZeroTierSecretMutation
    | IkeV2SecretMutation
    | IpsecSecretMutation
    | L2tpSecretMutation
    | PptpSecretMutation
    | SstpSecretMutation
    | undefined => {
    switch (vpnType) {
      case "openvpn": {
        const mutation: OpenVpnSecretMutation = {
          clearPassword: secretClears.password === true,
          clearInlineConfig: secretClears.inlineConfig === true,
          clearClientKey: secretClears.clientKey === true,
        };
        return Object.values(mutation).some(Boolean) ? mutation : undefined;
      }
      case "wireguard": {
        const mutation: WireGuardSecretMutation = {
          clearPrivateKey: secretClears.privateKey === true,
          clearPresharedKey: secretClears.presharedKey === true,
        };
        return Object.values(mutation).some(Boolean) ? mutation : undefined;
      }
      case "tailscale": {
        const mutation: TailscaleSecretMutation = {
          clearAuthKey: secretClears.authKey === true,
        };
        return Object.values(mutation).some(Boolean) ? mutation : undefined;
      }
      case "zerotier": {
        const mutation: ZeroTierSecretMutation = {
          clearIdentitySecret: secretClears.identitySecret === true,
          clearAuthtokenSecret: secretClears.authtokenSecret === true,
        };
        return Object.values(mutation).some(Boolean) ? mutation : undefined;
      }
      case "ikev2": {
        const mutation: IkeV2SecretMutation = {
          clearPassword: secretClears.password === true,
          clearPrivateKey: secretClears.privateKey === true,
        };
        return Object.values(mutation).some(Boolean) ? mutation : undefined;
      }
      case "ipsec": {
        const mutation: IpsecSecretMutation = {
          clearPsk: secretClears.psk === true,
          clearPrivateKey: secretClears.privateKey === true,
        };
        return Object.values(mutation).some(Boolean) ? mutation : undefined;
      }
      case "l2tp": {
        const mutation: L2tpSecretMutation = {
          clearPassword: secretClears.password === true,
          clearPsk: secretClears.psk === true,
        };
        return Object.values(mutation).some(Boolean) ? mutation : undefined;
      }
      case "pptp":
      case "sstp": {
        const mutation: PptpSecretMutation | SstpSecretMutation = {
          clearPassword: secretClears.password === true,
        };
        return Object.values(mutation).some(Boolean) ? mutation : undefined;
      }
      default:
        return undefined;
    }
  }, [secretClears, vpnType]);

  // Save
  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    if (unsupportedSettings.length > 0) {
      setError(
        `Remove unsupported ${getVpnProviderLabel(vpnType)} settings before saving: ${unsupportedSettings.join(", ")}.`,
      );
      return;
    }
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const typedConfig = buildTypedConfig();
      const secretMutation = buildSecretMutation();
      if (editingId) {
        // Update existing connection
        switch (vpnType) {
          case "openvpn":
            if (secretMutation) {
              await mgr.updateOpenVPNConnection(
                editingId,
                name.trim(),
                typedConfig as any,
                secretMutation as OpenVpnSecretMutation,
              );
            } else {
              await mgr.updateOpenVPNConnection(
                editingId,
                name.trim(),
                typedConfig as any,
              );
            }
            break;
          case "wireguard":
            if (secretMutation) {
              await mgr.updateWireGuardConnection(
                editingId,
                name.trim(),
                typedConfig as any,
                secretMutation as WireGuardSecretMutation,
              );
            } else {
              await mgr.updateWireGuardConnection(
                editingId,
                name.trim(),
                typedConfig as any,
              );
            }
            break;
          case "tailscale":
            if (secretMutation) {
              await mgr.updateTailscaleConnection(
                editingId,
                name.trim(),
                typedConfig as any,
                secretMutation as TailscaleSecretMutation,
              );
            } else {
              await mgr.updateTailscaleConnection(
                editingId,
                name.trim(),
                typedConfig as any,
              );
            }
            break;
          case "zerotier":
            if (secretMutation) {
              await mgr.updateZeroTierConnection(
                editingId,
                name.trim(),
                typedConfig as any,
                secretMutation as ZeroTierSecretMutation,
              );
            } else {
              await mgr.updateZeroTierConnection(
                editingId,
                name.trim(),
                typedConfig as any,
              );
            }
            break;
          case "pptp":
            await mgr.updatePPTPConnection(
              editingId,
              name.trim(),
              typedConfig as any,
              secretMutation as PptpSecretMutation | undefined,
            );
            break;
          case "l2tp":
            await mgr.updateL2TPConnection(
              editingId,
              name.trim(),
              typedConfig as any,
              secretMutation as L2tpSecretMutation | undefined,
            );
            break;
          case "ikev2":
            await mgr.updateIKEv2Connection(
              editingId,
              name.trim(),
              typedConfig as any,
              secretMutation as IkeV2SecretMutation | undefined,
            );
            break;
          case "ipsec":
            await mgr.updateIPsecConnection(
              editingId,
              name.trim(),
              typedConfig as any,
              secretMutation as IpsecSecretMutation | undefined,
            );
            break;
          case "sstp":
            await mgr.updateSSTPConnection(
              editingId,
              name.trim(),
              typedConfig as any,
              secretMutation as SstpSecretMutation | undefined,
            );
            break;
        }
      } else {
        // Create new connection
        switch (vpnType) {
          case "openvpn":
            await mgr.createOpenVPNConnection(name.trim(), typedConfig as any);
            break;
          case "wireguard":
            await mgr.createWireGuardConnection(
              name.trim(),
              typedConfig as any,
            );
            break;
          case "tailscale":
            await mgr.createTailscaleConnection(
              name.trim(),
              typedConfig as any,
            );
            break;
          case "zerotier":
            await mgr.createZeroTierConnection(name.trim(), typedConfig as any);
            break;
          case "pptp":
            await mgr.createPPTPConnection(name.trim(), typedConfig as any);
            break;
          case "l2tp":
            await mgr.createL2TPConnection(name.trim(), typedConfig as any);
            break;
          case "ikev2":
            await mgr.createIKEv2Connection(name.trim(), typedConfig as any);
            break;
          case "ipsec":
            await mgr.createIPsecConnection(name.trim(), typedConfig as any);
            break;
          case "sstp":
            await mgr.createSSTPConnection(name.trim(), typedConfig as any);
            break;
        }
      }
      resetForm();
      onSave();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save VPN connection",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    name,
    vpnType,
    editingId,
    buildTypedConfig,
    buildSecretMutation,
    mgr,
    resetForm,
    onSave,
    unsupportedSettings,
    validationError,
  ]);

  const canSave =
    name.trim() !== "" &&
    unsupportedSettings.length === 0 &&
    validationError === null;

  return {
    name,
    setName,
    description,
    setDescription,
    vpnType,
    handleTypeChange,
    config,
    updateConfig,
    setConfig,
    clearSecret,
    undoClearSecret,
    getSecretState,
    unsupportedSettings,
    removeUnsupportedSettings,
    tags,
    tagInput,
    setTagInput,
    handleAddTag,
    handleRemoveTag,
    handleTagKeyDown,
    isSaving,
    error,
    validationError,
    handleSave,
    canSave,
    editingConnection,
    editingId,
    resetForm,
  };
}

/** Convert persisted application VPN models into the deliberately flat form
 * state consumed by VpnEditor. Unsupported non-secret values stay on the form
 * so unrelated edits cannot discard them; secret values are always removed
 * and represented only by the separate presence/clear state. */
export function toVpnEditorFormConfig(
  vpnType: VpnEditorType,
  source: Record<string, any>,
): Record<string, any> {
  switch (vpnType) {
    case "openvpn": {
      const {
        password: _password,
        inlineConfig: _inlineConfig,
        clientKey: _clientKey,
        remoteHost: _remoteHost,
        remotePort: _remotePort,
        protocol: _protocol,
        dataCiphers: _dataCiphers,
        ...safeOpenVpn
      } = source;
      return {
        ...safeOpenVpn,
        password: undefined,
        inlineConfig: undefined,
        clientKey: undefined,
        remotes: openVpnEditorRemotes(source),
        dataCiphersText: Array.isArray(source.dataCiphers)
          ? source.dataCiphers.join(":")
          : "",
        keepAliveInterval: source.keepAlive?.interval,
        keepAliveTimeout: source.keepAlive?.timeout,
        customOptions: joinLines(source.customOptions),
      };
    }
    case "wireguard":
      return {
        configFile: source.configFile,
        privateKey: undefined,
        address: joinCsv(source.interface?.address),
        dns: joinCsv(source.interface?.dns),
        mtu: source.interface?.mtu,
        table: source.interface?.table,
        publicKey: source.peer?.publicKey,
        presharedKey: undefined,
        endpoint: source.peer?.endpoint,
        allowedIPs: joinCsv(source.peer?.allowedIPs),
        persistentKeepalive: source.peer?.persistentKeepalive,
        listenPort: source.listenPort,
        fwmark: source.fwmark,
        interfaceName: source.interfaceName,
      };
    case "tailscale":
      const { authKey: _authKey, ...safeTailscale } = source;
      return {
        ...safeTailscale,
        authKey: undefined,
        advertiseRoutes: joinCsv(source.advertiseRoutes),
      };
    case "zerotier":
      return {
        ...source,
        identityPublic: source.identity?.public,
        identitySecret: undefined,
        authtokenSecret: undefined,
      };
    case "l2tp":
      return {
        ...source,
        password: undefined,
        psk: undefined,
        pppMru: source.pppSettings?.mru,
        pppMtu: source.pppSettings?.mtu,
        lcpEchoInterval: source.pppSettings?.lcpEchoInterval,
        lcpEchoFailure: source.pppSettings?.lcpEchoFailure,
        requireChap: source.pppSettings?.requireChap,
        refuseChap: source.pppSettings?.refuseChap,
        requireMsChap: source.pppSettings?.requireMsChap,
        refuseMsChap: source.pppSettings?.refuseMsChap,
        requireMsChapV2: source.pppSettings?.requireMsChapV2,
        refuseMsChapV2: source.pppSettings?.refuseMsChapV2,
        requireEap: source.pppSettings?.requireEap,
        refuseEap: source.pppSettings?.refuseEap,
        requirePap: source.pppSettings?.requirePap,
        refusePap: source.pppSettings?.refusePap,
        ipsecIke: source.ipsecSettings?.ike,
        ipsecEsp: source.ipsecSettings?.esp,
        ipsecPfs: source.ipsecSettings?.pfs,
        ipsecIkeLifetime: source.ipsecSettings?.ikelifetime,
        ipsecLifetime: source.ipsecSettings?.lifetime,
        ipsecPhase2Alg: source.ipsecSettings?.phase2alg,
        customOptions: joinLines(source.customOptions),
      };
    case "ikev2":
      return {
        ...source,
        routingMode: source.routingMode ?? "full",
        remoteSubnets: Array.isArray(source.remoteSubnets)
          ? source.remoteSubnets
          : [],
        password: undefined,
        privateKey: undefined,
        customOptions: joinLines(source.customOptions),
      };
    case "ipsec":
      return {
        ...source,
        routingMode: source.routingMode ?? "full",
        remoteSubnets: Array.isArray(source.remoteSubnets)
          ? source.remoteSubnets
          : [],
        psk: undefined,
        privateKey: undefined,
        customOptions: joinLines(source.customOptions),
      };
    case "sstp":
    case "pptp":
      return {
        ...source,
        password: undefined,
        customOptions: joinLines(source.customOptions),
      };
    default:
      return source;
  }
}

function joinCsv(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .join(", ")
    : typeof value === "string"
      ? value
      : "";
}

function normalizeRemoteSubnets(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function isVpnEditorSecretField(value: string): value is VpnEditorSecretField {
  return [
    "password",
    "inlineConfig",
    "clientKey",
    "privateKey",
    "psk",
    "presharedKey",
    "authKey",
    "identitySecret",
    "authtokenSecret",
  ].includes(value);
}

function normalizeEditorSecretPresence(
  vpnType: VpnEditorType,
  presence: VpnSecretPresence | undefined,
): EditorSecretState {
  const source = (presence ?? {}) as Record<string, unknown>;
  switch (vpnType) {
    case "openvpn":
      return {
        password: source.password === true,
        inlineConfig: source.inlineConfig === true,
        clientKey: source.clientKey === true,
      };
    case "wireguard":
      return {
        privateKey: source.privateKey === true,
        presharedKey: source.presharedKey === true,
      };
    case "tailscale":
      return { authKey: source.authKey === true };
    case "zerotier":
      return {
        identitySecret: source.identitySecret === true,
        authtokenSecret: source.authtokenSecret === true,
      };
    case "ikev2":
      return {
        password: source.password === true,
        privateKey: source.privateKey === true,
      };
    case "ipsec":
      return {
        psk: source.psk === true,
        privateKey: source.privateKey === true,
      };
    case "l2tp":
      return { password: source.password === true, psk: source.psk === true };
    case "pptp":
    case "sstp":
      return { password: source.password === true };
    default:
      return {};
  }
}

function inferEditorSecretPresence(
  vpnType: VpnEditorType,
  config: Record<string, any>,
): EditorSecretState {
  switch (vpnType) {
    case "openvpn":
      return {
        password: nonEmptyString(config.password),
        inlineConfig: nonEmptyString(config.inlineConfig),
        clientKey: nonEmptyString(config.clientKey),
      };
    case "wireguard":
      return {
        privateKey: nonEmptyString(config.interface?.privateKey),
        presharedKey: nonEmptyString(config.peer?.presharedKey),
      };
    case "tailscale":
      return { authKey: nonEmptyString(config.authKey) };
    case "zerotier":
      return {
        identitySecret: nonEmptyString(config.identity?.secret),
        authtokenSecret: nonEmptyString(config.authtokenSecret),
      };
    case "ikev2":
      return {
        password: nonEmptyString(config.password),
        privateKey: nonEmptyString(config.privateKey),
      };
    case "ipsec":
      return {
        psk: nonEmptyString(config.psk),
        privateKey: nonEmptyString(config.privateKey),
      };
    case "l2tp":
      return {
        password: nonEmptyString(config.password),
        psk: nonEmptyString(config.psk),
      };
    case "pptp":
    case "sstp":
      return { password: nonEmptyString(config.password) };
    default:
      return {};
  }
}

function mergeEditorSecretPresence(
  inferred: EditorSecretState,
  declared: EditorSecretState,
): EditorSecretState {
  const result = { ...inferred };
  for (const field of Object.keys(declared) as VpnEditorSecretField[]) {
    result[field] = inferred[field] === true || declared[field] === true;
  }
  return result;
}

function getSecretEditorValidationError(
  config: Record<string, any>,
  clears: EditorSecretState,
): string | null {
  for (const field of Object.keys(clears) as VpnEditorSecretField[]) {
    if (clears[field] && nonEmptyString(config[field])) {
      return "A secret cannot be replaced and cleared in the same update.";
    }
  }
  for (const field of [
    "password",
    "inlineConfig",
    "clientKey",
    "privateKey",
    "psk",
    "presharedKey",
    "authKey",
    "identitySecret",
    "authtokenSecret",
  ] as VpnEditorSecretField[]) {
    if (isMaskedSecretPlaceholder(config[field])) {
      return "Masked secret placeholders cannot be saved. Enter a new value or leave the field blank.";
    }
  }
  return null;
}

function joinLines(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .join("\n")
    : typeof value === "string"
      ? value
      : "";
}
