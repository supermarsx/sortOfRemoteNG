import { FileTransferSession } from '../types/connection';
import { debugLog } from './debugLogger';
import { generateId } from './id';

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  permissions?: string;
}

export class FileTransferService {
  private activeTransfers = new Map<string, FileTransferSession>();

  async listDirectory(connectionId: string, path: string): Promise<FileItem[]> {
    // Simulate directory listing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mock directory contents
    const mockFiles: FileItem[] = [
      {
        name: 'documents',
        type: 'directory',
        size: 0,
        modified: new Date('2024-01-15'),
        permissions: 'drwxr-xr-x',
      },
      {
        name: 'downloads',
        type: 'directory',
        size: 0,
        modified: new Date('2024-01-10'),
        permissions: 'drwxr-xr-x',
      },
      {
        name: 'config.txt',
        type: 'file',
        size: 1024,
        modified: new Date('2024-01-20'),
        permissions: '-rw-r--r--',
      },
      {
        name: 'backup.zip',
        type: 'file',
        size: 5242880,
        modified: new Date('2024-01-18'),
        permissions: '-rw-r--r--',
      },
      {
        name: 'script.sh',
        type: 'file',
        size: 512,
        modified: new Date('2024-01-22'),
        permissions: '-rwxr-xr-x',
      },
    ];

    // Filter based on path
    if (path === '/documents') {
      return [
        {
          name: 'report.pdf',
          type: 'file',
          size: 2048576,
          modified: new Date('2024-01-19'),
          permissions: '-rw-r--r--',
        },
        {
          name: 'presentation.pptx',
          type: 'file',
          size: 8388608,
          modified: new Date('2024-01-17'),
          permissions: '-rw-r--r--',
        },
      ];
    }

    return mockFiles;
  }

  async uploadFile(connectionId: string, file: File, remotePath: string): Promise<void> {
    const transferId = generateId();
    const transfer: FileTransferSession = {
      id: transferId,
      connectionId,
      type: 'upload',
      localPath: file.name,
      remotePath,
      progress: 0,
      status: 'pending',
      startTime: new Date(),
      totalSize: file.size,
      transferredSize: 0,
    };

    this.activeTransfers.set(transferId, transfer);

    // Simulate upload progress
    transfer.status = 'active';
    this.activeTransfers.set(transferId, { ...transfer });

    const chunkSize = Math.max(file.size / 20, 1024); // 20 chunks minimum
    let transferred = 0;

    while (transferred < file.size) {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      transferred = Math.min(transferred + chunkSize, file.size);
      transfer.transferredSize = transferred;
      transfer.progress = (transferred / file.size) * 100;
      
      this.activeTransfers.set(transferId, { ...transfer });
    }

    transfer.status = 'completed';
    transfer.endTime = new Date();
    this.activeTransfers.set(transferId, { ...transfer });

    // Remove completed transfer after 5 seconds
    setTimeout(() => {
      this.activeTransfers.delete(transferId);
    }, 5000);
  }

  async downloadFile(connectionId: string, remotePath: string, fileName: string): Promise<void> {
    const transferId = generateId();
    const fileSize = Math.floor(Math.random() * 10000000) + 1000000; // Random size 1-10MB
    
    const transfer: FileTransferSession = {
      id: transferId,
      connectionId,
      type: 'download',
      localPath: fileName,
      remotePath,
      progress: 0,
      status: 'pending',
      startTime: new Date(),
      totalSize: fileSize,
      transferredSize: 0,
    };

    this.activeTransfers.set(transferId, transfer);

    // Simulate download progress
    transfer.status = 'active';
    this.activeTransfers.set(transferId, { ...transfer });

    const chunkSize = Math.max(fileSize / 20, 1024);
    let transferred = 0;

    while (transferred < fileSize) {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      transferred = Math.min(transferred + chunkSize, fileSize);
      transfer.transferredSize = transferred;
      transfer.progress = (transferred / fileSize) * 100;
      
      this.activeTransfers.set(transferId, { ...transfer });
    }

    transfer.status = 'completed';
    transfer.endTime = new Date();
    this.activeTransfers.set(transferId, { ...transfer });

    // Simulate file download
    const blob = new Blob(['Downloaded file content'], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Remove completed transfer after 5 seconds
    setTimeout(() => {
      this.activeTransfers.delete(transferId);
    }, 5000);
  }

  async deleteFile(connectionId: string, remotePath: string): Promise<void> {
    // Simulate file deletion
    await new Promise(resolve => setTimeout(resolve, 500));
    debugLog(`Deleted file: ${remotePath}`);
  }

  getActiveTransfers(connectionId: string): FileTransferSession[] {
    return Array.from(this.activeTransfers.values())
      .filter(transfer => transfer.connectionId === connectionId);
  }

  cancelTransfer(transferId: string): void {
    const transfer = this.activeTransfers.get(transferId);
    if (transfer) {
      transfer.status = 'cancelled';
      this.activeTransfers.set(transferId, transfer);
      
      setTimeout(() => {
        this.activeTransfers.delete(transferId);
      }, 1000);
    }
  }

  // SFTP specific methods
  async createDirectory(connectionId: string, path: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
    debugLog(`Created directory: ${path}`);
  }

  async renameFile(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
    debugLog(`Renamed ${oldPath} to ${newPath}`);
  }

  async changePermissions(connectionId: string, path: string, permissions: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
    debugLog(`Changed permissions of ${path} to ${permissions}`);
  }

  // SCP specific methods
  async scpUpload(connectionId: string, localFile: File, remotePath: string): Promise<void> {
    // SCP is typically a single file transfer
    return this.uploadFile(connectionId, localFile, remotePath);
  }

  async scpDownload(connectionId: string, remotePath: string, localPath: string): Promise<void> {
    return this.downloadFile(connectionId, remotePath, localPath);
  }
}
