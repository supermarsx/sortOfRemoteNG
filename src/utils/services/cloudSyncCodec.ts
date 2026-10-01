import {
  MAX_CLOUD_SYNC_FILE_SIZE_MIB,
  type CloudSyncConfig,
} from "../../types/settings/cloudSyncSettings";
import {
  decryptWithPassword,
  encryptWithPassword,
  fromBase64,
  toBase64,
} from "../crypto/webCryptoAes";
import {
  validateCloudSyncPayload,
  type CloudSyncPayload,
} from "./cloudSyncPayload";

export interface CloudSyncSnapshot {
  format: "sortofremoteng-cloud-sync";
  version: 1;
  modifiedAt: number;
  payload: CloudSyncPayload;
}

export function canonicalSyncJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalSyncJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalSyncJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function syncHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSyncJson(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function syncSizeLimit(config: CloudSyncConfig): number {
  if (
    !Number.isFinite(config.maxFileSizeMB) ||
    Math.floor(config.maxFileSizeMB * 1024 * 1024) < 1 ||
    config.maxFileSizeMB > MAX_CLOUD_SYNC_FILE_SIZE_MIB
  ) {
    throw new Error(
      `Invalid cloud sync size-limit setting. Set Maximum Sync Snapshot Size to 1–${MAX_CLOUD_SYNC_FILE_SIZE_MIB} MiB in Cloud Sync → Advanced Options. This is a settings error, not a measurement of your database.`,
    );
  }
  return Math.floor(config.maxFileSizeMB * 1024 * 1024);
}

async function gzip(
  bytes: Uint8Array,
  decompress: boolean,
  limit: number,
): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer])
    .stream()
    .pipeThrough(
      decompress
        ? new DecompressionStream("gzip")
        : new CompressionStream("gzip"),
    );
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Error("Cloud sync data exceeds the configured size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function encodeCloudSnapshot(
  snapshot: CloudSyncSnapshot,
  config: CloudSyncConfig,
): Promise<string> {
  const limit = syncSizeLimit(config);
  let bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.length > limit)
    throw new Error("Selected application data exceeds the sync size limit.");
  if (config.compressionEnabled)
    bytes = (await gzip(bytes, false, limit)) as Uint8Array<ArrayBuffer>;
  let body = toBase64(bytes);
  if (config.encryptBeforeSync) {
    if (!config.syncEncryptionPassword)
      throw new Error("Set a cloud sync encryption password before syncing.");
    // Encrypt format/compression metadata as well as the application payload.
    body = await encryptWithPassword(
      JSON.stringify({
        compression: config.compressionEnabled ? "gzip" : "none",
        data: body,
      }),
      config.syncEncryptionPassword,
    );
  }
  const wrapped = JSON.stringify({
    format: "sortofremoteng-cloud-envelope",
    version: 1,
    encrypted: config.encryptBeforeSync,
    compression: config.encryptBeforeSync
      ? undefined
      : config.compressionEnabled
        ? "gzip"
        : "none",
    body,
  });
  const encoded = new TextEncoder().encode(wrapped);
  if (encoded.length > limit)
    throw new Error("Encrypted sync data exceeds the sync size limit.");
  return toBase64(encoded);
}

export async function decodeCloudSnapshot(
  data: string,
  config: CloudSyncConfig,
): Promise<CloudSyncSnapshot> {
  const limit = syncSizeLimit(config);
  if (data.length > Math.ceil(limit / 3) * 4)
    throw new Error("Remote sync file exceeds the size limit.");
  const bytes = fromBase64(data);
  if (bytes.length > limit)
    throw new Error("Remote sync file exceeds the size limit.");
  const envelope = JSON.parse(new TextDecoder().decode(bytes));
  if (
    envelope?.format !== "sortofremoteng-cloud-envelope" ||
    envelope.version !== 1 ||
    typeof envelope.body !== "string" ||
    typeof envelope.encrypted !== "boolean"
  ) {
    throw new Error(
      "The remote file is not a supported application sync snapshot.",
    );
  }
  let inner = { compression: envelope.compression, data: envelope.body };
  if (envelope.encrypted) {
    if (!config.encryptBeforeSync)
      throw new Error(
        "The remote snapshot is encrypted. Keep sync encryption enabled; an existing encrypted snapshot cannot be downgraded.",
      );
    if (!config.syncEncryptionPassword)
      throw new Error(
        "This remote snapshot requires its cloud sync encryption password.",
      );
    try {
      inner = JSON.parse(
        await decryptWithPassword(
          envelope.body,
          config.syncEncryptionPassword,
          {
            maxCiphertextBytes: limit,
          },
        ),
      );
    } catch {
      throw new Error(
        "Cannot decrypt the remote snapshot. Check the sync password; remote data was not replaced.",
      );
    }
  } else if (config.encryptBeforeSync) {
    throw new Error(
      "The remote snapshot is unencrypted. Review it before disabling sync encryption.",
    );
  }
  if (
    !inner ||
    !["gzip", "none"].includes(inner.compression) ||
    typeof inner.data !== "string" ||
    inner.data.length > Math.ceil(limit / 3) * 4
  ) {
    throw new Error("Invalid cloud sync envelope.");
  }
  let plain = fromBase64(inner.data);
  if (inner.compression === "gzip") plain = await gzip(plain, true, limit);
  if (plain.length > limit)
    throw new Error("Remote sync data exceeds the size limit.");
  const snapshot = JSON.parse(new TextDecoder().decode(plain));
  if (
    snapshot?.format !== "sortofremoteng-cloud-sync" ||
    snapshot.version !== 1 ||
    !Number.isSafeInteger(snapshot.modifiedAt) ||
    snapshot.modifiedAt <= 0 ||
    snapshot.modifiedAt > Date.now() + 300_000
  ) {
    throw new Error("Invalid cloud sync snapshot metadata.");
  }
  return { ...snapshot, payload: validateCloudSyncPayload(snapshot.payload) };
}
