import type {
  OpenVPNConfig,
  TailscaleConfig,
  WireGuardConfig,
  ZeroTierConfig,
} from "../../types/settings/settings";
import type { ImportVpnData, VpnPortabilityMetadata } from "./types";

export type PortableVpnProvider = keyof ImportVpnData;

type UnknownRecord = Record<string, unknown>;
type AnyPortableVpnConnection = ImportVpnData[keyof ImportVpnData][number];

export interface PreparedVpnTransfer<T extends AnyPortableVpnConnection> {
  connection: T;
  warnings: string[];
}

export interface PreparedVpnDataTransfer {
  data: ImportVpnData;
  warnings: string[];
}

const PROVIDER_LABELS: Record<PortableVpnProvider, string> = {
  openvpn: "OpenVPN",
  wireguard: "WireGuard",
  tailscale: "Tailscale",
  zerotier: "ZeroTier",
};

const REDACTED_WARNING: Record<PortableVpnProvider, string> = {
  openvpn:
    "OpenVPN credentials, raw configuration, private key material, and credential paths were removed. This recovery record will be omitted on import or clone.",
  wireguard:
    "WireGuard private key, preshared key, raw configuration path, and hook commands were removed. This recovery record will be omitted on import or clone.",
  tailscale:
    "Tailscale authentication key and state/socket paths were removed. This recovery record will be omitted on import or clone.",
  zerotier:
    "ZeroTier identity secret, authentication token, and credential home path were removed. This recovery record will be omitted on import or clone.",
};

const UNAVAILABLE_WARNING: Record<PortableVpnProvider, string> = {
  openvpn:
    "The source reports stored OpenVPN secrets, but did not expose their values for backup. This recovery record will be omitted on import or clone.",
  wireguard:
    "The source reports stored WireGuard secrets, but did not expose their values for backup. This recovery record will be omitted on import or clone.",
  tailscale:
    "The source reports a stored Tailscale authentication key, but did not expose its value for backup. This recovery record will be omitted on import or clone.",
  zerotier:
    "The source reports stored ZeroTier secrets, but did not expose their values for backup. This recovery record will be omitted on import or clone.",
};

const MALFORMED_PORTABILITY_WARNING =
  "VPN portability metadata is incomplete or malformed. This recovery record will be omitted on import or clone.";

export function normalizeVpnImportData(
  value: unknown,
): ImportVpnData | undefined {
  if (!isRecord(value)) return undefined;

  return {
    openvpn: normalizeConnectionArray(
      "openvpn",
      value.openvpn ?? value.open_vpn ?? value.openvpn_connections,
    ),
    wireguard: normalizeConnectionArray(
      "wireguard",
      value.wireguard ?? value.wire_guard ?? value.wireguard_connections,
    ),
    tailscale: normalizeConnectionArray(
      "tailscale",
      value.tailscale ?? value.tail_scale ?? value.tailscale_connections,
    ),
    zerotier: normalizeConnectionArray(
      "zerotier",
      value.zerotier ?? value.zero_tier ?? value.zerotier_connections,
    ),
  };
}

export function prepareVpnDataForTransfer(
  data: ImportVpnData,
  includeCredentials: boolean,
): PreparedVpnDataTransfer {
  const warnings: string[] = [];
  const prepare = <K extends PortableVpnProvider>(
    provider: K,
    connections: ImportVpnData[K],
  ): ImportVpnData[K] =>
    connections.map((connection) => {
      const prepared = prepareVpnConnectionForTransfer(
        provider,
        connection,
        includeCredentials,
      );
      warnings.push(...prepared.warnings);
      return prepared.connection as ImportVpnData[K][number];
    }) as ImportVpnData[K];

  return {
    data: {
      openvpn: prepare("openvpn", data.openvpn),
      wireguard: prepare("wireguard", data.wireguard),
      tailscale: prepare("tailscale", data.tailscale),
      zerotier: prepare("zerotier", data.zerotier),
    },
    warnings: unique(warnings),
  };
}

export function prepareVpnConnectionForTransfer<K extends PortableVpnProvider>(
  provider: K,
  value: ImportVpnData[K][number],
  includeCredentials: boolean,
): PreparedVpnTransfer<ImportVpnData[K][number]> {
  const connection = normalizeVpnConnection(provider, value);
  const existingWarnings = getVpnPortabilityWarnings(connection);

  if (!includeCredentials) {
    const warning = REDACTED_WARNING[provider];
    const portability: VpnPortabilityMetadata = {
      version: 1,
      credentials: "redacted",
      executable: false,
      warnings: unique([...existingWarnings, warning]),
    };
    return {
      connection: {
        ...connection,
        status: "disconnected",
        connectedAt: undefined,
        config: sanitizeConfig(provider, connection.config),
        portability,
        secretPresence: undefined,
        secret_presence: undefined,
      } as ImportVpnData[K][number],
      warnings: [profileWarning(provider, connection.name, warning)],
    };
  }

  const unavailable = getUnavailableStoredSecretNames(provider, connection);
  if (unavailable.length === 0) {
    return {
      connection: connection as ImportVpnData[K][number],
      warnings: existingWarnings.map((warning) =>
        profileWarning(provider, connection.name, warning),
      ),
    };
  }

  const warning = `${UNAVAILABLE_WARNING[provider]} Missing: ${unavailable.join(", ")}.`;
  const portability: VpnPortabilityMetadata = {
    version: 1,
    credentials: "unavailable",
    executable: false,
    warnings: unique([...existingWarnings, warning]),
  };
  return {
    connection: {
      ...connection,
      status: "disconnected",
      connectedAt: undefined,
      config: disableConfig(provider, connection.config),
      portability,
      secretPresence: undefined,
      secret_presence: undefined,
    } as ImportVpnData[K][number],
    warnings: [profileWarning(provider, connection.name, warning)],
  };
}

export function getVpnPortabilityWarnings(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.portability)) return [];
  return stringArray(value.portability.warnings);
}

export function isVpnProfileExecutable(
  provider: PortableVpnProvider,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false;

  if (Object.prototype.hasOwnProperty.call(value, "portability")) {
    if (!isRecord(value.portability)) return false;
    if (
      value.portability.credentials !== "included" ||
      value.portability.executable !== true
    ) {
      return false;
    }
  }

  return hasProviderMinimumExecutableConfig(provider, value.config);
}

function normalizeConnectionArray<K extends PortableVpnProvider>(
  provider: K,
  value: unknown,
): ImportVpnData[K] {
  if (!Array.isArray(value)) return [] as unknown as ImportVpnData[K];
  return value
    .filter(isRecord)
    .map((connection) =>
      normalizeVpnConnection(provider, connection),
    ) as ImportVpnData[K];
}

function normalizeVpnConnection<K extends PortableVpnProvider>(
  provider: K,
  value: unknown,
): ImportVpnData[K][number] {
  const raw = isRecord(value) ? value : {};
  const hasExplicitConfig = Object.prototype.hasOwnProperty.call(raw, "config");
  const hasPortability = Object.prototype.hasOwnProperty.call(
    raw,
    "portability",
  );
  const configSource = isRecord(raw.config) ? raw.config : raw;
  const portability = normalizePortability(raw.portability);
  const secretPresence = normalizeSecretPresence(
    raw.secretPresence ?? raw.secret_presence,
  );
  const createdAt = dateValue(raw.createdAt ?? raw.created_at);
  const connectedAt = dateValue(raw.connectedAt ?? raw.connected_at);

  const base: UnknownRecord = {
    name: optionalString(raw.name) ?? `${PROVIDER_LABELS[provider]} connection`,
    config:
      hasExplicitConfig && !isRecord(raw.config)
        ? raw.config
        : normalizeConfig(provider, configSource),
  };
  if (typeof raw.id === "string") base.id = raw.id;
  const status = normalizeStatus(raw.status);
  if (status) base.status = status;
  if (createdAt) base.createdAt = createdAt;
  if (connectedAt) base.connectedAt = connectedAt;
  if (hasPortability) {
    base.portability = portability ?? malformedPortabilityMetadata();
  }
  if (secretPresence) base.secretPresence = secretPresence;

  for (const key of providerRuntimeFields(provider)) {
    const camelValue = raw[key.camel];
    const snakeValue = raw[key.snake];
    const resolved = camelValue ?? snakeValue;
    if (typeof resolved === "string" || typeof resolved === "number") {
      base[key.camel] = resolved;
    }
  }
  const tags = stringArray(raw.tags);
  if (tags.length > 0) base.tags = tags;

  return base as unknown as ImportVpnData[K][number];
}

function normalizeConfig<K extends PortableVpnProvider>(
  provider: K,
  value: UnknownRecord,
): ImportVpnData[K][number]["config"] {
  switch (provider) {
    case "openvpn":
      return normalizeOpenVpnConfig(
        value,
      ) as ImportVpnData[K][number]["config"];
    case "wireguard":
      return normalizeWireGuardConfig(
        value,
      ) as ImportVpnData[K][number]["config"];
    case "tailscale":
      return normalizeTailscaleConfig(
        value,
      ) as ImportVpnData[K][number]["config"];
    case "zerotier":
      return normalizeZeroTierConfig(
        value,
      ) as ImportVpnData[K][number]["config"];
  }
}

function normalizeOpenVpnConfig(value: UnknownRecord): OpenVPNConfig {
  const routes = arrayValue(value.route ?? value.routes)
    .filter(isRecord)
    .flatMap((route) => {
      const network = optionalString(route.network);
      const netmask = optionalString(route.netmask);
      return network && netmask
        ? [{ network, netmask, gateway: optionalString(route.gateway) }]
        : [];
    });
  const dns = arrayValue(value.dns ?? value.dns_servers).flatMap((entry) => {
    if (typeof entry === "string") return [{ server: entry }];
    if (!isRecord(entry)) return [];
    const server = optionalString(entry.server);
    return server ? [{ server, domain: optionalString(entry.domain) }] : [];
  });
  const keepAliveSource = recordValue(value.keepAlive ?? value.keep_alive);
  const keepAliveInterval = optionalNumber(keepAliveSource.interval);
  const keepAliveTimeout = optionalNumber(keepAliveSource.timeout);

  return compact({
    enabled: optionalBoolean(value.enabled),
    configFile: optionalString(value.configFile ?? value.config_file),
    inlineConfig: optionalString(value.inlineConfig ?? value.inline_config),
    authFile: optionalString(value.authFile ?? value.auth_file),
    caCert: optionalString(value.caCert ?? value.ca_cert),
    clientCert: optionalString(value.clientCert ?? value.client_cert),
    clientKey: optionalString(value.clientKey ?? value.client_key),
    username: optionalString(value.username),
    password: optionalString(value.password),
    remoteHost: optionalString(value.remoteHost ?? value.remote_host),
    remotePort: optionalNumber(value.remotePort ?? value.remote_port),
    protocol: enumValue(value.protocol, ["udp", "tcp"]),
    cipher: optionalString(value.cipher),
    auth: optionalString(value.auth),
    tlsAuth: optionalBoolean(value.tlsAuth ?? value.tls_auth),
    tlsAuthFile: optionalString(value.tlsAuthFile ?? value.tls_auth_file),
    tlsCrypt: optionalBoolean(value.tlsCrypt ?? value.tls_crypt),
    tlsCryptFile: optionalString(value.tlsCryptFile ?? value.tls_crypt_file),
    compression: optionalBoolean(value.compression),
    mssFix: optionalNumber(value.mssFix ?? value.mss_fix),
    tunMtu: optionalNumber(value.tunMtu ?? value.tun_mtu),
    fragment: optionalNumber(value.fragment),
    mtuDiscover: optionalBoolean(value.mtuDiscover ?? value.mtu_discover),
    keepAlive:
      keepAliveInterval !== undefined && keepAliveTimeout !== undefined
        ? { interval: keepAliveInterval, timeout: keepAliveTimeout }
        : undefined,
    routeNoPull: optionalBoolean(value.routeNoPull ?? value.route_no_pull),
    route: routes.length > 0 ? routes : undefined,
    dns: dns.length > 0 ? dns : undefined,
    customOptions: optionalStringArray(
      value.customOptions ?? value.custom_options,
    ),
  }) as unknown as OpenVPNConfig;
}

function normalizeWireGuardConfig(value: UnknownRecord): WireGuardConfig {
  const interfaceValue = recordValue(value.interface ?? value.interface_config);
  const peerValue = recordValue(value.peer ?? value.peer_config);
  const pickInterface = (camel: string, snake: string): unknown =>
    interfaceValue[camel] ?? interfaceValue[snake] ?? value[snake];
  const pickPeer = (camel: string, snake: string): unknown =>
    peerValue[camel] ?? peerValue[snake] ?? value[snake];

  return compact({
    enabled: optionalBoolean(value.enabled),
    interface: compact({
      privateKey:
        optionalString(pickInterface("privateKey", "private_key")) ?? "",
      address: stringArray(
        pickInterface("address", "addresses") ?? value.address,
      ),
      dns: optionalStringArray(pickInterface("dns", "dns_servers")),
      mtu: optionalNumber(pickInterface("mtu", "mtu")),
      table: stringOrNumber(pickInterface("table", "table")),
      preUp: optionalStringArray(pickInterface("preUp", "pre_up")),
      postUp: optionalStringArray(pickInterface("postUp", "post_up")),
      preDown: optionalStringArray(pickInterface("preDown", "pre_down")),
      postDown: optionalStringArray(pickInterface("postDown", "post_down")),
    }),
    peer: compact({
      publicKey: optionalString(pickPeer("publicKey", "public_key")) ?? "",
      presharedKey: optionalString(pickPeer("presharedKey", "preshared_key")),
      endpoint: optionalString(pickPeer("endpoint", "endpoint")),
      allowedIPs: stringArray(pickPeer("allowedIPs", "allowed_ips")),
      persistentKeepalive: optionalNumber(
        pickPeer("persistentKeepalive", "persistent_keepalive"),
      ),
    }),
    configFile: optionalString(value.configFile ?? value.config_file),
    listenPort: optionalNumber(value.listenPort ?? value.listen_port),
    fwmark: optionalNumber(value.fwmark),
    interfaceName: optionalString(value.interfaceName ?? value.interface_name),
  }) as unknown as WireGuardConfig;
}

function normalizeTailscaleConfig(value: UnknownRecord): TailscaleConfig {
  return compact({
    enabled: optionalBoolean(value.enabled),
    authKey: optionalString(value.authKey ?? value.auth_key),
    loginServer: optionalString(value.loginServer ?? value.login_server),
    routes: optionalStringArray(value.routes),
    exitNode: optionalString(value.exitNode ?? value.exit_node),
    advertiseRoutes: optionalStringArray(
      value.advertiseRoutes ?? value.advertise_routes,
    ),
    advertiseTags: optionalStringArray(
      value.advertiseTags ?? value.advertise_tags,
    ),
    acceptRoutes: optionalBoolean(value.acceptRoutes ?? value.accept_routes),
    acceptDNS: optionalBoolean(value.acceptDNS ?? value.accept_dns),
    hostname: optionalString(value.hostname),
    exitNodeAllowLanAccess: optionalBoolean(
      value.exitNodeAllowLanAccess ?? value.exit_node_allow_lan_access,
    ),
    ssh: optionalBoolean(value.ssh),
    funnel: optionalBoolean(value.funnel),
    stateDir: optionalString(value.stateDir ?? value.state_dir),
    socket: optionalString(value.socket),
    customOptions: optionalStringArray(
      value.customOptions ?? value.custom_options,
    ),
  }) as unknown as TailscaleConfig;
}

function normalizeZeroTierConfig(value: UnknownRecord): ZeroTierConfig {
  const identity = recordValue(value.identity);
  const identityPublic = optionalString(
    identity.public ?? value.identity_public,
  );
  const identitySecret = optionalString(
    identity.secret ?? value.identity_secret,
  );
  return compact({
    enabled: optionalBoolean(value.enabled),
    networkId: optionalString(value.networkId ?? value.network_id) ?? "",
    identity:
      identityPublic || identitySecret
        ? { public: identityPublic ?? "", secret: identitySecret ?? "" }
        : undefined,
    allowManaged: optionalBoolean(value.allowManaged ?? value.allow_managed),
    allowGlobal: optionalBoolean(value.allowGlobal ?? value.allow_global),
    allowDefault: optionalBoolean(value.allowDefault ?? value.allow_default),
    allowDNS: optionalBoolean(value.allowDNS ?? value.allow_dns),
    zerotierHome: optionalString(value.zerotierHome ?? value.zerotier_home),
    authtokenSecret: optionalString(
      value.authtokenSecret ?? value.authtoken_secret,
    ),
    customOptions: optionalStringArray(
      value.customOptions ?? value.custom_options,
    ),
  }) as unknown as ZeroTierConfig;
}

function sanitizeConfig<K extends PortableVpnProvider>(
  provider: K,
  value: ImportVpnData[K][number]["config"],
): ImportVpnData[K][number]["config"] {
  const normalized = normalizeConfig(
    provider,
    isRecord(value) ? value : {},
  ) as unknown as UnknownRecord;
  switch (provider) {
    case "openvpn": {
      const {
        configFile: _configFile,
        inlineConfig: _inlineConfig,
        authFile: _authFile,
        caCert: _caCert,
        clientCert: _clientCert,
        clientKey: _clientKey,
        username: _username,
        password: _password,
        tlsAuthFile: _tlsAuthFile,
        tlsCryptFile: _tlsCryptFile,
        customOptions: _customOptions,
        ...safe
      } = normalized;
      return { ...safe, enabled: false } as ImportVpnData[K][number]["config"];
    }
    case "wireguard": {
      const interfaceValue = recordValue(normalized.interface);
      const peerValue = recordValue(normalized.peer);
      const {
        privateKey: _privateKey,
        preUp: _preUp,
        postUp: _postUp,
        preDown: _preDown,
        postDown: _postDown,
        ...safeInterface
      } = interfaceValue;
      const { presharedKey: _presharedKey, ...safePeer } = peerValue;
      const { configFile: _configFile, ...safe } = normalized;
      return {
        ...safe,
        enabled: false,
        interface: { ...safeInterface, privateKey: "" },
        peer: safePeer,
      } as ImportVpnData[K][number]["config"];
    }
    case "tailscale": {
      const {
        authKey: _authKey,
        stateDir: _stateDir,
        socket: _socket,
        customOptions: _customOptions,
        ...safe
      } = normalized;
      return { ...safe, enabled: false } as ImportVpnData[K][number]["config"];
    }
    case "zerotier": {
      const identity = recordValue(normalized.identity);
      const { secret: _secret, ...safeIdentity } = identity;
      const {
        authtokenSecret: _authtokenSecret,
        zerotierHome: _zerotierHome,
        customOptions: _customOptions,
        ...safe
      } = normalized;
      return {
        ...safe,
        enabled: false,
        ...(Object.keys(safeIdentity).length > 0
          ? { identity: safeIdentity }
          : { identity: undefined }),
      } as ImportVpnData[K][number]["config"];
    }
  }
}

function disableConfig<K extends PortableVpnProvider>(
  provider: K,
  value: ImportVpnData[K][number]["config"],
): ImportVpnData[K][number]["config"] {
  const normalized = normalizeConfig(
    provider,
    isRecord(value) ? value : {},
  ) as unknown as UnknownRecord;
  return {
    ...normalized,
    enabled: false,
  } as ImportVpnData[K][number]["config"];
}

function getUnavailableStoredSecretNames<K extends PortableVpnProvider>(
  provider: K,
  connection: ImportVpnData[K][number],
): string[] {
  const presence = normalizeSecretPresence(
    connection.secretPresence ?? connection.secret_presence,
  );
  if (!presence) return [];
  const config: UnknownRecord = recordValue(connection.config);
  const interfaceValue = recordValue(config.interface);
  const peerValue = recordValue(config.peer);
  const identity = recordValue(config.identity);
  const missing: string[] = [];
  const check = (names: string[], actual: unknown, label: string) => {
    if (names.some((name) => presence[name] === true) && !hasValue(actual)) {
      missing.push(label);
    }
  };

  switch (provider) {
    case "openvpn":
      check(["password"], config.password, "password");
      check(
        ["inlineConfig", "inline_config"],
        config.inlineConfig,
        "inline configuration",
      );
      check(["clientKey", "client_key"], config.clientKey, "client key");
      break;
    case "wireguard":
      check(
        ["privateKey", "private_key"],
        interfaceValue.privateKey,
        "private key",
      );
      check(
        ["presharedKey", "preshared_key"],
        peerValue.presharedKey,
        "preshared key",
      );
      break;
    case "tailscale":
      check(["authKey", "auth_key"], config.authKey, "authentication key");
      break;
    case "zerotier":
      check(
        ["identitySecret", "identity_secret"],
        identity.secret,
        "identity secret",
      );
      check(
        ["authtokenSecret", "authtoken_secret"],
        config.authtokenSecret,
        "authentication token",
      );
      break;
  }
  return missing;
}

function normalizePortability(
  value: unknown,
): VpnPortabilityMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const credentials = value.credentials;
  if (
    credentials !== "included" &&
    credentials !== "redacted" &&
    credentials !== "unavailable"
  ) {
    return undefined;
  }
  return {
    version: 1,
    credentials,
    executable: credentials === "included" && value.executable === true,
    warnings: stringArray(value.warnings),
  };
}

function malformedPortabilityMetadata(): VpnPortabilityMetadata {
  return {
    version: 1,
    credentials: "unavailable",
    executable: false,
    warnings: [MALFORMED_PORTABILITY_WARNING],
  };
}

function hasProviderMinimumExecutableConfig(
  provider: PortableVpnProvider,
  value: unknown,
): boolean {
  // Older native backups used a non-empty opaque string for a provider's
  // authoritative configuration. Preserve that migration input while making
  // structured profiles prove their provider-specific minimums.
  if (typeof value === "string") return value.trim().length > 0;
  if (!isRecord(value)) return false;

  switch (provider) {
    case "openvpn":
      return [
        value.configFile,
        value.config_file,
        value.inlineConfig,
        value.inline_config,
        value.remoteHost,
        value.remote_host,
      ].some(hasValue);
    case "wireguard": {
      if (hasValue(value.configFile ?? value.config_file)) return true;
      const interfaceValue = recordValue(
        value.interface ?? value.interface_config,
      );
      const peerValue = recordValue(value.peer ?? value.peer_config);
      const privateKey =
        interfaceValue.privateKey ??
        interfaceValue.private_key ??
        value.privateKey ??
        value.private_key;
      const publicKey =
        peerValue.publicKey ??
        peerValue.public_key ??
        value.publicKey ??
        value.public_key;
      const allowedIps =
        peerValue.allowedIPs ??
        peerValue.allowed_ips ??
        value.allowedIPs ??
        value.allowed_ips;
      return (
        hasValue(privateKey) &&
        hasValue(publicKey) &&
        stringArray(allowedIps).some(hasValue)
      );
    }
    case "tailscale":
      return hasValue(value.authKey ?? value.auth_key);
    case "zerotier": {
      const networkId = value.networkId ?? value.network_id;
      return (
        typeof networkId === "string" &&
        /^[0-9a-fA-F]{16}$/.test(networkId.trim())
      );
    }
  }
}

function normalizeSecretPresence(
  value: unknown,
): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function providerRuntimeFields(provider: PortableVpnProvider) {
  switch (provider) {
    case "openvpn":
      return [
        { camel: "localIp", snake: "local_ip" },
        { camel: "remoteIp", snake: "remote_ip" },
        { camel: "chainPosition", snake: "chain_position" },
      ];
    case "wireguard":
      return [
        { camel: "interfaceName", snake: "interface_name" },
        { camel: "localIp", snake: "local_ip" },
        { camel: "peerIp", snake: "peer_ip" },
        { camel: "chainPosition", snake: "chain_position" },
      ];
    case "tailscale":
      return [
        { camel: "nodeIp", snake: "node_ip" },
        { camel: "tailnetIp", snake: "tailnet_ip" },
        { camel: "chainPosition", snake: "chain_position" },
      ];
    case "zerotier":
      return [
        { camel: "nodeId", snake: "node_id" },
        { camel: "networkId", snake: "network_id" },
        { camel: "chainPosition", snake: "chain_position" },
      ];
  }
}

function profileWarning(
  provider: PortableVpnProvider,
  name: string,
  warning: string,
): string {
  return `${PROVIDER_LABELS[provider]} profile "${name || "Unnamed"}": ${warning}`;
}

function normalizeStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  return [
    "disconnected",
    "connecting",
    "connected",
    "disconnecting",
    "error",
  ].includes(normalized)
    ? normalized
    : undefined;
}

function dateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringOrNumber(value: unknown): string | number | undefined {
  return typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionalStringArray(value: unknown): string[] | undefined {
  const values = stringArray(value);
  return values.length > 0 ? values : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact(value: UnknownRecord): UnknownRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
