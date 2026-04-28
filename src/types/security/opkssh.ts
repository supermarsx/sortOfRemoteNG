/**
 * TypeScript types for the OpenPubkey SSH (opkssh) integration.
 * Mirrors the Rust types in src-tauri/crates/sorng-opkssh/src/types.rs.
 */

// ── Runtime / Installation ──────────────────────────────────────────

export type OpksshBackendMode = "auto" | "library" | "cli";

export type OpksshBackendKind = "library" | "cli";

export type OpksshRuntimeAvailability =
  | "available"
  | "planned"
  | "unavailable";

export interface OpksshBackendStatus {
  kind: OpksshBackendKind;
  available: boolean;
  availability: OpksshRuntimeAvailability;
  version: string | null;
  path: string | null;
  message: string | null;
  providerOwnsCallbackListener: boolean;
  providerOwnsCallbackShutdown: boolean;
}

export interface OpksshBinaryStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  platform: string;
  arch: string;
  downloadUrl: string | null;
  backend: OpksshBackendStatus;
}

export interface OpksshRuntimeStatus {
  mode: OpksshBackendMode;
  activeBackend: OpksshBackendKind | null;
  usingFallback: boolean;
  library: OpksshBackendStatus;
  cli: OpksshBinaryStatus;
  message: string | null;
}

// ── Provider Aliases ────────────────────────────────────────────────

export type OpksshProviderAlias =
  | "google"
  | "microsoft"
  | "azure"
  | "gitlab"
  | "helloDev"
  | "authelia"
  | "authentik"
  | "awsCognito"
  | "keycloak"
  | "kanidm"
  | "pocketId"
  | "zitadel"
  | "custom";

export const WELL_KNOWN_PROVIDERS: ReadonlyArray<{
  alias: OpksshProviderAlias;
  label: string;
  issuer: string;
}> = [
  {
    alias: "google",
    label: "Google",
    issuer: "https://accounts.google.com",
  },
  {
    alias: "microsoft",
    label: "Microsoft / Azure AD",
    issuer:
      "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
  },
  {
    alias: "gitlab",
    label: "GitLab",
    issuer: "https://gitlab.com",
  },
  {
    alias: "authelia",
    label: "Authelia",
    issuer: "",
  },
  {
    alias: "authentik",
    label: "Authentik",
    issuer: "",
  },
  {
    alias: "awsCognito",
    label: "AWS Cognito",
    issuer: "",
  },
  {
    alias: "keycloak",
    label: "Keycloak",
    issuer: "",
  },
  {
    alias: "kanidm",
    label: "Kanidm",
    issuer: "",
  },
  {
    alias: "pocketId",
    label: "PocketID",
    issuer: "",
  },
  {
    alias: "zitadel",
    label: "Zitadel",
    issuer: "",
  },
] as const;

// ── OIDC Login ──────────────────────────────────────────────────────

export interface OpksshLoginOptions {
  provider?: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  keyFileName?: string;
  createConfig?: boolean;
  remoteRedirectUri?: string;
}

export interface OpksshLoginResult {
  success: boolean;
  keyPath: string | null;
  identity: string | null;
  provider: string | null;
  expiresAt: string | null;
  message: string;
  rawOutput: string;
}

export type OpksshLoginOperationStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface OpksshLoginOperation {
  id: string;
  status: OpksshLoginOperationStatus;
  provider: string | null;
  runtime: OpksshRuntimeStatus;
  browserUrl: string | null;
  canCancel: boolean;
  message: string | null;
  result: OpksshLoginResult | null;
  startedAt: string;
  finishedAt: string | null;
}

// ── Key Management ──────────────────────────────────────────────────

export interface OpksshKey {
  id: string;
  path: string;
  publicKeyPath: string;
  identity: string | null;
  provider: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
  algorithm: string;
  fingerprint: string | null;
}

// ── Server Policy ───────────────────────────────────────────────────

export type ExpirationPolicy =
  | "12h"
  | "24h"
  | "48h"
  | "1week"
  | "oidc"
  | "oidc-refreshed";

export const EXPIRATION_POLICIES: ReadonlyArray<{
  value: ExpirationPolicy;
  label: string;
  description: string;
}> = [
  { value: "12h", label: "12 Hours", description: "Key expires after 12 hours" },
  { value: "24h", label: "24 Hours", description: "Key expires after 24 hours (recommended)" },
  { value: "48h", label: "48 Hours", description: "Key expires after 48 hours" },
  { value: "1week", label: "1 Week", description: "Key expires after 1 week" },
  { value: "oidc", label: "OIDC Token", description: "Key expires when the ID Token expires" },
  {
    value: "oidc-refreshed",
    label: "OIDC Refreshed",
    description: "Key expires when the refreshed ID Token expires (advanced)",
  },
] as const;

export interface ProviderEntry {
  issuer: string;
  clientId: string;
  expirationPolicy: ExpirationPolicy;
}

export interface AuthIdEntry {
  principal: string;
  identity: string;
  issuer: string;
}

export interface ServerOpksshConfig {
  installed: boolean;
  version: string | null;
  providers: ProviderEntry[];
  globalAuthIds: AuthIdEntry[];
  userAuthIds: AuthIdEntry[];
  sshdConfigSnippet: string | null;
}

// ── Provider Configuration ──────────────────────────────────────────

export interface CustomProvider {
  alias: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string;
}

export interface OpksshClientConfig {
  configPath: string;
  defaultProvider: string | null;
  providers: CustomProvider[];
}

// ── Audit ───────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string | null;
  identity: string;
  principal: string;
  issuer: string;
  action: string;
  sourceIp: string | null;
  success: boolean;
  details: string | null;
}

export interface AuditResult {
  entries: AuditEntry[];
  totalCount: number;
  rawOutput: string;
}

// ── Server Install ──────────────────────────────────────────────────

export interface ServerInstallOptions {
  sessionId: string;
  useInstallScript: boolean;
  customBinaryUrl?: string;
}

export interface ServerInstallResult {
  success: boolean;
  version: string | null;
  message: string;
  rawOutput: string;
}

// ── Overall Status ──────────────────────────────────────────────────

export interface OpksshStatus {
  runtime: OpksshRuntimeStatus;
  binary: OpksshBinaryStatus;
  activeKeys: OpksshKey[];
  clientConfig: OpksshClientConfig | null;
  lastLogin: string | null;
  lastError: string | null;
}

// ── UI State ────────────────────────────────────────────────────────

export type OpksshTab =
  | "overview"
  | "login"
  | "keys"
  | "serverConfig"
  | "providers"
  | "audit";
