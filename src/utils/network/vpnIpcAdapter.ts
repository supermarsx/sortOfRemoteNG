import type {
  OpenVPNConfig,
  TailscaleConfig,
  WireGuardConfig,
  ZeroTierConfig,
} from "../../types/settings/settings";

export type VpnConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

type UnknownRecord = Record<string, unknown>;

export interface OpenVpnIpcConnection {
  id: string;
  name: string;
  config: OpenVPNConfig;
  status: VpnConnectionStatus;
  createdAt: Date;
  connectedAt?: Date;
  localIp?: string;
  remoteIp?: string;
}

export interface WireGuardIpcConnection {
  id: string;
  name: string;
  config: WireGuardConfig;
  status: VpnConnectionStatus;
  createdAt: Date;
  connectedAt?: Date;
  interfaceName?: string;
  localIp?: string;
  peerIp?: string;
}

export interface TailscaleIpcConnection {
  id: string;
  name: string;
  config: TailscaleConfig;
  status: VpnConnectionStatus;
  createdAt: Date;
  connectedAt?: Date;
  tailnetIp?: string;
}

export interface ZeroTierIpcConnection {
  id: string;
  name: string;
  config: ZeroTierConfig;
  status: VpnConnectionStatus;
  createdAt: Date;
  connectedAt?: Date;
  networkId?: string;
}

/**
 * Translate the application-facing OpenVPN model to the exact persisted Rust
 * command shape. Optional arrays are always supplied because the Rust model
 * intentionally treats them as concrete collections.
 */
export function toOpenVpnIpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "OpenVPN config");
  return compact({
    config_file: optionalString(source.configFile),
    inline_config: optionalString(source.inlineConfig),
    auth_file: optionalString(source.authFile),
    ca_cert: optionalString(source.caCert),
    client_cert: optionalString(source.clientCert),
    client_key: optionalString(source.clientKey),
    username: optionalString(source.username),
    password: optionalString(source.password),
    remote_host: optionalString(source.remoteHost),
    remote_port: optionalNumber(source.remotePort),
    protocol: optionalEnum(source.protocol, ["udp", "tcp"]),
    cipher: optionalString(source.cipher),
    auth: optionalString(source.auth),
    tls_auth: optionalBoolean(source.tlsAuth),
    tls_auth_file: optionalString(source.tlsAuthFile),
    tls_crypt: optionalBoolean(source.tlsCrypt),
    tls_crypt_file: optionalString(source.tlsCryptFile),
    compression: optionalBoolean(source.compression),
    mss_fix: optionalNumber(source.mssFix),
    tun_mtu: optionalNumber(source.tunMtu),
    fragment: optionalNumber(source.fragment),
    mtu_discover: optionalBoolean(source.mtuDiscover),
    keep_alive: optionalKeepAlive(source.keepAlive),
    route_no_pull: optionalBoolean(source.routeNoPull),
    routes: routeArray(source.route),
    dns_servers: dnsArray(source.dns),
    custom_options: stringArray(source.customOptions),
  });
}

export function toWireGuardIpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "WireGuard config");
  const interfaceConfig = optionalRecord(source.interface);
  const peerConfig = optionalRecord(source.peer);
  return compact({
    private_key: optionalNonEmptyString(interfaceConfig.privateKey),
    public_key: optionalNonEmptyString(peerConfig.publicKey),
    preshared_key: optionalNonEmptyString(peerConfig.presharedKey),
    endpoint: optionalNonEmptyString(peerConfig.endpoint),
    addresses: stringArray(interfaceConfig.address),
    allowed_ips: stringArray(peerConfig.allowedIPs),
    persistent_keepalive: optionalNumber(peerConfig.persistentKeepalive),
    listen_port: optionalNumber(source.listenPort),
    dns_servers: stringArray(interfaceConfig.dns),
    mtu: optionalNumber(interfaceConfig.mtu),
    table:
      interfaceConfig.table === undefined || interfaceConfig.table === null
        ? undefined
        : String(interfaceConfig.table),
    fwmark: optionalNumber(source.fwmark),
    config_file: optionalNonEmptyString(source.configFile),
    interface_name: optionalNonEmptyString(source.interfaceName),
  });
}

export function toTailscaleIpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "Tailscale config");
  return compact({
    auth_key: optionalString(source.authKey),
    login_server: optionalString(source.loginServer),
    accept_routes: optionalBoolean(source.acceptRoutes),
    accept_dns: optionalBoolean(source.acceptDNS),
    advertise_routes: stringArray(source.advertiseRoutes),
    advertise_tags: stringArray(source.advertiseTags),
    hostname: optionalString(source.hostname),
    exit_node: optionalString(source.exitNode),
    exit_node_allow_lan_access: optionalBoolean(source.exitNodeAllowLanAccess),
    ssh: optionalBoolean(source.ssh),
    funnel: optionalBoolean(source.funnel),
    state_dir: optionalString(source.stateDir),
    socket: optionalString(source.socket),
  });
}

export function toZeroTierIpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "ZeroTier config");
  return compact({
    network_id: requiredString(source.networkId, "ZeroTier network id"),
    allow_managed: optionalBoolean(source.allowManaged),
    allow_global: optionalBoolean(source.allowGlobal),
    allow_default: optionalBoolean(source.allowDefault),
    allow_dns: optionalBoolean(source.allowDNS),
    zerotier_home: optionalString(source.zerotierHome),
    authtoken_secret: optionalString(source.authtokenSecret),
  });
}

export function fromOpenVpnIpcConnection(value: unknown): OpenVpnIpcConnection {
  const raw = connectionRecord(value, "OpenVPN");
  const config = record(raw.config, "OpenVPN config");
  return {
    ...commonConnection(raw, "OpenVPN"),
    config: {
      enabled: true,
      configFile: optionalString(config.config_file),
      inlineConfig: optionalString(config.inline_config),
      authFile: optionalString(config.auth_file),
      caCert: optionalString(config.ca_cert),
      clientCert: optionalString(config.client_cert),
      clientKey: optionalString(config.client_key),
      username: optionalString(config.username),
      password: optionalString(config.password),
      remoteHost: optionalString(config.remote_host),
      remotePort: optionalNumber(config.remote_port),
      protocol: optionalEnum(config.protocol, ["udp", "tcp"]),
      cipher: optionalString(config.cipher),
      auth: optionalString(config.auth),
      tlsAuth: optionalBoolean(config.tls_auth),
      tlsAuthFile: optionalString(config.tls_auth_file),
      tlsCrypt: optionalBoolean(config.tls_crypt),
      tlsCryptFile: optionalString(config.tls_crypt_file),
      compression: optionalBoolean(config.compression),
      mssFix: optionalNumber(config.mss_fix),
      tunMtu: optionalNumber(config.tun_mtu),
      fragment: optionalNumber(config.fragment),
      mtuDiscover: optionalBoolean(config.mtu_discover),
      keepAlive: optionalKeepAlive(config.keep_alive),
      routeNoPull: optionalBoolean(config.route_no_pull),
      route: routeArray(config.routes),
      dns: dnsArray(config.dns_servers),
      customOptions: stringArray(config.custom_options),
    },
    localIp: optionalString(raw.local_ip),
    remoteIp: optionalString(raw.remote_ip),
  };
}

export function fromWireGuardIpcConnection(
  value: unknown,
): WireGuardIpcConnection {
  const raw = connectionRecord(value, "WireGuard");
  const config = record(raw.config, "WireGuard config");
  return {
    ...commonConnection(raw, "WireGuard"),
    config: {
      enabled: true,
      configFile: optionalString(config.config_file),
      interface: {
        privateKey: optionalString(config.private_key) ?? "",
        address: stringArray(config.addresses),
        dns: stringArray(config.dns_servers),
        mtu: optionalNumber(config.mtu),
        table:
          typeof config.table === "string" || typeof config.table === "number"
            ? config.table
            : undefined,
      },
      peer: {
        publicKey: optionalString(config.public_key) ?? "",
        presharedKey: optionalString(config.preshared_key),
        endpoint: optionalString(config.endpoint),
        allowedIPs: stringArray(config.allowed_ips),
        persistentKeepalive: optionalNumber(config.persistent_keepalive),
      },
      listenPort: optionalNumber(config.listen_port),
      fwmark: optionalNumber(config.fwmark),
      interfaceName: optionalString(config.interface_name),
    },
    interfaceName: optionalString(raw.interface_name),
    localIp: optionalString(raw.local_ip),
    peerIp: optionalString(raw.peer_ip),
  };
}

export function fromTailscaleIpcConnection(
  value: unknown,
): TailscaleIpcConnection {
  const raw = connectionRecord(value, "Tailscale");
  const config = record(raw.config, "Tailscale config");
  return {
    ...commonConnection(raw, "Tailscale"),
    config: {
      enabled: true,
      authKey: optionalString(config.auth_key),
      loginServer: optionalString(config.login_server),
      advertiseRoutes: stringArray(config.advertise_routes),
      advertiseTags: stringArray(config.advertise_tags),
      acceptRoutes: optionalBoolean(config.accept_routes),
      acceptDNS: optionalBoolean(config.accept_dns),
      hostname: optionalString(config.hostname),
      exitNode: optionalString(config.exit_node),
      exitNodeAllowLanAccess: optionalBoolean(
        config.exit_node_allow_lan_access,
      ),
      ssh: optionalBoolean(config.ssh),
      funnel: optionalBoolean(config.funnel),
      stateDir: optionalString(config.state_dir),
      socket: optionalString(config.socket),
    },
    tailnetIp: optionalString(raw.tailnet_ip),
  };
}

export function fromZeroTierIpcConnection(
  value: unknown,
): ZeroTierIpcConnection {
  const raw = connectionRecord(value, "ZeroTier");
  const config = record(raw.config, "ZeroTier config");
  const networkId = requiredString(config.network_id, "ZeroTier network id");
  const identityPublic = optionalString(config.identity_public);
  const identitySecret = optionalString(config.identity_secret);
  return {
    ...commonConnection(raw, "ZeroTier"),
    config: {
      enabled: true,
      networkId,
      identity:
        identityPublic !== undefined && identitySecret !== undefined
          ? { public: identityPublic, secret: identitySecret }
          : undefined,
      allowManaged: optionalBoolean(config.allow_managed),
      allowGlobal: optionalBoolean(config.allow_global),
      allowDefault: optionalBoolean(config.allow_default),
      allowDNS: optionalBoolean(config.allow_dns),
      zerotierHome: optionalString(config.zerotier_home),
      authtokenSecret: optionalString(config.authtoken_secret),
    },
    networkId: optionalString(raw.network_id) ?? networkId,
  };
}

export function normalizeVpnStatus(value: unknown): VpnConnectionStatus {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (
      normalized === "disconnected" ||
      normalized === "connecting" ||
      normalized === "connected" ||
      normalized === "disconnecting" ||
      normalized === "error"
    ) {
      return normalized;
    }
  }
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, "Error")) {
    return "error";
  }
  // Unknown backend states must never look safely disconnected/connected.
  return "error";
}

export function requireVpnConnectionId(
  value: unknown,
  provider: string,
): string {
  return requiredString(value, `${provider} connection id`);
}

function commonConnection(raw: UnknownRecord, provider: string) {
  return {
    id: requiredString(raw.id, `${provider} connection id`),
    name: requiredString(raw.name, `${provider} connection name`),
    status: normalizeVpnStatus(raw.status),
    createdAt: requiredDate(raw.created_at, `${provider} created timestamp`),
    connectedAt: optionalDate(
      raw.connected_at,
      `${provider} connected timestamp`,
    ),
  };
}

function connectionRecord(value: unknown, provider: string): UnknownRecord {
  return record(value, `${provider} connection`);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`${label} response is malformed`);
  return value;
}

function optionalRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} response is malformed`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  const result = optionalString(value)?.trim();
  return result || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function requiredDate(value: unknown, label: string): Date {
  const result = optionalDate(value, label);
  if (!result) throw new Error(`${label} response is malformed`);
  return result;
}

function optionalDate(value: unknown, label: string): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${label} response is malformed`);
  }
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new Error(`${label} response is malformed`);
  }
  return result;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionalKeepAlive(
  value: unknown,
): OpenVPNConfig["keepAlive"] | undefined {
  if (!isRecord(value)) return undefined;
  const interval = optionalNumber(value.interval);
  const timeout = optionalNumber(value.timeout);
  return interval !== undefined && timeout !== undefined
    ? { interval, timeout }
    : undefined;
}

function routeArray(value: unknown): NonNullable<OpenVPNConfig["route"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const network = optionalString(item.network);
    const netmask = optionalString(item.netmask);
    if (!network || !netmask) return [];
    return [
      {
        network,
        netmask,
        gateway: optionalString(item.gateway),
      },
    ];
  });
}

function dnsArray(value: unknown): NonNullable<OpenVPNConfig["dns"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const server = optionalString(item.server);
    if (!server) return [];
    return [{ server, domain: optionalString(item.domain) }];
  });
}

function compact(value: UnknownRecord): UnknownRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
