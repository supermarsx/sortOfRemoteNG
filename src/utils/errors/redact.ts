const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH|RSA|EC) PRIVATE KEY-----/g;
const KEY_VALUE_PATTERN =
  /\b([A-Za-z0-9_-]*(?:password|passphrase|secret|api[_-]?key|token)[A-Za-z0-9_-]*)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const FLAG_PASSWORD_PATTERN = /(^|\s)-p(\S+)/gi;
const AWS_TOKEN_PATTERN = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const GCP_TOKEN_PATTERN = /\bya29\.[0-9A-Za-z\-_]+\b/g;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(
  message: string,
  needles: readonly string[] = [],
): string {
  if (!message) return message;

  let redacted = message.replace(
    PRIVATE_KEY_BLOCK_PATTERN,
    "[redacted private key]",
  );

  redacted = redacted.replace(
    KEY_VALUE_PATTERN,
    (_, key: string, separator: string) => `${key}${separator}[redacted]`,
  );

  redacted = redacted.replace(
    FLAG_PASSWORD_PATTERN,
    (_, prefix: string) => `${prefix}-p[redacted]`,
  );
  redacted = redacted.replace(AWS_TOKEN_PATTERN, "[redacted]");
  redacted = redacted.replace(GCP_TOKEN_PATTERN, "[redacted]");

  for (const needle of needles) {
    if (!needle) continue;
    redacted = redacted.replace(
      new RegExp(escapeForRegExp(needle), "g"),
      "[redacted]",
    );
  }

  return redacted;
}

export default redactSecrets;