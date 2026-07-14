import { useState, useEffect, useRef, useCallback } from "react";
import { FileTransferSession } from "../../types/connection/connection";
import { FileTransferService } from "../../utils/file-transfer/fileTransferService";
import { TauriSFTPAdapter } from "../../utils/file-transfer/fileTransferAdapters";

export interface FileItem {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: Date;
  permissions?: string;
}

export type FileTransferProtocol = "ftp" | "sftp" | "scp";

export function isFileTransferProtocolSupported(
  protocol?: FileTransferProtocol,
): boolean {
  return protocol === "sftp";
}

export function getFileTransferUnsupportedReason(
  protocol?: FileTransferProtocol,
): string | null {
  if (!protocol || isFileTransferProtocolSupported(protocol)) return null;
  return `${protocol.toUpperCase()} file transfers are not wired to the frontend runtime yet. Use SFTP for file transfer sessions until this client is implemented.`;
}

export function useFileTransfer(
  isOpen: boolean,
  connectionId: string,
  protocol?: FileTransferProtocol,
) {
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [transfers, setTransfers] = useState<FileTransferSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const isProtocolSupported = isFileTransferProtocolSupported(protocol);
  const unsupportedReason = getFileTransferUnsupportedReason(protocol);

  const fileServiceRef = useRef(new FileTransferService());
  // Direct handle to the SFTP adapter so `pickAndUpload` can invoke
  // `uploadFromPath` without routing through the service (the service's
  // `uploadFile` path is File-bytes-only; the native-path flow is disjoint
  // and sftp-2b will converge them when the chunked-bytes backend lands).
  const sftpAdapterRef = useRef<TauriSFTPAdapter | null>(null);

  // Auto-register the backend adapter based on protocol. SFTP has a wired
  // Tauri adapter; FTP and SCP stay disabled until their clients exist.
  useEffect(() => {
    if (!protocol || !connectionId) {
      sftpAdapterRef.current = null;
      return;
    }
    if (protocol === "sftp") {
      const adapter = new TauriSFTPAdapter(connectionId);
      fileServiceRef.current.registerAdapter(connectionId, adapter);
      sftpAdapterRef.current = adapter;
    } else {
      sftpAdapterRef.current = null;
    }
  }, [protocol, connectionId]);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!isProtocolSupported) {
        setFiles([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const directoryContents = await fileServiceRef.current.listDirectory(
          connectionId,
          path,
        );
        setFiles(directoryContents);
      } catch (error) {
        console.error("Failed to load directory:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId, isProtocolSupported],
  );

  const loadTransfers = useCallback(async () => {
    if (!isProtocolSupported) {
      setTransfers([]);
      return;
    }
    const activeTransfers =
      await fileServiceRef.current.getActiveTransfers(connectionId);
    setTransfers(activeTransfers);
  }, [connectionId, isProtocolSupported]);

  useEffect(() => {
    if (isOpen && isProtocolSupported) {
      loadDirectory(currentPath);
      loadTransfers();
    }
  }, [
    isOpen,
    isProtocolSupported,
    currentPath,
    connectionId,
    loadDirectory,
    loadTransfers,
  ]);

  const navigateToPath = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
  }, []);

  const navigateUp = useCallback(() => {
    const parentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
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
      if (file.type === "directory") {
        const newPath =
          currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
        navigateToPath(newPath);
      }
    },
    [currentPath, navigateToPath],
  );

  const handleUpload = useCallback(
    async (uploadFiles: FileList) => {
      if (!isProtocolSupported) {
        console.warn(
          `${protocol?.toUpperCase() ?? "Unknown"} uploads are not wired`,
        );
        setShowUploadDialog(false);
        return;
      }
      for (const file of Array.from(uploadFiles)) {
        const remotePath =
          currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
        try {
          await fileServiceRef.current.uploadFile(
            connectionId,
            file,
            remotePath,
          );
          loadDirectory(currentPath);
          await loadTransfers();
        } catch (error) {
          console.error("Upload failed:", error);
        }
      }
      setShowUploadDialog(false);
    },
    [
      connectionId,
      currentPath,
      isProtocolSupported,
      loadDirectory,
      loadTransfers,
      protocol,
    ],
  );

  /**
   * Open the Tauri native-file-picker, then upload each selected file via the
   * SFTP adapter's `uploadFromPath`. Exists only when the bound adapter is
   * `TauriSFTPAdapter` (i.e. `protocol === 'sftp'`); callers should check the
   * returned `canPickAndUpload` flag before rendering the button.
   */
  const pickAndUpload = useCallback(async (): Promise<void> => {
    if (!isProtocolSupported) {
      console.warn(
        `${protocol?.toUpperCase() ?? "Unknown"} native uploads are not wired`,
      );
      setShowUploadDialog(false);
      return;
    }
    const adapter = sftpAdapterRef.current;
    if (!adapter) {
      console.warn(
        "pickAndUpload called but no TauriSFTPAdapter is registered",
      );
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
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
          localPath.split(/[\\/]/).filter(Boolean).pop() ?? "upload";
        const remotePath =
          currentPath === "/" ? `/${baseName}` : `${currentPath}/${baseName}`;
        try {
          await adapter.uploadFromPath(localPath, remotePath);
          await loadDirectory(currentPath);
          await loadTransfers();
        } catch (error) {
          console.error(`Upload of ${localPath} failed:`, error);
        }
      }
    } catch (error) {
      console.error("pickAndUpload failed:", error);
    } finally {
      setShowUploadDialog(false);
    }
  }, [
    currentPath,
    isProtocolSupported,
    loadDirectory,
    loadTransfers,
    protocol,
  ]);

  const handleDownload = useCallback(async () => {
    if (!isProtocolSupported) {
      console.warn(
        `${protocol?.toUpperCase() ?? "Unknown"} downloads are not wired`,
      );
      setSelectedFiles(new Set());
      return;
    }
    for (const fileName of selectedFiles) {
      const remotePath =
        currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;
      try {
        await fileServiceRef.current.downloadFile(
          connectionId,
          remotePath,
          fileName,
        );
        await loadTransfers();
      } catch (error) {
        console.error("Download failed:", error);
      }
    }
    setSelectedFiles(new Set());
  }, [
    connectionId,
    currentPath,
    isProtocolSupported,
    selectedFiles,
    loadTransfers,
    protocol,
  ]);

  const handleDelete = useCallback(async () => {
    if (!isProtocolSupported) {
      console.warn(
        `${protocol?.toUpperCase() ?? "Unknown"} deletes are not wired`,
      );
      setSelectedFiles(new Set());
      return;
    }
    if (!confirm(`Delete ${selectedFiles.size} selected item(s)?`)) return;
    for (const fileName of selectedFiles) {
      const remotePath =
        currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;
      try {
        await fileServiceRef.current.deleteFile(connectionId, remotePath);
      } catch (error) {
        console.error("Delete failed:", error);
      }
    }
    setSelectedFiles(new Set());
    loadDirectory(currentPath);
  }, [
    connectionId,
    currentPath,
    isProtocolSupported,
    selectedFiles,
    loadDirectory,
    protocol,
  ]);

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
      if (!isProtocolSupported) return;
      await fileServiceRef.current.resumeTransfer(transferId);
      await loadTransfers();
    },
    [isProtocolSupported, loadTransfers],
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
    isProtocolSupported,
    unsupportedReason,
    navigateToPath,
    navigateUp,
    handleFileSelect,
    handleDoubleClick,
    handleUpload,
    pickAndUpload,
    canPickAndUpload: isProtocolSupported,
    handleDownload,
    handleDelete,
    handleSelectAll,
    handleResumeTransfer,
  };
}

// ─── Formatting helpers ─────────────────────────────────────────────

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const getTransferProgress = (transfer: FileTransferSession): number => {
  return transfer.totalSize > 0
    ? (transfer.transferredSize / transfer.totalSize) * 100
    : 0;
};
