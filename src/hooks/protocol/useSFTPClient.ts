// useSFTPClient — real Tauri `invoke(...)` wrappers for the sorng-sftp backend.
//
// Pairs 1:1 with `src-tauri/crates/sorng-sftp/src/sftp/commands.rs`. Signatures
// and argument names match the Rust `#[tauri::command]` definitions exactly so
// Tauri's camelCase arg mapping works without custom serializers.
//
// e20 owns the actual FileTransferManager integration; this hook exposes a
// complete surface so the integration phase is purely glue code.

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type { ConnectionSession } from '../../types/connection/connection';
import type {
  BatchTransferResult,
  DiskUsageResult,
  QueueEntry,
  QueueStatus,
  SftpBatchTransfer,
  SftpBookmark,
  SftpChmodRequest,
  SftpChownRequest,
  SftpConnectionConfig,
  SftpDiagnosticReport,
  SftpDirEntry,
  SftpFileStat,
  SftpListOptions,
  SftpSessionInfo,
  SftpTransferRequest,
  SyncResult,
  TransferProgress,
  TransferResult,
  WatchConfig,
  WatchEvent,
  WatchInfo,
} from '../../types/sftp';

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const sftpApi = {
  // Session / connection
  connect: (config: SftpConnectionConfig) =>
    invoke<SftpSessionInfo>('sftp_connect', { config }),
  disconnect: (sessionId: string) =>
    invoke<void>('sftp_disconnect', { sessionId }),
  getSessionInfo: (sessionId: string) =>
    invoke<SftpSessionInfo>('sftp_get_session_info', { sessionId }),
  listSessions: () => invoke<SftpSessionInfo[]>('sftp_list_sessions'),
  ping: (sessionId: string) => invoke<boolean>('sftp_ping', { sessionId }),
  setDirectory: (sessionId: string, path: string) =>
    invoke<string>('sftp_set_directory', { sessionId, path }),
  realpath: (sessionId: string, path: string) =>
    invoke<string>('sftp_realpath', { sessionId, path }),

  // Directory ops
  listDirectory: (
    sessionId: string,
    path: string,
    options?: SftpListOptions,
  ) =>
    invoke<SftpDirEntry[]>('sftp_list_directory', {
      sessionId,
      path,
      options: options ?? null,
    }),
  mkdir: (sessionId: string, path: string, mode?: number | null) =>
    invoke<void>('sftp_mkdir', { sessionId, path, mode: mode ?? null }),
  mkdirP: (sessionId: string, path: string, mode?: number | null) =>
    invoke<void>('sftp_mkdir_p', { sessionId, path, mode: mode ?? null }),
  rmdir: (sessionId: string, path: string) =>
    invoke<void>('sftp_rmdir', { sessionId, path }),
  diskUsage: (sessionId: string, path: string) =>
    invoke<DiskUsageResult>('sftp_disk_usage', { sessionId, path }),
  search: (
    sessionId: string,
    root: string,
    pattern: string,
    maxResults?: number | null,
  ) =>
    invoke<SftpDirEntry[]>('sftp_search', {
      sessionId,
      root,
      pattern,
      maxResults: maxResults ?? null,
    }),

  // File ops
  stat: (sessionId: string, path: string) =>
    invoke<SftpFileStat>('sftp_stat', { sessionId, path }),
  lstat: (sessionId: string, path: string) =>
    invoke<SftpFileStat>('sftp_lstat', { sessionId, path }),
  rename: (
    sessionId: string,
    oldPath: string,
    newPath: string,
    overwrite?: boolean,
  ) =>
    invoke<void>('sftp_rename', {
      sessionId,
      oldPath,
      newPath,
      overwrite: overwrite ?? null,
    }),
  deleteFile: (sessionId: string, path: string) =>
    invoke<void>('sftp_delete_file', { sessionId, path }),
  deleteRecursive: (sessionId: string, path: string) =>
    invoke<number>('sftp_delete_recursive', { sessionId, path }),
  chmod: (sessionId: string, request: SftpChmodRequest) =>
    invoke<number>('sftp_chmod', { sessionId, request }),
  chown: (sessionId: string, request: SftpChownRequest) =>
    invoke<number>('sftp_chown', { sessionId, request }),
  createSymlink: (sessionId: string, target: string, linkPath: string) =>
    invoke<void>('sftp_create_symlink', { sessionId, target, linkPath }),
  readLink: (sessionId: string, path: string) =>
    invoke<string>('sftp_read_link', { sessionId, path }),
  touch: (sessionId: string, path: string) =>
    invoke<void>('sftp_touch', { sessionId, path }),
  truncate: (sessionId: string, path: string, size: number) =>
    invoke<void>('sftp_truncate', { sessionId, path, size }),
  readTextFile: (
    sessionId: string,
    path: string,
    maxBytes?: number | null,
  ) =>
    invoke<string>('sftp_read_text_file', {
      sessionId,
      path,
      maxBytes: maxBytes ?? null,
    }),
  writeTextFile: (sessionId: string, path: string, content: string) =>
    invoke<number>('sftp_write_text_file', { sessionId, path, content }),
  checksum: (sessionId: string, path: string) =>
    invoke<string>('sftp_checksum', { sessionId, path }),
  exists: (sessionId: string, path: string) =>
    invoke<boolean>('sftp_exists', { sessionId, path }),

  // Transfer
  upload: (request: SftpTransferRequest) =>
    invoke<TransferResult>('sftp_upload', { request }),
  download: (request: SftpTransferRequest) =>
    invoke<TransferResult>('sftp_download', { request }),

  // Chunked upload (drag-and-drop `File` path — see sftp-2b). `bytes` is
  // serialized as a JSON number array by default; Tauri's serde maps that onto
  // the backend `Vec<u8>`. For multi-GB files this is throughput-bound; callers
  // should `await` each `uploadChunk` to respect the backend's 4-in-flight cap.
  uploadBegin: (
    sessionId: string,
    remotePath: string,
    totalBytes: number,
    overwrite?: boolean | null,
  ) =>
    invoke<string>('sftp_upload_begin', {
      sessionId,
      remotePath,
      totalBytes,
      overwrite: overwrite ?? null,
    }),
  uploadChunk: (uploadId: string, offset: number, bytes: Uint8Array) =>
    invoke<number>('sftp_upload_chunk', {
      uploadId,
      offset,
      bytes: Array.from(bytes),
    }),
  uploadFinish: (uploadId: string) =>
    invoke<string>('sftp_upload_finish', { uploadId }),
  uploadAbort: (uploadId: string) =>
    invoke<void>('sftp_upload_abort', { uploadId }),
  batchTransfer: (batch: SftpBatchTransfer) =>
    invoke<BatchTransferResult>('sftp_batch_transfer', { batch }),
  getTransferProgress: (transferId: string) =>
    invoke<TransferProgress | null>('sftp_get_transfer_progress', {
      transferId,
    }),
  listActiveTransfers: () =>
    invoke<TransferProgress[]>('sftp_list_active_transfers'),
  cancelTransfer: (transferId: string) =>
    invoke<void>('sftp_cancel_transfer', { transferId }),
  pauseTransfer: (transferId: string) =>
    invoke<void>('sftp_pause_transfer', { transferId }),
  clearCompletedTransfers: () =>
    invoke<number>('sftp_clear_completed_transfers'),

  // Queue
  queueAdd: (request: SftpTransferRequest, priority?: number | null) =>
    invoke<string>('sftp_queue_add', { request, priority: priority ?? null }),
  queueRemove: (queueId: string) =>
    invoke<void>('sftp_queue_remove', { queueId }),
  queueList: () => invoke<QueueEntry[]>('sftp_queue_list'),
  queueStatus: () => invoke<QueueStatus>('sftp_queue_status'),
  queueStart: () => invoke<number>('sftp_queue_start'),
  queueStop: () => invoke<void>('sftp_queue_stop'),
  queueRetryFailed: () => invoke<number>('sftp_queue_retry_failed'),
  queueClearDone: () => invoke<number>('sftp_queue_clear_done'),
  queueSetPriority: (queueId: string, priority: number) =>
    invoke<void>('sftp_queue_set_priority', { queueId, priority }),

  // Watch / Sync
  watchStart: (config: WatchConfig) =>
    invoke<string>('sftp_watch_start', { config }),
  watchStop: (watchId: string) =>
    invoke<void>('sftp_watch_stop', { watchId }),
  watchList: () => invoke<WatchInfo[]>('sftp_watch_list'),
  syncPull: (sessionId: string, remotePath: string, localPath: string) =>
    invoke<SyncResult>('sftp_sync_pull', { sessionId, remotePath, localPath }),
  syncPush: (sessionId: string, localPath: string, remotePath: string) =>
    invoke<SyncResult>('sftp_sync_push', { sessionId, localPath, remotePath }),

  // Bookmarks
  bookmarkAdd: (bookmark: SftpBookmark) =>
    invoke<string>('sftp_bookmark_add', { bookmark }),
  bookmarkRemove: (bookmarkId: string) =>
    invoke<void>('sftp_bookmark_remove', { bookmarkId }),
  bookmarkUpdate: (bookmark: SftpBookmark) =>
    invoke<void>('sftp_bookmark_update', { bookmark }),
  bookmarkList: (group?: string | null) =>
    invoke<SftpBookmark[]>('sftp_bookmark_list', { group: group ?? null }),
  bookmarkTouch: (bookmarkId: string) =>
    invoke<void>('sftp_bookmark_touch', { bookmarkId }),
  bookmarkImport: (json: string) =>
    invoke<number>('sftp_bookmark_import', { json }),
  bookmarkExport: () => invoke<string>('sftp_bookmark_export'),

  // Diagnostics
  diagnose: (sessionId: string) =>
    invoke<SftpDiagnosticReport>('sftp_diagnose', { sessionId }),
};

// ─── React hook (stateful wrapper for UI consumers) ──────────────────────────

export interface UseSFTPClientOptions {
  /** Auto-connect when the hook mounts using `session.*` as connection hints. */
  autoConnect?: boolean;
  /** Existing `session_id` returned by the backend. If set, no fresh connect. */
  existingSessionId?: string;
}

export function useSFTPClient(
  session: ConnectionSession,
  options: UseSFTPClientOptions = {},
) {
  const { autoConnect = false, existingSessionId } = options;

  const [sessionId, setSessionId] = useState<string | null>(
    existingSessionId ?? null,
  );
  const [sessionInfo, setSessionInfo] = useState<SftpSessionInfo | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [entries, setEntries] = useState<SftpDirEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(Boolean(existingSessionId));

  // Keep the latest session id available to effect cleanups.
  const sessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // ── Connection lifecycle ─────────────────────────────────────────────────

  const connect = useCallback(
    async (config: SftpConnectionConfig) => {
      setIsLoading(true);
      setError(null);
      try {
        const info = await sftpApi.connect(config);
        setSessionId(info.id);
        setSessionInfo(info);
        setCurrentPath(info.currentDirectory || '/');
        setConnected(true);
        return info;
      } catch (e) {
        const msg = typeof e === 'string' ? e : (e as Error).message;
        setError(msg);
        setConnected(false);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      await sftpApi.disconnect(id);
    } finally {
      setSessionId(null);
      setSessionInfo(null);
      setConnected(false);
      setEntries([]);
      setSelected(new Set());
    }
  }, []);

  // ── Directory navigation ─────────────────────────────────────────────────

  const loadDirectory = useCallback(
    async (path: string, listOpts?: SftpListOptions) => {
      const id = sessionIdRef.current;
      if (!id) return;
      setIsLoading(true);
      setError(null);
      try {
        const list = await sftpApi.listDirectory(id, path, listOpts);
        setEntries(list);
        setCurrentPath(path);
        setSelected(new Set());
      } catch (e) {
        setError(typeof e === 'string' ? e : (e as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const navigateUp = useCallback(() => {
    if (currentPath === '/' || currentPath === '') return;
    const parent =
      currentPath.split('/').filter(Boolean).slice(0, -1).join('/');
    const next = parent === '' ? '/' : `/${parent}`;
    loadDirectory(next);
  }, [currentPath, loadDirectory]);

  const navigateInto = useCallback(
    (entry: SftpDirEntry) => {
      if (entry.entryType !== 'directory') return;
      loadDirectory(entry.path);
    },
    [loadDirectory],
  );

  const refreshDirectory = useCallback(() => {
    return loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  // ── Selection helpers ────────────────────────────────────────────────────

  const toggleSelect = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(entries.map(e => e.name)));
  }, [entries]);

  const deselectAll = useCallback(() => setSelected(new Set()), []);

  // ── File operations (thin wrappers that refresh the current directory) ──

  const requireSession = (): string => {
    const id = sessionIdRef.current;
    if (!id) throw new Error('No active SFTP session');
    return id;
  };

  const stat = useCallback(
    (path: string) => sftpApi.stat(requireSession(), path),
    [],
  );

  const mkdir = useCallback(
    async (path: string, mode?: number) => {
      await sftpApi.mkdir(requireSession(), path, mode ?? null);
      await refreshDirectory();
    },
    [refreshDirectory],
  );

  const rename = useCallback(
    async (oldPath: string, newPath: string, overwrite = false) => {
      await sftpApi.rename(requireSession(), oldPath, newPath, overwrite);
      await refreshDirectory();
    },
    [refreshDirectory],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      await sftpApi.deleteFile(requireSession(), path);
      await refreshDirectory();
    },
    [refreshDirectory],
  );

  const deleteRecursive = useCallback(
    async (path: string) => {
      const n = await sftpApi.deleteRecursive(requireSession(), path);
      await refreshDirectory();
      return n;
    },
    [refreshDirectory],
  );

  const chmod = useCallback(
    async (req: SftpChmodRequest) => {
      const n = await sftpApi.chmod(requireSession(), req);
      await refreshDirectory();
      return n;
    },
    [refreshDirectory],
  );

  const chown = useCallback(
    async (req: SftpChownRequest) => {
      const n = await sftpApi.chown(requireSession(), req);
      await refreshDirectory();
      return n;
    },
    [refreshDirectory],
  );

  // ── Transfers ────────────────────────────────────────────────────────────

  const uploadFile = useCallback(
    async (localPath: string, remotePath: string) => {
      const id = requireSession();
      return sftpApi.upload({
        sessionId: id,
        localPath,
        remotePath,
        direction: 'upload',
      });
    },
    [],
  );

  const downloadFile = useCallback(
    async (remotePath: string, localPath: string) => {
      const id = requireSession();
      return sftpApi.download({
        sessionId: id,
        localPath,
        remotePath,
        direction: 'download',
      });
    },
    [],
  );

  const refreshTransfers = useCallback(async () => {
    try {
      const list = await sftpApi.listActiveTransfers();
      setTransfers(list);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error).message);
    }
  }, []);

  // ── Watch subscription ───────────────────────────────────────────────────

  const watchDir = useCallback(
    async (config: WatchConfig, onEvent?: (ev: WatchEvent) => void) => {
      const id = await sftpApi.watchStart(config);
      let unlisten: UnlistenFn | null = null;
      if (onEvent) {
        unlisten = await listen<WatchEvent>(`sftp://watch/${id}`, event => {
          onEvent(event.payload);
        });
      }
      return {
        watchId: id,
        stop: async () => {
          if (unlisten) unlisten();
          await sftpApi.watchStop(id);
        },
      };
    },
    [],
  );

  // ── Auto-connect effect ──────────────────────────────────────────────────

  useEffect(() => {
    if (!autoConnect) return;
    if (existingSessionId) return;
    // autoConnect assumes `session.hostname` + a username is available somewhere;
    // actual credential prompting is e20's job. We seed a minimal config so the
    // invocation surface is exercised at dev time without hard-coding secrets.
    connect({
      host: session.hostname,
      port: 22,
      username: '',
      knownHostsPolicy: 'ask',
    }).catch(() => {
      /* surfaced via `error` state */
    });
  }, [autoConnect, existingSessionId, session.hostname, connect]);

  // ── Disconnect on unmount if we own the session ──────────────────────────

  useEffect(() => {
    return () => {
      if (!existingSessionId && sessionIdRef.current) {
        // Fire-and-forget; cleanup on unmount should not block React.
        sftpApi
          .disconnect(sessionIdRef.current)
          .catch(() => undefined);
      }
    };
  }, [existingSessionId]);

  // ── Formatting helper (parity with useSMBClient) ─────────────────────────

  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(
      Math.floor(Math.log(bytes) / Math.log(k)),
      sizes.length - 1,
    );
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  return {
    // Session state
    session,
    sessionId,
    sessionInfo,
    connected,
    currentPath,
    entries,
    selected,
    transfers,
    isLoading,
    error,

    // Raw API (full surface)
    api: sftpApi,

    // Connection lifecycle
    connect,
    disconnect,

    // Navigation
    loadDirectory,
    navigateUp,
    navigateInto,
    refreshDirectory,

    // Selection
    toggleSelect,
    selectAll,
    deselectAll,

    // File ops
    stat,
    mkdir,
    rename,
    deleteFile,
    deleteRecursive,
    chmod,
    chown,

    // Transfers
    uploadFile,
    downloadFile,
    refreshTransfers,

    // Watch
    watchDir,

    // Utils
    formatFileSize,
  };
}
