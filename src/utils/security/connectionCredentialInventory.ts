import type { Connection } from "../../types/connection/connection";

export const CONNECTION_CREDENTIAL_LABELS = {
  account: "Account / domain",
  password: "Password",
  privateKey: "Private key / key file",
  passphrase: "Key passphrase",
  totp: "Authenticators",
  recovery: "Recovery information / security answers",
  webAuth: "Website authentication",
  webHeaders: "Website headers",
  webParameters: "Website query / form values",
  databaseUri: "Database connection URI",
  cloud: "Cloud credentials",
  gateway: "RDP gateway credentials",
  rdpRouting: "RDP routing token / cookie",
  proxy: "Proxy credentials",
  sshHop: "SSH hop credentials",
  vpn: "Inline VPN / mesh credentials",
  tunnel: "Tunnel authentication",
  clientKey: "Client certificate / key reference",
  vault: "Reusable vault reference",
  integration: "Integration OS-vault reference",
  external: "External credential-store reference",
} as const;

export type ConnectionCredentialKind =
  keyof typeof CONNECTION_CREDENTIAL_LABELS;
export type ConnectionCredentialStorage = "embedded" | "vault" | "external";
export const CONNECTION_CREDENTIAL_STORAGE_LABELS = {
  embedded: "Connection-local",
  vault: "Database vault link",
  external: "External reference",
} as const;

/** A virtual row only. Never retain a Connection, a secret or an external record ID. */
export interface ConnectionCredentialInventoryRow {
  id: string;
  name: string;
  protocol: string;
  kinds: ConnectionCredentialKind[];
  storage: ConnectionCredentialStorage[];
  /** Local values remain stored, but must not be mistaken for an active fallback. */
  localValuesIgnored: boolean;
}

const present = (value: unknown): boolean =>
  typeof value === "string" && value.length > 0;
const any = (...values: unknown[]): boolean => values.some(present);
const valuesPresent = (value: Record<string, unknown> | undefined): boolean =>
  !!value && Object.values(value).some(present);

/**
 * Closed-schema, presence-only inventory. Deliberately does not recursively scan
 * arbitrary objects, parse URIs/JSON credentials, resolve references, inspect
 * session state, read key files, or fetch another store. Disabled/ignored saved
 * fields remain visible because they still contain stored material.
 */
export function connectionCredentialInventory(
  connections: readonly Connection[],
): ConnectionCredentialInventoryRow[] {
  return connections.flatMap((connection) => {
    const kinds = new Set<ConnectionCredentialKind>();
    const storage = new Set<ConnectionCredentialStorage>();
    const add = (
      kind: ConnectionCredentialKind,
      exists: boolean,
      source: ConnectionCredentialStorage = "embedded",
    ) => {
      if (!exists) return;
      kinds.add(kind);
      storage.add(source);
    };
    add(
      "account",
      any(connection.username, connection.domain, connection.basicAuthUsername),
    );
    add(
      "password",
      any(connection.password, connection.rustdeskPassword) ||
        (connection.password === "" && present(connection.username)),
    );
    add("privateKey", present(connection.privateKey));
    add("passphrase", present(connection.passphrase));
    add(
      "totp",
      present(connection.totpSecret) ||
        !!connection.totpConfigs?.some((item) => present(item.secret)),
    );
    add(
      "recovery",
      !!connection.securityQuestions?.some((item) => present(item.answer)) ||
        !!connection.totpConfigs?.some((item) =>
          item.backupCodes?.some(present),
        ) ||
        any(
          connection.recoveryInfo?.phone,
          connection.recoveryInfo?.alternativeEmail,
          connection.recoveryInfo?.alternativePhone,
          connection.recoveryInfo?.alternativeEquipment,
          connection.recoveryInfo?.seedPhrase,
        ),
    );
    add("webAuth", present(connection.basicAuthPassword));
    add("webHeaders", valuesPresent(connection.httpHeaders));
    add(
      "webParameters",
      !!connection.httpProxyPolicy?.queryParameters?.some((item) =>
        present(item.value),
      ) ||
        !!connection.httpFormAutomation?.fields?.some((item) =>
          present(item.value),
        ),
    );
    add("databaseUri", present(connection.mongoConnectionString));
    const cloud = connection.cloudProvider;
    add(
      "cloud",
      !!cloud &&
        any(
          cloud.apiKey,
          cloud.accessToken,
          cloud.clientSecret,
          cloud.serviceAccountKey,
          cloud.appSecret,
          cloud.consumerKey,
        ),
    );
    // Current cloud providers intentionally store token / JSON credentials in password.
    if (
      [
        "gcp",
        "azure",
        "ibm-csp",
        "digital-ocean",
        "heroku",
        "scaleway",
        "linode",
        "ovhcloud",
      ].includes(connection.protocol)
    )
      add("cloud", present(connection.password));
    const gateway = connection.rdpSettings?.gateway;
    add(
      "rdpRouting",
      present(connection.rdpSettings?.negotiation?.loadBalancingInfo),
    );
    add(
      "gateway",
      !!gateway &&
        any(
          gateway.username,
          gateway.password,
          gateway.domain,
          gateway.accessToken,
        ),
    );
    const proxy = connection.security?.proxy;
    add(
      "proxy",
      !!proxy &&
        (any(
          proxy.username,
          proxy.password,
          proxy.sshKeyFile,
          proxy.sshKeyPassphrase,
          proxy.tunnelKey,
        ) ||
          valuesPresent(proxy.customHeaders)),
    );
    for (const layer of connection.security?.tunnelChain ?? []) {
      add(
        "proxy",
        !!layer.proxy && any(layer.proxy.username, layer.proxy.password),
      );
      const ssh = layer.sshTunnel;
      add(
        "sshHop",
        !!ssh &&
          any(
            ssh.username,
            ssh.password,
            ssh.privateKey,
            ssh.passphrase,
            ssh.proxyCommand?.proxyUsername,
            ssh.proxyCommand?.proxyPassword,
          ),
      );
      add(
        "vpn",
        any(
          layer.vpn?.privateKey,
          layer.vpn?.presharedKey,
          layer.mesh?.authKey,
        ),
      );
      add("tunnel", present(layer.tunnel?.authToken));
    }
    const ssh = connection.sshConnectionConfigOverride;
    add("proxy", any(ssh?.proxyCommandUsername, ssh?.proxyCommandPassword));
    for (const hop of ssh?.mixedChain?.hops ?? []) {
      add(
        hop.type === "proxy" ? "proxy" : "sshHop",
        any(hop.username, hop.password),
      );
      if (hop.type === "ssh_jump")
        add(
          "sshHop",
          any(hop.privateKeyPath, hop.privateKeyPassphrase, hop.totpSecret) ||
            !!hop.keyboardInteractiveResponses?.some(present),
        );
    }
    // SPICE proxy URIs may embed credentials: never display or parse the URI.
    add("proxy", present(connection.spiceProxyUri));
    add(
      "clientKey",
      any(
        connection.postgresClientKeyPath,
        connection.postgresClientCertificatePath,
        connection.mysqlTls?.clientKeyPath,
        connection.mysqlTls?.clientCertPath,
        connection.mongoTls?.certKeyPath,
      ),
      "external",
    );
    const ps = connection.powerShellRemoting;
    add("account", any(ps?.credential?.username, ps?.credential?.domain));
    add(
      "external",
      any(
        ps?.credential?.savedCredentialId,
        ps?.credential?.vaultRef?.secretId,
        ps?.ssh?.privateKeyCredentialRef,
        ps?.wsman?.proxy?.credentialRef,
      ),
      "external",
    );
    add(
      "clientKey",
      any(ps?.ssh?.privateKeyPath, ps?.wsman?.tls?.clientCertificateRef),
      "external",
    );
    add("vault", connection.credentialSource?.kind === "vault", "vault");
    // Only persisted references. Integration launch secrets and providerFields are excluded.
    add(
      "integration",
      present(connection.integration?.credentialRefId) ||
        valuesPresent(connection.integration?.credentialRefIds),
      "external",
    );
    if (!kinds.size) return [];
    return [
      {
        id: connection.id,
        name: connection.name,
        protocol: connection.protocol.startsWith("integration:")
          ? "Integration"
          : connection.protocol,
        kinds: [...kinds],
        storage: [...storage],
        localValuesIgnored:
          connection.credentialSource?.kind === "vault" &&
          [...kinds].some((kind) =>
            [
              "account",
              "password",
              "privateKey",
              "passphrase",
              "totp",
              "webAuth",
              "webHeaders",
              "webParameters",
            ].includes(kind),
          ),
      },
    ];
  });
}

export function connectionCredentialMatches(
  row: ConnectionCredentialInventoryRow,
  query: string,
): boolean {
  return [
    row.name,
    row.protocol,
    ...row.kinds.map((key) => CONNECTION_CREDENTIAL_LABELS[key]),
    ...row.storage.map((key) => CONNECTION_CREDENTIAL_STORAGE_LABELS[key]),
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase());
}
