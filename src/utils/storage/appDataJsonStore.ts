import { getInvoke, type TauriInvoke } from "../tauri/invoke";
import { IndexedDbService } from "./indexedDbService";
import {
  assertMacroLibraryReadAccess,
  readMacroLibraryWhenReady,
  type MacroLibraryReadAccess,
} from "./macroLibraryReadRecovery";

export const APP_DATA_STORE_CHANGED_EVENT = "sorng-app-data-store-changed";

export interface SanitizedValue<T> {
  value: T;
  changed: boolean;
}

export interface DurableLoadResult<T> {
  value: T | null;
  sanitized: boolean;
}

interface AppDataJsonStoreOptions<T> {
  key: string;
  legacyLocalStorageKey?: string;
  sanitize: (value: unknown) => SanitizedValue<T>;
  requireNative?: boolean;
  /** Macro-family policy and rotation, not the generic connections artifact. */
  backend?: "app-data" | "macro-library";
}

const mutationQueues = new Map<string, Promise<void>>();
const MAX_CAS_ATTEMPTS = 5;

const normalizeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const enqueue = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  mutationQueues.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
};

const parseJson = (key: string, raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Stored data for "${key}" is corrupted: ${normalizeError(error)}`,
    );
  }
};

const emitChanged = (key: string): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, { detail: { key } }),
  );
};

export class AppDataJsonStore<T> {
  readonly key: string;
  private readonly legacyLocalStorageKey: string | undefined;
  private readonly sanitizeValue: (value: unknown) => SanitizedValue<T>;
  private readonly requireNative: boolean;
  private readonly storageBackend: "app-data" | "macro-library";

  constructor(options: AppDataJsonStoreOptions<T>) {
    this.key = options.key;
    this.legacyLocalStorageKey = options.legacyLocalStorageKey;
    this.sanitizeValue = options.sanitize;
    this.storageBackend = options.backend ?? "app-data";
    this.requireNative =
      options.requireNative === true || this.storageBackend === "macro-library";
  }

  private async backend(): Promise<TauriInvoke | null> {
    const invoke = await getInvoke();
    if (!invoke && this.requireNative)
      throw new Error(
        "This library requires the desktop app and an unlocked data store. No browser fallback was written.",
      );
    return invoke;
  }

  /** Optional recovery applies only to the first, pre-mutation macro read. */
  async load(access?: MacroLibraryReadAccess): Promise<DurableLoadResult<T>> {
    return enqueue(this.key, async () => {
      assertMacroLibraryReadAccess(access);
      const invoke = await this.backend();
      assertMacroLibraryReadAccess(access);
      const durableRaw =
        access && invoke && this.storageBackend === "macro-library"
          ? await readMacroLibraryWhenReady(invoke, this.key, access)
          : await this.readRaw(invoke);
      assertMacroLibraryReadAccess(access);
      if (durableRaw !== null) {
        const normalized = await this.normalizeDurable(
          invoke,
          durableRaw,
          access,
        );
        assertMacroLibraryReadAccess(access);
        this.removeLegacy();
        return normalized;
      }

      const legacyRaw = this.readLegacy();
      if (legacyRaw === null) return { value: null, sanitized: false };

      const sanitized = this.sanitizeValue(
        parseJson(this.legacyLocalStorageKey ?? this.key, legacyRaw),
      );
      const replacement = JSON.stringify(sanitized.value);
      const committed = await this.compareAndSwap(invoke, null, replacement);
      assertMacroLibraryReadAccess(access);
      if (!committed) {
        const concurrentRaw = await this.readRaw(invoke);
        assertMacroLibraryReadAccess(access);
        if (concurrentRaw === null) {
          throw new Error(
            `Concurrent migration for "${this.key}" did not produce durable data`,
          );
        }
        const concurrent = await this.normalizeDurable(
          invoke,
          concurrentRaw,
          access,
        );
        assertMacroLibraryReadAccess(access);
        this.removeLegacy();
        return concurrent;
      }

      this.removeLegacy();
      emitChanged(this.key);
      return { value: sanitized.value, sanitized: sanitized.changed };
    });
  }

  async save(value: T): Promise<SanitizedValue<T>> {
    return enqueue(this.key, async () => {
      const sanitized = this.sanitizeValue(value);
      const replacement = JSON.stringify(sanitized.value);
      const invoke = await this.backend();

      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
        const expected = await this.readRaw(invoke);
        if (await this.compareAndSwap(invoke, expected, replacement)) {
          this.removeLegacy();
          emitChanged(this.key);
          return sanitized;
        }
      }

      throw new Error(
        `Could not persist "${this.key}" after ${MAX_CAS_ATTEMPTS} concurrent write conflicts`,
      );
    });
  }

  /** Apply a synchronous edit to the latest value, retrying only refused CAS writes. */
  async update(
    transform: (current: T | null) => T,
  ): Promise<SanitizedValue<T>> {
    return enqueue(this.key, async () => {
      const invoke = await this.backend();
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
        const expected = await this.readRaw(invoke);
        const current =
          expected === null
            ? null
            : this.sanitizeValue(parseJson(this.key, expected)).value;
        const sanitized = this.sanitizeValue(transform(current));
        const replacement = JSON.stringify(sanitized.value);
        if (!(await this.compareAndSwap(invoke, expected, replacement)))
          continue;
        // A failed verification must never reapply the edit: the write may
        // already have committed or a different window may have advanced it.
        if ((await this.readRaw(invoke)) !== replacement)
          throw new Error(
            "Library write could not be verified. Reload before retrying; legacy data was retained.",
          );
        emitChanged(this.key);
        return sanitized;
      }
      throw new Error(
        "Library changed in another window. Reload before retrying.",
      );
    });
  }

  private async normalizeDurable(
    invoke: TauriInvoke | null,
    initialRaw: string,
    access?: MacroLibraryReadAccess,
  ): Promise<DurableLoadResult<T>> {
    let raw = initialRaw;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      assertMacroLibraryReadAccess(access);
      const sanitized = this.sanitizeValue(parseJson(this.key, raw));
      const replacement = JSON.stringify(sanitized.value);
      if (!sanitized.changed && replacement === raw) {
        return { value: sanitized.value, sanitized: false };
      }
      if (await this.compareAndSwap(invoke, raw, replacement)) {
        assertMacroLibraryReadAccess(access);
        emitChanged(this.key);
        return { value: sanitized.value, sanitized: true };
      }
      assertMacroLibraryReadAccess(access);
      const concurrentRaw = await this.readRaw(invoke);
      assertMacroLibraryReadAccess(access);
      if (concurrentRaw === null) {
        throw new Error(
          `Stored data for "${this.key}" disappeared during read`,
        );
      }
      raw = concurrentRaw;
    }
    throw new Error(
      `Could not sanitize "${this.key}" after ${MAX_CAS_ATTEMPTS} concurrent write conflicts`,
    );
  }

  private async readRaw(invoke: TauriInvoke | null): Promise<string | null> {
    if (invoke) {
      return invoke<string | null>(
        this.storageBackend === "macro-library"
          ? "read_macro_library"
          : "read_app_data",
        { key: this.key },
      );
    }
    const value = await IndexedDbService.getItemStrict<unknown>(this.key);
    if (value === null) return null;
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  private async compareAndSwap(
    invoke: TauriInvoke | null,
    expected: string | null,
    replacement: string,
  ): Promise<boolean> {
    if (invoke) {
      return invoke<boolean>(
        this.storageBackend === "macro-library"
          ? "compare_and_swap_macro_library"
          : "compare_and_swap_app_data",
        {
          key: this.key,
          expected,
          replacement,
        },
      );
    }

    const current = await this.readRaw(null);
    if (current !== expected) return false;
    await IndexedDbService.setItemStrict(this.key, replacement);
    return true;
  }

  private readLegacy(): string | null {
    if (typeof localStorage === "undefined" || !this.legacyLocalStorageKey)
      return null;
    return localStorage.getItem(this.legacyLocalStorageKey);
  }

  private removeLegacy(): void {
    if (typeof localStorage === "undefined" || !this.legacyLocalStorageKey)
      return;
    if (localStorage.getItem(this.legacyLocalStorageKey) !== null) {
      localStorage.removeItem(this.legacyLocalStorageKey);
    }
  }
}

const SECRET_FIELD_NAMES = [
  "password",
  "passphrase",
  "privatekey",
  "presharedkey",
  "secret",
  "token",
  "apikey",
  "authkey",
  "cookie",
  "authorization",
  "credentialref",
];

const normalizeFieldName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const isSecretFieldName = (value: string): boolean => {
  const normalized = normalizeFieldName(value);
  return SECRET_FIELD_NAMES.some(
    (field) => normalized === field || normalized.endsWith(field),
  );
};

const SECRET_TEXT_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
  /PuTTY-User-Key-File-[\s\S]*?Private-Lines:/i,
  /\btskey-(?:auth|client|api)-[A-Za-z0-9_-]+/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{8,}/i,
  /(?:--password|--passphrase|--token|--api-key)(?:=|\s+)(?![$%]|\{\{)[^\s]+/i,
  /\b(?:password|passwd|passphrase|client_secret|api_key)\s*[:=]\s*["'][^"'$%{][^"']{3,}["']/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i,
];

export const containsLikelySecretText = (value: string): boolean =>
  SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(value));

const stripCredentialFieldsInternal = (
  value: unknown,
  fieldName?: string,
): { value: unknown; changed: boolean } => {
  if (
    fieldName &&
    isSecretFieldName(fieldName) &&
    value !== undefined &&
    value !== null &&
    value !== ""
  ) {
    return { value: undefined, changed: true };
  }
  if (typeof value === "string" && containsLikelySecretText(value)) {
    return { value: undefined, changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const sanitized: unknown[] = [];
    for (const item of value) {
      const result = stripCredentialFieldsInternal(item);
      changed ||= result.changed;
      if (result.value !== undefined) sanitized.push(result.value);
      else changed = true;
    }
    return { value: sanitized, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const result = stripCredentialFieldsInternal(nestedValue, key);
      changed ||= result.changed;
      if (result.value !== undefined) sanitized[key] = result.value;
      else changed = true;
    }
    return { value: sanitized, changed };
  }
  return { value, changed: false };
};

export const stripCredentialFields = <T>(value: T): SanitizedValue<T> => {
  const result = stripCredentialFieldsInternal(value);
  return { value: result.value as T, changed: result.changed };
};
