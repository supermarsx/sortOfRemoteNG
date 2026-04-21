// FreeIPA — minimal TypeScript wire-format types for the sorng-freeipa backend.

export interface FreeIpaConnectionConfig {
  server_url: string;
  username: string;
  password: string;
  realm?: string;
  ca_cert_path?: string;
  verify_tls?: boolean;
  timeout_secs?: number;
}

export interface FreeIpaConnectionSummary {
  id: string;
  server_url: string;
  realm: string;
  username: string;
  connected_at: string;
}

// Open aliases for domain records.
export type FreeIpaUser = Record<string, unknown>;
export type FreeIpaGroup = Record<string, unknown>;
export type FreeIpaHost = Record<string, unknown>;
export type FreeIpaService = Record<string, unknown>;
export type FreeIpaDnsZone = Record<string, unknown>;
export type FreeIpaDnsRecord = Record<string, unknown>;
export type FreeIpaRole = Record<string, unknown>;
export type FreeIpaCertificate = Record<string, unknown>;
export type FreeIpaSudoRule = Record<string, unknown>;
export type FreeIpaHbacRule = Record<string, unknown>;
export type FreeIpaTrust = Record<string, unknown>;
export type FreeIpaDashboard = Record<string, unknown>;
