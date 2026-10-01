import { getInvoke, type TauriInvoke } from "../tauri/invoke";
import { IndexedDbService } from "./indexedDbService";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
  type RecordLedger,
} from "./recordLedger";
import {
  assertMacroLibraryReadAccess,
  readMacroLibraryWhenReady,
  readAppDataWhenReady,
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

export interface AppDataJsonStoreOptions<T> {
  key: string;
  legacyLocalStorageKey?: string;
  sanitize: (value: unknown) => SanitizedValue<T>;
  requireNative?: boolean;
  /** Macro-family policy and rotation, not the generic connections artifact. */
  backend?: "app-data" | "macro-library";
  /** Embed record history in object snapshots, in the same CAS as their data. */
  trackRecords?: boolean;
}

export interface AppDataJsonStoreUpdateOptions {
  /** Adopt reviewed remote history, rejecting mismatches and CAS conflicts. */
  adoptRecordMetadata?: boolean;
}

/** The CAS succeeded; a later failure must not be treated as a safe replay. */
export class AppDataJsonStoreCommittedError extends Error {
  readonly kind = "partial";
  constructor() {
    super(
      "Library write committed but verification or finalization failed. Reload before retrying; no rollback was attempted.",
    );
    this.name = "AppDataJsonStoreCommittedError";
  }
}

const isObjectSnapshot = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Keep ledger metadata outside strict domain sanitizers, without doing I/O. */
export function sanitizeWithRecordMetadata<T>(
  value: unknown,
  sanitize: (value: unknown) => SanitizedValue<T>,
): SanitizedValue<T> {
  const { recordMetadata, ...domain } = isObjectSnapshot(value) ? value : {};
  const metadata = normalizeRecordLedger(recordMetadata);
  const sanitized = sanitize(isObjectSnapshot(value) ? domain : value);
  if (!isObjectSnapshot(sanitized.value))
    throw new Error("Record tracking requires an object snapshot.");
  return {
    value: {
      ...sanitized.value,
      ...(metadata ? { recordMetadata: metadata } : {}),
    },
    changed:
      sanitized.changed ||
      JSON.stringify(recordMetadata) !== JSON.stringify(metadata),
  };
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
  private readonly trackRecords: boolean;

  constructor(options: AppDataJsonStoreOptions<T>) {
    this.key = options.key;
    this.legacyLocalStorageKey = options.legacyLocalStorageKey;
    this.trackRecords = options.trackRecords === true;
    this.sanitizeValue = this.trackRecords
      ? (value) => sanitizeWithRecordMetadata(value, options.sanitize)
      : options.sanitize;
    this.storageBackend = options.backend ?? "app-data";
    this.requireNative =
      options.requireNative === true || this.storageBackend === "macro-library";
  }

  private async migrateValue(value: unknown): Promise<SanitizedValue<T>> {
    const sanitized = this.sanitizeValue(value);
    if (!this.trackRecords) return sanitized;
    const metadata = normalizeRecordLedger(
      (sanitized.value as Record<string, unknown>).recordMetadata,
    );
    const recordMetadata = await reconcileRecordLedger(
      sanitized.value,
      metadata,
      { mode: "migrate" },
    );
    return {
      ...sanitized,
      value: { ...sanitized.value, recordMetadata },
    };
  }

  private async prepareWrite(
    value: T,
    previous?: RecordLedger,
    adoptRecordMetadata = false,
  ): Promise<SanitizedValue<T>> {
    const sanitized = this.sanitizeValue(value);
    if (!this.trackRecords) {
      if (adoptRecordMetadata)
        throw new Error("Remote record metadata requires record tracking.");
      return sanitized;
    }
    const incoming = normalizeRecordLedger(
      (sanitized.value as Record<string, unknown>).recordMetadata,
    );
    const domain = { ...sanitized.value } as Record<string, unknown>;
    delete domain.recordMetadata;
    const recordMetadata = await reconcileRecordLedger(
      domain,
      adoptRecordMetadata ? incoming : previous,
      { mode: adoptRecordMetadata ? "migrate" : "write" },
    );
    if (
      adoptRecordMetadata &&
      incoming !== undefined &&
      JSON.stringify(incoming) !== JSON.stringify(recordMetadata)
    )
      throw new Error(
        "Remote record metadata does not match the reviewed data.",
      );
    return {
      ...sanitized,
      value: { ...sanitized.value, recordMetadata },
    };
  }

  private async backend(): Promise<TauriInvoke | null> {
    const invoke = await getInvoke();
    if (!invoke && this.requireNative)
      throw new Error(
        "This library requires the desktop app and an unlocked data store. No browser fallback was written.",
      );
    return invoke;
  }

  /** Optional recovery applies only to the first, pre-mutation native read. */
  async load(
    access?: MacroLibraryReadAccess,
    options: { recoverPreReadBusy?: boolean } = {},
  ): Promise<DurableLoadResult<T>> {
    return enqueue(this.key, async () => {
      assertMacroLibraryReadAccess(access);
      const invoke = await this.backend();
      assertMacroLibraryReadAccess(access);
      const durableRaw =
        access && invoke && options.recoverPreReadBusy !== false
          ? await (this.storageBackend === "macro-library"
              ? readMacroLibraryWhenReady(invoke, this.key, access)
              : readAppDataWhenReady(invoke, this.key, access))
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

      const sanitized = await this.migrateValue(
        parseJson(this.legacyLocalStorageKey ?? this.key, legacyRaw),
      );
      const replacement = JSON.stringify(sanitized.value);
      assertMacroLibraryReadAccess(access);
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
      return {
        value: sanitized.value,
        sanitized: sanitized.changed || this.trackRecords,
      };
    });
  }

  async save(value: T): Promise<SanitizedValue<T>> {
    return enqueue(this.key, async () => {
      const invoke = await this.backend();

      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
        const expected = await this.readRaw(invoke);
        const current =
          this.trackRecords && expected !== null
            ? (await this.migrateValue(parseJson(this.key, expected))).value
            : null;
        const sanitized = await this.prepareWrite(
          value,
          this.durableMetadata(current),
        );
        const replacement = JSON.stringify(sanitized.value);
        const unchanged = replacement === expected;
        if (
          unchanged ||
          (await this.compareAndSwap(invoke, expected, replacement))
        ) {
          try {
            if (
              this.trackRecords &&
              (await this.readRaw(invoke)) !== replacement
            )
              throw new Error(
                "Library write could not be verified. Reload before retrying.",
              );
            this.removeLegacy();
            if (!unchanged) emitChanged(this.key);
            return sanitized;
          } catch (error) {
            if (!unchanged) throw new AppDataJsonStoreCommittedError();
            throw error;
          }
        }
        // A whole snapshot cannot be safely rebased onto a concurrent edit.
        if (this.trackRecords)
          throw new Error(
            "Library changed in another window. Reload before retrying.",
          );
      }

      throw new Error(
        `Could not persist "${this.key}" after ${MAX_CAS_ATTEMPTS} concurrent write conflicts`,
      );
    });
  }

  /** Rebase local edits on refused CAS writes; reviewed remote replacements never retry. */
  async update(
    transform: (current: T | null) => T,
    access?: MacroLibraryReadAccess,
    options: AppDataJsonStoreUpdateOptions = {},
  ): Promise<SanitizedValue<T>> {
    return enqueue(this.key, async () => {
      assertMacroLibraryReadAccess(access);
      const invoke = await this.backend();
      assertMacroLibraryReadAccess(access);
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
        const expected = await this.readRaw(invoke);
        assertMacroLibraryReadAccess(access);
        const current =
          expected === null
            ? null
            : (await this.migrateValue(parseJson(this.key, expected))).value;
        // Capture history before a transform can mutate its input in place.
        const previous = this.durableMetadata(current);
        assertMacroLibraryReadAccess(access);
        const sanitized = await this.prepareWrite(
          transform(current),
          previous,
          options.adoptRecordMetadata,
        );
        const replacement = JSON.stringify(sanitized.value);
        assertMacroLibraryReadAccess(access);
        const unchanged = replacement === expected;
        const committed =
          unchanged ||
          (await this.compareAndSwap(invoke, expected, replacement));
        if (!committed) {
          assertMacroLibraryReadAccess(access);
          if (options.adoptRecordMetadata)
            throw new Error(
              "Library changed in another window. Reload and review before cloud apply.",
            );
          continue;
        }
        // A failed verification must never reapply the edit: the write may
        // already have committed or a different window may have advanced it.
        try {
          assertMacroLibraryReadAccess(access);
          const verified = await this.readRaw(invoke);
          assertMacroLibraryReadAccess(access);
          if (verified !== replacement)
            throw new Error(
              "Library write could not be verified. Reload before retrying; legacy data was retained.",
            );
          if (!unchanged) emitChanged(this.key);
          return sanitized;
        } catch (error) {
          if (!unchanged) throw new AppDataJsonStoreCommittedError();
          throw error;
        }
      }
      throw new Error(
        "Library changed in another window. Reload before retrying.",
      );
    });
  }

  private durableMetadata(value: T | null): RecordLedger | undefined {
    return this.trackRecords && isObjectSnapshot(value)
      ? normalizeRecordLedger(structuredClone(value.recordMetadata))
      : undefined;
  }

  private async normalizeDurable(
    invoke: TauriInvoke | null,
    initialRaw: string,
    access?: MacroLibraryReadAccess,
  ): Promise<DurableLoadResult<T>> {
    let raw = initialRaw;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      assertMacroLibraryReadAccess(access);
      const sanitized = await this.migrateValue(parseJson(this.key, raw));
      const replacement = JSON.stringify(sanitized.value);
      assertMacroLibraryReadAccess(access);
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

    return IndexedDbService.transactItemsStrict([this.key], (values) => {
      const value = values[this.key];
      const current =
        value === null
          ? null
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
      const matches = current === expected;
      return {
        set: matches ? { [this.key]: replacement } : {},
        result: matches,
      };
    });
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
