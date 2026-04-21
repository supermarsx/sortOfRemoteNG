// CUPS — minimal TypeScript wire-format types for the sorng-cups backend.
// Full type surface is intentionally open (`unknown`) for complex records
// like PrinterInfo, JobInfo, PPD, etc. to avoid duplicating 500+ LoC of
// Rust struct definitions. Consumers that need field access can cast or
// progressively refine as UI needs appear.

export type CupsEncryption = "never" | "if_requested" | "required" | "always";

export interface CupsConnectionConfig {
  host: string;
  port?: number;
  use_tls?: boolean;
  encryption?: CupsEncryption;
  username?: string;
  password?: string;
  timeout_secs: number;
  verify_tls?: boolean;
}

// Open aliases — cast at call site when UI needs specific shape.
export type CupsPrinter = Record<string, unknown>;
export type CupsJob = Record<string, unknown>;
export type CupsClass = Record<string, unknown>;
export type CupsPPD = Record<string, unknown>;
export type CupsDriver = Record<string, unknown>;
export type CupsServerSettings = Record<string, unknown>;
export type CupsSubscription = Record<string, unknown>;
export type CupsEvent = Record<string, unknown>;
export type CupsDiscoveredDevice = Record<string, unknown>;
export type CupsPrinterStatistics = Record<string, unknown>;
