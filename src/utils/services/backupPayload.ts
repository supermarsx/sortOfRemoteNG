import type { BackupConfig } from "../../types/settings/backupSettings";
import type { Connection } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";

export interface BackupSourcePayload {
  connections?: unknown[];
  settings?: Record<string, unknown> | Partial<GlobalSettings>;
  timestamp?: number;
  app_data?: Record<string, unknown>;
}

export interface BackupPayload {
  connections: unknown[];
  settings: Record<string, unknown>;
  timestamp: number;
  app_data?: Record<string, unknown>;
}

const SECRET_FIELD_NAMES = new Set([
  "password",
  "basicauthpassword",
  "rustdeskpassword",
  "proxypassword",
  "privatekey",
  "passphrase",
  "totpsecret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "serviceaccountkey",
  "presharedkey",
  "authkey",
  "authtoken",
  "bearertoken",
  "apppassword",
  "webhookverifytoken",
  "appsecret",
  "syncencryptionpassword",
  "encryptionpassword",
  "token",
  "secret",
  "seedphrase",
  "answer",
]);

const SSH_KEY_FIELD_NAMES = new Set([
  "privatekey",
  "passphrase",
  "sshprivatekey",
  "sshpassphrase",
]);

const SECRET_HEADER_NAMES =
  /authorization|cookie|token|secret|password|api[-_ ]?key/i;

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripFields<T>(
  value: T,
  predicate: (normalizedFieldName: string) => boolean,
  fieldName?: string,
): T | undefined {
  const normalizedFieldName = fieldName ? normalizeFieldName(fieldName) : "";
  if (normalizedFieldName && predicate(normalizedFieldName)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripFields(item, predicate))
      .filter((item) => item !== undefined) as T;
  }

  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
      if (key === "httpHeaders" && isPlainObject(nestedValue)) {
        next[key] = Object.fromEntries(
          Object.entries(nestedValue).filter(
            ([headerName]) => !SECRET_HEADER_NAMES.test(headerName),
          ),
        );
        return;
      }

      const strippedValue = stripFields(nestedValue, predicate, key);
      if (strippedValue !== undefined) {
        next[key] = strippedValue;
      }
    });
    return next as T;
  }

  return value;
}

export function stripStructuredSecrets<T>(value: T): T | undefined {
  return stripFields(value, (fieldName) => SECRET_FIELD_NAMES.has(fieldName));
}

function stripSshKeyMaterial<T>(value: T): T | undefined {
  return stripFields(value, (fieldName) => SSH_KEY_FIELD_NAMES.has(fieldName));
}

function sanitizeConnectionForBackup(
  connection: unknown,
  config: BackupConfig,
): unknown {
  if (!config.includePasswords) {
    return stripStructuredSecrets(connection);
  }
  if (!config.includeSSHKeys) {
    return stripSshKeyMaterial(connection);
  }
  return connection;
}

function sanitizeSettingsForBackup(
  settings: BackupSourcePayload["settings"],
): Record<string, unknown> {
  const sanitized = stripStructuredSecrets(settings ?? {});
  return isPlainObject(sanitized) ? sanitized : {};
}

export function buildBackupPayload(
  source: BackupSourcePayload,
  config: BackupConfig,
): BackupPayload {
  const rawConnections = Array.isArray(source.connections)
    ? source.connections
    : [];
  const connections = rawConnections
    .map((connection) =>
      sanitizeConnectionForBackup(connection as Connection, config),
    )
    .filter((connection) => connection !== undefined);

  const payload: BackupPayload = {
    connections,
    settings: config.includeSettings
      ? sanitizeSettingsForBackup(source.settings)
      : {},
    timestamp:
      typeof source.timestamp === "number" ? source.timestamp : Date.now(),
  };

  if (source.app_data && isPlainObject(source.app_data)) {
    const sanitizedAppData = stripStructuredSecrets(source.app_data);
    if (isPlainObject(sanitizedAppData)) {
      payload.app_data = sanitizedAppData;
    }
  }

  return payload;
}
