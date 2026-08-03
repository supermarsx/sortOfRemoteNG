type JsonLikeRecord = Record<string, unknown>;

const EXPLICIT_SECRET_FIELD_NAMES = new Set([
  "password",
  "basicauthpassword",
  "rustdeskpassword",
  "proxypassword",
  "privatekey",
  "privatekeypath",
  "passphrase",
  "sshkeypassphrase",
  "presharedkey",
  "totpsecret",
  "apikey",
  "accesskeyid",
  "secretaccesskey",
  "appkey",
  "appsecret",
  "consumerkey",
  "consumersecret",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "clientsecret",
  "serviceaccountkey",
  "authkey",
  "authtoken",
  "authtokensecret",
  "identitysecret",
  "seedphrase",
  "answer",
  "verificationcode",
  "recoverycode",
  "recoverycodes",
  "backupcode",
  "backupcodes",
  "savedcredentialid",
  "credentialid",
  "credentialref",
  "credentialrefid",
  "credentialrefids",
  "vaultref",
  "clientcertificateref",
  "privatekeycredentialref",
  "authorization",
  "proxyauthorization",
  "cookie",
  "cookies",
  "setcookie",
  "webhooksecret",
  "webhookurl",
  "signingsecret",
  "signingkey",
  "connectionstring",
]);

const normalizeFieldName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const hasSecretValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "boolean") return false;
  return true;
};

const isSecretFieldName = (fieldName: string): boolean => {
  const normalized = normalizeFieldName(fieldName);
  if (EXPLICIT_SECRET_FIELD_NAMES.has(normalized)) return true;

  return (
    normalized.endsWith("password") ||
    normalized.endsWith("passphrase") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("presharedkey") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token")
  );
};

const SECRET_TEXT_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
  /PuTTY-User-Key-File-[\s\S]*?(?:^|\r?\n)Private-Lines:/im,
  /(?:^|\r?\n)\s*(?:PrivateKey|PresharedKey|AuthKey|AuthToken|AccessToken|RefreshToken|Password|Passphrase)\s*[:=]\s*\S+/im,
  /<(?:key|tls-auth|tls-crypt|auth-user-pass)>[\s\S]*?<\/(?:key|tls-auth|tls-crypt|auth-user-pass)>/i,
  /(?:^|\r?\n)\s*auth-user-pass\s+\S+/im,
  /\btskey-(?:auth|client|api)-[A-Za-z0-9_-]+/i,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{8,}/i,
  /[?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|secret)=[^&\s]+/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i,
  /["'](?:password|passphrase|private[_-]?key|preshared[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)["']\s*:\s*["'][^"']+["']/i,
];

const containsSecretText = (value: string): boolean =>
  SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(value));

const isDate = (value: unknown): value is Date =>
  typeof Date !== "undefined" && value instanceof Date;

const containsExportSecretsInternal = (
  value: unknown,
  fieldName?: string,
): boolean => {
  if (fieldName && isSecretFieldName(fieldName) && hasSecretValue(value)) {
    return true;
  }
  if (typeof value === "string") return containsSecretText(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsExportSecretsInternal(item));
  }
  if (value && typeof value === "object" && !isDate(value)) {
    return Object.entries(value as JsonLikeRecord).some(([key, nestedValue]) =>
      containsExportSecretsInternal(nestedValue, key),
    );
  }
  return false;
};

const stripExportSecretsInternal = <T>(
  value: T,
  fieldName?: string,
): T | undefined => {
  if (fieldName && isSecretFieldName(fieldName) && hasSecretValue(value)) {
    return undefined;
  }
  if (typeof value === "string" && containsSecretText(value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stripExportSecretsInternal(item))
      .filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === "object" && !isDate(value)) {
    const sanitized: JsonLikeRecord = {};
    Object.entries(value as JsonLikeRecord).forEach(([key, nestedValue]) => {
      const safeValue = stripExportSecretsInternal(nestedValue, key);
      if (safeValue !== undefined) sanitized[key] = safeValue;
    });
    return sanitized as T;
  }
  return value;
};

/**
 * Detects credential material in a JSON-compatible export payload. This is a
 * final safety boundary, not a replacement for format-specific preparation.
 */
export const containsExportSecrets = (value: unknown): boolean =>
  containsExportSecretsInternal(value);

/**
 * Returns a deep copy with credential-bearing fields and recognizable inline
 * secret material removed. Arrays are compacted when an item is removed.
 */
export const stripExportSecrets = <T>(value: T): T | undefined =>
  stripExportSecretsInternal(value);
