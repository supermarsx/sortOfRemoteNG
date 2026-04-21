import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionSession } from '../../types/connection/connection';

// ═══════════════════════════════════════════════════════════════════════════
// Types (mirror Rust-side `sorng_smb::smb::types`)
// ═══════════════════════════════════════════════════════════════════════════

export type SmbShareType =
  | 'disk'
  | 'printer'
  | 'ipc'
  | 'device'
  | 'special'
  | 'unknown';

export interface SmbShareInfo {
  name: string;
  shareType: SmbShareType;
  comment?: string | null;
  isAdmin: boolean;
}

export type SmbEntryType = 'file' | 'directory' | 'symlink' | 'unknown';

export interface SmbDirEntry {
  name: string;
  path: string;
  entryType: SmbEntryType;
  size: number;
  modified?: number | null; // millis since epoch
  isHidden: boolean;
  isReadonly: boolean;
  isSystem: boolean;
}

export interface SmbStat {
  path: string;
  entryType: SmbEntryType;
  size: number;
  modified?: number | null;
  created?: number | null;
  accessed?: number | null;
  isHidden: boolean;
  isReadonly: boolean;
  isSystem: boolean;
}

export interface SmbSessionInfo {
  id: string;
  host: string;
  port: number;
  domain?: string | null;
  username?: string | null;
  share?: string | null;
  connected: boolean;
  label?: string | null;
  connectedAt: string;
  lastActivity: string;
  backend: string;
}

export interface SmbConnectionConfig {
  host: string;
  port?: number;
  domain?: string | null;
  username?: string | null;
  password?: string | null;
  workgroup?: string | null;
  share?: string | null;
  label?: string | null;
  disablePlaintext?: boolean;
  useKerberos?: boolean;
}

// Legacy alias so any external imports of the old `SMBFile` type keep
// working. New code should use `SmbDirEntry` directly.
export interface SMBFile {
  name: string;
  type: 'file' | 'directory' | 'share';
  size: number;
  modified: Date;
  permissions?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SMB client hook — backed by the real Rust `sorng-smb` crate.
 *
 * Connects to the session's hostname once on mount, lists shares, and
 * lets the caller navigate directories. All mock data is gone: every
 * call hits the backend via `invoke("smb_*", …)`.
 *
 * The session may carry credentials in its Connection record
 * (resolved by the backend). For now the hook only passes `host`; the
 * backend uses ambient auth (current Windows user on Windows; smbclient
 * with no -U on Unix) unless upstream code explicitly calls `connect`
 * with credentials via a separate setup flow.
 */
export function useSMBClient(session: ConnectionSession) {
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [files, setFiles] = useState<SmbDirEntry[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [shares, setShares] = useState<SmbShareInfo[]>([]);
  const [currentShare, setCurrentShare] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guard against double-connect in dev/StrictMode.
  const connectingRef = useRef(false);
  const connectedSessionRef = useRef<string | null>(null);

  // ── Connection ─────────────────────────────────────────────────────

  const connect = useCallback(
    async (configOverride?: Partial<SmbConnectionConfig>): Promise<string> => {
      if (connectingRef.current) {
        throw new Error('SMB connect already in progress');
      }
      connectingRef.current = true;
      setIsLoading(true);
      setError(null);
      try {
        const config: SmbConnectionConfig = {
          host: session.hostname,
          port: 445,
          ...configOverride,
        };
        const info = await invoke<SmbSessionInfo>('smb_connect', { config });
        setSessionId(info.id);
        connectedSessionRef.current = info.id;
        return info.id;
      } catch (e) {
        const msg = typeof e === 'string' ? e : (e as Error)?.message ?? String(e);
        setError(`SMB connect failed: ${msg}`);
        throw e;
      } finally {
        connectingRef.current = false;
        setIsLoading(false);
      }
    },
    [session.hostname],
  );

  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    try {
      await invoke<void>('smb_disconnect', { sessionId });
    } catch (e) {
      // Non-fatal — log and clear local state anyway.
      console.warn('SMB disconnect failed:', e);
    } finally {
      setSessionId(null);
      connectedSessionRef.current = null;
      setShares([]);
      setCurrentShare('');
      setFiles([]);
    }
  }, [sessionId]);

  // ── Share enumeration ──────────────────────────────────────────────

  const loadShares = useCallback(async () => {
    let sid = sessionId;
    if (!sid) {
      try {
        sid = await connect();
      } catch {
        return;
      }
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<SmbShareInfo[]>('smb_list_shares', {
        sessionId: sid,
      });
      setShares(result);
      if (result.length > 0 && !currentShare) {
        // Pick the first non-IPC share as the default; fall back to first.
        const firstUsable =
          result.find(s => s.shareType !== 'ipc' && !s.isAdmin) ??
          result.find(s => s.shareType !== 'ipc') ??
          result[0];
        setCurrentShare(firstUsable.name);
      }
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e as Error)?.message ?? String(e);
      setError(`Failed to load SMB shares: ${msg}`);
      console.error('Failed to load SMB shares:', e);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, connect, currentShare]);

  // ── Directory listing ──────────────────────────────────────────────

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!sessionId || !currentShare) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await invoke<SmbDirEntry[]>('smb_list_directory', {
          sessionId,
          share: currentShare,
          path,
        });
        // Filter out the synthetic "." / ".." entries that smbclient may emit.
        setFiles(result.filter(e => e.name !== '.' && e.name !== '..'));
      } catch (e) {
        const msg = typeof e === 'string' ? e : (e as Error)?.message ?? String(e);
        setError(`Failed to load directory: ${msg}`);
        console.error('Failed to load directory:', e);
        setFiles([]);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, currentShare],
  );

  // ── Effects: auto-connect + auto-load ──────────────────────────────

  useEffect(() => {
    // Connect + load shares once on mount.
    void loadShares();
    // Disconnect on unmount.
    return () => {
      const sid = connectedSessionRef.current;
      if (sid) {
        void invoke('smb_disconnect', { sessionId: sid }).catch(() => {
          // Ignore — session may already be gone.
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sessionId && currentShare) {
      void loadDirectory(currentPath);
    }
  }, [sessionId, currentShare, currentPath, loadDirectory]);

  // ── Navigation helpers ─────────────────────────────────────────────

  const navigateToPath = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
  }, []);

  const navigateUp = useCallback(() => {
    const parts = currentPath.split('/').filter(p => p);
    if (parts.length > 0) {
      parts.pop();
      navigateToPath(parts.length ? '/' + parts.join('/') : '/');
    }
  }, [currentPath, navigateToPath]);

  const handleFileSelect = useCallback((fileName: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  }, []);

  const handleDoubleClick = useCallback(
    (file: SmbDirEntry) => {
      if (file.entryType === 'directory') {
        navigateToPath(file.path.startsWith('/') ? file.path : `/${file.path}`);
      }
    },
    [navigateToPath],
  );

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(files.map(f => f.name)));
  }, [files]);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const handleShareChange = useCallback((share: string) => {
    setCurrentShare(share);
    setCurrentPath('/');
    setSelectedFiles(new Set());
  }, []);

  const refreshDirectory = useCallback(() => {
    void loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  // ── File operations ────────────────────────────────────────────────

  const downloadFile = useCallback(
    async (remotePath: string, localPath: string) => {
      if (!sessionId || !currentShare) throw new Error('not connected');
      return invoke<unknown>('smb_download_file', {
        sessionId,
        share: currentShare,
        remotePath,
        localPath,
      });
    },
    [sessionId, currentShare],
  );

  const uploadFile = useCallback(
    async (localPath: string, remotePath: string) => {
      if (!sessionId || !currentShare) throw new Error('not connected');
      return invoke<unknown>('smb_upload_file', {
        sessionId,
        share: currentShare,
        localPath,
        remotePath,
      });
    },
    [sessionId, currentShare],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      if (!sessionId || !currentShare) throw new Error('not connected');
      await invoke<void>('smb_delete_file', {
        sessionId,
        share: currentShare,
        path,
      });
      refreshDirectory();
    },
    [sessionId, currentShare, refreshDirectory],
  );

  const deleteSelected = useCallback(async () => {
    if (!sessionId || !currentShare) return;
    for (const name of selectedFiles) {
      const file = files.find(f => f.name === name);
      if (!file) continue;
      try {
        if (file.entryType === 'directory') {
          await invoke<void>('smb_rmdir', {
            sessionId,
            share: currentShare,
            path: file.path,
            recursive: true,
          });
        } else {
          await invoke<void>('smb_delete_file', {
            sessionId,
            share: currentShare,
            path: file.path,
          });
        }
      } catch (e) {
        console.error(`Failed to delete ${file.path}:`, e);
      }
    }
    setSelectedFiles(new Set());
    refreshDirectory();
  }, [sessionId, currentShare, selectedFiles, files, refreshDirectory]);

  const mkdir = useCallback(
    async (path: string) => {
      if (!sessionId || !currentShare) throw new Error('not connected');
      await invoke<void>('smb_mkdir', {
        sessionId,
        share: currentShare,
        path,
      });
      refreshDirectory();
    },
    [sessionId, currentShare, refreshDirectory],
  );

  const rename = useCallback(
    async (from: string, to: string) => {
      if (!sessionId || !currentShare) throw new Error('not connected');
      await invoke<void>('smb_rename', {
        sessionId,
        share: currentShare,
        from,
        to,
      });
      refreshDirectory();
    },
    [sessionId, currentShare, refreshDirectory],
  );

  const stat = useCallback(
    async (path: string): Promise<SmbStat> => {
      if (!sessionId || !currentShare) throw new Error('not connected');
      return invoke<SmbStat>('smb_stat', {
        sessionId,
        share: currentShare,
        path,
      });
    },
    [sessionId, currentShare],
  );

  // ── Formatters ─────────────────────────────────────────────────────

  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  return {
    // state
    sessionId,
    error,
    currentPath,
    files,
    selectedFiles,
    isLoading,
    shares,
    currentShare,
    session,
    // connection
    connect,
    disconnect,
    // share / dir ops
    loadShares,
    refreshDirectory,
    navigateToPath,
    navigateUp,
    handleShareChange,
    // selection
    handleFileSelect,
    handleDoubleClick,
    selectAll,
    deselectAll,
    // file ops
    downloadFile,
    uploadFile,
    deleteFile,
    deleteSelected,
    mkdir,
    rename,
    stat,
    // formatters
    formatFileSize,
  };
}
