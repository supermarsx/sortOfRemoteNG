import type {
  IKEv2Config,
  IPsecConfig,
  L2TPConfig,
  OpenVPNConfig,
  PPTPConfig,
  SSTPConfig,
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

export interface OpenVpnSecretPresence {
  [key: string]: boolean;
  password: boolean;
  inlineConfig: boolean;
  clientKey: boolean;
}

export interface WireGuardSecretPresence {
  [key: string]: boolean;
  privateKey: boolean;
  presharedKey: boolean;
}

export interface TailscaleSecretPresence {
  [key: string]: boolean;
  authKey: boolean;
}

export interface ZeroTierSecretPresence {
  [key: string]: boolean;
  identitySecret: boolean;
  authtokenSecret: boolean;
}

export interface IkeV2SecretPresence {
  [key: string]: boolean;
  password: boolean;
  privateKey: boolean;
}

export interface SstpSecretPresence {
  [key: string]: boolean;
  password: boolean;
}

export interface L2tpSecretPresence {
  [key: string]: boolean;
  password: boolean;
  psk: boolean;
}

export interface PptpSecretPresence {
  [key: string]: boolean;
  password: boolean;
}

export interface IpsecSecretPresence {
  [key: string]: boolean;
  psk: boolean;
  privateKey: boolean;
}

export interface OpenVpnSecretMutation {
  clearPassword?: boolean;
  clearInlineConfig?: boolean;
  clearClientKey?: boolean;
}

export interface WireGuardSecretMutation {
  clearPrivateKey?: boolean;
  clearPresharedKey?: boolean;
}

export interface TailscaleSecretMutation {
  clearAuthKey?: boolean;
}

export interface ZeroTierSecretMutation {
  clearIdentitySecret?: boolean;
  clearAuthtokenSecret?: boolean;
}

export interface IkeV2SecretMutation {
  clearPassword?: boolean;
  clearPrivateKey?: boolean;
}

export interface SstpSecretMutation {
  clearPassword?: boolean;
}

export interface L2tpSecretMutation {
  clearPassword?: boolean;
  clearPsk?: boolean;
}

export interface PptpSecretMutation {
  clearPassword?: boolean;
}

export interface IpsecSecretMutation {
  clearPsk?: boolean;
  clearPrivateKey?: boolean;
}

export type VpnSecretPresence =
  | OpenVpnSecretPresence
  | WireGuardSecretPresence
  | TailscaleSecretPresence
  | ZeroTierSecretPresence
  | IkeV2SecretPresence
  | SstpSecretPresence
  | L2tpSecretPresence
  | PptpSecretPresence
  | IpsecSecretPresence;

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
  secretPresence: OpenVpnSecretPresence;
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
  secretPresence: WireGuardSecretPresence;
}

export interface TailscaleIpcConnection {
  id: string;
  name: string;
  config: TailscaleConfig;
  status: VpnConnectionStatus;
  createdAt: Date;
  connectedAt?: Date;
  tailnetIp?: string;
  secretPresence: TailscaleSecretPresence;
}

export interface ZeroTierIpcConnection {
  id: string;
  name: string;
  config: ZeroTierConfig;
  status: VpnConnectionStatus;
  createdAt: Date;
  connectedAt?: Date;
  networkId?: string;
  secretPresence: ZeroTierSecretPresence;
}

export interface LegacyVpnIpcConnection<
  TConfig,
  TPresence extends VpnSecretPresence = VpnSecretPresence,
> {
  id: string;
  name: string;
  config: TConfig;
  status: VpnConnectionStatus;
  createdAt: Date;
  connectedAt?: Date;
  localIp?: string;
  remoteIp?: string;
  secretPresence: TPresence;
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
    inline_config: optionalSecret(source.inlineConfig, "OpenVPN inline config"),
    auth_file: optionalString(source.authFile),
    ca_cert: optionalString(source.caCert),
    client_cert: optionalString(source.clientCert),
    client_key: optionalSecret(source.clientKey, "OpenVPN client key"),
    username: optionalString(source.username),
    password: optionalSecret(source.password, "OpenVPN password"),
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
    private_key: optionalSecret(
      interfaceConfig.privateKey,
      "WireGuard private key",
    ),
    public_key: optionalNonEmptyString(peerConfig.publicKey),
    preshared_key: optionalSecret(
      peerConfig.presharedKey,
      "WireGuard preshared key",
    ),
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
    auth_key: optionalSecret(source.authKey, "Tailscale auth key"),
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
  const identity = optionalRecord(source.identity);
  return compact({
    network_id: requiredString(source.networkId, "ZeroTier network id"),
    identity_public: optionalNonEmptyString(identity.public),
    identity_secret: optionalSecret(
      identity.secret,
      "ZeroTier identity secret",
    ),
    allow_managed: optionalBoolean(source.allowManaged),
    allow_global: optionalBoolean(source.allowGlobal),
    allow_default: optionalBoolean(source.allowDefault),
    allow_dns: optionalBoolean(source.allowDNS),
    zerotier_home: optionalString(source.zerotierHome),
    authtoken_secret: optionalSecret(
      source.authtokenSecret,
      "ZeroTier auth token",
    ),
  });
}

export function toIkeV2IpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "IKEv2 config");
  return compact({
    server: requiredString(source.server, "IKEv2 server"),
    routing_mode: optionalEnum(source.routingMode, ["full", "split"]) ?? "full",
    remote_subnets: stringArray(source.remoteSubnets),
    username: optionalNonEmptyString(source.username),
    password: optionalSecret(source.password, "IKEv2 password"),
    certificate: optionalString(source.certificate),
    private_key: optionalSecret(source.privateKey, "IKEv2 private key"),
    ca_certificate: optionalString(source.caCertificate),
    eap_method: optionalEnum(source.eapMethod, ["mschapv2", "tls", "peap"]),
    phase1_algorithms: optionalString(source.phase1Algorithms),
    phase2_algorithms: optionalString(source.phase2Algorithms),
    local_id: optionalString(source.localId),
    remote_id: optionalString(source.remoteId),
    fragmentation: optionalBoolean(source.fragmentation),
    mobike: optionalBoolean(source.mobike),
    custom_options: stringArray(source.customOptions),
  });
}

export function toSstpIpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "SSTP config");
  const proxy = optionalRecord(source.proxy);
  const proxyEnabled = optionalBoolean(proxy.enabled) !== false;
  return compact({
    server: requiredString(source.server, "SSTP server"),
    username: optionalNonEmptyString(source.username),
    password: optionalSecret(source.password, "SSTP password"),
    domain: optionalString(source.domain),
    certificate: optionalString(source.certificate),
    ca_certificate: optionalString(source.caCertificate),
    ignore_certificate: optionalBoolean(source.ignoreCertificate),
    proxy_host: proxyEnabled ? optionalNonEmptyString(proxy.host) : undefined,
    proxy_port: proxyEnabled ? optionalNumber(proxy.port) : undefined,
    custom_options: stringArray(source.customOptions),
  });
}

export function toL2tpIpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "L2TP config");
  const ppp = optionalRecord(source.pppSettings);
  const ipsec = optionalRecord(source.ipsecSettings);
  return compact({
    server: requiredString(source.server, "L2TP server"),
    username: optionalNonEmptyString(source.username),
    password: optionalSecret(source.password, "L2TP password"),
    psk: optionalSecret(source.psk, "L2TP pre-shared key"),
    ipsec_ike: optionalString(ipsec.ike),
    ipsec_esp: optionalString(ipsec.esp),
    ipsec_pfs: optionalString(ipsec.pfs),
    mru: optionalNumber(ppp.mru),
    mtu: optionalNumber(ppp.mtu),
    lcp_echo_interval: optionalNumber(ppp.lcpEchoInterval),
    lcp_echo_failure: optionalNumber(ppp.lcpEchoFailure),
    require_chap: optionalBoolean(ppp.requireChap),
    refuse_chap: optionalBoolean(ppp.refuseChap),
    require_mschap: optionalBoolean(ppp.requireMsChap),
    refuse_mschap: optionalBoolean(ppp.refuseMsChap),
    require_mschapv2: optionalBoolean(ppp.requireMsChapV2),
    refuse_mschapv2: optionalBoolean(ppp.refuseMsChapV2),
    require_eap: optionalBoolean(ppp.requireEap),
    refuse_eap: optionalBoolean(ppp.refuseEap),
    require_pap: optionalBoolean(ppp.requirePap),
    refuse_pap: optionalBoolean(ppp.refusePap),
    ipsec_ikelifetime: optionalNumber(ipsec.ikelifetime),
    ipsec_lifetime: optionalNumber(ipsec.lifetime),
    ipsec_phase2alg: optionalString(ipsec.phase2alg),
    custom_options: stringArray(source.customOptions),
  });
}

export function toPptpIpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "PPTP config");
  return compact({
    server: requiredString(source.server, "PPTP server"),
    username: optionalNonEmptyString(source.username),
    password: optionalSecret(source.password, "PPTP password"),
    domain: optionalString(source.domain),
    require_mppe: optionalBoolean(source.requireMppe),
    mppe_stateful: optionalBoolean(source.mppeStateful),
    refuse_eap: optionalBoolean(source.refuseEap),
    refuse_pap: optionalBoolean(source.refusePap),
    refuse_chap: optionalBoolean(source.refuseChap),
    refuse_mschap: optionalBoolean(source.refuseMsChap),
    refuse_mschapv2: optionalBoolean(source.refuseMsChapV2),
    nobsdcomp: optionalBoolean(source.nobsdcomp),
    nodeflate: optionalBoolean(source.nodeflate),
    no_vj_comp: optionalBoolean(source.noVjComp),
    custom_options: stringArray(source.customOptions),
  });
}

export function toIpsecIpcConfig(config: unknown): UnknownRecord {
  const source = record(config, "IPsec config");
  return compact({
    server: requiredString(source.server, "IPsec server"),
    routing_mode: optionalEnum(source.routingMode, ["full", "split"]) ?? "full",
    remote_subnets: stringArray(source.remoteSubnets),
    auth_method: optionalEnum(source.authMethod, ["psk", "certificate", "eap"]),
    psk: optionalSecret(source.psk, "IPsec pre-shared key"),
    certificate: optionalString(source.certificate),
    private_key: optionalSecret(source.privateKey, "IPsec private key"),
    ca_certificate: optionalString(source.caCertificate),
    phase1_proposals: optionalString(source.phase1Proposals),
    phase2_proposals: optionalString(source.phase2Proposals),
    sa_lifetime: optionalNumber(source.saLifetime),
    dpd_delay: optionalNumber(source.dpdDelay),
    dpd_timeout: optionalNumber(source.dpdTimeout),
    tunnel_mode: optionalBoolean(source.tunnelMode),
    custom_options: stringArray(source.customOptions),
  });
}

export function toOpenVpnIpcSecretMutation(
  mutation: OpenVpnSecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = {
    clear_password: mutation.clearPassword === true,
    clear_inline_config: mutation.clearInlineConfig === true,
    clear_client_key: mutation.clearClientKey === true,
  };
  rejectReplaceAndClear(config, [
    ["password", result.clear_password, "OpenVPN password"],
    ["inline_config", result.clear_inline_config, "OpenVPN inline config"],
    ["client_key", result.clear_client_key, "OpenVPN client key"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function toWireGuardIpcSecretMutation(
  mutation: WireGuardSecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = {
    clear_private_key: mutation.clearPrivateKey === true,
    clear_preshared_key: mutation.clearPresharedKey === true,
  };
  rejectReplaceAndClear(config, [
    ["private_key", result.clear_private_key, "WireGuard private key"],
    ["preshared_key", result.clear_preshared_key, "WireGuard preshared key"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function toTailscaleIpcSecretMutation(
  mutation: TailscaleSecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = { clear_auth_key: mutation.clearAuthKey === true };
  rejectReplaceAndClear(config, [
    ["auth_key", result.clear_auth_key, "Tailscale auth key"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function toZeroTierIpcSecretMutation(
  mutation: ZeroTierSecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = {
    clear_identity_secret: mutation.clearIdentitySecret === true,
    clear_authtoken_secret: mutation.clearAuthtokenSecret === true,
  };
  rejectReplaceAndClear(config, [
    [
      "identity_secret",
      result.clear_identity_secret,
      "ZeroTier identity secret",
    ],
    ["authtoken_secret", result.clear_authtoken_secret, "ZeroTier auth token"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function toIkeV2IpcSecretMutation(
  mutation: IkeV2SecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = {
    clear_password: mutation.clearPassword === true,
    clear_private_key: mutation.clearPrivateKey === true,
  };
  rejectReplaceAndClear(config, [
    ["password", result.clear_password, "IKEv2 password"],
    ["private_key", result.clear_private_key, "IKEv2 private key"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function toSstpIpcSecretMutation(
  mutation: SstpSecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = { clear_password: mutation.clearPassword === true };
  rejectReplaceAndClear(config, [
    ["password", result.clear_password, "SSTP password"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function toL2tpIpcSecretMutation(
  mutation: L2tpSecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = {
    clear_password: mutation.clearPassword === true,
    clear_psk: mutation.clearPsk === true,
  };
  rejectReplaceAndClear(config, [
    ["password", result.clear_password, "L2TP password"],
    ["psk", result.clear_psk, "L2TP PSK"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function toPptpIpcSecretMutation(
  mutation: PptpSecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = { clear_password: mutation.clearPassword === true };
  rejectReplaceAndClear(config, [
    ["password", result.clear_password, "PPTP password"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function toIpsecIpcSecretMutation(
  mutation: IpsecSecretMutation | undefined,
  config?: UnknownRecord,
): UnknownRecord | undefined {
  if (!mutation) return undefined;
  const result = {
    clear_psk: mutation.clearPsk === true,
    clear_private_key: mutation.clearPrivateKey === true,
  };
  rejectReplaceAndClear(config, [
    ["psk", result.clear_psk, "IPsec PSK"],
    ["private_key", result.clear_private_key, "IPsec private key"],
  ]);
  return anyTrue(result) ? result : undefined;
}

export function fromIkeV2IpcConnection(
  value: unknown,
): LegacyVpnIpcConnection<IKEv2Config, IkeV2SecretPresence> {
  const raw = connectionRecord(value, "IKEv2");
  const config = record(raw.config, "IKEv2 config");
  const presence = secretPresenceRecord(value, raw);
  return {
    ...commonConnection(raw, "IKEv2"),
    config: {
      enabled: true,
      server: requiredString(config.server, "IKEv2 server"),
      routingMode:
        optionalEnum(config.routing_mode, ["full", "split"]) ?? "full",
      remoteSubnets: stringArray(config.remote_subnets),
      username: optionalString(config.username) ?? "",
      password: undefined,
      certificate: optionalString(config.certificate),
      privateKey: undefined,
      caCertificate: optionalString(config.ca_certificate),
      eapMethod: optionalEnum(config.eap_method, ["mschapv2", "tls", "peap"]),
      phase1Algorithms: optionalString(config.phase1_algorithms),
      phase2Algorithms: optionalString(config.phase2_algorithms),
      localId: optionalString(config.local_id),
      remoteId: optionalString(config.remote_id),
      fragmentation: optionalBoolean(config.fragmentation),
      mobike: optionalBoolean(config.mobike),
      customOptions: stringArray(config.custom_options),
    },
    localIp: optionalString(raw.local_ip),
    remoteIp: optionalString(raw.remote_ip),
    secretPresence: {
      password:
        optionalBoolean(presence.password) === true ||
        hasNonEmpty(config.password),
      privateKey:
        optionalBoolean(presence.private_key) === true ||
        optionalBoolean(presence.privateKey) === true ||
        hasNonEmpty(config.private_key),
    },
  };
}

export function fromSstpIpcConnection(
  value: unknown,
): LegacyVpnIpcConnection<SSTPConfig, SstpSecretPresence> {
  const raw = connectionRecord(value, "SSTP");
  const config = record(raw.config, "SSTP config");
  const presence = secretPresenceRecord(value, raw);
  const proxyHost = optionalNonEmptyString(config.proxy_host);
  return {
    ...commonConnection(raw, "SSTP"),
    config: {
      enabled: true,
      server: requiredString(config.server, "SSTP server"),
      username: optionalString(config.username) ?? "",
      password: undefined,
      domain: optionalString(config.domain),
      certificate: optionalString(config.certificate),
      caCertificate: optionalString(config.ca_certificate),
      ignoreCertificate: optionalBoolean(config.ignore_certificate),
      proxy: proxyHost
        ? {
            type: "http",
            host: proxyHost,
            port: optionalNumber(config.proxy_port) ?? 8080,
            enabled: true,
          }
        : undefined,
      customOptions: stringArray(config.custom_options),
    },
    localIp: optionalString(raw.local_ip),
    remoteIp: optionalString(raw.remote_ip),
    secretPresence: {
      password:
        optionalBoolean(presence.password) === true ||
        hasNonEmpty(config.password),
    },
  };
}

export function fromL2tpIpcConnection(
  value: unknown,
): LegacyVpnIpcConnection<L2TPConfig, L2tpSecretPresence> {
  const raw = connectionRecord(value, "L2TP");
  const config = record(raw.config, "L2TP config");
  const presence = secretPresenceRecord(value, raw);
  return {
    ...commonConnection(raw, "L2TP"),
    config: {
      enabled: true,
      server: requiredString(config.server, "L2TP server"),
      username: optionalString(config.username) ?? "",
      password: "",
      psk: undefined,
      pppSettings: {
        mru: optionalNumber(config.mru),
        mtu: optionalNumber(config.mtu),
        lcpEchoInterval: optionalNumber(config.lcp_echo_interval),
        lcpEchoFailure: optionalNumber(config.lcp_echo_failure),
        requireChap: optionalBoolean(config.require_chap),
        refuseChap: optionalBoolean(config.refuse_chap),
        requireMsChap: optionalBoolean(config.require_mschap),
        refuseMsChap: optionalBoolean(config.refuse_mschap),
        requireMsChapV2: optionalBoolean(config.require_mschapv2),
        refuseMsChapV2: optionalBoolean(config.refuse_mschapv2),
        requireEap: optionalBoolean(config.require_eap),
        refuseEap: optionalBoolean(config.refuse_eap),
        requirePap: optionalBoolean(config.require_pap),
        refusePap: optionalBoolean(config.refuse_pap),
      },
      ipsecSettings: {
        ike: optionalString(config.ipsec_ike),
        esp: optionalString(config.ipsec_esp),
        pfs: optionalString(config.ipsec_pfs),
        ikelifetime: optionalNumber(config.ipsec_ikelifetime),
        lifetime: optionalNumber(config.ipsec_lifetime),
        phase2alg: optionalString(config.ipsec_phase2alg),
      },
      customOptions: stringArray(config.custom_options),
    },
    localIp: optionalString(raw.local_ip),
    remoteIp: optionalString(raw.remote_ip),
    secretPresence: {
      password:
        optionalBoolean(presence.password) === true ||
        hasNonEmpty(config.password),
      psk: optionalBoolean(presence.psk) === true || hasNonEmpty(config.psk),
    },
  };
}

export function fromPptpIpcConnection(
  value: unknown,
): LegacyVpnIpcConnection<PPTPConfig, PptpSecretPresence> {
  const raw = connectionRecord(value, "PPTP");
  const config = record(raw.config, "PPTP config");
  const presence = secretPresenceRecord(value, raw);
  return {
    ...commonConnection(raw, "PPTP"),
    config: {
      enabled: true,
      server: requiredString(config.server, "PPTP server"),
      username: optionalString(config.username) ?? "",
      password: "",
      domain: optionalString(config.domain),
      requireMppe: optionalBoolean(config.require_mppe),
      mppeStateful: optionalBoolean(config.mppe_stateful),
      refuseEap: optionalBoolean(config.refuse_eap),
      refusePap: optionalBoolean(config.refuse_pap),
      refuseChap: optionalBoolean(config.refuse_chap),
      refuseMsChap: optionalBoolean(config.refuse_mschap),
      refuseMsChapV2: optionalBoolean(config.refuse_mschapv2),
      nobsdcomp: optionalBoolean(config.nobsdcomp),
      nodeflate: optionalBoolean(config.nodeflate),
      noVjComp: optionalBoolean(config.no_vj_comp),
      customOptions: stringArray(config.custom_options),
    },
    localIp: optionalString(raw.local_ip),
    remoteIp: optionalString(raw.remote_ip),
    secretPresence: {
      password:
        optionalBoolean(presence.password) === true ||
        hasNonEmpty(config.password),
    },
  };
}

export function fromIpsecIpcConnection(
  value: unknown,
): LegacyVpnIpcConnection<IPsecConfig, IpsecSecretPresence> {
  const raw = connectionRecord(value, "IPsec");
  const config = record(raw.config, "IPsec config");
  const presence = secretPresenceRecord(value, raw);
  return {
    ...commonConnection(raw, "IPsec"),
    config: {
      enabled: true,
      server: requiredString(config.server, "IPsec server"),
      routingMode:
        optionalEnum(config.routing_mode, ["full", "split"]) ?? "full",
      remoteSubnets: stringArray(config.remote_subnets),
      authMethod: optionalEnum(config.auth_method, [
        "psk",
        "certificate",
        "eap",
      ]),
      psk: undefined,
      certificate: optionalString(config.certificate),
      privateKey: undefined,
      caCertificate: optionalString(config.ca_certificate),
      phase1Proposals: optionalString(config.phase1_proposals),
      phase2Proposals: optionalString(config.phase2_proposals),
      saLifetime: optionalNumber(config.sa_lifetime),
      dpdDelay: optionalNumber(config.dpd_delay),
      dpdTimeout: optionalNumber(config.dpd_timeout),
      tunnelMode: optionalBoolean(config.tunnel_mode),
      customOptions: stringArray(config.custom_options),
    },
    localIp: optionalString(raw.local_ip),
    remoteIp: optionalString(raw.remote_ip),
    secretPresence: {
      psk: optionalBoolean(presence.psk) === true || hasNonEmpty(config.psk),
      privateKey:
        optionalBoolean(presence.private_key) === true ||
        optionalBoolean(presence.privateKey) === true ||
        hasNonEmpty(config.private_key),
    },
  };
}

export function fromOpenVpnIpcConnection(value: unknown): OpenVpnIpcConnection {
  const raw = connectionRecord(value, "OpenVPN");
  const config = record(raw.config, "OpenVPN config");
  const presence = secretPresenceRecord(value, raw);
  return {
    ...commonConnection(raw, "OpenVPN"),
    config: {
      enabled: true,
      configFile: optionalString(config.config_file),
      inlineConfig: undefined,
      authFile: optionalString(config.auth_file),
      caCert: optionalString(config.ca_cert),
      clientCert: optionalString(config.client_cert),
      clientKey: undefined,
      username: optionalString(config.username),
      password: undefined,
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
    secretPresence: {
      password:
        optionalBoolean(presence.password) === true ||
        hasNonEmpty(config.password),
      inlineConfig:
        optionalBoolean(presence.inline_config) === true ||
        optionalBoolean(presence.inlineConfig) === true ||
        hasNonEmpty(config.inline_config),
      clientKey:
        optionalBoolean(presence.client_key) === true ||
        optionalBoolean(presence.clientKey) === true ||
        hasNonEmpty(config.client_key),
    },
  };
}

export function fromWireGuardIpcConnection(
  value: unknown,
): WireGuardIpcConnection {
  const raw = connectionRecord(value, "WireGuard");
  const config = record(raw.config, "WireGuard config");
  const presence = secretPresenceRecord(value, raw);
  return {
    ...commonConnection(raw, "WireGuard"),
    config: {
      enabled: true,
      configFile: optionalString(config.config_file),
      interface: {
        privateKey: "",
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
        presharedKey: undefined,
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
    secretPresence: {
      privateKey:
        optionalBoolean(presence.private_key) === true ||
        optionalBoolean(presence.privateKey) === true ||
        hasNonEmpty(config.private_key),
      presharedKey:
        optionalBoolean(presence.preshared_key) === true ||
        optionalBoolean(presence.presharedKey) === true ||
        hasNonEmpty(config.preshared_key),
    },
  };
}

export function fromTailscaleIpcConnection(
  value: unknown,
): TailscaleIpcConnection {
  const raw = connectionRecord(value, "Tailscale");
  const config = record(raw.config, "Tailscale config");
  const presence = secretPresenceRecord(value, raw);
  return {
    ...commonConnection(raw, "Tailscale"),
    config: {
      enabled: true,
      authKey: undefined,
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
    secretPresence: {
      authKey:
        optionalBoolean(presence.auth_key) === true ||
        optionalBoolean(presence.authKey) === true ||
        hasNonEmpty(config.auth_key),
    },
  };
}

export function fromZeroTierIpcConnection(
  value: unknown,
): ZeroTierIpcConnection {
  const raw = connectionRecord(value, "ZeroTier");
  const config = record(raw.config, "ZeroTier config");
  const presence = secretPresenceRecord(value, raw);
  const networkId = requiredString(config.network_id, "ZeroTier network id");
  const identityPublic = optionalString(config.identity_public);
  return {
    ...commonConnection(raw, "ZeroTier"),
    config: {
      enabled: true,
      networkId,
      identity:
        identityPublic !== undefined
          ? { public: identityPublic, secret: "" }
          : undefined,
      allowManaged: optionalBoolean(config.allow_managed),
      allowGlobal: optionalBoolean(config.allow_global),
      allowDefault: optionalBoolean(config.allow_default),
      allowDNS: optionalBoolean(config.allow_dns),
      zerotierHome: optionalString(config.zerotier_home),
      authtokenSecret: undefined,
    },
    networkId: optionalString(raw.network_id) ?? networkId,
    secretPresence: {
      identitySecret:
        optionalBoolean(presence.identity_secret) === true ||
        optionalBoolean(presence.identitySecret) === true ||
        hasNonEmpty(config.identity_secret),
      authtokenSecret:
        optionalBoolean(presence.authtoken_secret) === true ||
        optionalBoolean(presence.authtokenSecret) === true ||
        hasNonEmpty(config.authtoken_secret),
    },
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
  const outer = record(value, `${provider} connection`);
  return isRecord(outer.connection)
    ? record(outer.connection, `${provider} connection`)
    : outer;
}

function secretPresenceRecord(
  value: unknown,
  raw: UnknownRecord,
): UnknownRecord {
  const outer = isRecord(value) ? value : {};
  return optionalRecord(
    outer.secret_presence ?? outer.secretPresence ?? raw.secret_presence,
  );
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

function optionalSecret(value: unknown, label: string): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  if (isMaskedSecretPlaceholder(value)) {
    throw new Error(
      `${label} must be entered explicitly; masked values cannot be saved`,
    );
  }
  return value;
}

export function isMaskedSecretPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return (
    /^[*\u2022\u25cf\u00b7]{4,}(?:\s*\((?:stored|redacted|unchanged)\))?$/i.test(
      normalized,
    ) || /^(?:<|\[)?(?:redacted|stored(?: secret)?)(?:>|\])?$/i.test(normalized)
  );
}

function hasNonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function rejectReplaceAndClear(
  config: UnknownRecord | undefined,
  fields: Array<[string, boolean, string]>,
): void {
  if (!config) return;
  for (const [field, clear, label] of fields) {
    if (clear && hasNonEmpty(config[field])) {
      throw new Error(
        `${label} cannot be replaced and cleared in the same update`,
      );
    }
  }
}

function anyTrue(value: Record<string, boolean>): boolean {
  return Object.values(value).some(Boolean);
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
