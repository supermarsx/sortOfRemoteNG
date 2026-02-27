import React, { useState, useEffect } from 'react';
import { Folder, File, Download, Upload, Trash2, RefreshCw, Home, ArrowLeft, HardDrive } from 'lucide-react';
import { ConnectionSession } from '../types/connection';

interface SMBFile {
  name: string;
  type: 'file' | 'directory' | 'share';
  size: number;
  modified: Date;
  permissions?: string;
}

interface SMBClientProps {
  session: ConnectionSession;
}

export const SMBClient: React.FC<SMBClientProps> = ({ session }) => {
  const [currentPath, setCurrentPath] = useState('\\');
  const [files, setFiles] = useState<SMBFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [shares, setShares] = useState<string[]>([]);
  const [currentShare, setCurrentShare] = useState<string>('');

  useEffect(() => {
    loadShares();
  }, []);

  useEffect(() => {
    if (currentShare) {
      loadDirectory(currentPath);
    }
  }, [currentShare, currentPath]);

  const loadShares = async () => {
    setIsLoading(true);
    try {
      // Simulate loading SMB shares
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
  };

  const loadDirectory = async (path: string) => {
    setIsLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mock directory contents
      const mockFiles: SMBFile[] = [
        {
          name: 'Windows',
          type: 'directory',
          size: 0,
          modified: new Date('2024-01-15'),
          permissions: 'drwxr-xr-x',
        },
        {
          name: 'Program Files',
          type: 'directory',
          size: 0,
          modified: new Date('2024-01-10'),
          permissions: 'drwxr-xr-x',
        },
        {
          name: 'Users',
          type: 'directory',
          size: 0,
          modified: new Date('2024-01-20'),
          permissions: 'drwxr-xr-x',
        },
        {
          name: 'config.ini',
          type: 'file',
          size: 2048,
          modified: new Date('2024-01-22'),
          permissions: '-rw-r--r--',
        },
        {
          name: 'system.log',
          type: 'file',
          size: 1048576,
          modified: new Date('2024-01-21'),
          permissions: '-rw-r--r--',
        },
      ];

      setFiles(mockFiles);
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToPath = (path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
  };

  const navigateUp = () => {
    const parts = currentPath.split('\\').filter(p => p);
    if (parts.length > 0) {
      parts.pop();
      const parentPath = '\\' + parts.join('\\');
      navigateToPath(parentPath);
    }
  };

  const handleFileSelect = (fileName: string) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(fileName)) {
      newSelection.delete(fileName);
    } else {
      newSelection.add(fileName);
    }
    setSelectedFiles(newSelection);
  };

  const handleDoubleClick = (file: SMBFile) => {
    if (file.type === 'directory') {
      const newPath = currentPath === '\\' ? `\\${file.name}` : `${currentPath}\\${file.name}`;
      navigateToPath(newPath);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* SMB Header */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <HardDrive size={20} className="text-blue-400" />
            <span className="text-[var(--color-text)] font-medium">SMB Client - {session.hostname}</span>
          </div>
          
          <div className="flex items-center space-x-2">
            <select
              value={currentShare}
              onChange={(e) => {
                setCurrentShare(e.target.value);
                setCurrentPath('\\');
              }}
              className="px-3 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
            >
              {shares.map(share => (
                <option key={share} value={share}>{share}</option>
              ))}
            </select>
            
            <button
              onClick={loadShares}
              className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              title="Refresh shares"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => navigateToPath('\\')}
            className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            title="Root"
          >
            <Home size={16} />
          </button>
          <button
            onClick={navigateUp}
            disabled={currentPath === '\\'}
            className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-50"
            title="Up"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={() => loadDirectory(currentPath)}
            className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          
          <div className="flex-1 bg-[var(--color-border)] rounded px-3 py-2 text-[var(--color-textSecondary)] font-mono text-sm">
            \\{session.hostname}\{currentShare}{currentPath !== '\\' ? currentPath : ''}
          </div>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={24} className="animate-spin text-[var(--color-textSecondary)]" />
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[var(--color-border)] sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">
                  <input
                    type="checkbox"
                    checked={selectedFiles.size === files.length && files.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFiles(new Set(files.map(f => f.name)));
                      } else {
                        setSelectedFiles(new Set());
                      }
                    }}
                    className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">
                  Size
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">
                  Modified
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">
                  Permissions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {files.map(file => (
                <tr
                  key={file.name}
                  className={`hover:bg-[var(--color-border)] cursor-pointer ${
                    selectedFiles.has(file.name) ? 'bg-blue-900/20' : ''
                  }`}
                  onClick={() => handleFileSelect(file.name)}
                  onDoubleClick={() => handleDoubleClick(file)}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(file.name)}
                      onChange={() => handleFileSelect(file.name)}
                      className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--color-text)]">
                    <div className="flex items-center space-x-2">
                      {file.type === 'directory' ? (
                        <Folder size={16} className="text-blue-400" />
                      ) : (
                        <File size={16} className="text-[var(--color-textSecondary)]" />
                      )}
                      <span>{file.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
                    {file.type === 'file' ? formatFileSize(file.size) : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
                    {file.modified.toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)] font-mono">
                    {file.permissions || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Action Bar */}
      {selectedFiles.size > 0 && (
        <div className="bg-[var(--color-surface)] border-t border-[var(--color-border)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-textSecondary)] text-sm">
              {selectedFiles.size} item{selectedFiles.size !== 1 ? 's' : ''} selected
            </span>
            
            <div className="flex items-center space-x-2">
              <button className="px-3 py-1 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
                <Download size={14} />
                <span>Download</span>
              </button>
              
              <button className="px-3 py-1 bg-red-600 hover:bg-red-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
