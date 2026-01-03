import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Upload, Download, Folder, File, Trash2, RefreshCw, ArrowLeft, Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FileTransferSession } from '../types/connection';
import { FileTransferService } from '../utils/fileTransferService';

interface FileTransferManagerProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  protocol: 'ftp' | 'sftp' | 'scp';
}

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  permissions?: string;
}

export const FileTransferManager: React.FC<FileTransferManagerProps> = ({
  isOpen,
  onClose,
  connectionId,
  protocol,
}) => {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [transfers, setTransfers] = useState<FileTransferSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const fileServiceRef = useRef(new FileTransferService());

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const directoryContents = await fileServiceRef.current.listDirectory(connectionId, path);
      setFiles(directoryContents);
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

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

  const navigateToPath = (path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
  };

  const navigateUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateToPath(parentPath);
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

  const handleDoubleClick = (file: FileItem) => {
    if (file.type === 'directory') {
      const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      navigateToPath(newPath);
    }
  };

  const handleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
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
  };

  const handleDownload = async () => {
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
  };

  const handleDelete = async () => {
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
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getTransferProgress = (transfer: FileTransferSession): number => {
    return transfer.totalSize > 0 ? (transfer.transferredSize / transfer.totalSize) * 100 : 0;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">
            File Transfer - {protocol.toUpperCase()}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex h-[calc(90vh-120px)]">
          {/* File Browser */}
          <div className="flex-1 flex flex-col border-r border-gray-700">
            {/* Toolbar */}
            <div className="bg-gray-750 border-b border-gray-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => navigateToPath('/')}
                    className="p-2 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white"
                    title="Home"
                  >
                    <Home size={16} />
                  </button>
                  <button
                    onClick={navigateUp}
                    disabled={currentPath === '/'}
                    className="p-2 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-50"
                    title="Up"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <button
                    onClick={() => loadDirectory(currentPath)}
                    className="p-2 hover:bg-gray-600 rounded transition-colors text-gray-400 hover:text-white"
                    title="Refresh"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setShowUploadDialog(true)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
                  >
                    <Upload size={14} />
                    <span>Upload</span>
                  </button>
                  
                  {selectedFiles.size > 0 && (
                    <>
                      <button
                        onClick={handleDownload}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors flex items-center space-x-2"
                      >
                        <Download size={14} />
                        <span>Download</span>
                      </button>
                      
                      <button
                        onClick={handleDelete}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors flex items-center space-x-2"
                      >
                        <Trash2 size={14} />
                        <span>Delete</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Path */}
              <div className="bg-gray-700 rounded px-3 py-2 text-gray-300 font-mono text-sm">
                {currentPath}
              </div>
            </div>

            {/* File List */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw size={24} className="animate-spin text-gray-400" />
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-700 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">
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
                          className="rounded border-gray-600 bg-gray-700 text-blue-600"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">
                        Size
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">
                        Modified
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase">
                        Permissions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-600">
                    {files.map(file => (
                      <tr
                        key={file.name}
                        className={`hover:bg-gray-700 cursor-pointer ${
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
                            className="rounded border-gray-600 bg-gray-700 text-blue-600"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-white">
                          <div className="flex items-center space-x-2">
                            {file.type === 'directory' ? (
                              <Folder size={16} className="text-blue-400" />
                            ) : (
                              <File size={16} className="text-gray-400" />
                            )}
                            <span>{file.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {file.type === 'file' ? formatFileSize(file.size) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {file.modified.toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 font-mono">
                          {file.permissions || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Transfer Queue */}
          <div className="w-80 flex flex-col">
            <div className="bg-gray-750 border-b border-gray-700 p-4">
              <h3 className="text-white font-medium">Active Transfers</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {transfers.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <Upload size={24} className="mx-auto mb-2" />
                  <p>No active transfers</p>
                </div>
              ) : (
                transfers.map(transfer => (
                  <div key={transfer.id} className="bg-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        {transfer.type === 'upload' ? (
                          <Upload size={14} className="text-blue-400" />
                        ) : (
                          <Download size={14} className="text-green-400" />
                        )}
                        <span className="text-white text-sm font-medium">
                          {transfer.type === 'upload' ? 'Uploading' : 'Downloading'}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {getTransferProgress(transfer).toFixed(0)}%
                      </span>
                    </div>
                    
                    <p className="text-gray-300 text-sm truncate mb-2">
                      {transfer.remotePath.split('/').pop()}
                    </p>
                    
                    <div className="w-full bg-gray-600 rounded-full h-2 mb-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          transfer.status === 'error' ? 'bg-red-500' :
                          transfer.status === 'completed' ? 'bg-green-500' :
                          'bg-blue-500'
                        }`}
                        style={{ width: `${getTransferProgress(transfer)}%` }}
                      />
                    </div>
                    
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>{formatFileSize(transfer.transferredSize)} / {formatFileSize(transfer.totalSize)}</span>
                      <span className="capitalize">{transfer.status}</span>
                    </div>
                    
                    {transfer.error && (
                      <p className="text-red-400 text-xs mt-1">{transfer.error}</p>
                    )}

                    {transfer.status !== 'active' &&
                      transfer.status !== 'completed' &&
                      transfer.type === 'download' && (
                        <button
                          onClick={async () => {
                            await fileServiceRef.current.resumeTransfer(transfer.id);
                            await loadTransfers();
                          }}
                          className="mt-2 text-blue-400 text-xs hover:underline"
                        >
                          Resume
                        </button>
                      )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Upload Dialog */}
        {showUploadDialog && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="bg-gray-800 rounded-lg p-6 w-96">
              <h3 className="text-white font-medium mb-4">Upload Files</h3>
              
              <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center">
                <Upload size={48} className="mx-auto text-gray-400 mb-4" />
                <p className="text-gray-300 mb-4">Drop files here or click to browse</p>
                <input
                  type="file"
                  multiple
                  onChange={(e) => e.target.files && handleUpload(e.target.files)}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors cursor-pointer"
                >
                  Select Files
                </label>
              </div>
              
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowUploadDialog(false)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
