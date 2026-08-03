import type { File as NodeFile } from "buffer";
import { sftpApi } from "../../hooks/protocol/useSFTPClient";
import type { SftpDirEntry } from "../../types/sftp";

export interface FileItem {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: Date;
  permissions?: string;
}

export interface FileTransferAdapter {
  list(path: string, signal?: AbortSignal): Promise<FileItem[]>;
  upload(
    file: File | NodeFile | Buffer,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  download(
    remotePath: string,
    localPath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

const MAX_BROWSER_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_PATH_BYTES = 4096;
const MAX_REMOTE_PATH_SEGMENTS = 256;
const MAX_DIRECTORY_ENTRIES = 10_000;

export function safeRemoteEntryName(name: string): string {
  if (
    name.length === 0 ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error("Remote entry name is not a safe path component");
  }
  return name;
}

export function normalizeRemotePath(path: string): string {
  if (
    path.length > MAX_REMOTE_PATH_BYTES ||
    !path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    [...path].some((character) => character < " ")
  ) {
    throw new Error("Remote path must be an absolute POSIX path");
  }
  const parts = path.split("/").filter(Boolean);
  if (
    parts.length > MAX_REMOTE_PATH_SEGMENTS ||
    parts.some((part) => part === "." || part === ".." || part.length > 255)
  ) {
    throw new Error("Remote path traversal is not allowed");
  }
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function joinRemotePath(parent: string, child: string): string {
  const normalizedParent = normalizeRemotePath(parent);
  const safeChild = safeRemoteEntryName(child);
  return normalizedParent === "/"
    ? `/${safeChild}`
    : `${normalizedParent}/${safeChild}`;
}

// NOTE: the legacy browser FTPAdapter was retired in t3-e20 — the Rust
// backend (`sorng-ftp`, `ftp_*` invoke commands) is the sole FTP path.
// Frontend callers should route FTP file-transfer through those commands.

// ─── Tauri SFTP adapter (real backend via sorng-sftp / sftpApi) ──────────────
//
// Routes `list` / `download` / `delete` / `mkdir` / `rename` through the Tauri
// `invoke(...)` chain registered by aggregator e19. This is the production
// SFTP path. The former Node-only `SFTPAdapter` and `SCPAdapter` (see t3-e41)
// were retired — all SFTP/SCP transfer now flows through `sorng-ssh` +
// `sorng-sftp` via this Tauri adapter.
//
// Session lookup: the adapter does NOT open its own SSH session. It expects a
// session id that was established upstream (e.g. by the connection manager
// when the user opened the tab). The `sessionId` is resolved lazily on first
// use: if the passed id matches an active session id, we use it directly;
// otherwise we attempt to find an SFTP session whose label matches the given
// `connectionId`. If neither works, we throw an actionable error rather than
// silently spawning a new unauthenticated session.
export class TauriSFTPAdapter implements FileTransferAdapter {
  private resolvedSessionId: string | null = null;

  constructor(private readonly connectionId: string) {}

  private async getSessionId(): Promise<string> {
    // First try: treat the passed connectionId as an SFTP session id directly.
    // Most upstream call sites pass the backend session id already.
    try {
      const sessions = await sftpApi.listSessions();
      if (this.resolvedSessionId) {
        const cached = sessions.find(
          (session) =>
            session.id === this.resolvedSessionId &&
            session.connected &&
            (session.id === this.connectionId ||
              session.label === this.connectionId),
        );
        if (cached) return cached.id;
        this.resolvedSessionId = null;
      }
      const direct = sessions.find(
        (s) => s.id === this.connectionId && s.connected,
      );
      if (direct) {
        this.resolvedSessionId = direct.id;
        return direct.id;
      }
      // Fallback: label-match so callers that only know the app-level
      // connection id can still resolve.
      const byLabel = sessions.filter(
        (s) => s.label === this.connectionId && s.connected,
      );
      if (byLabel.length > 1) {
        throw new Error(
          `Multiple active SFTP sessions use connection label '${this.connectionId}'`,
        );
      }
      if (byLabel.length === 1) {
        this.resolvedSessionId = byLabel[0].id;
        return byLabel[0].id;
      }
    } catch (err) {
      throw new Error(
        `Failed to enumerate SFTP sessions: ${
          (err as Error).message ?? String(err)
        }`,
      );
    }

    throw new Error(
      `No active SFTP session found for connection '${this.connectionId}'. ` +
        `Open the SFTP connection first (via the Connections panel) before ` +
        `launching File Transfer.`,
    );
  }

  private static mapEntry(entry: SftpDirEntry): FileItem | null {
    if (entry.entryType !== "file" && entry.entryType !== "directory") {
      return null;
    }
    const name = safeRemoteEntryName(entry.name);
    return {
      name,
      type: entry.entryType,
      size: entry.size,
      modified:
        entry.modified != null ? new Date(entry.modified * 1000) : new Date(0),
      permissions: entry.permissionsString,
    };
  }

  async list(path: string, signal?: AbortSignal): Promise<FileItem[]> {
    const sessionId = await this.getSessionId();
    if (signal?.aborted) throw new Error("aborted");
    const entries = await sftpApi.listDirectory(
      sessionId,
      normalizeRemotePath(path),
    );
    if (entries.length > MAX_DIRECTORY_ENTRIES) {
      throw new Error("Remote directory listing exceeds the supported limit");
    }
    return entries
      .map(TauriSFTPAdapter.mapEntry)
      .filter((entry): entry is FileItem => entry !== null);
  }

  /**
   * Chunked upload of a browser `File` via `sftp_upload_begin` /
   * `sftp_upload_chunk` / `sftp_upload_finish` / `sftp_upload_abort`.
   *
   * Uses `File.stream()` — NOT `File.arrayBuffer()` — so multi-GB files do not
   * OOM the renderer. Default chunk size is 4 MiB; callers can override via
   * the 5th argument.
   *
   * On AbortSignal: a best-effort `sftp_upload_abort` is issued, then the
   * abort reason is propagated. If the abort call itself fails (e.g. the
   * backend sweeper already cleaned up the upload), the error is logged and
   * we still propagate the original cause — never swallow, never crash.
   */
  async upload(
    file: File | NodeFile | Buffer,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
    chunkSize: number = 4 * 1024 * 1024,
  ): Promise<void> {
    // `Buffer` / `NodeFile` paths are not supported here — the chunker assumes
    // the Web `File`/`Blob` surface (`.stream()` + `.size`). Callers with an
    // fs path should go through `uploadFromPath` instead.
    if (
      typeof (file as any)?.stream !== "function" ||
      typeof (file as any)?.size !== "number"
    ) {
      throw new Error(
        "TauriSFTPAdapter.upload requires a browser File/Blob with .stream() " +
          "and .size. For filesystem paths, use uploadFromPath().",
      );
    }
    const webFile = file as Blob & { size: number };
    if (
      !Number.isSafeInteger(webFile.size) ||
      webFile.size < 0 ||
      !Number.isSafeInteger(chunkSize) ||
      chunkSize <= 0 ||
      chunkSize > MAX_BROWSER_CHUNK_BYTES
    ) {
      throw new Error("Upload size or chunk size is outside supported bounds");
    }

    const sessionId = await this.getSessionId();
    if (signal?.aborted) throw new Error("aborted");

    const totalBytes = webFile.size;
    const uploadId = await sftpApi.uploadBegin(
      sessionId,
      normalizeRemotePath(remotePath),
      totalBytes,
      true,
    );

    const reader = webFile.stream().getReader();
    let offset = 0;
    let pending = new Uint8Array(0);

    const flushChunk = async (bytes: Uint8Array) => {
      if (bytes.length === 0) return;
      if (offset + bytes.length > totalBytes) {
        throw new Error("Upload stream exceeded its declared file size");
      }
      await sftpApi.uploadChunk(uploadId, offset, bytes);
      offset += bytes.length;
      onProgress?.(offset, totalBytes);
    };

    const bestEffortAbort = async (cause: unknown) => {
      try {
        await sftpApi.uploadAbort(uploadId);
      } catch (abortErr) {
        // Upload may have already been cleaned up by the backend sweeper, or
        // the network dropped entirely. Log and continue so we propagate the
        // original cause — do not crash on abort-of-abort.

        console.warn(
          `[TauriSFTPAdapter] sftp_upload_abort(${uploadId}) failed:`,
          abortErr,
        );
      }
      throw cause instanceof Error ? cause : new Error(String(cause));
    };

    try {
      // Pump the ReadableStream. Each read() may return a chunk of any size;
      // we buffer into `pending` and flush exactly `chunkSize` at a time to
      // match the backend's backpressure contract (4 in-flight chunks).

      while (true) {
        if (signal?.aborted) {
          await bestEffortAbort(new Error("aborted"));
          return; // unreachable — bestEffortAbort rethrows
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        if (value.length > MAX_BROWSER_CHUNK_BYTES) {
          await bestEffortAbort(
            new Error("Upload stream produced an oversized chunk"),
          );
        }

        // Append value to pending.
        if (pending.length === 0) {
          pending = value;
        } else {
          const merged = new Uint8Array(pending.length + value.length);
          merged.set(pending, 0);
          merged.set(value, pending.length);
          pending = merged;
        }

        // Emit full-size chunks.
        while (pending.length >= chunkSize) {
          const chunk = pending.subarray(0, chunkSize);
          await flushChunk(chunk);
          pending = pending.subarray(chunkSize);
          if (signal?.aborted) {
            await bestEffortAbort(new Error("aborted"));
            return;
          }
        }
      }

      // Flush any tail bytes.
      if (pending.length > 0) {
        await flushChunk(pending);
        pending = new Uint8Array(0);
      }
      if (offset !== totalBytes) {
        throw new Error(
          `Upload stream ended at ${offset} bytes; expected ${totalBytes}`,
        );
      }

      const finalPath = await sftpApi.uploadFinish(uploadId);
      if (normalizeRemotePath(finalPath) !== normalizeRemotePath(remotePath)) {
        throw new Error(
          "Backend acknowledged an unexpected upload destination",
        );
      }
      // Terminal progress tick (covers the case where totalBytes is 0).
      onProgress?.(totalBytes, totalBytes);
    } catch (err) {
      await bestEffortAbort(err);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* reader may already be released on cancel path */
      }
    }
  }

  /**
   * Native-file-picker upload path.
   *
   * `localPath` MUST be a real filesystem path (obtained from
   * `@tauri-apps/plugin-dialog`'s `open()`, not a browser `File`). This maps
   * directly onto the existing `sftp_upload` backend command and thus
   * sidesteps the multi-GB `File.arrayBuffer()` OOM problem that drove the
   * sftp-2b chunked design.
   */
  async uploadFromPath(
    localPath: string,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const sessionId = await this.getSessionId();
    if (signal?.aborted) throw new Error("aborted");
    const safeRemotePath = normalizeRemotePath(remotePath);
    const result = await sftpApi.upload({
      sessionId,
      localPath,
      remotePath: safeRemotePath,
      direction: "upload",
    });
    if (!result.success) {
      throw new Error(result.error ?? "SFTP upload failed");
    }
    // The backend `sftp_upload` is one-shot (no chunked progress events in
    // this path — sftp-2b will add them for the File-bytes flow). Fire a
    // single terminal progress event so UI queues can advance.
    onProgress?.(result.bytesTransferred, result.bytesTransferred);
  }

  async download(
    remotePath: string,
    localPath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const sessionId = await this.getSessionId();
    if (signal?.aborted) throw new Error("aborted");
    if (
      localPath.length === 0 ||
      localPath.length > 32_768 ||
      localPath.includes("\0")
    ) {
      throw new Error("Local download path is invalid");
    }
    const result = await sftpApi.download({
      sessionId,
      localPath,
      remotePath: normalizeRemotePath(remotePath),
      direction: "download",
    });
    if (!result.success) {
      throw new Error(result.error ?? "SFTP download failed");
    }
    onProgress?.(result.bytesTransferred, result.bytesTransferred);
  }

  async delete(remotePath: string): Promise<void> {
    const sessionId = await this.getSessionId();
    await sftpApi.deleteFile(sessionId, normalizeRemotePath(remotePath));
  }

  async mkdir(path: string): Promise<void> {
    const sessionId = await this.getSessionId();
    await sftpApi.mkdir(sessionId, normalizeRemotePath(path), null);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const sessionId = await this.getSessionId();
    await sftpApi.rename(
      sessionId,
      normalizeRemotePath(oldPath),
      normalizeRemotePath(newPath),
      false,
    );
  }
}

// SCP is now routed through the Tauri `sorng-ssh` backend via
// `invoke('ssh_*')` (see `@/hooks/protocol/useSSHClient`). The former Node-only
// `SCPAdapter` (see t3-e41) was retired — no Node-only SSH frontend
// dependency remains.
