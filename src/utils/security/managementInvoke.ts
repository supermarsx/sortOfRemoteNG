import { invoke as tauriInvoke } from "@tauri-apps/api/core";

const MAX_COMMAND_LENGTH = 128;
const MAX_DEPTH = 16;
const MAX_IDENTIFIER_LENGTH = 4096;
const MAX_REQUEST_STRING_LENGTH = 1024 * 1024;
const MAX_RESPONSE_STRING_LENGTH = 4 * 1024 * 1024;
const MAX_REQUEST_UNITS = 2 * 1024 * 1024;
const MAX_RESPONSE_UNITS = 16 * 1024 * 1024;
const MAX_REQUEST_ARRAY_ITEMS = 4096;
const MAX_RESPONSE_ARRAY_ITEMS = 10_000;
const MAX_OBJECT_KEYS = 512;
const MAX_SAFE_ERROR_LENGTH = 512;
const MAX_RAW_ERROR_LENGTH = 16 * 1024;

const identifierKey = /(?:^|_)(?:id|ids|connection_id|session_id)$|(?:Id|Ids)$/;
const controlCharacters = {
  test(value: string): boolean {
    return Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
  },
};

interface EnvelopeLimits {
  maxUnits: number;
  maxStringLength: number;
  maxArrayItems: number;
}

function inspectEnvelope(
  value: unknown,
  limits: EnvelopeLimits,
  path: string,
  depth: number,
  budget: { units: number },
  seen: WeakSet<object>,
): void {
  if (depth > MAX_DEPTH) {
    throw new Error(
      `Management request exceeded the nesting limit at ${path}.`,
    );
  }

  if (value === null || value === undefined) {
    budget.units += 1;
  } else if (typeof value === "string") {
    if (value.length > limits.maxStringLength) {
      throw new Error(`Management value at ${path} exceeded the size limit.`);
    }
    const pathParts = path.split(".");
    const key = pathParts[pathParts.length - 1] ?? "";
    if (identifierKey.test(key)) {
      if (
        value.length === 0 ||
        value.length > MAX_IDENTIFIER_LENGTH ||
        controlCharacters.test(value)
      ) {
        throw new Error(`Management identifier at ${path} is invalid.`);
      }
    }
    budget.units += value.length;
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Management number at ${path} must be finite.`);
    }
    budget.units += 16;
  } else if (typeof value === "boolean") {
    budget.units += 16;
  } else if (typeof value === "bigint") {
    throw new Error(
      `Management payload at ${path} contains an unsupported value.`,
    );
  } else if (Array.isArray(value)) {
    if (value.length > limits.maxArrayItems) {
      throw new Error(
        `Management collection at ${path} exceeded the item limit.`,
      );
    }
    budget.units += value.length;
    value.forEach((item, index) =>
      inspectEnvelope(
        item,
        limits,
        `${path}[${index}]`,
        depth + 1,
        budget,
        seen,
      ),
    );
  } else if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        `Management payload at ${path} must contain only plain objects.`,
      );
    }
    if (seen.has(value)) {
      throw new Error(`Management payload at ${path} contains a cycle.`);
    }
    seen.add(value);
    let keyCount = 0;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      keyCount += 1;
      if (keyCount > MAX_OBJECT_KEYS) {
        throw new Error(`Management object at ${path} exceeded the key limit.`);
      }
      if (key.length > 256 || controlCharacters.test(key)) {
        throw new Error(
          `Management object at ${path} contains an invalid key.`,
        );
      }
      budget.units += key.length;
      inspectEnvelope(
        (value as Record<string, unknown>)[key],
        limits,
        `${path}.${key}`,
        depth + 1,
        budget,
        seen,
      );
    }
    seen.delete(value);
  } else {
    throw new Error(
      `Management payload at ${path} contains an unsupported value.`,
    );
  }

  if (budget.units > limits.maxUnits) {
    throw new Error(`Management payload exceeded the total size limit.`);
  }
}

function validateEnvelope(
  value: unknown,
  limits: EnvelopeLimits,
  root: string,
): void {
  inspectEnvelope(value, limits, root, 0, { units: 0 }, new WeakSet());
}

function rawErrorText(error: unknown, fallback: string): string {
  try {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return String(error || fallback);
  } catch {
    return fallback;
  }
}

export function toSafeManagementError(
  error: unknown,
  fallback = "The management operation failed.",
): string {
  const redacted = rawErrorText(error, fallback)
    .slice(0, MAX_RAW_ERROR_LENGTH)
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gi,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/(\b(?:set-cookie|cookie)\b\s*:\s*)[^\r\n]*/gi, "$1[REDACTED]")
    .replace(
      /(\b(?:authorization|password|passwd|pwd|passphrase|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*)(["'])(?:\\.|[^\\])*?\2/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(\b(?:authorization|password|passwd|pwd|passphrase|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*)(?!["'])[^\s,;}\]]+/gi,
      "$1[REDACTED]",
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(
      /([?&](?:access_token|refresh_token|id_token|api_key|client_secret|password|passwd|pwd|passphrase|secret|token)=)[^&#\s]*/gi,
      "$1[REDACTED]",
    )
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "[REDACTED DATA]")
    .trim();

  return (redacted || fallback).slice(0, MAX_SAFE_ERROR_LENGTH);
}

const requestLimits: EnvelopeLimits = {
  maxUnits: MAX_REQUEST_UNITS,
  maxStringLength: MAX_REQUEST_STRING_LENGTH,
  maxArrayItems: MAX_REQUEST_ARRAY_ITEMS,
};

const responseLimits: EnvelopeLimits = {
  maxUnits: MAX_RESPONSE_UNITS,
  maxStringLength: MAX_RESPONSE_STRING_LENGTH,
  maxArrayItems: MAX_RESPONSE_ARRAY_ITEMS,
};

export async function invokeManagement<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (
    command.length === 0 ||
    command.length > MAX_COMMAND_LENGTH ||
    !/^[a-z][a-z0-9_]*$/.test(command)
  ) {
    throw new Error("Management command name is invalid.");
  }

  try {
    if (args !== undefined) {
      validateEnvelope(args, requestLimits, "args");
    }
    const response =
      args === undefined
        ? await tauriInvoke<T>(command)
        : await tauriInvoke<T>(command, args);
    validateEnvelope(response, responseLimits, "response");
    return response;
  } catch (error) {
    throw new Error(toSafeManagementError(error));
  }
}
