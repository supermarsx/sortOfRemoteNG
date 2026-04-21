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
    if (this.resolvedSessionId) return this.resolvedSessionId;

    // First try: treat the passed connectionId as an SFTP session id directly.
    // Most upstream call sites pass the backend session id already.
    try {
      const sessions = await sftpApi.listSessions();
      const direct = sessions.find((s) => s.id === this.connectionId);
      if (direct) {
        this.resolvedSessionId = direct.id;
        return direct.id;
      }
      // Fallback: label-match so callers that only know the app-level
      // connection id can still resolve.
      const byLabel = sessions.find((s) => s.label === this.connectionId);
      if (byLabel) {
        this.resolvedSessionId = byLabel.id;
        return byLabel.id;
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

  private static mapEntry(entry: SftpDirEntry): FileItem {
    const isDir =
      entry.entryType === "directory" ||
      (entry.entryType === "symlink" && entry.linkTarget?.endsWith("/"));
    return {
      name: entry.name,
      type: isDir ? "directory" : "file",
      size: entry.size,
      modified:
        entry.modified != null ? new Date(entry.modified * 1000) : new Date(0),
      permissions: entry.permissionsString,
    };
  }

  async list(path: string, signal?: AbortSignal): Promise<FileItem[]> {
    const sessionId = await this.getSessionId();
    if (signal?.aborted) throw new Error("aborted");
    const entries = await sftpApi.listDirectory(sessionId, path);
    return entries.map(TauriSFTPAdapter.mapEntry);
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

    const sessionId = await this.getSessionId();
    if (signal?.aborted) throw new Error("aborted");

    const totalBytes = webFile.size;
    const uploadId = await sftpApi.uploadBegin(
      sessionId,
      remotePath,
      totalBytes,
      true,
    );

    const reader = webFile.stream().getReader();
    let offset = 0;
    let pending = new Uint8Array(0);

    const flushChunk = async (bytes: Uint8Array) => {
      if (bytes.length === 0) return;
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
        // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal?.aborted) {
          await bestEffortAbort(new Error("aborted"));
          return; // unreachable — bestEffortAbort rethrows
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

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

      await sftpApi.uploadFinish(uploadId);
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
    const result = await sftpApi.upload({
      sessionId,
      localPath,
      remotePath,
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
    const result = await sftpApi.download({
      sessionId,
      localPath,
      remotePath,
      direction: "download",
    });
    if (!result.success) {
      throw new Error(result.error ?? "SFTP download failed");
    }
    onProgress?.(result.bytesTransferred, result.bytesTransferred);
  }

  async delete(remotePath: string): Promise<void> {
    const sessionId = await this.getSessionId();
    await sftpApi.deleteFile(sessionId, remotePath);
  }

  async mkdir(path: string): Promise<void> {
    const sessionId = await this.getSessionId();
    await sftpApi.mkdir(sessionId, path, null);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const sessionId = await this.getSessionId();
    await sftpApi.rename(sessionId, oldPath, newPath, false);
  }
}

// SCP is now routed through the Tauri `sorng-ssh` backend via
// `invoke('ssh_*')` (see `@/hooks/protocol/useSSHClient`). The former Node-only
// `SCPAdapter` (see t3-e41) was retired — no Node-only SSH frontend
// dependency remains.
