import { useState, useEffect, useCallback } from 'react';
import { ConnectionSession } from '../types/connection';

export interface SMBFile {
  name: string;
  type: 'file' | 'directory' | 'share';
  size: number;
  modified: Date;
  permissions?: string;
}

export function useSMBClient(session: ConnectionSession) {
  const [currentPath, setCurrentPath] = useState('\\');
  const [files, setFiles] = useState<SMBFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [shares, setShares] = useState<string[]>([]);
  const [currentShare, setCurrentShare] = useState<string>('');

  const loadShares = useCallback(async () => {
    setIsLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const mockShares = ['C$', 'D$', 'Users', 'Public', 'IPC$', 'ADMIN$'];
      setShares(mockShares);
      if (mockShares.length > 0) {
        setCurrentShare(mockShares[0]);
      }
    } catch (error) {
      console.error('Failed to load SMB shares:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const mockFiles: SMBFile[] = [
        { name: 'Windows', type: 'directory', size: 0, modified: new Date('2024-01-15'), permissions: 'drwxr-xr-x' },
        { name: 'Program Files', type: 'directory', size: 0, modified: new Date('2024-01-10'), permissions: 'drwxr-xr-x' },
        { name: 'Users', type: 'directory', size: 0, modified: new Date('2024-01-20'), permissions: 'drwxr-xr-x' },
        { name: 'config.ini', type: 'file', size: 2048, modified: new Date('2024-01-22'), permissions: '-rw-r--r--' },
        { name: 'system.log', type: 'file', size: 1048576, modified: new Date('2024-01-21'), permissions: '-rw-r--r--' },
      ];
      setFiles(mockFiles);
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  useEffect(() => {
    if (currentShare) {
      loadDirectory(currentPath);
    }
  }, [currentShare, currentPath, loadDirectory]);

  const navigateToPath = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
  }, []);

  const navigateUp = useCallback(() => {
    const parts = currentPath.split('\\').filter(p => p);
    if (parts.length > 0) {
      parts.pop();
      const parentPath = '\\' + parts.join('\\');
      navigateToPath(parentPath);
    }
  }, [currentPath, navigateToPath]);

  const handleFileSelect = useCallback((fileName: string) => {
    setSelectedFiles(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(fileName)) {
        newSelection.delete(fileName);
      } else {
        newSelection.add(fileName);
      }
      return newSelection;
    });
  }, []);

  const handleDoubleClick = useCallback((file: SMBFile) => {
    if (file.type === 'directory') {
      const newPath = currentPath === '\\' ? `\\${file.name}` : `${currentPath}\\${file.name}`;
      navigateToPath(newPath);
    }
  }, [currentPath, navigateToPath]);

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(files.map(f => f.name)));
  }, [files]);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const handleShareChange = useCallback((share: string) => {
    setCurrentShare(share);
    setCurrentPath('\\');
  }, []);

  const refreshDirectory = useCallback(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  return {
    currentPath,
    files,
    selectedFiles,
    isLoading,
    shares,
    currentShare,
    loadShares,
    navigateToPath,
    navigateUp,
    handleFileSelect,
    handleDoubleClick,
    selectAll,
    deselectAll,
    handleShareChange,
    refreshDirectory,
    formatFileSize,
    session,
  };
}
