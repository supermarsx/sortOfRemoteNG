// Exchange shared types — camelCase 1:1 mirror of the connection/config/common
// structs in `src-tauri/crates/sorng-exchange/src/types.rs`. Those structs derive
// `#[serde(rename_all = "camelCase")]`, so these interfaces are a direct 1:1 view
// of the wire shape (no invoke-layer field remapping, unlike netbox).
//
// This barrel owns ONLY the shell/shared types (connection config + credential
// variants, the connection summary, error/token/paging helpers, and the tab-plugin
// props). Per-domain types (Mailbox, TransportRule, ExchangeServer, MobileDevice,
// RetentionPolicy, ...) live in the category-exec files
// `src/types/exchange/<category>.ts`; each appends its own `export * from
// "./<category>"` line in the marked region below (append-only, disjoint per §4b).
//
// ⚠️ Exchange is a SINGLETON service: there is ONE active connection in
// `ExchangeServiceState`, and `exchange_*` commands take NO connection id — they
// operate on that single connection. Category tabs therefore receive an
// `ExchangeTabProps` carrying the summary, NOT a `connectionId`.

import type { ComponentType } from "react";

// ─── Environment & credential variants ────────────────────────────────────────

/** Mirror of `ExchangeEnvironment`. Chooses which credential variant is used. */
export type ExchangeEnvironment = "onPremises" | "online" | "hybrid";

/** Mirror of `OnPremAuthMethod` — PowerShell remoting auth mechanism. */
export type OnPremAuthMethod = "kerberos" | "negotiate" | "basic" | "ntlm";

/** Mirror of `ExchangeOnlineCredentials` — OAuth2 for Exchange Online / Graph. */
export interface ExchangeOnlineCredentials {
  /** Azure AD tenant ID (GUID or domain). */
  tenantId: string;
  /** Application (client) ID. */
  clientId: string;
  /** Client secret (service principal); optional for delegated auth. */
  clientSecret?: string | null;
  /** Delegated user UPN for app+user flows. */
  username?: string | null;
  /** Password for ROPC flow. */
  password?: string | null;
  /** Organization domain, e.g. contoso.onmicrosoft.com. */
  organization?: string | null;
}

/** Mirror of `ExchangeOnPremCredentials` — Exchange Management Shell remoting. */
export interface ExchangeOnPremCredentials {
  /** Exchange server FQDN (e.g. mail01.contoso.local). */
  server: string;
  /** PowerShell remoting port; defaults to 443. */
  port: number;
  /** Domain\\User or UPN. */
  username: string;
  /** Password. */
  password: string;
  /** Use SSL for PowerShell remoting. */
  useSsl: boolean;
  /** Auth mechanism. */
  authMethod: OnPremAuthMethod;
  /** Skip certificate validation (lab/dev). */
  skipCertCheck: boolean;
}

/** Mirror of `ExchangeConnectionConfig` — the payload of `exchange_set_config`.
 *  Populate `online` for Exchange Online, `onPrem` for on-prem; `environment`
 *  selects which the backend uses (hybrid may carry both). */
export interface ExchangeConnectionConfig {
  environment: ExchangeEnvironment;
  online?: ExchangeOnlineCredentials | null;
  onPrem?: ExchangeOnPremCredentials | null;
  /** Request timeout in seconds (default 120). */
  timeoutSecs?: number | null;
  /** Optional HTTP proxy URL used for Exchange Online Graph/EXO HTTP calls. */
  proxyUrl?: string | null;
}

/** Mirror of `ExchangeConnectionSummary` — returned by `exchange_connect` /
 *  `exchange_connection_summary`. */
export interface ExchangeConnectionSummary {
  connected: boolean;
  environment: ExchangeEnvironment;
  server?: string | null;
  organization?: string | null;
  connectedAs?: string | null;
  exchangeVersion?: string | null;
}

// ─── Error / token / paging helpers ───────────────────────────────────────────

/** Mirror of `ExchangeErrorKind`. Note: the Rust enum is NOT `rename_all`, so its
 *  variants serialize PascalCase — but commands return `Result<T, String>` (the
 *  error is a formatted string), so this type is informational only. */
export type ExchangeErrorKind =
  | "Auth"
  | "Connection"
  | "Timeout"
  | "NotFound"
  | "Conflict"
  | "Validation"
  | "PowerShell"
  | "Graph"
  | "Ews"
  | "Throttled"
  | "QuotaExceeded"
  | "ServiceUnavailable"
  | "Unknown";

/** Mirror of `ExchangeError`. Commands surface errors as strings; this describes
 *  the structured shape for any command that returns it directly. */
export interface ExchangeError {
  kind: ExchangeErrorKind;
  message: string;
  statusCode?: number | null;
  code?: string | null;
}

/** Mirror of `ExchangeToken` — an issued OAuth token (Exchange Online). */
export interface ExchangeToken {
  accessToken: string;
  tokenType: string;
  /** ISO-8601 timestamp. */
  expiresAt: string;
  refreshToken?: string | null;
  scopes: string[];
}

/** Mirror of `GraphList<T>` — the Graph paged-collection envelope. */
export interface GraphList<T> {
  value: T[];
  nextLink?: string | null;
  count?: number | null;
}

// ─── Tab-plugin contract ─────────────────────────────────────────────────────

/** Props every Exchange category tab receives from the shell's sub-tab host. A tab
 *  is only mounted once the shell has an established connection. Exchange is a
 *  SINGLETON service, so there is NO `connectionId`: call each `exchange_*` command
 *  with its own command-specific args only. */
export interface ExchangeTabProps {
  /** Latest connection summary from the shell (environment, server, org, version). */
  summary: ExchangeConnectionSummary | null;
}

/** Convenience alias for a category tab component. */
export type ExchangeTabComponent = ComponentType<ExchangeTabProps>;

// ─── Per-category type modules (append-only; owned by category execs) ─────────
// Wired by the Wave-2 integrator (no cross-slice name collisions — `export *`
// is safe here; hook barrel uses named re-exports instead).
export * from "./recipients";
export * from "./mailflow";
export * from "./servers";
export * from "./clientaccess";
export * from "./orgsecurity";
