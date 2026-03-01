import { useState, useEffect, useRef, useCallback } from 'react';
import { FileTransferSession } from '../types/connection';
import { FileTransferService } from '../utils/fileTransferService';

export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  permissions?: string;
}

export function useFileTransfer(isOpen: boolean, connectionId: string) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [transfers, setTransfers] = useState<FileTransferSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const fileServiceRef = useRef(new FileTransferService());

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
