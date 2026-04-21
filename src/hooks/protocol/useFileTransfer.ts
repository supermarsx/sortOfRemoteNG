import { useState, useEffect, useRef, useCallback } from 'react';
import { FileTransferSession } from '../../types/connection/connection';
import { FileTransferService } from '../../utils/file-transfer/fileTransferService';
import { TauriSFTPAdapter } from '../../utils/file-transfer/fileTransferAdapters';

export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  permissions?: string;
}

export type FileTransferProtocol = 'ftp' | 'sftp' | 'scp';

export function useFileTransfer(
  isOpen: boolean,
  connectionId: string,
  protocol?: FileTransferProtocol,
) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [transfers, setTransfers] = useState<FileTransferSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const fileServiceRef = useRef(new FileTransferService());
  // Direct handle to the SFTP adapter so `pickAndUpload` can invoke
  // `uploadFromPath` without routing through the service (the service's
  // `uploadFile` path is File-bytes-only; the native-path flow is disjoint
  // and sftp-2b will converge them when the chunked-bytes backend lands).
  const sftpAdapterRef = useRef<TauriSFTPAdapter | null>(null);

  // Auto-register the backend adapter based on protocol. For SFTP we wire the
  // real Tauri adapter (aggregator e19 registered the backend commands). FTP
  // and SCP are Node-only and not yet wired for Tauri — callers must register
  // their own adapter or the hook's ops will throw "No adapter registered".
  useEffect(() => {
    if (!protocol || !connectionId) return;
    if (protocol === 'sftp') {
      const adapter = new TauriSFTPAdapter(connectionId);
      fileServiceRef.current.registerAdapter(connectionId, adapter);
      sftpAdapterRef.current = adapter;
    } else {
      sftpAdapterRef.current = null;
    }
  }, [protocol, connectionId]);

  const loadDirectory = useCallback(
    async (path: string) => {
      setIsLoading(true);
      try {
        const directoryContents = await fileServiceRef.current.listDirectory(connectionId, path);
        setFiles(directoryContents);
      } catch (error) {
        console.error('Failed to load directory:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId],
  );

  const loadTransfers = useCallback(async () => {
    const activeTransfers = await fileServiceRef.current.getActiveTransfers(connectionId);
    setTransfers(activeTransfers);
  }, [connectionId]);

  useEffect(() => {
    if (isOpen) {
      loadDirectory(currentPath);
      loadTransfers();
    }
  }, [isOpen, currentPath, connectionId, loadDirectory, loadTransfers]);

  const navigateToPath = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
  }, []);

  const navigateUp = useCallback(() => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateToPath(parentPath);
  }, [currentPath, navigateToPath]);

  const handleFileSelect = useCallback(
    (fileName: string) => {
      const newSelection = new Set(selectedFiles);
      if (newSelection.has(fileName)) {
        newSelection.delete(fileName);
      } else {
        newSelection.add(fileName);
      }
      setSelectedFiles(newSelection);
    },
    [selectedFiles],
  );

  const handleDoubleClick = useCallback(
    (file: FileItem) => {
      if (file.type === 'directory') {
        const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        navigateToPath(newPath);
      }
    },
    [currentPath, navigateToPath],
  );

  const handleUpload = useCallback(
    async (uploadFiles: FileList) => {
      for (const file of Array.from(uploadFiles)) {
        const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        try {
          await fileServiceRef.current.uploadFile(connectionId, file, remotePath);
          loadDirectory(currentPath);
          await loadTransfers();
        } catch (error) {
          console.error('Upload failed:', error);
        }
      }
      setShowUploadDialog(false);
    },
    [connectionId, currentPath, loadDirectory, loadTransfers],
  );

  /**
   * Open the Tauri native-file-picker, then upload each selected file via the
   * SFTP adapter's `uploadFromPath`. Exists only when the bound adapter is
   * `TauriSFTPAdapter` (i.e. `protocol === 'sftp'`); callers should check the
   * returned `canPickAndUpload` flag before rendering the button.
   */
  const pickAndUpload = useCallback(async (): Promise<void> => {
    const adapter = sftpAdapterRef.current;
    if (!adapter) {
      console.warn('pickAndUpload called but no TauriSFTPAdapter is registered');
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ multiple: true });
      if (!selected) {
        setShowUploadDialog(false);
        return;
      }
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const localPath of paths) {
        // Derive remote filename from the basename of the selected path.
        // Handle both POSIX `/` and Windows `\` separators.
        const baseName =
          localPath.split(/[\\/]/).filter(Boolean).pop() ?? 'upload';
        const remotePath =
          currentPath === '/'
            ? `/${baseName}`
            : `${currentPath}/${baseName}`;
        try {
          await adapter.uploadFromPath(localPath, remotePath);
          await loadDirectory(currentPath);
          await loadTransfers();
        } catch (error) {
          console.error(`Upload of ${localPath} failed:`, error);
        }
      }
    } catch (error) {
      console.error('pickAndUpload failed:', error);
    } finally {
      setShowUploadDialog(false);
    }
  }, [currentPath, loadDirectory, loadTransfers]);

  const handleDownload = useCallback(async () => {
    for (const fileName of selectedFiles) {
      const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
      try {
        await fileServiceRef.current.downloadFile(connectionId, remotePath, fileName);
        await loadTransfers();
      } catch (error) {
        console.error('Download failed:', error);
      }
    }
    setSelectedFiles(new Set());
  }, [connectionId, currentPath, selectedFiles, loadTransfers]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete ${selectedFiles.size} selected item(s)?`)) return;
    for (const fileName of selectedFiles) {
      const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
      try {
        await fileServiceRef.current.deleteFile(connectionId, remotePath);
      } catch (error) {
        console.error('Delete failed:', error);
      }
    }
    setSelectedFiles(new Set());
    loadDirectory(currentPath);
  }, [connectionId, currentPath, selectedFiles, loadDirectory]);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedFiles(new Set(files.map((f) => f.name)));
      } else {
        setSelectedFiles(new Set());
      }
    },
    [files],
  );

  const handleResumeTransfer = useCallback(
    async (transferId: string) => {
      await fileServiceRef.current.resumeTransfer(transferId);
      await loadTransfers();
    },
    [loadTransfers],
  );

  return {
    currentPath,
    files,
    selectedFiles,
    transfers,
    isLoading,
    showUploadDialog,
    setShowUploadDialog,
    loadDirectory,
    navigateToPath,
    navigateUp,
    handleFileSelect,
    handleDoubleClick,
    handleUpload,
    pickAndUpload,
    canPickAndUpload: protocol === 'sftp',
    handleDownload,
    handleDelete,
    handleSelectAll,
    handleResumeTransfer,
  };
}

// ─── Formatting helpers ─────────────────────────────────────────────

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const getTransferProgress = (transfer: FileTransferSession): number => {
  return transfer.totalSize > 0 ? (transfer.transferredSize / transfer.totalSize) * 100 : 0;
};
